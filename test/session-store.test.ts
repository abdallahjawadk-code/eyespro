import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ────────────────────────────────────────────────────────────────────
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet }));
vi.mock('../src/main/db/database', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}));

import {
  createSession,
  destroySession,
  getSessionByToken,
  pruneExpiredSessions,
} from '../src/main/auth/session-store';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSession', () => {
  it('inserts a session row and returns a token + expiry', () => {
    mockRun.mockReturnValue({ lastInsertRowid: 1 });
    const { token, expiresAt } = createSession(42);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mockRun).toHaveBeenCalledWith(token, 42, expiresAt);
  });

  it('generates a unique token on each call', () => {
    mockRun.mockReturnValue({});
    const { token: t1 } = createSession(1);
    const { token: t2 } = createSession(1);
    expect(t1).not.toBe(t2);
  });
});

describe('destroySession', () => {
  it('deletes the session row', () => {
    mockRun.mockReturnValue({ changes: 1 });
    destroySession('some-token');
    expect(mockRun).toHaveBeenCalledWith('some-token');
  });
});

describe('getSessionByToken', () => {
  it('returns null when token not found', () => {
    mockGet.mockReturnValue(undefined);
    expect(getSessionByToken('missing')).toBeNull();
  });

  it('returns null and destroys expired session', () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    mockGet.mockReturnValue({
      token: 'old-token',
      user_id: 1,
      expires_at: expiredAt,
      username: 'admin',
      email: null,
      role: 'super_admin',
    });
    const result = getSessionByToken('old-token');
    expect(result).toBeNull();
    // destroySession should have been called
    expect(mockRun).toHaveBeenCalled();
  });

  it('returns user for a valid non-expired session', () => {
    const futureAt = new Date(Date.now() + 60_000).toISOString();
    mockGet.mockReturnValue({
      token: 'valid-token',
      user_id: 7,
      expires_at: futureAt,
      username: 'reporter',
      email: 'r@eyespro.test',
      role: 'reporter',
    });
    const user = getSessionByToken('valid-token');
    expect(user).not.toBeNull();
    expect(user?.id).toBe(7);
    expect(user?.username).toBe('reporter');
    expect(user?.role).toBe('reporter');
  });
});

describe('pruneExpiredSessions', () => {
  it('calls DELETE with a datetime clause', () => {
    mockRun.mockReturnValue({ changes: 3 });
    pruneExpiredSessions();
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM sessions WHERE')
    );
    expect(mockRun).toHaveBeenCalled();
  });
});
