import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn();
const mockGet = vi.fn();
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet }));
vi.mock('../src/main/db/database', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}));

import {
  checkRateLimit,
  recordAttempt,
  clearLoginAttempts,
} from '../src/main/auth/login-rate-limit';

beforeEach(() => vi.clearAllMocks());

describe('checkRateLimit', () => {
  it('allows login when failed attempt count is below threshold', () => {
    mockGet.mockReturnValue({ c: 3 });
    expect(checkRateLimit('user1')).toEqual({ ok: true });
  });

  it('blocks login when failed attempts reach max (8)', () => {
    mockGet.mockReturnValue({ c: 8 });
    const result = checkRateLimit('user1');
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('blocks login when failed attempts exceed max', () => {
    mockGet.mockReturnValue({ c: 15 });
    expect(checkRateLimit('attacker')).toMatchObject({ ok: false });
  });

  it('allows login at exactly max - 1 failures', () => {
    mockGet.mockReturnValue({ c: 7 });
    expect(checkRateLimit('user1')).toEqual({ ok: true });
  });

  it('queries only the relevant username', () => {
    mockGet.mockReturnValue({ c: 0 });
    checkRateLimit('targetUser');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('username = ?'));
    expect(mockGet).toHaveBeenCalledWith('targetUser');
  });
});

describe('recordAttempt', () => {
  it('inserts a failure record', () => {
    mockRun.mockReturnValue({});
    recordAttempt('user1', false);
    expect(mockRun).toHaveBeenCalledWith('user1', '127.0.0.1', 0);
  });

  it('inserts a success record', () => {
    mockRun.mockReturnValue({});
    recordAttempt('user1', true);
    expect(mockRun).toHaveBeenCalledWith('user1', '127.0.0.1', 1);
  });

  it('accepts custom IP', () => {
    mockRun.mockReturnValue({});
    recordAttempt('user1', false, '10.0.0.1');
    expect(mockRun).toHaveBeenCalledWith('user1', '10.0.0.1', 0);
  });
});

describe('clearLoginAttempts', () => {
  it('deletes all records for the username', () => {
    mockRun.mockReturnValue({ changes: 5 });
    clearLoginAttempts('user1');
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM login_attempts WHERE username = ?')
    );
    expect(mockRun).toHaveBeenCalledWith('user1');
  });
});
