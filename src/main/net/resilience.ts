/**
 * Resilience primitives for the central HTTP client — pure, dependency-free, and
 * unit-tested in isolation. Applied ONLY to idempotent GET/HEAD requests by
 * net/http.ts; non-idempotent methods (POST/DELETE, i.e. publishing) bypass these
 * so they are never retried or blocked.
 */

/** Exponential backoff with light jitter. attempt is 0-based. */
export function backoffDelay(attempt: number, baseMs = 300, capMs = 5_000): number {
  const exp = Math.min(capMs, baseMs * 3 ** attempt);
  return Math.round(exp * (0.5 + Math.random() * 0.5)); // 50–100% jitter
}

export interface RetryOptions<T> {
  retries: number;
  /** Return true to retry. Called with either the resolved value or a thrown error. */
  shouldRetry: (value: T | undefined, error: unknown) => boolean;
  baseDelayMs?: number;
  /** Injectable sleeper (tests pass a no-op to avoid real delays). */
  sleep?: (ms: number) => Promise<void>;
  /** Optional hook fired before each retry (for logging/metrics). */
  onRetry?: (attempt: number, value: T | undefined, error: unknown) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying up to `retries` times while `shouldRetry` holds. Retries on
 * both resolved-but-retryable values (e.g. HTTP 5xx) and thrown errors (network).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions<T>): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const base = opts.baseDelayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const value = await fn();
      if (attempt < opts.retries && opts.shouldRetry(value, undefined)) {
        opts.onRetry?.(attempt, value, undefined);
        await sleep(backoffDelay(attempt, base));
        continue;
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < opts.retries && opts.shouldRetry(undefined, error)) {
        opts.onRetry?.(attempt, undefined, error);
        await sleep(backoffDelay(attempt, base));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open (fast-fail) after tripping, in ms. */
  cooldownMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Per-key circuit breaker. After `failureThreshold` consecutive failures a key's
 * circuit opens for `cooldownMs` (callers fast-fail instead of hammering a dead
 * host); the first request after cooldown is allowed (half-open) and a success
 * fully closes it.
 */
export class CircuitBreaker {
  private readonly failures = new Map<string, number>();
  private readonly openUntil = new Map<string, number>();

  constructor(private readonly opts: CircuitBreakerOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** True if a request to `key` is currently allowed. */
  canRequest(key: string): boolean {
    const until = this.openUntil.get(key);
    if (until != null && until > this.now()) return false;
    return true;
  }

  isOpen(key: string): boolean {
    return !this.canRequest(key);
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
    this.openUntil.delete(key);
  }

  recordFailure(key: string): void {
    // If cooldown elapsed, the prior open is cleared before counting again.
    const until = this.openUntil.get(key);
    if (until != null && until <= this.now()) {
      this.openUntil.delete(key);
      this.failures.delete(key);
    }
    const next = (this.failures.get(key) ?? 0) + 1;
    if (next >= this.opts.failureThreshold) {
      this.openUntil.set(key, this.now() + this.opts.cooldownMs);
      this.failures.set(key, 0); // reset count once opened
    } else {
      this.failures.set(key, next);
    }
  }

  /** Test/diagnostic helper. */
  reset(): void {
    this.failures.clear();
    this.openUntil.clear();
  }
}
