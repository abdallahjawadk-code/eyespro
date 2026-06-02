import { getDb } from '../../db/database';
import type { CatalogEntry } from './types';

export type CatalogSuggestion = {
  id: number;
  name: string;
  feed_url: string;
  website: string | null;
  sector: string | null;
  language: string | null;
  status: string;
  created_at: string;
};

export function suggestCatalogSource(input: {
  name: string;
  feedUrl: string;
  website?: string;
  sector?: string;
  language?: string;
}): CatalogSuggestion {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO catalog_suggestions (name, feed_url, website, sector, language, status)
       VALUES (?,?,?,?,?,'approved')`
    )
    .run(
      input.name.trim(),
      input.feedUrl.trim(),
      input.website?.trim() || null,
      input.sector || null,
      input.language || null
    );
  return db
    .prepare(`SELECT * FROM catalog_suggestions WHERE id=?`)
    .get(r.lastInsertRowid) as CatalogSuggestion;
}

export function listSuggestions(status = 'approved'): CatalogSuggestion[] {
  return getDb()
    .prepare(`SELECT * FROM catalog_suggestions WHERE status=? ORDER BY id DESC LIMIT 200`)
    .all(status) as CatalogSuggestion[];
}

export function communityCatalogEntry(): CatalogEntry {
  const rows = listSuggestions('approved');
  return {
    id: 'community',
    name: 'مجتمع EyesPro',
    description: 'مصادر أضافها المستخدمون',
    language: 'mixed',
    items: rows.map((r) => ({
      name: r.name,
      website: r.website || r.feed_url,
      feedUrl: r.feed_url,
      type: 'rss',
      tags: [r.sector || 'community', r.language || ''].filter(Boolean),
    })),
  };
}
