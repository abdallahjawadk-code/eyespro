import { getDb } from '../db/database';
import { hashPassword, verifyPassword } from '../security/password';
import { sanitizeString, sanitizeInt } from '../security/sanitize';
import { getActiveTenantId } from './tenant';
import { tenantSqlClause } from './tenant';
import { auditEmitter } from '../events/audit-emitter';
import type { UserPublic } from '../../shared/api-types';

/** Roles that can be assigned to users — super_admin cannot be granted via API */
const VALID_ROLES = new Set(['editor', 'reporter', 'viewer', 'super_admin']);
function safeRole(raw?: string, fallback = 'editor'): string {
  if (!raw) return fallback;
  const r = sanitizeString(raw, 32).toLowerCase();
  return VALID_ROLES.has(r) ? r : fallback;
}

export interface UserRow extends UserPublic {
  is_active: number;
  must_change_password: number;
  created_at: string;
}

export function listUsers(): UserPublic[] {
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(`SELECT id, username, email, role FROM users WHERE is_active=1${tenant.sql} ORDER BY username`)
    .all(...tenant.params) as UserPublic[];
}

export function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): { ok: boolean; code?: string } {
  const row = getDb()
    .prepare(`SELECT password_hash, salt FROM users WHERE id=? AND is_active=1`)
    .get(userId) as { password_hash: string; salt: string } | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (!verifyPassword(currentPassword, row.password_hash, row.salt)) {
    return { ok: false, code: 'INVALID_PASSWORD' };
  }
  const { hash, salt } = hashPassword(newPassword);
  getDb()
    .prepare(`UPDATE users SET password_hash=?, salt=?, must_change_password=0 WHERE id=?`)
    .run(hash, salt, userId);
  auditEmitter.emitLog({ userId, action: 'user.changePassword', targetType: 'user', targetId: userId, details: {} });
  return { ok: true };
}

/** Used by password-reset flow only */
export function adminResetPassword(userId: number, newPassword: string, actorId?: number): boolean {
  const tenant = tenantSqlClause();
  const cur = getDb().prepare(`SELECT 1 FROM users WHERE id=?${tenant.sql}`).get(userId, ...tenant.params);
  if (!cur) return false;
  if (!newPassword || newPassword.trim().length < 1) return false;
  const { hash, salt } = hashPassword(newPassword);
  const r = getDb()
    .prepare(`UPDATE users SET password_hash=?, salt=?, must_change_password=1 WHERE id=?`)
    .run(hash, salt, userId);
  if (r.changes) auditEmitter.emitLog({ userId: actorId ?? null, action: 'user.resetPassword', targetType: 'user', targetId: userId, details: {} });
  return r.changes > 0;
}

/** For legacy-import compatibility only */
export function createUserRaw(data: { username: string; password: string; email?: string; tenantId?: number | null }): number {
  const username = sanitizeString(data.username, 64);
  const { hash, salt } = hashPassword(data.password);
  const r = getDb()
    .prepare(`INSERT INTO users (username, password_hash, salt, email, is_active, tenant_id) VALUES (?, ?, ?, ?, 1, ?)`)
    .run(username, hash, salt, data.email ?? null, data.tenantId ?? null);
  return Number(r.lastInsertRowid);
}

export function createUser(data: { username: string; password?: string; email?: string | null; role?: string; tenant_id?: number | null }): number {
  const username = sanitizeString(data.username, 64);
  const email    = data.email ? sanitizeString(data.email, 128) : null;
  // Never allow super_admin via this path — only seeded internally
  const role     = safeRole(data.role, 'editor') === 'super_admin' ? 'editor' : safeRole(data.role, 'editor');
  const tenantId = data.tenant_id ?? getActiveTenantId();

  // Require explicit password — no silent fallback
  if (!data.password || data.password.trim().length < 1) {
    throw new Error('كلمة المرور مطلوبة لإنشاء المستخدم');
  }
  const { hash, salt } = hashPassword(data.password);

  const r = getDb()
    .prepare(`INSERT INTO users (username, password_hash, salt, email, role, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(username, hash, salt, email, role, tenantId);
  return Number(r.lastInsertRowid);
}

export function updateUser(id: number, data: { username?: string; email?: string | null; role?: string; password?: string; is_active?: number }): boolean {
  const cur = getDb().prepare('SELECT * FROM users WHERE id=?').get(id) as (UserRow & { password_hash: string; salt: string }) | undefined;
  if (!cur) return false;

  const username = data.username !== undefined ? sanitizeString(data.username, 64) : cur.username;
  const email    = data.email !== undefined ? (data.email ? sanitizeString(data.email, 128) : null) : cur.email;
  // Prevent escalating existing user to super_admin via update
  const newRole  = data.role !== undefined ? safeRole(data.role, cur.role) : cur.role;
  const role     = (newRole === 'super_admin' && cur.role !== 'super_admin') ? cur.role : newRole;
  const isActive = data.is_active !== undefined ? sanitizeInt(data.is_active, 0, 1) : cur.is_active;

  let hash = cur.password_hash;
  let salt = cur.salt;
  if (data.password && data.password.trim().length > 0) {
    const hashed = hashPassword(data.password);
    hash = hashed.hash;
    salt = hashed.salt;
  }

  getDb()
    .prepare('UPDATE users SET username=?, email=?, role=?, is_active=?, password_hash=?, salt=? WHERE id=?')
    .run(username, email, role, isActive, hash, salt, id);
  return true;
}

export function deleteUser(id: number): boolean {
  const r = getDb().prepare('DELETE FROM users WHERE id=?').run(id);
  return r.changes > 0;
}
