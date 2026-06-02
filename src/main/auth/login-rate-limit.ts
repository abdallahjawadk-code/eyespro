import { getDb } from '../db/database';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;

export function checkRateLimit(username: string): { ok: true } | { ok: false; code: string } {
  const windowMinutes = Math.round(WINDOW_MS / 60000);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE username = ? AND success = 0
       AND created_at > datetime('now', '-${windowMinutes} minutes')`
    )
    .get(username) as { c: number };

  if (row.c >= MAX_FAILS) return { ok: false, code: 'RATE_LIMITED' };
  return { ok: true };
}

export function recordAttempt(username: string, success: boolean, ip = '127.0.0.1'): void {
  getDb()
    .prepare('INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)')
    .run(username, ip, success ? 1 : 0);
}

export function clearLoginAttempts(username: string): void {
  getDb().prepare(`DELETE FROM login_attempts WHERE username = ?`).run(username);
}
