import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import type Database from 'better-sqlite3';

// Helpers must be imported before the modules under test
let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => teardownTestDb());

import { checkRateLimit, recordAttempt, clearLoginAttempts } from '../../src/main/auth/login-rate-limit';

describe('rate-limit integration (real SQLite)', () => {
  it('allows login with zero previous failures', () => {
    expect(checkRateLimit('alice')).toEqual({ ok: true });
  });

  it('allows login with 7 failures (below limit of 8)', () => {
    for (let i = 0; i < 7; i++) recordAttempt('bob', false);
    expect(checkRateLimit('bob')).toEqual({ ok: true });
  });

  it('blocks login at exactly 8 failures', () => {
    for (let i = 0; i < 8; i++) recordAttempt('charlie', false);
    expect(checkRateLimit('charlie')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('blocks login beyond 8 failures', () => {
    for (let i = 0; i < 15; i++) recordAttempt('dan', false);
    expect(checkRateLimit('dan')).toMatchObject({ ok: false });
  });

  it('does not count successful attempts toward rate limit', () => {
    for (let i = 0; i < 7; i++) recordAttempt('eve', false);
    recordAttempt('eve', true); // success resets nothing but shouldn't be counted
    expect(checkRateLimit('eve')).toEqual({ ok: true });
  });

  it('isolates failures per username', () => {
    for (let i = 0; i < 8; i++) recordAttempt('malice', false);
    // Different user should be unaffected
    expect(checkRateLimit('innocent')).toEqual({ ok: true });
  });

  it('clearLoginAttempts unblocks a locked account', () => {
    for (let i = 0; i < 8; i++) recordAttempt('frank', false);
    expect(checkRateLimit('frank')).toMatchObject({ ok: false });
    clearLoginAttempts('frank');
    expect(checkRateLimit('frank')).toEqual({ ok: true });
  });

  it('records attempt with correct fields', () => {
    recordAttempt('gina', false, '192.168.1.1');
    type Row = { username: string; ip: string; success: number };
    const row = db.prepare('SELECT * FROM login_attempts WHERE username = ?').get('gina') as Row;
    expect(row.username).toBe('gina');
    expect(row.ip).toBe('192.168.1.1');
    expect(row.success).toBe(0);
  });
});
