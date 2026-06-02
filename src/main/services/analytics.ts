import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

export function dashboardMetrics() {
  const db = getDb();
  const tenant = tenantSqlClause();
  const tenantA = tenantSqlClause('a');

  // Per-status counts
  const articleRows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM articles WHERE 1=1${tenant.sql} GROUP BY status`)
    .all(...tenant.params) as { status: string; c: number }[];

  // Aggregated totals
  const total = articleRows.reduce((s, r) => s + r.c, 0);
  const published = articleRows.find((r) => r.status === 'published')?.c ?? 0;
  const pending   = articleRows.find((r) => r.status === 'pending')?.c ?? 0;

  // Articles published today
  const today = (
    db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE date(created_at)=date('now')${tenant.sql}`)
      .get(...tenant.params) as { c: number }
  ).c;

  // Active sources count
  const sources = (
    db.prepare(`SELECT COUNT(*) AS c FROM sources WHERE enabled=1${tenant.sql}`)
      .get(...tenant.params) as { c: number }
  ).c;

  // Publish rate (published / total * 100)
  const publishRate = total > 0 ? Math.round((published / total) * 100) : 0;

  // Average word count of published articles
  const avgWordsRow = db
    .prepare(`SELECT ROUND(AVG(word_count),0) AS avg FROM articles WHERE status='published'${tenant.sql}`)
    .get(...tenant.params) as { avg: number | null };
  const avgWords = Math.round(avgWordsRow.avg ?? 0);

  // Platform publish performance - with fallback for empty results
  let publish: { platform: string; success: number; total: number }[] = [];
  try {
    if (tenantA.sql) {
      publish = db.prepare(
        `SELECT pl.platform, SUM(pl.success) AS success, COUNT(*) AS total
         FROM publish_logs pl JOIN articles a ON a.id = pl.article_id
         WHERE 1=1${tenantA.sql} GROUP BY pl.platform`
      ).all(...tenantA.params) as { platform: string; success: number; total: number }[];
    } else {
      // No tenant filtering - query publish_logs directly
      publish = db.prepare(
        `SELECT platform, SUM(success) AS success, COUNT(*) AS total
         FROM publish_logs GROUP BY platform`
      ).all() as { platform: string; success: number; total: number }[];
    }
  } catch {
    publish = [];
  }

  // Last 7 days activity
  const byDay = (
    db.prepare(
      `SELECT date(created_at) AS date, COUNT(*) AS count
       FROM articles WHERE created_at >= date('now', '-6 days')${tenant.sql}
       GROUP BY date(created_at) ORDER BY date(created_at)`
    ).all(...tenant.params) as { date: string; count: number }[]
  );

  // Sentiment counts
  const sentimentRows = db
    .prepare(`SELECT sentiment, COUNT(*) AS c FROM articles WHERE sentiment IS NOT NULL${tenant.sql} GROUP BY sentiment`)
    .all(...tenant.params) as { sentiment: string; c: number }[];

  const avgSentimentScoreRow = db
    .prepare(`SELECT AVG(sentiment_score) AS avg FROM articles WHERE sentiment_score IS NOT NULL${tenant.sql}`)
    .get(...tenant.params) as { avg: number | null };
  const avgSentimentScore = avgSentimentScoreRow.avg !== null ? Number(avgSentimentScoreRow.avg.toFixed(2)) : null;

  return {
    articles: articleRows,
    publish,
    byDay,
    total,
    published,
    pending,
    today,
    sources,
    publishRate,
    avgWords,
    sentiments: sentimentRows,
    avgSentimentScore
  };
}

export interface PublishLogRow {
  id: number;
  article_id: number;
  article_title: string | null;
  platform: string;
  success: number;
  post_url: string | null;
  error: string | null;
  created_at: string;
}

export function publishLogs(limit = 100): PublishLogRow[] {
  const db = getDb();
  const tenant = tenantSqlClause('a');
  try {
    return db
      .prepare(
        `SELECT pl.id, pl.article_id, a.title AS article_title,
                pl.platform, pl.success, pl.post_url, pl.error, pl.created_at
         FROM publish_logs pl
         LEFT JOIN articles a ON a.id = pl.article_id
         WHERE 1=1${tenant.sql}
         ORDER BY pl.created_at DESC
         LIMIT ?`
      )
      .all(...tenant.params, limit) as PublishLogRow[];
  } catch {
    return [];
  }
}

export function recordMetric(articleId: number, platform: string, key: string, value: number): void {
  try {
    getDb()
      .prepare(`INSERT INTO post_metrics (article_id, platform, metric_key, metric_value) VALUES (?, ?, ?, ?)`)
      .run(articleId, platform, key, value);
  } catch {
    // Table may not exist yet - ignore
  }
}

export function exportCsv(): string {
  const tenant = tenantSqlClause('a');
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.title, a.status, a.source, a.published_at, a.word_count FROM articles a WHERE 1=1${tenant.sql} ORDER BY a.id`
    )
    .all(...tenant.params) as Record<string, unknown>[];
  const header = 'id,title,status,source,published_at,word_count';
  const lines = rows.map((r) =>
    [r.id, r.title, r.status, r.source, r.published_at, r.word_count]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export interface NotifItem {
  id: number;
  type: string;
  message: string;
  created_at: string;
  kind: 'system' | 'keyword';
  dismissed: number;
}

export function listAlerts(limit = 20): NotifItem[] {
  const db = getDb();
  let sys: NotifItem[] = [];
  let kw: NotifItem[] = [];
  try {
    sys = db
      .prepare(`SELECT id, alert_type AS type, message, created_at, 'system' AS kind, dismissed FROM system_alerts WHERE dismissed=0 ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as NotifItem[];
  } catch { /* table may not exist */ }
  try {
    kw = db
      .prepare(
        `SELECT km.id, 'keyword' AS type,
                ka.keyword || ': ' || a.title AS message,
                km.matched_at AS created_at, 'keyword' AS kind, km.dismissed
         FROM keyword_matches km
         JOIN keyword_alerts ka ON ka.id = km.alert_id
         JOIN articles a ON a.id = km.article_id
         WHERE km.dismissed = 0
           AND km.matched_at >= datetime('now', '-48 hours')
         ORDER BY km.matched_at DESC LIMIT ?`
      )
      .all(limit) as NotifItem[];
  } catch { /* table may not exist */ }
  return [...sys, ...kw]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function dismissAlert(id: number): void {
  try { getDb().prepare(`UPDATE system_alerts SET dismissed=1 WHERE id=?`).run(id); } catch { /* ignore */ }
}

export function dismissNotif(id: number, kind: 'system' | 'keyword'): void {
  try {
    if (kind === 'keyword') {
      getDb().prepare(`UPDATE keyword_matches SET dismissed=1 WHERE id=?`).run(id);
    } else {
      getDb().prepare(`UPDATE system_alerts SET dismissed=1 WHERE id=?`).run(id);
    }
  } catch { /* ignore */ }
}

export function runAlertCheck(): number {
  const db = getDb();
  const pending = (db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE status='pending'`).get() as { c: number }).c;
  if (pending > 50) {
    try {
      const recent = db
        .prepare(`SELECT 1 FROM system_alerts WHERE alert_type='backlog' AND dismissed=0 AND created_at >= datetime('now','-6 hours') LIMIT 1`)
        .get();
      if (!recent) {
        db.prepare(`INSERT INTO system_alerts (alert_type, message) VALUES ('backlog', ?)`).run(`${pending} مقالة في الانتظار`);
        return 1;
      }
    } catch { /* table may not exist */ }
  }
  return 0;
}
