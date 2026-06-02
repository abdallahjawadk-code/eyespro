import { createHash } from 'node:crypto';
import { getDb } from '../../db/database';
import type { SourceSearchOptions } from './types';

export function discoveryCacheKey(opts: SourceSearchOptions): string {
  const raw = JSON.stringify({
    q: opts.query.trim().toLowerCase(),
    region: opts.region ?? 'SA',
    catalogId: opts.catalogId ?? '',
    sector: opts.sector ?? 'all',
    language: opts.language ?? 'any',
    p: opts.providers ?? {},
  });
  return createHash('sha256').update(raw).digest('hex');
}

export function clearDiscoveryCache(query?: string): number {
  const db = getDb();
  if (!query?.trim()) {
    const r = db.prepare(`DELETE FROM source_discovery_cache`).run();
    return r.changes;
  }
  const key = createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
  const r = db.prepare(`DELETE FROM source_discovery_cache WHERE query_hash LIKE ?`).run(`${key.slice(0, 16)}%`);
  return r.changes;
}
