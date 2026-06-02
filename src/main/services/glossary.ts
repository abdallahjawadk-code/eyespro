/**
 * Feature 4 — Institution Terminology Glossary
 *
 * Lets editors define canonical spellings / replacements for names, brands,
 * and terms specific to their organisation. Applied automatically to
 * article titles and content after ingestion (pipeline sanitize step).
 *
 * DB table: glossary_terms  (added in migration v22)
 * Fields: id, term, replacement, enabled, case_sensitive, created_at
 */

import { getDb } from '../db/database';
import { getArticle } from './articles';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GlossaryTerm {
  id:            number;
  term:          string;
  replacement:   string;
  enabled:       boolean;
  caseSensitive: boolean;
  createdAt:     string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listTerms(): GlossaryTerm[] {
  type Row = { id: number; term: string; replacement: string; enabled: number; case_sensitive: number; created_at: string };
  return (getDb().prepare(`SELECT * FROM glossary_terms ORDER BY term ASC`).all() as Row[])
    .map((r) => ({
      id:            r.id,
      term:          r.term,
      replacement:   r.replacement,
      enabled:       r.enabled === 1,
      caseSensitive: r.case_sensitive === 1,
      createdAt:     r.created_at,
    }));
}

export function createTerm(term: string, replacement: string, caseSensitive = false): number {
  if (!term?.trim() || !replacement?.trim()) throw new Error('المصطلح والبديل مطلوبان');
  const r = getDb()
    .prepare(
      `INSERT INTO glossary_terms (term, replacement, enabled, case_sensitive)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(term) DO UPDATE SET replacement=excluded.replacement, enabled=1`
    )
    .run(term.trim(), replacement.trim(), caseSensitive ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function updateTerm(id: number, data: Partial<Pick<GlossaryTerm, 'term' | 'replacement' | 'enabled' | 'caseSensitive'>>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.term        !== undefined) { sets.push('term=?');           vals.push(data.term); }
  if (data.replacement !== undefined) { sets.push('replacement=?');    vals.push(data.replacement); }
  if (data.enabled     !== undefined) { sets.push('enabled=?');        vals.push(data.enabled ? 1 : 0); }
  if (data.caseSensitive !== undefined) { sets.push('case_sensitive=?'); vals.push(data.caseSensitive ? 1 : 0); }
  if (!sets.length) return;
  getDb().prepare(`UPDATE glossary_terms SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
  invalidateCache();
}

export function deleteTerm(id: number): void {
  getDb().prepare(`DELETE FROM glossary_terms WHERE id=?`).run(id);
  invalidateCache();
}

// ─── Application ──────────────────────────────────────────────────────────────

let cache: GlossaryTerm[] | null = null;
let cacheTime = 0;

function invalidateCache(): void { cache = null; }

function getActiveTerms(): GlossaryTerm[] {
  const now = Date.now();
  if (cache && now - cacheTime < 60_000) return cache;
  cache = listTerms().filter((t) => t.enabled);
  cacheTime = now;
  return cache;
}

/**
 * Apply all enabled glossary terms to a text string.
 * Longer terms are applied first to avoid partial replacements.
 */
export function applyGlossary(text: string): string {
  if (!text) return text;
  const terms = getActiveTerms();
  if (!terms.length) return text;

  // Sort by term length descending (replace longer terms first)
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  let result = text;

  for (const { term, replacement, caseSensitive } of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use word boundaries for terms that are standalone words
    const pattern = new RegExp(`\\b${escaped}\\b`, caseSensitive ? 'g' : 'gi');
    result = result.replace(pattern, replacement);
  }

  return result;
}

/** Apply glossary to an article's title, content, and summary in-place. */
export function applyGlossaryToArticle(articleId: number): { applied: number } {
  const article = getArticle(articleId);
  if (!article) return { applied: 0 };

  const newTitle   = applyGlossary(article.title);
  const newContent = applyGlossary(article.content ?? '');
  const newSummary = applyGlossary(article.summary ?? '');

  const changed =
    (newTitle   !== article.title   ? 1 : 0) +
    (newContent !== article.content ? 1 : 0) +
    (newSummary !== article.summary ? 1 : 0);

  if (changed > 0) {
    getDb()
      .prepare(
        `UPDATE articles SET title=?, content=?, summary=?, updated_at=datetime('now') WHERE id=?`
      )
      .run(newTitle, newContent, newSummary, articleId);
  }

  return { applied: changed };
}

/** Bulk-apply glossary to all articles that have never been processed. */
export function bulkApplyGlossary(limit = 500): { processed: number; changed: number } {
  type Row = { id: number };
  const rows = getDb()
    .prepare(`SELECT id FROM articles ORDER BY id DESC LIMIT ?`)
    .all(limit) as Row[];

  let changed = 0;
  for (const { id } of rows) {
    const r = applyGlossaryToArticle(id);
    if (r.applied > 0) changed++;
  }
  return { processed: rows.length, changed };
}
