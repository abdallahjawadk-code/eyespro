/**
 * Feature 12 — Editor Performance Reports
 *
 * Tracks per-editor and team-wide publishing metrics over time.
 * Queries articles by assignee_id + publish_logs for success rates.
 */

import { getDb } from '../db/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EditorStat {
  userId:          number;
  username:        string;
  role:            string;
  articlesAssigned: number;
  articlesPublished: number;
  articlesDraft:   number;
  avgProcessingHours: number | null;  // time from creation to published
  publishSuccessRate: number;
  topPlatforms:    string[];
  last30Days:      number;            // articles published in last 30 days
}

export interface TeamReport {
  period:       string;     // e.g. "last_30_days"
  totalArticles: number;
  publishedArticles: number;
  editors:      EditorStat[];
  busiest:      EditorStat | null;
  mostEfficient: EditorStat | null;   // highest publish success rate
  avgPublishTime: number | null;      // hours
}

// ─── Per-editor stats ─────────────────────────────────────────────────────────

export function editorStats(userId?: number, days = 30): EditorStat[] {
  const where = userId ? 'AND a.assignee_id = ?' : '';
  const params: unknown[] = [`-${days} days`];
  if (userId) params.push(userId);

  type Row = {
    user_id: number; username: string; role: string;
    assigned: number; published: number; draft: number;
    avg_hours: number | null; last30: number;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         u.id AS user_id, u.username, u.role,
         COUNT(a.id) AS assigned,
         SUM(CASE WHEN a.status='published' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN a.status='draft' THEN 1 ELSE 0 END) AS draft,
         AVG(CASE
           WHEN a.published_at IS NOT NULL
           THEN (julianday(a.published_at) - julianday(a.created_at)) * 24
         END) AS avg_hours,
         SUM(CASE WHEN a.published_at >= datetime('now',?) THEN 1 ELSE 0 END) AS last30
       FROM users u
       LEFT JOIN articles a ON a.assignee_id = u.id
       WHERE 1=1 ${where}
       GROUP BY u.id
       ORDER BY published DESC`
    )
    .all(...params) as Row[];

  return rows.map((r) => {
    // Get publish success rate from publish_logs
    type PubRow = { total: number; success: number; platforms: string };
    const pubRow = getDb()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN pl.success=1 THEN 1 ELSE 0 END) AS success,
                GROUP_CONCAT(DISTINCT pl.platform) AS platforms
         FROM publish_logs pl
         JOIN articles a ON a.id = pl.article_id
         WHERE a.assignee_id = ? AND pl.created_at >= datetime('now', ?)`
      )
      .get(r.user_id, `-${days} days`) as PubRow;

    const successRate = pubRow?.total > 0 ? pubRow.success / pubRow.total : 0;
    const topPlatforms = pubRow?.platforms
      ? pubRow.platforms.split(',').slice(0, 3)
      : [];

    return {
      userId:             r.user_id,
      username:           r.username,
      role:               r.role,
      articlesAssigned:   r.assigned,
      articlesPublished:  r.published,
      articlesDraft:      r.draft,
      avgProcessingHours: r.avg_hours != null ? Math.round(r.avg_hours * 10) / 10 : null,
      publishSuccessRate: successRate,
      topPlatforms,
      last30Days:         r.last30,
    };
  });
}

// ─── Team report ──────────────────────────────────────────────────────────────

export function teamReport(days = 30): TeamReport {
  const editors = editorStats(undefined, days);

  type CountRow = { total: number; published: number; avg_hours: number | null };
  const totals = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
         AVG(CASE
           WHEN published_at IS NOT NULL
           THEN (julianday(published_at) - julianday(created_at)) * 24
         END) AS avg_hours
       FROM articles
       WHERE created_at >= datetime('now', ?)`
    )
    .get(`-${days} days`) as CountRow;

  const withArticles = editors.filter((e) => e.articlesAssigned > 0);
  const busiest     = withArticles.sort((a, b) => b.articlesPublished - a.articlesPublished)[0] ?? null;
  const mostEfficient = withArticles
    .filter((e) => e.articlesPublished >= 3)
    .sort((a, b) => b.publishSuccessRate - a.publishSuccessRate)[0] ?? null;

  return {
    period:            `last_${days}_days`,
    totalArticles:     totals.total,
    publishedArticles: totals.published,
    editors,
    busiest,
    mostEfficient,
    avgPublishTime:    totals.avg_hours != null ? Math.round(totals.avg_hours * 10) / 10 : null,
  };
}
