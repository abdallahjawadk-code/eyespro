import { getDb } from '../db/database';
import { headRequest, getText } from '../net/http';
import { isUrlFetchAllowedAsync } from '../security/fetch-guard';

export type LinkHealthState = 'healthy' | 'redirect' | 'broken' | 'unknown';

export interface LinkHealthReport {
  url: string;
  ok: boolean;
  statusCode: number;
  state: LinkHealthState;
  checkedAt: string;
}

function classifyHealth(status: number): LinkHealthState {
  if (status >= 200 && status < 300) return 'healthy';
  if ([301, 302, 303, 307, 308].includes(status)) return 'redirect';
  if (status === 404 || status === 410 || status >= 500) return 'broken';
  return 'unknown';
}

export async function checkLinkHealth(url: string): Promise<LinkHealthReport> {
  const checkedAt = new Date().toISOString();
  const allowed = await isUrlFetchAllowedAsync(url);
  if (!allowed.ok) {
    return { url, ok: false, statusCode: 0, state: 'broken', checkedAt };
  }

  let status = 0;
  try {
    const head = await headRequest(url, {}, { redirectsLeft: 3, validateRedirect: isUrlFetchAllowedAsync });
    status = head.status;
    if (head.ok || head.notModified) {
      return { url, ok: true, statusCode: status, state: classifyHealth(status), checkedAt };
    }
    if (status === 405 || status === 501) {
      const get = await getText(url, { Range: 'bytes=0-0' }, { maxBytes: 1024, redirectsLeft: 3, validateRedirect: isUrlFetchAllowedAsync });
      status = get.status;
    }
  } catch {
    return { url, ok: false, statusCode: 0, state: 'unknown', checkedAt };
  }

  const state = classifyHealth(status);
  return { url, ok: state === 'healthy' || state === 'redirect', statusCode: status, state, checkedAt };
}

export function persistLinkHealth(articleId: number, report: LinkHealthReport): void {
  getDb()
    .prepare(
      `UPDATE articles SET link_health_state=?, link_checked_at=? WHERE id=?`
    )
    .run(report.state, report.checkedAt, articleId);

  getDb()
    .prepare(
      `INSERT INTO link_health_log (article_id, url, status_code, health_state, checked_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(articleId, report.url, report.statusCode, report.state, report.checkedAt);
}

/** Check stale article links (soft — no auto-delete). */
export async function runPeriodicLinkHealth(limit = 10): Promise<number> {
  type Row = { id: number; link: string };
  const rows = getDb()
    .prepare(
      `SELECT id, link FROM articles
       WHERE link IS NOT NULL AND link != ''
         AND (link_checked_at IS NULL OR link_checked_at < datetime('now', '-24 hours'))
       ORDER BY link_checked_at IS NULL DESC, link_checked_at ASC
       LIMIT ?`
    )
    .all(limit) as Row[];

  let checked = 0;
  for (const row of rows) {
    try {
      const report = await checkLinkHealth(row.link);
      persistLinkHealth(row.id, report);
      checked++;
    } catch { /* skip */ }
  }
  return checked;
}

export function listLinkHealthLog(limit = 50) {
  return getDb()
    .prepare(`SELECT * FROM link_health_log ORDER BY checked_at DESC LIMIT ?`)
    .all(limit);
}
