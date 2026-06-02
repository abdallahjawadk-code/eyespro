import { getDb } from '../db/database';
import { getArticle } from './articles';
import { tenantSqlClause } from './tenant';

const WORKFLOW_ALIASES: Record<string, string> = {
  in_review: 'review',
  review: 'review',
  draft: 'draft',
  approved: 'approved',
  rejected: 'rejected',
};

function normalizeWorkflowStatus(status?: string): string {
  const key = String(status || 'review').trim().toLowerCase();
  return WORKFLOW_ALIASES[key] ?? key;
}

export function workflowQueue(status = 'review') {
  const wf = normalizeWorkflowStatus(status);
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(
      `SELECT id, title, category, workflow_status,
              workflow_status AS review_status,
              pipeline_quality_score AS quality_score,
              assignee_id, updated_at
       FROM articles WHERE workflow_status = ?${tenant.sql}
       ORDER BY updated_at DESC LIMIT 100`
    )
    .all(wf, ...tenant.params);
}

export function submitReview(articleId: number): boolean {
  const art = getArticle(articleId);
  if (!art) return false;
  if (art.workflow_status === 'review') return true;

  const tenant = tenantSqlClause();
  return (
    getDb()
      .prepare(
        `UPDATE articles
         SET workflow_status = 'review',
             status = CASE WHEN status = 'draft' THEN 'pending' ELSE status END,
             updated_at = datetime('now')
         WHERE id = ?${tenant.sql}`
      )
      .run(articleId, ...tenant.params).changes > 0
  );
}

export function approve(articleId: number, userId?: number): boolean {
  const tenant = tenantSqlClause();
  return (
    getDb()
      .prepare(
        `UPDATE articles SET workflow_status='approved', status='pending', assignee_id=?, updated_at=datetime('now') WHERE id=?${tenant.sql}`
      )
      .run(userId ?? null, articleId, ...tenant.params).changes > 0
  );
}

export function reject(articleId: number, reason?: string): boolean {
  const tenant = tenantSqlClause();
  const art = getArticle(articleId);
  if (!art) return false;
  getDb()
    .prepare(
      `INSERT INTO quality_reports (article_id, check_type, result_json) VALUES (?, 'reject', ?)`
    )
    .run(articleId, JSON.stringify({ reason: reason ?? '' }));
  return (
    getDb()
      .prepare(`UPDATE articles SET workflow_status='rejected', updated_at=datetime('now') WHERE id=?${tenant.sql}`)
      .run(articleId, ...tenant.params).changes > 0
  );
}

export function runQualityCheck(articleId: number, checkType: string): { ok: boolean; score: number; details: string } {
  const article = getArticle(articleId);
  if (!article) return { ok: false, score: 0, details: 'Not found' };
  const text = `${article.title} ${article.content || ''}`;
  let score = 100;
  const issues: string[] = [];
  if (text.length < 200) {
    score -= 30;
    issues.push('short_content');
  }
  if (!article.summary) {
    score -= 15;
    issues.push('missing_summary');
  }
  if (!article.image_url) {
    score -= 10;
    issues.push('missing_image');
  }
  const result = { issues, wordCount: article.word_count };
  getDb()
    .prepare(`INSERT INTO quality_reports (article_id, check_type, score, result_json) VALUES (?, ?, ?, ?)`)
    .run(articleId, checkType, score, JSON.stringify(result));
  return { ok: score >= 60, score, details: issues.join(', ') || 'ok' };
}

export function listReports(articleId?: number, limit = 50) {
  const tenant = tenantSqlClause('a');
  if (articleId) {
    const art = getArticle(articleId);
    if (!art) return [];
    return getDb()
      .prepare(`SELECT qr.* FROM quality_reports qr WHERE qr.article_id=? ORDER BY qr.created_at DESC LIMIT ?`)
      .all(articleId, limit);
  }
  return getDb()
    .prepare(
      `SELECT qr.* FROM quality_reports qr JOIN articles a ON a.id = qr.article_id WHERE 1=1${tenant.sql} ORDER BY qr.created_at DESC LIMIT ?`
    )
    .all(...tenant.params, limit);
}

export function qualityStats() {
  const tenant = tenantSqlClause('a');
  const avg = getDb()
    .prepare(`SELECT AVG(qr.score) AS avg FROM quality_reports qr JOIN articles a ON a.id = qr.article_id WHERE 1=1${tenant.sql}`)
    .get(...tenant.params) as { avg: number | null };
  const rows = getDb()
    .prepare(
      `SELECT workflow_status, COUNT(*) AS c
       FROM articles a
       WHERE workflow_status IN ('review', 'approved', 'rejected', 'draft')${tenant.sql}
       GROUP BY workflow_status`
    )
    .all(...tenant.params) as { workflow_status: string; c: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.workflow_status] = r.c;
  const inReview = map.review ?? 0;
  return {
    avgScore: avg.avg ?? 0,
    pendingReview: inReview,
    workflow: {
      in_review: inReview,
      review: inReview,
      approved: map.approved ?? 0,
      rejected: map.rejected ?? 0,
      draft: map.draft ?? 0,
    },
  };
}
