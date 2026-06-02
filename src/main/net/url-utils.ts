import { isUrlFetchAllowedAsync } from '../security/fetch-guard';
import { getText } from './http';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
  'spm', 'igshid', 'mkt_tok'
]);

/** Remove tracking query params; keep functional params. */
export function stripTrackingParams(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}${u.search}${u.hash}`;
  } catch {
    return urlStr;
  }
}

/** Normalize URL for duplicate detection (strip tracking, lowercase host). */
export function normalizeUrlForDedup(urlStr: string): string {
  try {
    const u = new URL(stripTrackingParams(urlStr));
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return urlStr.trim().toLowerCase();
  }
}

export interface ResolveUrlResult {
  ok: boolean;
  originalUrl: string;
  finalUrl: string;
  chain: string[];
  error?: string;
}

/**
 * Follow redirects with SSRF guard on each hop (does not download full body on success path).
 */
export async function resolveUrlChain(
  rawUrl: string,
  maxHops = 8
): Promise<ResolveUrlResult> {
  const originalUrl = rawUrl.trim();
  const chain: string[] = [];
  let current = originalUrl;

  try {
    if (!/^https?:\/\//i.test(current)) current = `https://${current.replace(/^\/+/, '')}`;
    new URL(current);
  } catch {
    return { ok: false, originalUrl, finalUrl: originalUrl, chain, error: 'Invalid URL' };
  }

  for (let hop = 0; hop < maxHops; hop++) {
    const allowed = await isUrlFetchAllowedAsync(current);
    if (!allowed.ok) {
      return { ok: false, originalUrl, finalUrl: current, chain, error: allowed.error };
    }
    if (!chain.includes(current)) chain.push(current);

    let res;
    try {
      res = await getText(current, {}, {
        maxBytes: 512 * 1024,
        validateRedirect: async (next) => isUrlFetchAllowedAsync(next),
        redirectsLeft: 0
      });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('exceeds') && msg.includes('bytes')) {
        return { ok: true, originalUrl, finalUrl: stripTrackingParams(current), chain };
      }
      return { ok: false, originalUrl, finalUrl: current, chain, error: msg.slice(0, 200) };
    }

    if (res.redirectTo) {
      current = res.redirectTo;
      continue;
    }

    if (res.ok || (res.status >= 200 && res.status < 400)) {
      return { ok: true, originalUrl, finalUrl: stripTrackingParams(current), chain };
    }
    return { ok: false, originalUrl, finalUrl: current, chain, error: res.body?.slice(0, 120) || `HTTP ${res.status}` };
  }

  return { ok: false, originalUrl, finalUrl: current, chain, error: 'Too many redirects' };
}

export function pickCanonicalLink(pageUrl: string, canonicalFromMeta: string): string {
  if (!canonicalFromMeta?.trim()) return stripTrackingParams(pageUrl);
  try {
    return stripTrackingParams(new URL(canonicalFromMeta.trim(), pageUrl).href);
  } catch {
    return stripTrackingParams(pageUrl);
  }
}
