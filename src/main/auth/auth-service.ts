import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { getDb } from '../db/database';
import { verifyPasswordDetailed, upgradePasswordHash } from '../security/password';
import { isBackupCode, verifyTotp } from '../security/totp';
import { sanitizeUsername } from '../security/sanitize';
import { verifyBackupCode } from './totp-service';
import {
  bindSession,
  bindSessionForWebContents,
  clearSessionForWebContents,
  createSession,
  destroySession,
  getSessionByToken,
  getSessionToken
} from './session-store';
import { checkRateLimit, recordAttempt } from './login-rate-limit';
import { logAudit } from '../services/audit';
import type { ApiResult, LoginPayload, LoginResult, UserPublic } from '../../shared/api-types';

import type { Role } from '../../shared/api-types';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  email: string | null;
  is_active: number;
  totp_secret: string | null;
  totp_enabled: number;
  role: Role;
}

function toPublic(user: UserRow): UserPublic {
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

function finishLogin(event: IpcMainInvokeEvent, user: UserRow): ApiResult<LoginResult> {
  const { token, expiresAt } = createSession(user.id);
  bindSession(event, token);
  return { ok: true, data: { token, user: toPublic(user), expiresAt } };
}

export function login(
  event: IpcMainInvokeEvent,
  payload: LoginPayload
): ApiResult<LoginResult> {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password ?? '');
  const totpCode = payload.totpCode ? String(payload.totpCode).trim() : '';

  if (!username || !password) {
    return { ok: false, error: 'Credentials required', code: 'INVALID_INPUT' };
  }

  const limited = checkRateLimit(username);
  if (!limited.ok) {
    return { ok: false, error: 'Too many attempts', code: limited.code };
  }

  const user = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as UserRow | undefined;

  if (!user || !user.is_active) {
    recordAttempt(username, false);
    return { ok: false, error: 'Invalid credentials', code: 'INVALID_LOGIN' };
  }

  const verified = verifyPasswordDetailed(password, user.password_hash, user.salt);
  if (!verified.ok) {
    recordAttempt(username, false);
    return { ok: false, error: 'Invalid credentials', code: 'INVALID_LOGIN' };
  }

  if (verified.legacy) {
    const { hash, salt } = upgradePasswordHash(password);
    getDb()
      .prepare(`UPDATE users SET password_hash=?, salt=?, password_changed_at=datetime('now') WHERE id=?`)
      .run(hash, salt, user.id);
    user.password_hash = hash;
    user.salt = salt;
  }

  if (user.totp_enabled) {
    if (!totpCode) {
      return {
        ok: false,
        needs2fa: true,
        pendingUser: username,
        error: '2FA code required',
        code: 'NEEDS_2FA'
      };
    }
    let valid = false;
    if (isBackupCode(totpCode)) valid = verifyBackupCode(user.id, totpCode);
    else valid = verifyTotp(user.totp_secret || '', totpCode);
    if (!valid) {
      return { ok: false, error: 'Invalid 2FA code', code: 'INVALID_2FA' };
    }
  }

  recordAttempt(username, true);
  logAudit(user.id, 'auth:login', 'user', user.id, { username: user.username, method: user.totp_enabled ? '2fa' : 'password' });
  return finishLogin(event, user);
}

export function logout(event: IpcMainInvokeEvent): ApiResult {
  const t = getSessionToken(event);
  const session = getSessionByToken(t || '');
  if (t) destroySession(t);
  clearSessionForWebContents(event.sender);
  if (session) {
    logAudit(session.id, 'auth:logout', 'user', session.id, { username: session.username });
  }
  return { ok: true };
}

export function loginByUserId(
  event: IpcMainInvokeEvent,
  userId: number
): ApiResult<LoginResult> {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId) as
    | UserRow
    | undefined;
  if (!user) return { ok: false, error: 'User not found', code: 'NOT_FOUND' };
  return finishLogin(event, user);
}

export function getSession(token: string | null): ApiResult<{ user: UserPublic } | null> {
  if (!token) return { ok: true, data: null };
  const user = getSessionByToken(token);
  if (!user) return { ok: true, data: null };
  return { ok: true, data: { user } };
}

/**
 * Automatically bind a session to a webContents before the renderer loads.
 * The app has no role hierarchy — the first active user gets a full session.
 */
export function autoBindAdminSession(wc: WebContents): void {
  try {
    const user = getDb()
      .prepare(`SELECT id FROM users WHERE is_active = 1 ORDER BY id ASC LIMIT 1`)
      .get() as { id: number } | undefined;

    if (!user) return;
    const { token } = createSession(user.id);
    bindSessionForWebContents(wc, token);
  } catch {
    /* DB not yet ready - harmless */
  }
}
