import { getDb } from '../db/database';

const DEFAULT_TRUST = 50;

export function getSourceTrust(sourceId: number): number {
  const row = getDb()
    .prepare(`SELECT trust_score FROM sources WHERE id=?`)
    .get(sourceId) as { trust_score: number | null } | undefined;
  return row?.trust_score ?? DEFAULT_TRUST;
}

export function updateTrustAfterFetch(
  sourceId: number,
  result: { ok: boolean; saved: number; notModified?: boolean; error?: string }
): void {
  let delta = 0;
  if (result.ok) {
    if (result.notModified) delta = 1;
    else if (result.saved > 0) delta = Math.min(5, result.saved);
    else delta = 0;
  } else {
    delta = -5;
  }

  getDb()
    .prepare(
      `UPDATE sources SET trust_score = MAX(0, MIN(100, COALESCE(trust_score, ?) + ?)) WHERE id=?`
    )
    .run(DEFAULT_TRUST, delta, sourceId);
}

export function listLowTrustSources(threshold = 30, limit = 20) {
  return getDb()
    .prepare(
      `SELECT id, name, url, trust_score, last_error FROM sources
       WHERE enabled=1 AND COALESCE(trust_score, ?) < ?
       ORDER BY trust_score ASC LIMIT ?`
    )
    .all(DEFAULT_TRUST, threshold, limit);
}
