import type { Role } from '../../../shared/api-types';

export function useRole() {
  return {
    role: 'super_admin' as Role,
    canRead: true,
    canWrite: true,
    canAdmin: true,
    isViewer: false
  };
}

export function roleCanAccess(_role: Role, _min: 'read' | 'write' | 'admin'): boolean {
  return true;
}
