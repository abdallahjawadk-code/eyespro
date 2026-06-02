import type { IpcMainInvokeEvent } from 'electron';
import { getDb } from '../db/database';
import {
  generateBackupCodes,
  generateSecret,
  hashBackupCode,
  otpauthUri,
  verifyTotp
} from '../security/totp';
import { getSessionFromEvent } from './session-store';
import type { ApiResult } from '../../shared/api-types';

export function setup2fa(userId: number): ApiResult<{ secret: string; uri: string }> {
  const user = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    | { username: string }
    | undefined;
  if (!user) return { ok: false, error: 'User not found', code: 'NOT_FOUND' };
  const secret = generateSecret();
  getDb().prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, userId);
  return { ok: true, data: { secret, uri: otpauthUri(secret, user.username) } };
}

export function enable2fa(userId: number, code: string): ApiResult<{ backupCodes: string[] }> {
  const row = getDb()
    .prepare('SELECT totp_secret FROM users WHERE id = ?')
    .get(userId) as { totp_secret: string | null } | undefined;
  if (!row?.totp_secret) return { ok: false, error: '2FA setup required', code: 'NEEDS_2FA' };
  if (!verifyTotp(row.totp_secret, code)) {
    return { ok: false, error: 'Invalid code', code: 'INVALID_2FA' };
  }
  getDb().prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  const backupCodes = generateBackupCodes(8);
  getDb().prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').run(userId);
  const ins = getDb().prepare('INSERT INTO totp_backup_codes (user_id, code_hash) VALUES (?, ?)');
  for (const c of backupCodes) ins.run(userId, hashBackupCode(c));
  return { ok: true, data: { backupCodes } };
}

export function disable2fa(userId: number, code: string): ApiResult {
  const row = getDb()
    .prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?')
    .get(userId) as { totp_secret: string | null; totp_enabled: number } | undefined;
  if (!row?.totp_enabled) return { ok: true };
  if (!verifyTotp(row.totp_secret || '', code)) {
    return { ok: false, error: 'Invalid code', code: 'INVALID_2FA' };
  }
  getDb().prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(userId);
  getDb().prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').run(userId);
  return { ok: true };
}

export function verifyBackupCode(userId: number, code: string): boolean {
  const hash = hashBackupCode(code);
  const db = getDb();
  // Single atomic UPDATE: marks as used only if currently unused.
  // Returns changes=1 on success, 0 if already used or not found — no race condition.
  const result = db
    .prepare(
      `UPDATE totp_backup_codes SET used_at = datetime('now')
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`
    )
    .run(userId, hash);
  return result.changes === 1;
}

export function get2faStatus(event: IpcMainInvokeEvent): ApiResult<{ enabled: boolean }> {
  const session = getSessionFromEvent(event);
  if (!session) return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
  const row = getDb()
    .prepare('SELECT totp_enabled FROM users WHERE id = ?')
    .get(session.id) as { totp_enabled: number };
  return { ok: true, data: { enabled: !!row.totp_enabled } };
}
