import { getDb } from '../db/database';
import { getActiveTenantId, tenantSqlClause } from './tenant';

export interface KeywordAlert {
  id: number;
  keyword: string;
  enabled: number;
  tenant_id: number | null;
  created_at: string;
}

export interface KeywordMatch {
  id: number;
  alert_id: number;
  article_id: number;
  dismissed: number;
  matched_at: string;
  keyword?: string;
  article_title?: string;
}

export function listAlerts(): KeywordAlert[] {
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(`SELECT * FROM keyword_alerts WHERE 1=1${tenant.sql} ORDER BY keyword`)
    .all(...tenant.params) as KeywordAlert[];
}

export function createAlert(keyword: string): number {
  const tenantId = getActiveTenantId();
  const r = getDb()
    .prepare(`INSERT INTO keyword_alerts (keyword, enabled, tenant_id) VALUES (?, 1, ?)`)
    .run(keyword.trim().toLowerCase(), tenantId);
  return Number(r.lastInsertRowid);
}

export function deleteAlert(id: number): boolean {
  return getDb().prepare(`DELETE FROM keyword_alerts WHERE id=?`).run(id).changes > 0;
}

export function toggleAlert(id: number, enabled: boolean): boolean {
  return getDb().prepare(`UPDATE keyword_alerts SET enabled=? WHERE id=?`).run(enabled ? 1 : 0, id).changes > 0;
}

export function checkKeywords(articleId: number, title: string, content: string): void {
  const tenant = tenantSqlClause();
  const alerts = getDb()
    .prepare(`SELECT * FROM keyword_alerts WHERE enabled=1${tenant.sql}`)
    .all(...tenant.params) as KeywordAlert[];

  const text = `${title} ${content}`.toLowerCase();
  for (const alert of alerts) {
    if (text.includes(alert.keyword)) {
      const exists = getDb()
        .prepare(`SELECT 1 FROM keyword_matches WHERE alert_id=? AND article_id=? LIMIT 1`)
        .get(alert.id, articleId);
      if (!exists) {
        getDb()
          .prepare(`INSERT INTO keyword_matches (alert_id, article_id, dismissed) VALUES (?, ?, 0)`)
          .run(alert.id, articleId);
      }
    }
  }
}

export function listMatches(dismissed = false): KeywordMatch[] {
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(
      `SELECT km.*, ka.keyword, a.title as article_title
       FROM keyword_matches km
       JOIN keyword_alerts ka ON ka.id = km.alert_id
       JOIN articles a ON a.id = km.article_id
       WHERE km.dismissed=?${tenant.sql.replace(/AND tenant_id=\?/, 'AND ka.tenant_id=?')}
       ORDER BY km.matched_at DESC LIMIT 200`
    )
    .all(dismissed ? 1 : 0, ...tenant.params) as KeywordMatch[];
}

export function dismissMatch(id: number): boolean {
  return getDb().prepare(`UPDATE keyword_matches SET dismissed=1 WHERE id=?`).run(id).changes > 0;
}
