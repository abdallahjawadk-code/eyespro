/**
 * Integration tests for role-permissions against the REAL migrated schema.
 *
 * Regression guard: role_permissions must use platform + action columns (migration v51).
 * Before the fix the table had a single `resource` column, so list/set/hasPermission
 * threw "no such column: platform".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => teardownTestDb());

import { listPermissions, setPermission, hasPermission } from '../../src/main/services/permissions';

describe('role-permissions integration (real SQLite)', () => {
  it('schema: role_permissions has platform + action columns (migration v51)', () => {
    const cols = (db.prepare(`PRAGMA table_info(role_permissions)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('platform');
    expect(cols).toContain('action');
    expect(cols).not.toContain('resource');
  });

  it('seeds publish defaults: super_admin allowed, viewer denied', () => {
    const perms = listPermissions();
    expect(perms.length).toBeGreaterThan(0);
    expect(hasPermission('super_admin', 'telegram', 'publish')).toBe(true);
    expect(hasPermission('viewer', 'telegram', 'publish')).toBe(false);
  });

  it('setPermission inserts and upserts (ON CONFLICT) without throwing', () => {
    setPermission('reporter', 'twitter', 'publish', true);
    expect(hasPermission('reporter', 'twitter', 'publish')).toBe(true);
    setPermission('reporter', 'twitter', 'publish', false); // upsert same key
    expect(hasPermission('reporter', 'twitter', 'publish')).toBe(false);
  });

  it('distinguishes actions on the same platform', () => {
    setPermission('editor', 'facebook', 'delete', false);
    setPermission('editor', 'facebook', 'edit', true);
    expect(hasPermission('editor', 'facebook', 'delete')).toBe(false);
    expect(hasPermission('editor', 'facebook', 'edit')).toBe(true);
  });

  it('hasPermission returns false for an unknown role/platform/action combo', () => {
    expect(hasPermission('ghost', 'telegram', 'publish')).toBe(false);
  });
});
