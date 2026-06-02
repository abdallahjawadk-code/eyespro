import { createLogger } from '../logger';

const log = createLogger('rate-limiter');

interface RateLimitEntry {
  timestamps: number[];
  blockedUntil?: number;
}

export class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(maxRequests = 60, windowMs = 60000, blockDurationMs = 300000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;

    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 300000);
  }

  /**
   * Check if a key is allowed to make a request
   * @param key - Unique identifier (e.g., userId or sessionId)
   * @param maxRequests - Override default max requests
   * @returns Object with allowed status and remaining requests
   */
  check(key: string, maxRequests?: number): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const max = maxRequests ?? this.maxRequests;

    let entry = this.requests.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.requests.set(key, entry);
    }

    // Check if currently blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.blockedUntil
      };
    }

    // Clear block if expired
    if (entry.blockedUntil && now >= entry.blockedUntil) {
      entry.blockedUntil = undefined;
      entry.timestamps = [];
    }

    // Filter old timestamps outside the window
    const windowStart = now - this.windowMs;
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    // Check if limit exceeded
    if (entry.timestamps.length >= max) {
      // Block the key
      entry.blockedUntil = now + this.blockDurationMs;
      log.warn('Rate limit exceeded', { key, blockedUntil: new Date(entry.blockedUntil).toISOString() });
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.blockedUntil
      };
    }

    // Record this request
    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: max - entry.timestamps.length,
      resetTime: now + this.windowMs
    };
  }

  /**
   * Quick check if key is allowed (returns boolean only)
   */
  isAllowed(key: string, maxRequests?: number): boolean {
    return this.check(key, maxRequests).allowed;
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.requests.delete(key);
    log.info('Rate limit reset', { key });
  }

  /**
   * Get current stats for a key
   */
  getStats(key: string): { count: number; blocked: boolean; resetTime: number | null } {
    const entry = this.requests.get(key);
    if (!entry) {
      return { count: 0, blocked: false, resetTime: null };
    }

    const now = Date.now();
    const blocked = !!(entry.blockedUntil && now < entry.blockedUntil);

    return {
      count: entry.timestamps.length,
      blocked,
      resetTime: entry.blockedUntil || (now + this.windowMs)
    };
  }

  /**
   * Cleanup old entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, entry] of this.requests.entries()) {
      // Remove if no recent requests and not blocked
      if (!entry.blockedUntil && entry.timestamps.every(t => t <= windowStart)) {
        this.requests.delete(key);
      }
      // Remove if block has expired and no recent requests
      else if (entry.blockedUntil && now > entry.blockedUntil && entry.timestamps.every(t => t <= windowStart)) {
        this.requests.delete(key);
      }
    }

    log.debug('Rate limiter cleanup completed', { entriesRemaining: this.requests.size });
  }
}

// Default limiter instance for IPC (60 requests per minute)
export const defaultRateLimiter = new RateLimiter(60, 60000, 300000);

// Stricter limiter for auth endpoints (5 attempts per minute)
export const authRateLimiter = new RateLimiter(5, 60000, 600000);

