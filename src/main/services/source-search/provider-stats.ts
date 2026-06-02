import { getDb } from '../../db/database';
import type { SearchProviderId } from './types';

export function recordProviderSuccess(provider: SearchProviderId, count: number): void {
  if (count <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO discovery_provider_stats (provider, success_count, fail_count, last_ok_at)
       VALUES (?, ?, 0, datetime('now'))
       ON CONFLICT(provider) DO UPDATE SET
         success_count = discovery_provider_stats.success_count + excluded.success_count,
         last_ok_at = datetime('now')`
    )
    .run(provider, count);
}

export function recordProviderFail(provider: SearchProviderId, err: string): void {
  getDb()
    .prepare(
      `INSERT INTO discovery_provider_stats (provider, success_count, fail_count, last_err, last_fail_at)
       VALUES (?, 0, 1, ?, datetime('now'))
       ON CONFLICT(provider) DO UPDATE SET
         fail_count = discovery_provider_stats.fail_count + 1,
         last_err = excluded.last_err,
         last_fail_at = datetime('now')`
    )
    .run(provider, err.slice(0, 240));
}

export function listProviderStats(): Array<{
  provider: string;
  success_count: number;
  fail_count: number;
  last_ok_at: string | null;
  last_err: string | null;
}> {
  return getDb()
    .prepare(`SELECT provider, success_count, fail_count, last_ok_at, last_err FROM discovery_provider_stats`)
    .all() as Array<{
    provider: string;
    success_count: number;
    fail_count: number;
    last_ok_at: string | null;
    last_err: string | null;
  }>;
}
