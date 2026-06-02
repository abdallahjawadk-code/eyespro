/**
 * Regression tests for the IPC guard origin policy.
 *
 * Guards against the "NODE_ENV is unset in packaged builds" trap: the dev origin
 * allowlist (http://localhost / 127.0.0.1) must NOT be active in a packaged build.
 * Dev detection keys off app.isPackaged, so:
 *   - packaged (isPackaged: true)  → strict file:// only
 *   - dev      (isPackaged: false) → file:// + localhost/127.0.0.1
 *
 * These tests exercise the real installIpcGuard wrapper end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable so each test can flip dev/packaged. vi.hoisted runs before vi.mock.
const { appMock } = vi.hoisted(() => ({ appMock: { isPackaged: false } }));

vi.mock('electron', () => ({
  app: appMock,
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../src/main/db/database', () => ({ getDb: vi.fn() }));
vi.mock('../src/main/auth/session-store', () => ({ getSessionFromEvent: vi.fn() }));
vi.mock('../src/main/ipc/rate-limiter', () => ({
  defaultRateLimiter: { check: () => ({ allowed: true, resetTime: 0 }) },
  authRateLimiter: { check: () => ({ allowed: true, resetTime: 0 }) },
}));

import { installIpcGuard } from '../src/main/ipc/guard';

/** Install the guard and return the wrapped handler registered for `channel`. */
function makeWrappedHandler(channel: string, impl: () => unknown) {
  let wrapped: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
  // The guard rebinds ipcMain.handle; the *original* handle captures the wrapped fn.
  const fakeIpcMain = { handle: (_ch: string, fn: typeof wrapped) => { wrapped = fn; } };
  installIpcGuard(fakeIpcMain as never);
  fakeIpcMain.handle(channel, impl as typeof wrapped);
  if (!wrapped) throw new Error('guard did not wrap the handler');
  return wrapped;
}

function eventWithUrl(url: string) {
  return {
    senderFrame: { parent: null, url },
    sender: { id: 1 },
  };
}

// license:info is a PUBLIC channel, so the origin check is reached without a session.
const SENTINEL = { ok: true, data: 'reached-handler' };

describe('IPC guard origin policy', () => {
  beforeEach(() => { appMock.isPackaged = false; });

  describe('packaged build (isPackaged: true)', () => {
    beforeEach(() => { appMock.isPackaged = true; });

    it('allows file:// origin', async () => {
      const h = makeWrappedHandler('license:info', () => SENTINEL);
      const res = await h(eventWithUrl('file:///C:/app/index.html'));
      expect(res).toEqual(SENTINEL);
    });

    it('REJECTS http://localhost origin (dev allowlist must be off in prod)', async () => {
      const h = makeWrappedHandler('license:info', () => SENTINEL);
      const res = (await h(eventWithUrl('http://localhost:5173'))) as { ok: boolean; code?: string };
      expect(res.ok).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('REJECTS http://127.0.0.1 origin', async () => {
      const h = makeWrappedHandler('license:info', () => SENTINEL);
      const res = (await h(eventWithUrl('http://127.0.0.1:5173'))) as { ok: boolean; code?: string };
      expect(res.ok).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });
  });

  describe('dev build (isPackaged: false)', () => {
    it('allows http://localhost origin', async () => {
      const h = makeWrappedHandler('license:info', () => SENTINEL);
      const res = await h(eventWithUrl('http://localhost:5173'));
      expect(res).toEqual(SENTINEL);
    });

    it('allows file:// origin', async () => {
      const h = makeWrappedHandler('license:info', () => SENTINEL);
      const res = await h(eventWithUrl('file:///C:/app/index.html'));
      expect(res).toEqual(SENTINEL);
    });
  });

  it('rejects a sub-frame (non-null parent) regardless of build', async () => {
    appMock.isPackaged = true;
    const h = makeWrappedHandler('license:info', () => SENTINEL);
    const res = (await h({ senderFrame: { parent: {}, url: 'file:///x' }, sender: { id: 1 } })) as { ok: boolean; code?: string };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('FORBIDDEN');
  });
});
