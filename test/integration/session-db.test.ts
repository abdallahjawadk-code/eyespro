import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb, insertRawUser } from '../helpers/test-db';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => teardownTestDb());

import {
  createSession,
  destroySession,
  getSessionByToken,
  pruneExpiredSessions,
} from '../../src/main/auth/session-store';

describe('session lifecycle integration (real SQLite)', () => {
  it('createSession inserts a row and returns a unique token', () => {
    const userId = insertRawUser(db);
    const { token, expiresAt } = createSession(userId);

    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(40);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    type Row = { token: string; user_id: number };
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as Row;
    expect(row).toBeTruthy();
    expect(row.user_id).toBe(userId);
  });

  it('generates unique tokens on successive calls', () => {
    const userId = insertRawUser(db);
    const { token: t1 } = createSession(userId);
    const { token: t2 } = createSession(userId);
    expect(t1).not.toBe(t2);
  });

  it('getSessionByToken returns user for a valid session', () => {
    const userId = insertRawUser(db, { username: 'alice', role: 'editor' });
    const { token } = createSession(userId);
    const user = getSessionByToken(token);
    expect(user).not.toBeNull();
    expect(user?.username).toBe('alice');
    expect(user?.role).toBe('editor');
  });

  it('getSessionByToken returns null for unknown token', () => {
    expect(getSessionByToken('nonexistent-token')).toBeNull();
  });

  it('getSessionByToken destroys and returns null for expired session', () => {
    const userId = insertRawUser(db);
    const { token } = createSession(userId);

    // Manually expire the session
    db.prepare(`UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token = ?`).run(token);

    expect(getSessionByToken(token)).toBeNull();

    // Session row should be gone
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    expect(row).toBeUndefined();
  });

  it('destroySession removes the row', () => {
    const userId = insertRawUser(db);
    const { token } = createSession(userId);
    destroySession(token);
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    expect(row).toBeUndefined();
  });

  it('pruneExpiredSessions removes only expired rows', () => {
    const userId = insertRawUser(db);
    const { token: valid } = createSession(userId);
    const { token: expired } = createSession(userId);

    db.prepare(`UPDATE sessions SET expires_at = datetime('now', '-2 hours') WHERE token = ?`).run(expired);

    pruneExpiredSessions();

    expect(db.prepare('SELECT * FROM sessions WHERE token = ?').get(valid)).toBeTruthy();
    expect(db.prepare('SELECT * FROM sessions WHERE token = ?').get(expired)).toBeUndefined();
  });

  it('getSessionByToken returns null for inactive user', () => {
    const userId = insertRawUser(db, { username: 'inactive' });
    db.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).run(userId);
    const { token } = createSession(userId);
    expect(getSessionByToken(token)).toBeNull();
  });
});
