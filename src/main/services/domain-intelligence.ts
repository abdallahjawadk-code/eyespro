import { getDb } from '../db/database';

export interface DomainIntelReport {
  host: string;
  totalRequests: number;
  successRate: number;
  avgDurationMs: number;
  browserFallbackRate: number;
  suggestedUseBrowser: boolean;
  suggestedFetchMode: 'smart' | 'http' | 'browser';
  notes: string[];
}

export function analyzeDomain(host: string): DomainIntelReport {
  type Row = { status_code: number; ok: number; method: string; duration_ms: number; cnt: number };
  const rows = getDb()
    .prepare(
      `SELECT status_code, ok, method, AVG(duration_ms) as duration_ms, COUNT(*) as cnt
       FROM fetch_audit_log
       WHERE url LIKE ? AND created_at > datetime('now', '-7 days')
       GROUP BY status_code, ok, method`
    )
    .all(`%${host}%`) as Row[];

  let total = 0;
  let successes = 0;
  let durationSum = 0;
  let browserCount = 0;
  let blockedCount = 0;

  for (const r of rows) {
    total += r.cnt;
    if (r.ok) successes += r.cnt;
    durationSum += r.duration_ms * r.cnt;
    if (r.method === 'browser') browserCount += r.cnt;
    if ([403, 429, 503].includes(r.status_code)) blockedCount += r.cnt;
  }

  const successRate = total > 0 ? successes / total : 0;
  const avgDurationMs = total > 0 ? Math.round(durationSum / total) : 0;
  const browserFallbackRate = total > 0 ? browserCount / total : 0;
  const notes: string[] = [];

  let suggestedUseBrowser = false;
  let suggestedFetchMode: 'smart' | 'http' | 'browser' = 'smart';

  if (blockedCount > total * 0.3 && total >= 5) {
    suggestedUseBrowser = true;
    suggestedFetchMode = 'browser';
    notes.push('High rate of 403/429/503 — consider browser fetch mode');
  } else if (successRate > 0.9 && browserFallbackRate < 0.1) {
    suggestedFetchMode = 'http';
    notes.push('Stable HTTP responses — http-only mode may suffice');
  }

  if (avgDurationMs > 8000) notes.push('Slow responses — increase fetch interval');

  return {
    host,
    totalRequests: total,
    successRate,
    avgDurationMs,
    browserFallbackRate,
    suggestedUseBrowser,
    suggestedFetchMode,
    notes
  };
}

export function listDomainIntelligence(limit = 20): DomainIntelReport[] {
  type Row = { host: string };
  const hosts = getDb()
    .prepare(
      `SELECT DISTINCT host FROM domain_circuit_state ORDER BY updated_at DESC LIMIT ?`
    )
    .all(limit) as Row[];

  if (hosts.length === 0) {
    type AuditHost = { url: string };
    const urls = getDb()
      .prepare(`SELECT url FROM fetch_audit_log ORDER BY created_at DESC LIMIT 100`)
      .all() as AuditHost[];
    const seen = new Set<string>();
    for (const u of urls) {
      try {
        seen.add(new URL(u.url).hostname);
      } catch { /* skip */ }
    }
    return [...seen].slice(0, limit).map((h) => analyzeDomain(h));
  }

  return hosts.map((h) => analyzeDomain(h.host));
}

/** Suggest domain policy update — observe only, no auto-apply. */
export function suggestDomainPolicy(host: string): { useBrowser: boolean; fetchMode: string; notes: string } | null {
  const intel = analyzeDomain(host);
  if (intel.totalRequests < 5) return null;
  return {
    useBrowser: intel.suggestedUseBrowser,
    fetchMode: intel.suggestedFetchMode,
    notes: intel.notes.join('; ') || 'No strong signal'
  };
}
