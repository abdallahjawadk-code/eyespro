import { getDb } from '../db/database';
import { isUrlFetchAllowedAsync } from '../security/fetch-guard';
import { getSetting } from '../services/settings';
import {
  checkCircuit,
  hostFromUrl,
  parseRetryAfter,
  recordFetchFailure,
  recordFetchSuccess,
  sleepMs
} from '../services/fetch-shield';
import { browserFetch } from './browser-fetch';
import { getCookieHeader, storeCookies } from './cookie-jar';
import { getText, type HttpResult } from './http';
import { buildStealthHeaders, shouldUseBrowser, stealthEnabled } from './stealth-config';
import { isTorActive, rotateTorIp } from '../services/tor-manager';
import { createLogger } from '../logger';

const log = createLogger('guarded-fetch');

function hourKey(): string {
  return new Date().toISOString().slice(0, 13);
}

function checkDomainBudget(host: string): { ok: boolean; error?: string } {
  // Increased default from 60 to 120 for better multi-source fetching
  const max = Number(getSetting('stealth_max_per_hour') || '120') || 120;
  const key = hourKey();
  const db = getDb();
  const row = db.prepare(`SELECT fetch_count FROM fetch_domain_budget WHERE host=? AND hour_key=?`).get(host, key) as
    | { fetch_count: number }
    | undefined;
  if (row && row.fetch_count >= max) {
    return { ok: false, error: 'Domain fetch budget exceeded' };
  }
  db.prepare(
    `INSERT INTO fetch_domain_budget (host, hour_key, fetch_count) VALUES (?, ?, 1)
     ON CONFLICT(host) DO UPDATE SET
       fetch_count = CASE WHEN fetch_domain_budget.hour_key = excluded.hour_key THEN fetch_domain_budget.fetch_count + 1 ELSE 1 END,
       hour_key = excluded.hour_key`
  ).run(host, key);
  return { ok: true };
}

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

function buildConditionalHeaders(conditional?: {
  etag?: string | null;
  lastModified?: string | null;
}): Record<string, string> {
  const h: Record<string, string> = {};
  if (conditional?.etag) h['If-None-Match'] = conditional.etag;
  if (conditional?.lastModified) h['If-Modified-Since'] = conditional.lastModified;
  return h;
}

// Status codes that should trigger a browser fallback
const BROWSER_FALLBACK_STATUSES = new Set([403, 401, 429, 503, 520, 521, 522, 523, 524]);
const RETRY_STATUSES = new Set([429, 503]);

export interface GuardedFetchOpts {
  forceBrowser?: boolean;
  selector?: string;
  maxBytes?: number;
  conditional?: { etag?: string | null; lastModified?: string | null };
  timeout?: number;
  /**
   * Discovery/probe fetch: this request is speculatively trying a URL that may
   * legitimately not exist (e.g. guessing /feed, /rss during source discovery).
   * A failure here must NOT trip the host-wide circuit breaker — otherwise probing
   * a few dead paths on a healthy host (which returns 404) blocks every real source
   * on that host. Successes are still recorded.
   */
  probe?: boolean;
}

/**
 * HTTP statuses that indicate "this specific path/resource isn't here" rather than
 * "this host is unhealthy/blocking us". These must never trip the host circuit
 * breaker — many independent feeds live on one host (feeds.npr.org, medium.com…)
 * and one 404 path should not take down the others.
 */
const NON_CIRCUIT_STATUSES = new Set([400, 404, 405, 410]);

export async function fetchUrlGuarded(
  url: string,
  opts?: GuardedFetchOpts
): Promise<HttpResult> {
  const allowed = await isUrlFetchAllowedAsync(url);
  if (!allowed.ok) return { ok: false, status: 0, body: allowed.error ?? 'blocked' };

  const host = hostFromUrl(url);
  const circuit = checkCircuit(host);
  if (!circuit.allowed) {
    return { ok: false, status: 0, body: circuit.reason ?? 'circuit_open' };
  }

  const budget = checkDomainBudget(host);
  if (!budget.ok) return { ok: false, status: 0, body: budget.error ?? 'budget' };

  // Force browser if requested or domain is in stealth browser list
  if (opts?.forceBrowser || shouldUseBrowser(host)) {
    const br = await browserFetch(url, !!opts?.forceBrowser, opts?.selector);
    if (br.ok && br.body) {
      recordFetchSuccess(host);
      return { ok: true, status: 200, body: br.body };
    }
    if (!stealthEnabled()) return { ok: false, status: 0, body: br.error ?? 'browser fetch failed' };
  }

  // Build headers with cookies + conditional GET
  const cookieHeader = getCookieHeader(url);
  const baseHeaders = stealthEnabled()
    ? buildStealthHeaders(host, url)
    : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      };

  const headers: Record<string, string> = {
    ...baseHeaders,
    ...buildConditionalHeaders(opts?.conditional),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const maxMb = Math.max(1, Number(getSetting('fetch_max_response_mb') || '6') || 6);

  async function doFetch(): Promise<HttpResult> {
    try {
      return await getText(url, headers, {
        maxBytes: opts?.maxBytes ?? maxMb * 1024 * 1024,
        validateRedirect: async (next) => isUrlFetchAllowedAsync(next),
        useProxy: true, // content fetching routes through the user's custom proxy when set
        timeout: opts?.timeout,
      });
    } catch (e) {
      return { ok: false, status: 0, body: String(e) };
    }
  }

  let result = await doFetch();

  // Tor self-healing: Auto-rotate Tor IP and retry on HTTP 429, 403, or connection blocks when Tor is active
  if (!result.ok && isTorActive() && (RETRY_STATUSES.has(result.status) || result.status === 403 || result.status === 0)) {
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      log.info(`Tor fetch failed for ${url} (status: ${result.status}). Rotating IP and retrying (attempt ${retryCount + 1}/${maxRetries})...`);
      const rotated = await rotateTorIp();
      if (rotated) {
        await sleepMs(3500); // wait for circuit establishment
        result = await doFetch();
        if (result.ok || result.status === 304) {
          log.info(`Tor fetch recovery successful for ${url} after IP rotation.`);
          break;
        }
      } else {
        log.warn(`Tor IP rotation failed during fetch recovery for ${url}.`);
        break;
      }
      retryCount++;
    }
  } else if (!result.ok && RETRY_STATUSES.has(result.status)) {
    // Retry-After on 429/503 (once, capped delay)
    recordFetchFailure(host, result.status);
    const retryMs = parseRetryAfter(headerValue(result.headers, 'retry-after'));
    if (retryMs != null && retryMs > 0) {
      await sleepMs(retryMs);
      result = await doFetch();
    }
  }

  // Store any Set-Cookie headers from the response
  const setCookie = result.headers?.['set-cookie'];
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    storeCookies(url, cookies);
  }

  if (result.notModified) {
    recordFetchSuccess(host);
    return result;
  }

  if (result.ok) {
    recordFetchSuccess(host);
  } else if (result.status > 0 && !opts?.probe && !NON_CIRCUIT_STATUSES.has(result.status)) {
    // Only count failures that reflect host health (403/429/5xx/timeouts).
    // 404-class "resource not found" and discovery probes never trip the circuit.
    recordFetchFailure(host, result.status);
  }

  // Auto-fallback to Playwright on protection responses (403, 429, 503, etc.)
  const autoBrowserFallback = getSetting('fetch_auto_browser_fallback') !== '0';
  if (!result.ok && autoBrowserFallback && BROWSER_FALLBACK_STATUSES.has(result.status)) {
    const br = await browserFetch(url, false, opts?.selector);
    if (br.ok && br.body) {
      recordFetchSuccess(host);
      return { ok: true, status: 200, body: br.body };
    }
  }

  return result;
}
