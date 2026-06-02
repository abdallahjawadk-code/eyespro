import { getDb } from '../db/database';
import { sanitizeInt, sanitizeString } from '../security/sanitize';
import { getActiveTenantId, tenantSqlClause } from './tenant';
import { checkKeywords } from './keyword-alerts';
import { storeSimhash } from './dedup';
import { fireEvent } from './webhooks';
import { indexArticleFts, removeArticleFts, searchArticleIdsFts } from './article-fts';

export interface ArticleFull {
  id: number;
  title: string;
  summary: string | null;
  content: string | null;
  link: string | null;
  image_url: string | null;
  video_url?: string | null;
  source: string | null;
  category: string | null;
  status: string;
  workflow_status?: string | null;
  word_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  ingest_status?: string | null;
  original_url?: string | null;
  final_url?: string | null;
  redirect_chain_json?: string | null;
  fetch_method?: string | null;
  purity_score?: number | null;
  fetch_warnings_json?: string | null;
  quality_tier?: string | null;
  link_fingerprint?: string | null;
  link_health_state?: string | null;
  link_checked_at?: string | null;
  processing_status?: string | null;
  content_hash?: string | null;
  pipeline_quality_score?: number | null;
  pipeline_profile?: string | null;
  original_content?: string | null;
  sentiment?: string | null;
  sentiment_score?: number | null;
  tags?: string | null;
}

/** Columns returned in list views — excludes heavy `content` field */
const LIST_COLS = [
  'id', 'title', 'summary', 'link', 'image_url', 'video_url',
  'source', 'category', 'status', 'word_count',
  'published_at', 'created_at', 'updated_at',
  'processing_status', 'pipeline_quality_score', 'pipeline_profile',
  'ingest_status', 'purity_score', 'tenant_id',
].join(', ');

export function listArticles(opts?: {
  status?: string;
  category?: string;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
  page?: number;
  pageSize?: number;
  limit?: number;
}): ArticleFull[] {
  const status = opts?.status ? sanitizeString(opts.status, 32) : null;
  const category = opts?.category ? sanitizeString(opts.category, 120) : null;
  const source = opts?.source ? sanitizeString(opts.source, 200) : null;
  const search = opts?.search ? sanitizeString(opts.search, 100) : null;
  const dateFrom = opts?.dateFrom ? sanitizeString(opts.dateFrom, 32) : null;
  const dateTo = opts?.dateTo ? sanitizeString(opts.dateTo, 32) : null;

  const pageSize = sanitizeInt(opts?.pageSize ?? opts?.limit ?? 100, 1, 500);
  const page = Math.max(sanitizeInt(opts?.page ?? 1, 1), 1);
  const offset = (page - 1) * pageSize;
  const tenant = tenantSqlClause();

  // Use LIST_COLS to avoid sending heavy content field over IPC
  let sql = `SELECT ${LIST_COLS} FROM articles WHERE 1=1`;
  const params: unknown[] = [];
  sql += tenant.sql;
  params.push(...tenant.params);

  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (source && source !== 'all') {
    sql += ' AND source = ?';
    params.push(source);
  }
  if (search) {
    const ftsIds = searchArticleIdsFts(search, pageSize * 3);
    if (ftsIds.length > 0) {
      const placeholders = ftsIds.map(() => '?').join(',');
      sql += ` AND id IN (${placeholders})`;
      params.push(...ftsIds);
    } else {
      sql += ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }
  }
  if (dateFrom) {
    sql += ' AND created_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ' AND created_at <= ?';
    params.push(dateTo);
  }

  // Sorting
  const allowedSortFields = new Set(['updated_at', 'created_at', 'published_at', 'word_count', 'title']);
  const sortField = opts?.sortField && allowedSortFields.has(opts.sortField) ? opts.sortField : 'updated_at';
  const sortOrder = opts?.sortOrder === 'ASC' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortField} ${sortOrder}`;

  sql += ' LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  return getDb().prepare(sql).all(...params) as ArticleFull[];
}

export function countArticles(opts?: {
  status?: string;
  category?: string;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): number {
  const status = opts?.status ? sanitizeString(opts.status, 32) : null;
  const category = opts?.category ? sanitizeString(opts.category, 120) : null;
  const source = opts?.source ? sanitizeString(opts.source, 200) : null;
  const search = opts?.search ? sanitizeString(opts.search, 100) : null;
  const dateFrom = opts?.dateFrom ? sanitizeString(opts.dateFrom, 32) : null;
  const dateTo = opts?.dateTo ? sanitizeString(opts.dateTo, 32) : null;

  const tenant = tenantSqlClause();
  let sql = 'SELECT COUNT(*) AS count FROM articles WHERE 1=1';
  const params: unknown[] = [];
  sql += tenant.sql;
  params.push(...tenant.params);

  if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  if (source && source !== 'all') { sql += ' AND source = ?'; params.push(source); }

  if (search) {
    // Use FTS for consistency with listArticles (same result set)
    const ftsIds = searchArticleIdsFts(search, 10_000);
    if (ftsIds.length > 0) {
      sql += ` AND id IN (${ftsIds.map(() => '?').join(',')})`;
      params.push(...ftsIds);
    } else {
      // FTS returned nothing — count is 0
      return 0;
    }
  }

  if (dateFrom) { sql += ' AND created_at >= ?'; params.push(dateFrom); }
  if (dateTo)   { sql += ' AND created_at <= ?'; params.push(dateTo); }

  const row = getDb().prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getArticle(id: number): ArticleFull | null {
  const tenant = tenantSqlClause();
  const row = getDb()
    .prepare(`SELECT * FROM articles WHERE id = ?${tenant.sql}`)
    .get(id, ...tenant.params) as ArticleFull | undefined;
  return row ?? null;
}

/** Preserve pre-AI body for compare view; refreshed until rewrite completes successfully. */
export function snapshotOriginalBeforeRewrite(articleId: number): void {
  const art = getArticle(articleId);
  if (!art) return;

  const rewriteDone = getDb()
    .prepare(
      `SELECT 1 FROM article_processing_log
       WHERE article_id = ? AND step = 'rewrite' AND status = 'ok'
         AND COALESCE(message, '') LIKE 'completed%'
       LIMIT 1`
    )
    .get(articleId);
  if (rewriteDone) return;

  const snapshot =
    art.content?.trim() ||
    (art.summary?.trim() ? `<p>${art.summary.trim()}</p>` : '');
  if (!snapshot) return;

  getDb()
    .prepare(`UPDATE articles SET original_content = ? WHERE id = ?`)
    .run(sanitizeString(snapshot, 200_000), articleId);
}

/** Preserve pre-AI / pre-pipeline body once for compare view in production line. */
export function snapshotOriginalContentIfEmpty(articleId: number): void {
  const art = getArticle(articleId);
  if (!art) return;

  const row = getDb()
    .prepare(`SELECT original_content FROM articles WHERE id = ?`)
    .get(articleId) as { original_content: string | null } | undefined;
  if (row?.original_content?.trim()) return;

  const snapshot =
    art.content?.trim() ||
    (art.summary?.trim() ? `<p>${art.summary.trim()}</p>` : '');
  if (!snapshot) return;

  getDb()
    .prepare(`UPDATE articles SET original_content = ? WHERE id = ?`)
    .run(sanitizeString(snapshot, 200_000), articleId);
}

export function createArticle(data: Partial<ArticleFull>): number {
  const title = sanitizeString(data.title, 500) || 'Untitled';
  const content = sanitizeString(data.content, 200_000);
  const summary = sanitizeString(data.summary, 2000);
  const wc = content.split(/\s+/).filter(Boolean).length;
  const tenantId = getActiveTenantId();
  const publishedAt = data.published_at ? sanitizeString(data.published_at, 64) : null;
  const r = getDb()
    .prepare(
      `INSERT INTO articles (title, summary, content, link, image_url, video_url, source, category, status, word_count, ingest_status, published_at,
        original_url, final_url, redirect_chain_json, fetch_method, purity_score, fetch_warnings_json, tenant_id,
        quality_tier, link_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      summary || null,
      content || null,
      sanitizeString(data.link, 2000) || null,
      sanitizeString(data.image_url, 2000) || null,
      sanitizeString(data.video_url, 2000) || null,
      sanitizeString(data.source, 200) || null,
      sanitizeString(data.category, 120) || null,
      sanitizeString(data.status, 32) || 'draft',
      wc,
      sanitizeString(data.ingest_status, 64) || null,
      publishedAt,
      sanitizeString(data.original_url, 2000) || null,
      sanitizeString(data.final_url, 2000) || null,
      data.redirect_chain_json ? sanitizeString(data.redirect_chain_json, 4000) : null,
      sanitizeString(data.fetch_method, 32) || null,
      data.purity_score != null ? sanitizeInt(data.purity_score, 0, 100) : null,
      data.fetch_warnings_json ? sanitizeString(data.fetch_warnings_json, 4000) : null,
      tenantId,
      data.quality_tier ? sanitizeString(data.quality_tier, 16) : null,
      data.link_fingerprint ? sanitizeString(data.link_fingerprint, 64) : null
    );
  const newId = Number(r.lastInsertRowid);
  try { indexArticleFts(newId, title, summary || null, content || null); } catch { /* non-fatal */ }
  try { checkKeywords(newId, title, content || ''); } catch { /* non-fatal */ }
  try { storeSimhash(newId, title, summary || ''); } catch { /* non-fatal */ }
  fireEvent('article.created', { id: newId, title, source: data.source ?? null }).catch(() => undefined);
  return newId;
}

export function updateArticle(id: number, data: Partial<ArticleFull>): boolean {
  const tenant = tenantSqlClause();

  // Single-query update using COALESCE — avoids read-then-write pattern
  // Only re-compute word_count when content is explicitly provided
  const contentProvided = data.content !== undefined;
  const content = contentProvided ? sanitizeString(data.content, 200_000) : null;
  const wc = contentProvided
    ? String(content || '').split(/\s+/).filter(Boolean).length
    : null; // null means keep existing DB value

  const r = getDb()
    .prepare(
      `UPDATE articles SET
        title      = COALESCE(?, title),
        summary    = CASE WHEN ? THEN ? ELSE summary END,
        content    = CASE WHEN ? THEN ? ELSE content END,
        link       = CASE WHEN ? THEN ? ELSE link END,
        image_url  = CASE WHEN ? THEN ? ELSE image_url END,
        video_url  = CASE WHEN ? THEN ? ELSE video_url END,
        source     = CASE WHEN ? THEN ? ELSE source END,
        category   = CASE WHEN ? THEN ? ELSE category END,
        status     = COALESCE(?, status),
        word_count = CASE WHEN ? THEN ? ELSE word_count END,
        updated_at = datetime('now')
       WHERE id = ?${tenant.sql}`
    )
    .run(
      data.title !== undefined ? sanitizeString(data.title, 500) : null,
      // summary
      data.summary !== undefined ? 1 : 0, data.summary !== undefined ? sanitizeString(data.summary, 2000) : null,
      // content
      contentProvided ? 1 : 0, content,
      // link
      data.link !== undefined ? 1 : 0, data.link !== undefined ? sanitizeString(data.link, 2000) : null,
      // image_url
      data.image_url !== undefined ? 1 : 0, data.image_url !== undefined ? sanitizeString(data.image_url, 2000) : null,
      // video_url
      data.video_url !== undefined ? 1 : 0, data.video_url !== undefined ? sanitizeString(data.video_url, 2000) : null,
      // source
      data.source !== undefined ? 1 : 0, data.source !== undefined ? sanitizeString(data.source, 200) : null,
      // category
      data.category !== undefined ? 1 : 0, data.category !== undefined ? sanitizeString(data.category, 120) : null,
      // status
      data.status !== undefined ? sanitizeString(data.status, 32) : null,
      // word_count
      wc !== null ? 1 : 0, wc,
      id,
      ...tenant.params
    );

  if (r.changes > 0 && contentProvided) {
    // Re-index FTS only when content actually changed
    const updated = getArticle(id);
    if (updated) indexArticleFts(id, updated.title, updated.summary, updated.content);
  }
  return r.changes > 0;
}

/** Single-query dashboard statistics — avoids 4 separate COUNT queries */
export function dashboardStats(): { pending: number; published: number; sources: number; today: number } {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today
    FROM articles
  `).get() as { pending: number | null; published: number | null; today: number | null };

  const src = (getDb().prepare(`SELECT COUNT(*) AS c FROM sources WHERE enabled = 1`).get() as { c: number }).c;
  return {
    pending:   row?.pending   ?? 0,
    published: row?.published ?? 0,
    today:     row?.today     ?? 0,
    sources:   src,
  };
}

/** Batch init data for ArticlesPage — replaces 7+ separate IPC calls */
export interface PageInitData {
  categories: string[];
  stats: { total: number; draft: number; pending: number; published: number };
  platforms: string[];
}

export function articlesPageInit(): PageInitData {
  const tenant = tenantSqlClause();

  const statsRow = getDb().prepare(`
    SELECT
      COUNT(*)                                                        AS total,
      SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END)         AS draft,
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END)         AS pending,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END)         AS published
    FROM articles WHERE 1=1${tenant.sql}
  `).get(...tenant.params) as { total: number; draft: number; pending: number; published: number } | undefined;

  const catRows = getDb().prepare(
    `SELECT DISTINCT category FROM articles WHERE category IS NOT NULL AND category != ''${tenant.sql} ORDER BY category`
  ).all(...tenant.params) as { category: string }[];

  return {
    categories: catRows.map((r) => r.category),
    stats: {
      total:     statsRow?.total     ?? 0,
      draft:     statsRow?.draft     ?? 0,
      pending:   statsRow?.pending   ?? 0,
      published: statsRow?.published ?? 0,
    },
    platforms: [], // filled by caller who has access to publish service
  };
}

export function deleteArticle(id: number): boolean {
  const tenant = tenantSqlClause();
  const r = getDb().prepare(`DELETE FROM articles WHERE id = ?${tenant.sql}`).run(id, ...tenant.params);
  if (r.changes > 0) removeArticleFts(id);
  return r.changes > 0;
}

export function searchArticles(query: string, limit = 50): ArticleFull[] {
  const q = `%${sanitizeString(query, 100)}%`;
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(
      `SELECT * FROM articles WHERE (title LIKE ? OR summary LIKE ? OR content LIKE ?)${tenant.sql} ORDER BY updated_at DESC LIMIT ?`
    )
    .all(q, q, q, ...tenant.params, sanitizeInt(limit, 1, 200)) as ArticleFull[];
}

/**
 * Delete every article in the current tenant — used for "delete all" action.
 * Returns the count of deleted rows.
 */
export function deleteAllArticles(): number {
  const db     = getDb();
  const tenant = tenantSqlClause();
  // Build WHERE clause — either filter by tenant or delete all if no tenant
  const where  = tenant.sql ? `1=1${tenant.sql}` : '1=1';
  const result = db.prepare(`DELETE FROM articles WHERE ${where}`).run(...tenant.params);
  return result.changes;
}

export function bulkDeleteArticles(ids: number[]): number {
  const db = getDb();
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (deleteArticle(sanitizeInt(id, 1))) {
        n++;
      }
    }
  })();
  return n;
}

export function listCategories(): string[] {
  const tenant = tenantSqlClause();
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT category FROM articles WHERE category IS NOT NULL AND category != ''${tenant.sql} ORDER BY category`
    )
    .all(...tenant.params) as { category: string }[];
  return rows.map((r) => r.category);
}
