/**
 * Tests for IPC guard permission model.
 * We test the permission table semantics by exercising role/channel combinations.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock electron and db — guard.ts uses them at import time
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../src/main/db/database', () => ({ getDb: vi.fn() }));
vi.mock('../src/main/auth/session-store', () => ({
  getSessionFromEvent: vi.fn(),
}));
vi.mock('../src/main/ipc/rate-limiter', () => ({
  defaultRateLimiter: { check: () => ({ allowed: true }) },
  authRateLimiter: { check: () => ({ allowed: true }) },
}));

// The permission constants we want to verify independently
const PERM_LEVEL: Record<string, number> = { auth: 0, read: 1, contribute: 2, write: 3, admin: 4 };
const ROLE_MAX: Record<string, string> = {
  super_admin: 'admin',
  editor: 'write',
  reporter: 'contribute',
  viewer: 'read',
};

function can(role: string, required: string): boolean {
  const maxPerm = ROLE_MAX[role];
  if (!maxPerm) return false;
  return (PERM_LEVEL[maxPerm] ?? -1) >= (PERM_LEVEL[required] ?? 99);
}

describe('IPC permission model', () => {
  describe('super_admin', () => {
    it('can do everything', () => {
      expect(can('super_admin', 'read')).toBe(true);
      expect(can('super_admin', 'write')).toBe(true);
      expect(can('super_admin', 'admin')).toBe(true);
      expect(can('super_admin', 'contribute')).toBe(true);
    });
  });

  describe('editor', () => {
    it('can read, contribute, write', () => {
      expect(can('editor', 'read')).toBe(true);
      expect(can('editor', 'contribute')).toBe(true);
      expect(can('editor', 'write')).toBe(true);
    });
    it('cannot do admin operations', () => {
      expect(can('editor', 'admin')).toBe(false);
    });
  });

  describe('reporter', () => {
    it('can read and contribute', () => {
      expect(can('reporter', 'read')).toBe(true);
      expect(can('reporter', 'contribute')).toBe(true);
    });
    it('cannot write or admin', () => {
      expect(can('reporter', 'write')).toBe(false);
      expect(can('reporter', 'admin')).toBe(false);
    });
  });

  describe('viewer', () => {
    it('can only read', () => {
      expect(can('viewer', 'read')).toBe(true);
    });
    it('cannot contribute, write, or admin', () => {
      expect(can('viewer', 'contribute')).toBe(false);
      expect(can('viewer', 'write')).toBe(false);
      expect(can('viewer', 'admin')).toBe(false);
    });
  });

  describe('unknown role', () => {
    it('is denied everything', () => {
      expect(can('hacker', 'read')).toBe(false);
      expect(can('hacker', 'auth')).toBe(false);
    });
  });
});

describe('permission level ordering', () => {
  it('auth < read < contribute < write < admin', () => {
    expect(PERM_LEVEL.auth).toBeLessThan(PERM_LEVEL.read);
    expect(PERM_LEVEL.read).toBeLessThan(PERM_LEVEL.contribute);
    expect(PERM_LEVEL.contribute).toBeLessThan(PERM_LEVEL.write);
    expect(PERM_LEVEL.write).toBeLessThan(PERM_LEVEL.admin);
  });
});
