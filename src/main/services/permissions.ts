import { getDb } from '../db/database';

export type PermissionAction = 'publish' | 'schedule' | 'delete' | 'edit';

export interface RolePermission {
  role: string;
  platform: string;
  action: PermissionAction;
  allowed: number;
}

export function listPermissions(): RolePermission[] {
  return getDb()
    .prepare(`SELECT * FROM role_permissions ORDER BY role, platform, action`)
    .all() as RolePermission[];
}

export function setPermission(role: string, platform: string, action: PermissionAction, allowed: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO role_permissions (role, platform, action, allowed) VALUES (?, ?, ?, ?)
       ON CONFLICT(role, platform, action) DO UPDATE SET allowed=excluded.allowed`
    )
    .run(role, platform, action, allowed ? 1 : 0);
}

export function hasPermission(role: string, platform: string, action: PermissionAction): boolean {
  const row = getDb()
    .prepare(`SELECT allowed FROM role_permissions WHERE role=? AND platform=? AND action=?`)
    .get(role, platform, action) as { allowed: number } | undefined;
  return row?.allowed === 1;
}
