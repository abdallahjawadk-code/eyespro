/**
 * Integration tests for keyword-alerts against the REAL migrated schema.
 *
 * Regression guard: keyword_alerts must carry the `enabled` and `tenant_id`
 * columns the service writes/filters on (added in migration v50). Before the fix,
 * createAlert/toggleAlert/checkKeywords threw "no column named enabled".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import type Database from 'better-sqlite3';

vi.mock('../../src/main/services/tenant', () => ({
  tenantSqlClause: () => ({ sql: '', params: [] }),
  getActiveTenantId: () => null,
}));

let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => teardownTestDb());

import {
  createAlert, listAlerts, toggleAlert, deleteAlert, checkKeywords, listMatches,
} from '../../src/main/services/keyword-alerts';

describe('keyword-alerts integration (real SQLite)', () => {
  it('schema: keyword_alerts has enabled + tenant_id columns (migration v50)', () => {
    const cols = (db.prepare(`PRAGMA table_info(keyword_alerts)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('enabled');
    expect(cols).toContain('tenant_id');
  });

  it('createAlert inserts a row and returns its id (this was the broken path)', () => {
    const id = createAlert('Gaza');
    expect(id).toBeGreaterThan(0);
    const alerts = listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].keyword).toBe('gaza'); // normalized lowercase
    expect(alerts[0].enabled).toBe(1);
  });

  it('toggleAlert flips the enabled flag', () => {
    const id = createAlert('Economy');
    expect(toggleAlert(id, false)).toBe(true);
    expect(listAlerts()[0].enabled).toBe(0);
    expect(toggleAlert(id, true)).toBe(true);
    expect(listAlerts()[0].enabled).toBe(1);
  });

  it('deleteAlert removes the row', () => {
    const id = createAlert('Sports');
    expect(deleteAlert(id)).toBe(true);
    expect(listAlerts()).toHaveLength(0);
  });

  it('checkKeywords records a match for an enabled keyword and lists it', () => {
    const id = createAlert('election');
    const art = db.prepare(`INSERT INTO articles (title, summary, status) VALUES (?, ?, 'draft')`)
      .run('National election results announced', 'details').lastInsertRowid as number;

    checkKeywords(art, 'National election results announced', 'full body about the election');
    const matches = listMatches(false);
    expect(matches).toHaveLength(1);
    expect(matches[0].alert_id).toBe(id);
    expect(matches[0].article_id).toBe(art);
  });

  it('checkKeywords ignores disabled keywords', () => {
    const id = createAlert('weather');
    toggleAlert(id, false);
    const art = db.prepare(`INSERT INTO articles (title, summary, status) VALUES (?, ?, 'draft')`)
      .run('Weather forecast today', 'sunny').lastInsertRowid as number;
    checkKeywords(art, 'Weather forecast today', 'weather is sunny');
    expect(listMatches(false)).toHaveLength(0);
  });
});
