import { getDb } from '../db/database';

const MIN_INTERVAL = 15;
const MAX_INTERVAL = 360;
const DEFAULT_INTERVAL = 30;

/** Adjust fetch interval based on recent yield — soft scheduling only. */
export function refreshAdaptiveInterval(
  sourceId: number,
  fetchResult: { saved: number; ok: boolean }
): number {
  const row = getDb()
    .prepare(`SELECT fetch_interval_min FROM sources WHERE id=?`)
    .get(sourceId) as { fetch_interval_min: number | null } | undefined;

  let interval = row?.fetch_interval_min && row.fetch_interval_min > 0
    ? row.fetch_interval_min
    : DEFAULT_INTERVAL;

  if (!fetchResult.ok) {
    interval = Math.min(MAX_INTERVAL, interval + 15);
  } else if (fetchResult.saved >= 5) {
    interval = Math.max(MIN_INTERVAL, interval - 10);
  } else if (fetchResult.saved === 0) {
    interval = Math.min(MAX_INTERVAL, interval + 5);
  }

  const next = new Date(Date.now() + interval * 60_000).toISOString();
  getDb()
    .prepare(`UPDATE sources SET fetch_interval_min=?, next_fetch_at=? WHERE id=?`)
    .run(interval, next, sourceId);

  return interval;
}

/** Honor RSS/Atom TTL publisher hint (RFC 822 RSS 2.0). Soft bounds: 15–360 min. */
export function applyPublisherTtl(sourceId: number, ttlMinutes: number): void {
  const bounded = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, ttlMinutes));
  const next = new Date(Date.now() + bounded * 60_000).toISOString();
  getDb()
    .prepare(`UPDATE sources SET fetch_interval_min=?, next_fetch_at=? WHERE id=?`)
    .run(bounded, next, sourceId);
}

export function computeSuggestedInterval(sourceId: number): number {
  type Row = { ok: number; cnt: number };
  const stats = getDb()
    .prepare(
      `SELECT SUM(ok) as ok, COUNT(*) as cnt FROM fetch_audit_log
       WHERE source_id=? AND created_at > datetime('now', '-3 days')`
    )
    .get(sourceId) as Row | undefined;

  if (!stats || !stats.cnt || stats.cnt < 3) return DEFAULT_INTERVAL;
  const successRate = (stats.ok ?? 0) / stats.cnt;
  if (successRate > 0.8) return MIN_INTERVAL;
  if (successRate < 0.3) return MAX_INTERVAL;
  return DEFAULT_INTERVAL;
}
