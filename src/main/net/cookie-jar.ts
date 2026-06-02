/**
 * Simple in-memory + DB-backed cookie jar per domain.
 * Persists cookies across fetches within the same session.
 */

import { getDb } from '../db/database';

interface Cookie {
  name: string;
  value: string;
  expires?: number; // unix ms, 0 = session
  path?: string;
  secure?: boolean;
}

// In-memory cache: host → cookies
const jar = new Map<string, Map<string, Cookie>>();

function hostKey(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return url; }
}

/** Load cookies for a host from DB into memory */
function loadHost(host: string): Map<string, Cookie> {
  if (jar.has(host)) return jar.get(host)!;
  const map = new Map<string, Cookie>();
  try {
    const rows = getDb()
      .prepare(`SELECT name, value, expires, path, secure FROM http_cookies WHERE host=?`)
      .all(host) as Cookie[];
    const now = Date.now();
    for (const r of rows) {
      if (r.expires && r.expires > 0 && r.expires < now) continue; // expired
      map.set(r.name, r);
    }
  } catch { /* table may not exist yet */ }
  jar.set(host, map);
  return map;
}

/** Return Cookie header string for a URL */
export function getCookieHeader(url: string): string {
  const host = hostKey(url);
  const map = loadHost(host);
  const now = Date.now();
  const parts: string[] = [];
  for (const [, c] of map) {
    if (c.expires && c.expires > 0 && c.expires < now) { map.delete(c.name); continue; }
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

/** Parse and store Set-Cookie headers for a URL */
export function storeCookies(url: string, setCookieHeaders: string[]): void {
  if (!setCookieHeaders.length) return;
  const host = hostKey(url);
  const map = loadHost(host);

  for (const header of setCookieHeaders) {
    const parts = header.split(';').map(p => p.trim());
    const [nameVal, ...attrs] = parts;
    const eq = nameVal.indexOf('=');
    if (eq < 0) continue;
    const name = nameVal.slice(0, eq).trim();
    const value = nameVal.slice(eq + 1).trim();

    let expires = 0;
    let path = '/';
    let secure = false;

    for (const attr of attrs) {
      const al = attr.toLowerCase();
      if (al.startsWith('expires=')) {
        expires = new Date(attr.slice(8)).getTime() || 0;
      } else if (al.startsWith('max-age=')) {
        const sec = parseInt(attr.slice(8), 10);
        if (!isNaN(sec)) expires = Date.now() + sec * 1000;
      } else if (al.startsWith('path=')) {
        path = attr.slice(5);
      } else if (al === 'secure') {
        secure = true;
      }
    }

    const cookie: Cookie = { name, value, expires, path, secure };
    map.set(name, cookie);

    // Persist to DB (best-effort)
    try {
      getDb()
        .prepare(`INSERT INTO http_cookies (host, name, value, expires, path, secure)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(host, name) DO UPDATE SET value=excluded.value, expires=excluded.expires`)
        .run(host, name, value, expires, path, secure ? 1 : 0);
    } catch { /* ignore if table missing */ }
  }
}

/** Clear all cookies for a host */
export function clearCookies(host: string): void {
  jar.delete(host);
  try {
    getDb().prepare(`DELETE FROM http_cookies WHERE host=?`).run(host);
  } catch { /* ignore */ }
}
