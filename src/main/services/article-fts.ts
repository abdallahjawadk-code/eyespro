import { getDb } from '../db/database';

export function indexArticleFts(articleId: number, title: string, summary: string | null, content: string | null): void {
  try {
    getDb().prepare(`DELETE FROM articles_fts WHERE rowid=?`).run(articleId);
    getDb()
      .prepare(`INSERT INTO articles_fts(rowid, title, summary, content) VALUES (?,?,?,?)`)
      .run(articleId, title ?? '', summary ?? '', content ?? '');
  } catch { /* FTS unavailable */ }
}

export function removeArticleFts(articleId: number): void {
  try {
    getDb().prepare(`DELETE FROM articles_fts WHERE rowid=?`).run(articleId);
  } catch { /* ignore */ }
}

/** FTS5 search — returns article ids ordered by relevance */
export function searchArticleIdsFts(query: string, limit = 50): number[] {
  const q = query.trim().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"`).join(' ');
  try {
    const rows = getDb()
      .prepare(
        `SELECT rowid FROM articles_fts WHERE articles_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(terms, limit) as { rowid: number }[];
    return rows.map(r => r.rowid);
  } catch {
    return [];
  }
}
