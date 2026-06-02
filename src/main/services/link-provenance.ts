import { createHash } from 'node:crypto';

const TRACKING_PARAMS = new Set(['fbclid', 'ref', 'mc_cid', 'mc_eid', 'gclid', 'yclid']);

/** Normalize URL for fingerprinting — strip tracking, hash, trailing slash. */
export function normalizeUrlForProvenance(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function linkFingerprint(url: string): string {
  return createHash('sha256').update(normalizeUrlForProvenance(url)).digest('hex').slice(0, 32);
}
