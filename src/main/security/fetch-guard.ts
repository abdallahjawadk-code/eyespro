import dns from 'node:dns/promises';
import net from 'node:net';
import { getSetting } from '../services/settings';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal'
]);

export function isPrivateIp(host: string): boolean {
  const ipVer = net.isIP(host);
  if (ipVer === 4) {
    const p = host.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 0) return true;
    return false;
  }
  if (ipVer === 6) {
    const h = host.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
    if (h.startsWith('::ffff:')) {
      const embedded = h.slice(7);
      if (net.isIP(embedded) === 4) return isPrivateIp(embedded);
    }
  }
  return false;
}

function parseAllowlist(): string[] | null {
  if (getSetting('fetch_allowlist_enabled') !== '1') return null;
  const raw = getSetting('fetch_allowlist_domains') || '';
  const list = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

function hostInAllowlist(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith('.' + d));
}

function checkParsed(parsed: URL): { ok: boolean; error?: string; host?: string } {
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'SSRF: local host blocked' };
  }
  if (isPrivateIp(host)) return { ok: false, error: 'SSRF: private network blocked' };
  const allowlist = parseAllowlist();
  if (allowlist && !hostInAllowlist(host, allowlist)) {
    return { ok: false, error: `Domain not in allowlist: ${host}` };
  }
  return { ok: true, host };
}

export function isUrlFetchAllowed(urlStr: string): { ok: boolean; error?: string } {
  if (!urlStr?.trim()) return { ok: false, error: 'Empty URL' };
  const trimmed = urlStr.trim();
  if (/^(javascript|data|file|vbscript|blob):/i.test(trimmed)) {
    return { ok: false, error: 'Blocked URL scheme' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'HTTP/HTTPS only' };
  }
  return checkParsed(parsed);
}

export async function isUrlFetchAllowedAsync(urlStr: string): Promise<{ ok: boolean; error?: string }> {
  const sync = isUrlFetchAllowed(urlStr);
  if (!sync.ok) return sync;
  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  const host = parsed.hostname;
  if (net.isIP(host)) return sync;
  try {
    const addrs = await dns.resolve4(host).catch(() => [] as string[]);
    const addrs6 = await dns.resolve6(host).catch(() => [] as string[]);
    for (const ip of [...addrs, ...addrs6]) {
      if (isPrivateIp(ip)) return { ok: false, error: 'SSRF: DNS resolves to private IP' };
    }
  } catch {
    // DNS infrastructure failure (SERVFAIL, timeout, etc.) — fail-open so the
    // packaged app can still reach external hosts when the OS resolver is slow
    // or when dns.resolve4/6 is unavailable in the packaged environment.
    return sync;
  }
  return sync;
}
