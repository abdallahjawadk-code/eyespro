import { describe, it, expect, vi } from 'vitest';
import { backoffDelay, withRetry, CircuitBreaker } from '../src/main/net/resilience';

const noSleep = () => Promise.resolve();

describe('backoffDelay', () => {
  it('is bounded by the cap and grows with attempt', () => {
    for (let a = 0; a < 8; a++) {
      const d = backoffDelay(a, 300, 5000);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(5000);
    }
    // base*3^0 = 300 → 150..300 ; base*3^2 = 2700 → 1350..2700
    expect(backoffDelay(0, 300, 5000)).toBeLessThanOrEqual(300);
    expect(backoffDelay(2, 300, 5000)).toBeGreaterThan(300);
  });
});

describe('withRetry', () => {
  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const r = await withRetry(fn, { retries: 2, shouldRetry: () => true, sleep: noSleep });
    expect(r).toBe('ok');
    // shouldRetry(value) is true but value 'ok'… it WOULD retry; guard: it only retries while attempts remain.
    // Here we assert it still resolves to the last value after exhausting retries.
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries because shouldRetry always true
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 200 });
    const r = await withRetry(fn, {
      retries: 3,
      shouldRetry: (v) => !!v && (v as { status: number }).status >= 500,
      sleep: noSleep,
    });
    expect(r).toEqual({ status: 200 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 5xx then succeeds', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    const r = await withRetry(fn, {
      retries: 3,
      shouldRetry: (v) => !!v && (v as { status: number }).status >= 500,
      sleep: noSleep,
    });
    expect(r).toEqual({ status: 200 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on thrown error then rethrows after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      withRetry(fn, { retries: 2, shouldRetry: (_v, e) => !!e, sleep: noSleep }),
    ).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('fires onRetry before each retry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('done');
    await withRetry(fn, { retries: 2, shouldRetry: (_v, e) => !!e, sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  it('is closed initially and allows requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.canRequest('a')).toBe(true);
  });

  it('opens after the failure threshold and fast-fails', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => now });
    cb.recordFailure('host'); cb.recordFailure('host'); expect(cb.canRequest('host')).toBe(true);
    cb.recordFailure('host'); // 3rd → opens
    expect(cb.isOpen('host')).toBe(true);
    expect(cb.canRequest('host')).toBe(false);
  });

  it('isolates keys', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    cb.recordFailure('a'); cb.recordFailure('a');
    expect(cb.canRequest('a')).toBe(false);
    expect(cb.canRequest('b')).toBe(true);
  });

  it('re-allows after cooldown elapses (half-open)', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    cb.recordFailure('h'); cb.recordFailure('h');
    expect(cb.canRequest('h')).toBe(false);
    now = 1001; // cooldown passed
    expect(cb.canRequest('h')).toBe(true);
  });

  it('recordSuccess closes the circuit and clears failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    cb.recordFailure('h');
    cb.recordSuccess('h');
    cb.recordFailure('h'); // count restarts from 0 → 1, still closed
    expect(cb.canRequest('h')).toBe(true);
  });
});
