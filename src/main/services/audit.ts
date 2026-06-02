import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';

export function logAudit(
  userId: number | null,
  action: string,
  targetType?: string,
  targetId?: number,
  details?: Record<string, unknown>
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, action, targetType ?? null, targetId ?? null, details ? JSON.stringify(details) : null);
}

export function listAudit(limit = 100) {
  const tenant = tenantSqlClause('u');
  return getDb()
    .prepare(
      `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1${tenant.sql} ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(...tenant.params, limit);
}
