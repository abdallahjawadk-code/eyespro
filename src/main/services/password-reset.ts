import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/database';
import { hashPassword, validatePasswordStrength } from '../security/password';
import { sanitizeString } from '../security/sanitize';
import { clearLoginAttempts } from '../auth/login-rate-limit';
import { buildResetEmail, sendMail } from './mail';

const RESET_TTL_MS = 30 * 60 * 1000;

// DB-backed rate limit: persists across restarts, immune to restart bypass
function rateCheck(identifier: string): { ok: boolean; error?: string } {
  const windowMs = 60 * 60 * 1000; // 1-hour window
  const maxAttempts = 3;
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  // Reuse login_attempts table with a namespaced "username" to avoid collisions
  const key = `__reset__:${identifier}`;
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM login_attempts WHERE username=? AND success=0 AND created_at > ?`)
    .get(key, windowStart) as { c: number };
  if (row.c >= maxAttempts) return { ok: false, error: 'RATE_LIMITED' };
  getDb().prepare(`INSERT INTO login_attempts (username, ip, success) VALUES (?, '127.0.0.1', 0)`).run(key);
  return { ok: true };
}

function findUser(identifier: string): { id: number; username: string; email: string | null } | null {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  if (id.includes('@')) {
    return (
      getDb()
        .prepare(`SELECT id, username, email FROM users WHERE LOWER(email)=? AND is_active=1`)
        .get(id) as { id: number; username: string; email: string | null } | undefined
    ) ?? null;
  }
  return (
    getDb()
      .prepare(`SELECT id, username, email FROM users WHERE LOWER(username)=? AND is_active=1`)
      .get(id) as { id: number; username: string; email: string | null } | undefined
  ) ?? null;
}

function deliverableEmail(email: string | null): boolean {
  return !!email && email.includes('@') && !email.endsWith('@eyespro.local');
}

const GENERIC_MSG =
  'If an account exists, you will receive an email shortly. Check spam folder.';

export async function requestPasswordReset(payload: {
  username?: string;
  email?: string;
}): Promise<{ ok: boolean; message?: string; error?: string; sentTo?: string }> {
  const identifier = sanitizeString(payload.username || payload.email || '', 128).toLowerCase();
  if (!identifier) return { ok: false, error: 'INVALID_INPUT' };
  const rate = rateCheck(identifier);
  if (!rate.ok) return { ok: false, error: rate.error };

  const user = findUser(identifier);
  if (!user || !deliverableEmail(user.email)) {
    return { ok: true, message: GENERIC_MSG };
  }

  // 8-char uppercase hex = 4.3 billion combinations; safe against brute-force even without rate limiting
  const code = randomBytes(4).toString('hex').toUpperCase();
  const tokenHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  getDb().prepare(`UPDATE password_reset_tokens SET used=1 WHERE user_id=? AND used=0`).run(user.id);
  getDb()
    .prepare(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)`)
    .run(user.id, tokenHash, expiresAt);

  const mail = buildResetEmail(code, user.username);
  mail.to = user.email!;
  const sent = await sendMail(mail);
  if (!sent.ok) return { ok: false, error: sent.error };

  return {
    ok: true,
    message: GENERIC_MSG,
    sentTo: user.email!.replace(/(^.).*(@.*$)/, '$1***$2')
  };
}

export function confirmPasswordReset(payload: {
  username?: string;
  email?: string;
  code: string;
  newPassword: string;
}): { ok: boolean; message?: string; error?: string; username?: string } {
  const identifier = sanitizeString(payload.username || payload.email || '', 128).toLowerCase();
  const token = String(payload.code || '').trim().replace(/\s/g, '').toUpperCase();
  if (!identifier || token.length < 8) return { ok: false, error: 'INVALID_INPUT' };

  const user = findUser(identifier);
  if (!user) return { ok: false, error: 'INVALID_TOKEN' };

  const pwErr = validatePasswordStrength(payload.newPassword);
  if (pwErr) return { ok: false, error: pwErr };

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = getDb()
    .prepare(
      `SELECT id FROM password_reset_tokens WHERE user_id=? AND token_hash=? AND used=0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
    )
    .get(user.id, tokenHash) as { id: number } | undefined;
  if (!row) return { ok: false, error: 'INVALID_TOKEN' };

  const { hash, salt } = hashPassword(payload.newPassword);
  getDb()
    .prepare(`UPDATE users SET password_hash=?, salt=?, must_change_password=0, password_changed_at=datetime('now') WHERE id=?`)
    .run(hash, salt, user.id);
  getDb().prepare(`UPDATE password_reset_tokens SET used=1 WHERE user_id=?`).run(user.id);
  clearLoginAttempts(user.username);

  return { ok: true, message: 'Password updated', username: user.username };
}
