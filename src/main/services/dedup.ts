/**
 * Feature 3 — Semantic Deduplication (SimHash)
 *
 * Detects near-duplicate articles even when titles/content differ slightly
 * (syndicated stories, rephrased headlines, minor edits).
 *
 * Algorithm: 32-bit SimHash over character 3-grams of normalized text.
 * Two articles are near-duplicates if their Hamming distance ≤ threshold (default 4).
 *
 * DB column: articles.simhash (INTEGER) — added in migration v21.
 */

import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

// ─── SimHash implementation ───────────────────────────────────────────────────

/** 32-bit FNV-1a hash of a string. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Extract all character n-grams from a string. */
function ngrams(text: string, n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    result.push(text.slice(i, i + n));
  }
  return result;
}

/** Normalise text for hashing: lowercase, strip punctuation/diacritics, collapse spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')   // Arabic diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // keep only letters, digits, spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute 32-bit SimHash for a text string.
 * Returns 0 for empty strings.
 */
export function simhash(text: string): number {
  if (!text) return 0;
  const normalised = normalise(text);
  const tokens = ngrams(normalised, 3);
  if (tokens.length === 0) return 0;

  const v = new Int32Array(32);  // signed intentional — we use +1/-1 weights

  for (const token of tokens) {
    const hash = fnv1a32(token);
    for (let i = 0; i < 32; i++) {
      v[i] += (hash >> i) & 1 ? 1 : -1;
    }
  }

  let result = 0;
  for (let i = 0; i < 32; i++) {
    if (v[i] > 0) result |= 1 << i;
  }
  return result >>> 0;  // unsigned
}

/** Count differing bits between two SimHashes (Hamming distance). */
export function hammingDistance(a: number, b: number): number {
  let xor = (a ^ b) >>> 0;
  let dist = 0;
  while (xor) {
    dist += xor & 1;
    xor >>>= 1;
  }
  return dist;
}

/** Strip HTML tags and boilerplate before hashing. */
function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute a combined SimHash from title + summary (weighted). */
export function articleSimhash(title: string, summary: string): number {
  const t = stripHtml(title);
  const s = stripHtml(summary);
  const combined = `${t} ${t} ${t} ${s}`;  // title weighted 3×
  return simhash(combined);
}

// ─── DB integration ───────────────────────────────────────────────────────────

export interface DuplicateMatch {
  id: number;
  title: string;
  link: string | null;
  distance: number;
  similarity: number;    // 0–1 (1 = identical)
}

/** Extract the 4 LSH band bytes from a 32-bit simhash. */
function hashBands(h: number): [number, number, number, number] {
  return [h & 0xFF, (h >> 8) & 0xFF, (h >> 16) & 0xFF, (h >>> 24) & 0xFF];
}

/**
 * Find existing articles that are near-duplicates of the given title+summary.
 *
 * Uses indexed LSH band columns (simhash_b0..b3) to pre-filter candidates in
 * SQLite, then computes Hamming distance only on the small result set.
 * Falls back to a full scan (limit 500) for rows that pre-date migration v34.
 */
export function findNearDuplicates(
  title: string,
  summary: string,
  threshold = 4,
  limit = 500
): DuplicateMatch[] {
  const hash = articleSimhash(title, summary);
  if (!hash) return [];

  const [b0, b1, b2, b3] = hashBands(hash);
  const tenant = tenantSqlClause();
  type Row = { id: number; title: string; link: string | null; simhash: number | null };

  // Band-index query: candidates share at least one 8-bit band with our hash.
  // Threshold ≤ 3 is guaranteed recall; threshold 4 has ~75% recall (acceptable for dedup).
  const bandRows = getDb()
    .prepare(
      `SELECT id, title, link, simhash FROM articles
       WHERE simhash IS NOT NULL
         AND (simhash_b0 = ? OR simhash_b1 = ? OR simhash_b2 = ? OR simhash_b3 = ?)
         ${tenant.sql}`
    )
    .all(b0, b1, b2, b3, ...tenant.params) as Row[];

  // Fallback: also scan rows that have simhash but NULL bands (pre-v34 rows).
  const legacyRows = getDb()
    .prepare(
      `SELECT id, title, link, simhash FROM articles
       WHERE simhash IS NOT NULL AND simhash_b0 IS NULL${tenant.sql}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...tenant.params, limit) as Row[];

  const seen = new Set<number>();
  const matches: DuplicateMatch[] = [];

  for (const row of [...bandRows, ...legacyRows]) {
    if (seen.has(row.id) || row.simhash == null) continue;
    seen.add(row.id);
    const dist = hammingDistance(hash, row.simhash >>> 0);
    if (dist <= threshold) {
      matches.push({
        id: row.id,
        title: row.title,
        link: row.link,
        distance: dist,
        similarity: 1 - dist / 32,
      });
    }
  }
  return matches.sort((a, b) => a.distance - b.distance);
}

/** Quick duplicate check — returns true + best match if a near-duplicate exists. */
export function isDuplicate(
  title: string,
  summary: string,
  threshold = 4
): { duplicate: boolean; match?: DuplicateMatch } {
  const matches = findNearDuplicates(title, summary, threshold);
  if (matches.length === 0) return { duplicate: false };
  return { duplicate: true, match: matches[0] };
}

/** Write the SimHash (and LSH bands) for an article into the DB. */
export function storeSimhash(articleId: number, title: string, summary: string): void {
  const hash = articleSimhash(title, summary);
  const [b0, b1, b2, b3] = hashBands(hash);
  getDb()
    .prepare(`UPDATE articles SET simhash=?, simhash_b0=?, simhash_b1=?, simhash_b2=?, simhash_b3=? WHERE id=?`)
    .run(hash, b0, b1, b2, b3, articleId);
}

/** Re-compute and store SimHashes (and bands) for all articles that don't have one yet. */
export function backfillSimhashes(limit = 1000): number {
  type Row = { id: number; title: string; summary: string | null };
  const rows = getDb()
    .prepare(`SELECT id, title, summary FROM articles WHERE simhash IS NULL LIMIT ?`)
    .all(limit) as Row[];

  const stmt = getDb().prepare(
    `UPDATE articles SET simhash=?, simhash_b0=?, simhash_b1=?, simhash_b2=?, simhash_b3=? WHERE id=?`
  );
  const run = getDb().transaction(() => {
    for (const row of rows) {
      const hash = articleSimhash(row.title, row.summary ?? '');
      const [b0, b1, b2, b3] = hashBands(hash);
      stmt.run(hash, b0, b1, b2, b3, row.id);
    }
  });
  run();
  return rows.length;
}

export function levenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0]![j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i]![j] = Math.min(
        tmp[i - 1]![j]! + 1, // deletion
        tmp[i]![j - 1]! + 1, // insertion
        tmp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[a.length]![b.length]!;
}

export function titleSimilarity(t1: string, t2: string): number {
  const s1 = t1.toLowerCase().trim();
  const s2 = t2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return 1 - dist / maxLen;
}

/** Check if there is a duplicate in the same source within the last 24 hours based on title similarity. */
export function isTitleSimilarSameSource(
  title: string,
  sourceName: string,
  threshold = 0.85
): boolean {
  const tenant = tenantSqlClause();
  type Row = { title: string };
  const rows = getDb()
    .prepare(
      `SELECT title FROM articles
       WHERE source = ? AND created_at > datetime('now', '-1 day')
       ${tenant.sql}`
    )
    .all(sourceName, ...tenant.params) as Row[];

  for (const row of rows) {
    if (titleSimilarity(title, row.title) > threshold) {
      return true;
    }
  }
  return false;
}
