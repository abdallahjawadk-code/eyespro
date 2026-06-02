import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';
import { getSetting, setSetting } from './settings';

let activeTenantId: number | null = null;

export function loadActiveTenant(): void {
  const v = getSetting('active_tenant_id');
  activeTenantId = v ? Number(v) : null;
}

export function getActiveTenantId(): number | null {
  return activeTenantId;
}

export function tenantSqlClause(alias = ''): { sql: string; params: unknown[] } {
  const prefix = alias ? `${alias}.` : '';
  if (!activeTenantId) return { sql: '', params: [] };
  return {
    sql: ` AND (${prefix}tenant_id IS NULL OR ${prefix}tenant_id = ?)`,
    params: [activeTenantId]
  };
}

export function listTenants() {
  return getDb().prepare(`SELECT * FROM tenants ORDER BY name`).all();
}

export function createTenant(name: string, slug?: string): number {
  const s =
    slug ||
    sanitizeString(name, 64)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  const r = getDb().prepare(`INSERT INTO tenants (name, slug) VALUES (?, ?)`).run(name, s);
  return Number(r.lastInsertRowid);
}

export function switchTenant(id: number | null): void {
  activeTenantId = id;
  if (id) setSetting('active_tenant_id', String(id));
  else setSetting('active_tenant_id', '');
}

export function currentTenant() {
  if (!activeTenantId) return null;
  return getDb().prepare(`SELECT * FROM tenants WHERE id=?`).get(activeTenantId);
}
