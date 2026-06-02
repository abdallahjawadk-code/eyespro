/**
 * Feature 5 — Advanced Content Analytics
 *
 * Provides deeper insights beyond the basic dashboardMetrics():
 *   - topicTrends()       : tag/keyword frequency over time
 *   - platformPerformance(): detailed per-platform stats with trend
 *   - contentTypeStats()  : performance by content type (text / image / video)
 *   - sourcePerformance() : which sources produce the best-performing articles
 *   - readinessBreakdown(): pipeline processing funnel
 *   - topArticles()       : most-published / highest success articles
 */

import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

// ─── Topic Trends ─────────────────────────────────────────────────────────────

export interface TopicDataPoint {
  date: string;   // YYYY-MM-DD
  count: number;
}

export interface TopicTrend {
  tag: string;
  total: number;
  trend: TopicDataPoint[];
}

/**
 * Return the top `topN` tags/keywords and their daily article counts
 * over the last `days` days.
 */
export function topicTrends(days = 30, topN = 15): TopicTrend[] {
  const tenant = tenantSqlClause();

  // Get all articles with tags in the window
  type Row = { tags: string; date: string };
  const rows = getDb()
    .prepare(
      `SELECT tags, date(created_at) AS date
       FROM articles
       WHERE tags IS NOT NULL AND tags != ''
         AND created_at >= datetime('now', ?)${tenant.sql}`
    )
    .all(`-${days} days`, ...tenant.params) as Row[];

  // Build tag → date → count
  const tagDateCount: Map<string, Map<string, number>> = new Map();

  for (const row of rows) {
    const date = row.date;
    for (const rawTag of row.tags.split(',')) {
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;
      if (!tagDateCount.has(tag)) tagDateCount.set(tag, new Map());
      const m = tagDateCount.get(tag)!;
      m.set(date, (m.get(date) ?? 0) + 1);
    }
  }

  // Sort by total and take top N
  const sorted = [...tagDateCount.entries()]
    .map(([tag, dateMap]) => ({
      tag,
      total: [...dateMap.values()].reduce((a, b) => a + b, 0),
      trend: [...dateMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);

  return sorted;
}

// ─── Platform Performance ─────────────────────────────────────────────────────

export interface PlatformPerformance {
  platform: string;
  totalPublishes: number;
  successCount: number;
  failCount: number;
  successRate: number;
  last7Days: number;       // publishes in last 7 days
  last30Days: number;      // publishes in last 30 days
  trend: 'up' | 'down' | 'stable';
}

export function platformPerformance(): PlatformPerformance[] {
  type Row = {
    platform: string;
    total: number;
    successes: number;
    last7: number;
    last30: number;
    prev7: number;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         platform,
         COUNT(*) AS total,
         SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN created_at >= datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS last7,
         SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last30,
         SUM(CASE WHEN created_at >= datetime('now', '-14 days')
                   AND created_at <  datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS prev7
       FROM publish_logs
       GROUP BY platform
       ORDER BY total DESC`
    )
    .all() as Row[];

  return rows.map((r) => {
    const successRate = r.total > 0 ? r.successes / r.total : 0;
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (r.last7 > r.prev7 * 1.2) trend = 'up';
    else if (r.last7 < r.prev7 * 0.8) trend = 'down';

    return {
      platform: r.platform,
      totalPublishes: r.total,
      successCount: r.successes,
      failCount: r.total - r.successes,
      successRate,
      last7Days: r.last7,
      last30Days: r.last30,
      trend,
    };
  });
}

// ─── Content Type Stats ───────────────────────────────────────────────────────

export interface ContentTypeStat {
  type: 'video' | 'image' | 'text';
  articleCount: number;
  publishedCount: number;
  publishRate: number;
  avgWordCount: number;
}

export function contentTypeStats(): ContentTypeStat[] {
  const tenant = tenantSqlClause();

  type Row = {
    type: 'video' | 'image' | 'text';
    total: number;
    published: number;
    avgWords: number;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         CASE
           WHEN video_url IS NOT NULL AND video_url != '' THEN 'video'
           WHEN image_url IS NOT NULL AND image_url != '' THEN 'image'
           ELSE 'text'
         END AS type,
         COUNT(*) AS total,
         SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
         AVG(COALESCE(word_count, 0)) AS avgWords
       FROM articles
       WHERE 1=1${tenant.sql}
       GROUP BY type`
    )
    .all(...tenant.params) as Row[];

  return rows.map((r) => ({
    type: r.type,
    articleCount: r.total,
    publishedCount: r.published,
    publishRate: r.total > 0 ? r.published / r.total : 0,
    avgWordCount: Math.round(r.avgWords),
  }));
}

// ─── Source Performance ───────────────────────────────────────────────────────

export interface SourcePerformance {
  source: string;
  articleCount: number;
  publishedCount: number;
  publishRate: number;
  avgWordCount: number;
  last30DaysArticles: number;
}

export function sourcePerformance(limit = 20): SourcePerformance[] {
  const tenant = tenantSqlClause();

  type Row = {
    source: string;
    total: number;
    published: number;
    avgWords: number;
    last30: number;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         COALESCE(source, 'غير معروف') AS source,
         COUNT(*) AS total,
         SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
         AVG(COALESCE(word_count, 0)) AS avgWords,
         SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last30
       FROM articles
       WHERE 1=1${tenant.sql}
       GROUP BY source
       ORDER BY total DESC
       LIMIT ?`
    )
    .all(...tenant.params, limit) as Row[];

  return rows.map((r) => ({
    source: r.source,
    articleCount: r.total,
    publishedCount: r.published,
    publishRate: r.total > 0 ? r.published / r.total : 0,
    avgWordCount: Math.round(r.avgWords),
    last30DaysArticles: r.last30,
  }));
}

// ─── Pipeline Funnel ─────────────────────────────────────────────────────────

export interface FunnelStep {
  step: string;
  count: number;
  percentage: number;
}

export function readinessFunnel(): FunnelStep[] {
  const tenant = tenantSqlClause();

  type Row = { step: string; count: number };
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(processing_status, 'new') AS step, COUNT(*) AS count
       FROM articles
       WHERE 1=1${tenant.sql}
       GROUP BY processing_status`
    )
    .all(...tenant.params) as Row[];

  const total = rows.reduce((s, r) => s + r.count, 0);
  return rows
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      step: r.step,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    }));
}

// ─── Top Articles ─────────────────────────────────────────────────────────────

export interface TopArticle {
  id: number;
  title: string;
  publishCount: number;
  successCount: number;
  platforms: string[];
  publishedAt: string | null;
}

export function topPublishedArticles(limit = 10): TopArticle[] {
  type Row = {
    id: number;
    title: string;
    publishCount: number;
    successCount: number;
    platforms: string;
    publishedAt: string | null;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         a.id, a.title, a.published_at AS publishedAt,
         COUNT(pl.id) AS publishCount,
         SUM(CASE WHEN pl.success=1 THEN 1 ELSE 0 END) AS successCount,
         GROUP_CONCAT(DISTINCT pl.platform) AS platforms
       FROM articles a
       JOIN publish_logs pl ON pl.article_id = a.id
       GROUP BY a.id
       ORDER BY publishCount DESC, successCount DESC
       LIMIT ?`
    )
    .all(limit) as Row[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    publishCount: r.publishCount,
    successCount: r.successCount,
    platforms: r.platforms ? r.platforms.split(',') : [],
    publishedAt: r.publishedAt,
  }));
}

// ─── Combined dashboard ───────────────────────────────────────────────────────

export function advancedDashboard() {
  return {
    topics: topicTrends(30, 10),
    platforms: platformPerformance(),
    contentTypes: contentTypeStats(),
    sources: sourcePerformance(10),
    funnel: readinessFunnel(),
    topArticles: topPublishedArticles(5),
  };
}
