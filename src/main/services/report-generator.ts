import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

export type ReportPeriod = 'weekly' | 'monthly';

interface ReportData {
  period: ReportPeriod;
  from: string;
  to: string;
  totalArticles: number;
  publishedArticles: number;
  failedPublishes: number;
  topSources: { name: string; count: number }[];
  topCategories: { name: string; count: number }[];
  platformBreakdown: { platform: string; count: number }[];
}

export function generateReport(period: ReportPeriod): ReportData {
  const now = new Date();
  const days = period === 'weekly' ? 7 : 30;
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const to = now.toISOString();
  const tenant = tenantSqlClause();

  const db = getDb();

  const totalArticles = (db
    .prepare(`SELECT COUNT(*) as n FROM articles WHERE created_at >= ?${tenant.sql}`)
    .get(from, ...tenant.params) as { n: number }).n;

  // publish_logs records success as an INTEGER flag (0/1) and uses created_at —
  // it has no `status` or `published_at` column (see migrations + the INSERTs in
  // publish.ts). Querying those threw "no such column: published_at".
  const publishedArticles = (db
    .prepare(`SELECT COUNT(*) as n FROM publish_logs WHERE created_at >= ? AND success=1${tenant.sql}`)
    .get(from, ...tenant.params) as { n: number }).n;

  const failedPublishes = (db
    .prepare(`SELECT COUNT(*) as n FROM publish_logs WHERE created_at >= ? AND success=0${tenant.sql}`)
    .get(from, ...tenant.params) as { n: number }).n;

  // articles store the source as a text column (`source`); there is no source_id
  // FK to the sources table, so group by the text value directly.
  const topSources = db
    .prepare(
      `SELECT COALESCE(NULLIF(source,''),'غير معروف') as name, COUNT(*) as count
       FROM articles WHERE created_at >= ?${tenant.sql}
       GROUP BY name ORDER BY count DESC LIMIT 10`
    )
    .all(from, ...tenant.params) as { name: string; count: number }[];

  const topCategories = db
    .prepare(
      `SELECT COALESCE(category,'بدون تصنيف') as name, COUNT(*) as count
       FROM articles WHERE created_at >= ?${tenant.sql}
       GROUP BY category ORDER BY count DESC LIMIT 10`
    )
    .all(from, ...tenant.params) as { name: string; count: number }[];

  const platformBreakdown = db
    .prepare(
      `SELECT platform, COUNT(*) as count
       FROM publish_logs WHERE created_at >= ? AND success=1${tenant.sql}
       GROUP BY platform ORDER BY count DESC`
    )
    .all(from, ...tenant.params) as { platform: string; count: number }[];

  return { period, from, to, totalArticles, publishedArticles, failedPublishes, topSources, topCategories, platformBreakdown };
}

export function generateReportHtml(period: ReportPeriod): string {
  const data = generateReport(period);
  const title = period === 'weekly' ? 'التقرير الأسبوعي' : 'التقرير الشهري';
  const fromDate = new Date(data.from).toLocaleDateString('ar-SA');
  const toDate = new Date(data.to).toLocaleDateString('ar-SA');

  const rows = (items: { name?: string; platform?: string; count: number }[]) =>
    items.map(i => `<tr><td>${i.name || i.platform || ''}</td><td>${i.count}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; }
  h1 { color: #a78bfa; } h2 { color: #7c3aed; border-bottom: 1px solid #334155; padding-bottom: 8px; }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 24px 0; }
  .stat { background: #1e293b; border-radius: 12px; padding: 20px 32px; text-align: center; }
  .stat .n { font-size: 2.5em; font-weight: bold; color: #a78bfa; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 10px 16px; text-align: right; border-bottom: 1px solid #1e293b; }
  th { background: #1e293b; color: #a78bfa; }
</style>
</head>
<body>
<h1>${title} — ${fromDate} إلى ${toDate}</h1>
<div class="stats">
  <div class="stat"><div class="n">${data.totalArticles}</div><div>مقالات مجلوبة</div></div>
  <div class="stat"><div class="n">${data.publishedArticles}</div><div>نشر ناجح</div></div>
  <div class="stat"><div class="n">${data.failedPublishes}</div><div>نشر فاشل</div></div>
</div>
<h2>أبرز المصادر</h2>
<table><tr><th>المصدر</th><th>المقالات</th></tr>${rows(data.topSources)}</table>
<h2>التصنيفات</h2>
<table><tr><th>التصنيف</th><th>المقالات</th></tr>${rows(data.topCategories)}</table>
<h2>المنصات</h2>
<table><tr><th>المنصة</th><th>المنشورات</th></tr>${rows(data.platformBreakdown)}</table>
</body></html>`;
}
