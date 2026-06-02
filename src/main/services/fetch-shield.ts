import { getDb } from '../db/database';

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

export type CircuitMode = 'normal' | 'open' | 'feed_only';

export interface CircuitState {
  host: string;
  mode: CircuitMode;
  failureCount: number;
  shieldScore: number;
  openUntil: string | null;
}

function rowToState(row: {
  host: string;
  failure_count: number;
  open_until: string | null;
  shield_score: number;
  mode: string | null;
}): CircuitState {
  const now = Date.now();
  const openUntilMs = row.open_until ? new Date(row.open_until).getTime() : 0;
  let mode: CircuitMode = (row.mode as CircuitMode) || 'normal';
  if (row.open_until && openUntilMs > now) mode = 'open';
  else if (mode === 'open') mode = 'feed_only';
  return {
    host: row.host,
    mode,
    failureCount: row.failure_count,
    shieldScore: row.shield_score ?? 100,
    openUntil: row.open_until
  };
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function getCircuitState(host: string): CircuitState {
  const row = getDb()
    .prepare(`SELECT host, failure_count, open_until, shield_score, mode FROM domain_circuit_state WHERE host=?`)
    .get(host) as
    | { host: string; failure_count: number; open_until: string | null; shield_score: number; mode: string | null }
    | undefined;
  if (!row) {
    return { host, mode: 'normal', failureCount: 0, shieldScore: 100, openUntil: null };
  }
  const now = Date.now();
  const openUntilMs = row.open_until ? new Date(row.open_until).getTime() : 0;
  if (row.mode === 'open' && row.open_until && openUntilMs <= now) {
    getDb()
      .prepare(`UPDATE domain_circuit_state SET mode='feed_only', open_until=NULL, updated_at=datetime('now') WHERE host=?`)
      .run(host);
    return rowToState({ ...row, mode: 'feed_only', open_until: null });
  }
  return rowToState(row);
}

export function listCircuitStates(limit = 50): CircuitState[] {
  type Row = { host: string; failure_count: number; open_until: string | null; shield_score: number; mode: string | null };
  const rows = getDb()
    .prepare(`SELECT host, failure_count, open_until, shield_score, mode FROM domain_circuit_state ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Row[];
  return rows.map((r) => getCircuitState(r.host));
}

export function getShieldOverview(): {
  totalHosts: number;
  openCount: number;
  feedOnlyCount: number;
  avgScore: number;
} {
  type Row = { total: number; open_c: number; feed_c: number; avg_score: number | null };
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN mode='open' AND open_until > datetime('now') THEN 1 ELSE 0 END) as open_c,
              SUM(CASE WHEN mode='feed_only' THEN 1 ELSE 0 END) as feed_c,
              AVG(shield_score) as avg_score
       FROM domain_circuit_state`
    )
    .get() as Row;
  return {
    totalHosts: row?.total ?? 0,
    openCount: row?.open_c ?? 0,
    feedOnlyCount: row?.feed_c ?? 0,
    avgScore: Math.round(row?.avg_score ?? 100)
  };
}

export function checkCircuit(host: string): { allowed: boolean; mode: CircuitMode; reason?: string } {
  if (!host) return { allowed: true, mode: 'normal' };
  const state = getCircuitState(host);
  if (state.mode === 'open') {
    return { allowed: false, mode: 'open', reason: `Circuit open for ${host} until ${state.openUntil}` };
  }
  return { allowed: true, mode: state.mode };
}

export function isFeedOnlyMode(host: string): boolean {
  return getCircuitState(host).mode === 'feed_only';
}

export function recordFetchSuccess(host: string): void {
  if (!host) return;
  getDb()
    .prepare(
      `INSERT INTO domain_circuit_state (host, failure_count, open_until, shield_score, mode, updated_at)
       VALUES (?, 0, NULL, 100, 'normal', datetime('now'))
       ON CONFLICT(host) DO UPDATE SET
         failure_count = 0,
         open_until = NULL,
         shield_score = MIN(100, domain_circuit_state.shield_score + 5),
         mode = 'normal',
         updated_at = datetime('now')`
    )
    .run(host);
}

export function recordFetchFailure(host: string, statusCode: number): void {
  if (!host) return;
  const cur = getCircuitState(host);
  const failures = cur.failureCount + 1;
  let mode: CircuitMode = cur.mode;
  let openUntil: string | null = null;
  const shieldScore = Math.max(0, cur.shieldScore - (statusCode === 429 ? 15 : 10));

  if (failures >= FAILURE_THRESHOLD || statusCode === 429) {
    mode = 'open';
    openUntil = new Date(Date.now() + OPEN_DURATION_MS).toISOString();
  }

  getDb()
    .prepare(
      `INSERT INTO domain_circuit_state (host, failure_count, open_until, shield_score, mode, last_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(host) DO UPDATE SET
         failure_count = excluded.failure_count,
         open_until = COALESCE(excluded.open_until, domain_circuit_state.open_until),
         shield_score = excluded.shield_score,
         mode = excluded.mode,
         last_status = excluded.last_status,
         updated_at = datetime('now')`
    )
    .run(host, failures, openUntil, shieldScore, mode, statusCode);

  // Transition open → feed_only when pause expires (checked on next getCircuitState)
  const state = getCircuitState(host);
  if (state.mode === 'open' && state.openUntil && new Date(state.openUntil).getTime() <= Date.now()) {
    getDb()
      .prepare(`UPDATE domain_circuit_state SET mode='feed_only', open_until=NULL, updated_at=datetime('now') WHERE host=?`)
      .run(host);
  }
}

/** Parse Retry-After header (seconds or HTTP-date). Returns delay in ms, capped at 2 min. */
export function parseRetryAfter(header: string | undefined): number | null {
  if (!header?.trim()) return null;
  const trimmed = header.trim();
  const secs = Number(trimmed);
  if (!Number.isNaN(secs) && secs >= 0) return Math.min(secs * 1000, 120_000);
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(0, dateMs - Date.now()), 120_000);
  return null;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
