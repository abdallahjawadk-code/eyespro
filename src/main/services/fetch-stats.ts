import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

/** Count articles by fetch quality tier (observe-only stats). */
export function getQualityTierStats(): Record<string, number> {
  const tenant = tenantSqlClause();
  type Row = { quality_tier: string | null; cnt: number };
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(quality_tier, 'unknown') as quality_tier, COUNT(*) as cnt
       FROM articles WHERE 1=1${tenant.sql}
       GROUP BY quality_tier`
    )
    .all(...tenant.params) as Row[];

  const stats: Record<string, number> = {};
  for (const r of rows) stats[r.quality_tier ?? 'unknown'] = r.cnt;
  return stats;
}

/** Link health summary from articles table. */
export function getLinkHealthStats(): Record<string, number> {
  const tenant = tenantSqlClause();
  type Row = { link_health_state: string | null; cnt: number };
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(link_health_state, 'unchecked') as link_health_state, COUNT(*) as cnt
       FROM articles WHERE link IS NOT NULL${tenant.sql}
       GROUP BY link_health_state`
    )
    .all(...tenant.params) as Row[];

  const stats: Record<string, number> = {};
  for (const r of rows) stats[r.link_health_state ?? 'unchecked'] = r.cnt;
  return stats;
}
