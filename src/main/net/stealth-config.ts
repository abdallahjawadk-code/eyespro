import { getSetting } from '../services/settings';

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

export function parseDomainList(raw: string): string[] {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hashHost(host: string): number {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h << 5) - h + host.charCodeAt(i);
  return h;
}

export function pickUserAgent(host: string): string {
  const custom = getSetting('stealth_user_agents');
  const pool = custom
    ? custom.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    : DEFAULT_USER_AGENTS;
  if (!pool.length) return DEFAULT_USER_AGENTS[0]!;
  return pool[Math.abs(hashHost(host)) % pool.length]!;
}

export function buildStealthHeaders(host: string, urlStr: string): Record<string, string> {
  let referer: string | undefined;
  try {
    referer = new URL(urlStr).origin + '/';
  } catch {
    referer = undefined;
  }
  return {
    'User-Agent': pickUserAgent(host),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': getSetting('stealth_accept_language') || 'ar,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    ...(referer ? { Referer: referer } : {})
  };
}

export function stealthEnabled(): boolean {
  return getSetting('stealth_fetch_enabled') === '1';
}

export function shouldUseBrowser(host: string): boolean {
  if (getSetting('stealth_browser_enabled') !== '1') return false;
  const list = parseDomainList(getSetting('stealth_browser_domains') || '');
  if (!list.length) return false;
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith('.' + d));
}
