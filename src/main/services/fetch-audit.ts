import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';

export interface FetchAuditEntry {
  sourceId?: number;
  articleId?: number;
  url: string;
  finalUrl?: string;
  method: string;
  statusCode?: number;
  durationMs: number;
  bytesRead?: number;
  ok: boolean;
  error?: string;
  warnings?: string[];
}

export function logFetchAudit(entry: FetchAuditEntry): number {
  const r = getDb()
    .prepare(
      `INSERT INTO fetch_audit_log (source_id, article_id, url, final_url, method, status_code, duration_ms, bytes_read, ok, error, warnings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.sourceId ?? null,
      entry.articleId ?? null,
      sanitizeString(entry.url, 2048),
      entry.finalUrl ? sanitizeString(entry.finalUrl, 2048) : null,
      sanitizeString(entry.method, 32),
      entry.statusCode ?? 0,
      entry.durationMs,
      entry.bytesRead ?? 0,
      entry.ok ? 1 : 0,
      entry.error ? sanitizeString(entry.error, 500) : null,
      entry.warnings?.length ? JSON.stringify(entry.warnings.slice(0, 20)) : null
    );
  return Number(r.lastInsertRowid);
}

export function listFetchAudit(opts?: { sourceId?: number; limit?: number }) {
  const limit = Math.min(opts?.limit ?? 50, 200);
  if (opts?.sourceId) {
    return getDb()
      .prepare(`SELECT * FROM fetch_audit_log WHERE source_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(opts.sourceId, limit);
  }
  return getDb()
    .prepare(`SELECT * FROM fetch_audit_log ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

export function sourceFetchHealth(sourceId: number): {
  total: number;
  ok: number;
  fail: number;
  avgMs: number;
  lastError: string | null;
} {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS fail,
         AVG(duration_ms) AS avgMs
       FROM fetch_audit_log
       WHERE source_id=? AND created_at >= datetime('now', '-7 days')`
    )
    .get(sourceId) as { total: number; ok: number; fail: number; avgMs: number } | undefined;
  const lastErr = getDb()
    .prepare(`SELECT error FROM fetch_audit_log WHERE source_id=? AND ok=0 ORDER BY created_at DESC LIMIT 1`)
    .get(sourceId) as { error: string } | undefined;
  return {
    total: row?.total ?? 0,
    ok: row?.ok ?? 0,
    fail: row?.fail ?? 0,
    avgMs: Math.round(row?.avgMs ?? 0),
    lastError: lastErr?.error ?? null
  };
}
