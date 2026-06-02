/**
 * Free Proxy Pool — rotates public HTTP proxies to avoid IP blocks.
 *
 * Source: ProxyScrape v2 free API (no key required).
 * Works natively with Electron session.setProxy() for BrowserWindow scrapers.
 */
import http from 'node:http';
import { app } from 'electron';
import { getText } from './http';
import { getSetting } from '../services/settings';
import { createLogger } from '../logger';
import { isTorActive, getTorSocksPort } from '../services/tor-manager';

const log = createLogger('proxy-pool');

// ─── Custom (paid residential) proxy ─────────────────────────────────────────
// A user-supplied proxy from Settings takes priority over the free pool. Accepts
// `host:port`, `http://host:port`, or `http://user:pass@host:port`. Auth is
// applied via the global app 'login' handler installed in warmProxyPool().
export interface CustomProxy { host: string; port: number; username?: string; password?: string; }

export function getCustomProxy(): CustomProxy | null {
  const raw = (getSetting('custom_proxy') || '').trim();
  if (!raw) return null;
  try {
    const withScheme = /^\w+:\/\//.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withScheme);
    const port = parseInt(u.port, 10);
    if (!u.hostname || isNaN(port) || port <= 0 || port >= 65536) return null;
    return {
      host: u.hostname,
      port,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch { return null; }
}

interface ProxyEntry {
  host: string;
  port: number;
  failures: number;
}

const TTL_MS = 15 * 60 * 1000; // refresh every 15 min
const MAX_FAILURES = 3;
const MAX_POOL_SIZE = 200;

// ─── Validation — keep only proxies that actually work ───────────────────────
const VALIDATE_TIMEOUT = 5000;
const VALIDATE_CONCURRENCY = 40;   // test this many proxies at once
const VALIDATE_CANDIDATES = 400;   // cap raw proxies we bother testing
const WANT_LIVE = 40;              // stop once we have this many working proxies

/**
 * Validate via the CONNECT method — this is exactly how the app uses the proxy
 * (HTTPS tunnelling for scrapers and content fetch). A proxy that only does
 * plain HTTP GET but can't CONNECT is useless for HTTPS sites, so we test the
 * real capability and keep only proxies that can tunnel to :443.
 */
function validateProxy(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const req = http.request({
        host, port,
        method: 'CONNECT',
        path: 'www.gstatic.com:443',
        timeout: VALIDATE_TIMEOUT,
      });
      req.on('connect', (res, socket) => {
        socket.destroy();
        finish(res.statusCode === 200);
      });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
      req.end();
    } catch { finish(false); }
  });
}

/** Validate candidates concurrently; return only the live ones (up to WANT_LIVE). */
async function filterLiveProxies(candidates: ProxyEntry[]): Promise<ProxyEntry[]> {
  const live: ProxyEntry[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length && live.length < WANT_LIVE) {
      const c = candidates[next++];
      if (!c) break;
      if (await validateProxy(c.host, c.port)) live.push(c);
    }
  }
  const workers = Array.from({ length: Math.min(VALIDATE_CONCURRENCY, candidates.length) }, worker);
  await Promise.all(workers);
  return live;
}

// Free public proxy APIs — no key required, maintained by their own servers
const SOURCES = [
  // ProxyScrape — largest free proxy aggregator
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=anonymous',
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=elite',
  // ProxyList.geonode.com — curated free proxies
  'https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&protocols=http&anonymityLevel=anonymous&anonymityLevel=elite',
  // raw GitHub proxy lists (community-maintained, updated daily)
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
];

let pool: ProxyEntry[] = [];
let lastRefresh = 0;
let idx = 0;
let refreshing = false;

async function fetchProxies(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const fresh: ProxyEntry[] = [];
    for (const url of SOURCES) {
      try {
        const res = await getText(url, {}, { timeout: 10_000 });
        if (!res.ok) continue;
        for (const line of res.body.split('\n')) {
          const [host, portStr] = line.trim().split(':');
          const port = parseInt(portStr ?? '');
          if (host && !isNaN(port) && port > 0 && port < 65536) {
            fresh.push({ host, port, failures: 0 });
          }
        }
      } catch { /* skip source */ }
    }
    if (fresh.length > 0) {
      // Shuffle so we don't always test the same dead head of the list, then
      // validate — free proxy lists are ~90%+ dead, so we keep only live ones.
      for (let j = fresh.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [fresh[j], fresh[k]] = [fresh[k]!, fresh[j]!];
      }
      const candidates = fresh.slice(0, VALIDATE_CANDIDATES);
      const live = await filterLiveProxies(candidates);
      if (live.length > 0) {
        pool = live.slice(0, MAX_POOL_SIZE);
        idx = 0;
        log.info(`Proxy pool validated: ${pool.length} live proxies (from ${fresh.length} fetched)`);
      } else {
        log.warn(`Proxy pool: 0 live proxies after validating ${candidates.length} candidates`);
      }
    }
    lastRefresh = Date.now();
  } finally {
    refreshing = false;
  }
}

function ensureFresh(): void {
  if (Date.now() - lastRefresh > TTL_MS) {
    void fetchProxies().catch(() => { /* non-fatal */ });
  }
}

/** Returns next healthy proxy for session.setProxy(), or null for direct connection */
export function getNextProxy(): { host: string; port: number } | null {
  // A user-configured paid/residential proxy always wins — it's far more reliable
  // than the free pool or Tor (and the only thing that makes TikTok work properly).
  const custom = getCustomProxy();
  if (custom) return { host: custom.host, port: custom.port };

  if (isTorActive()) {
    return { host: '127.0.0.1', port: getTorSocksPort() };
  }

  ensureFresh();
  if (pool.length === 0) return null;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[(idx + i) % pool.length]!;
    if (p.failures >= MAX_FAILURES) continue;
    idx = ((idx + i) + 1) % pool.length;
    return { host: p.host, port: p.port };
  }
  return null;
}

/** Build proxy rules string for Electron session.setProxy() */
export function getProxyRules(proxy: { host: string; port: number }): string {
  if (proxy.host === '127.0.0.1' || proxy.host === 'localhost') {
    return `socks5://127.0.0.1:${proxy.port}`;
  }
  return `http=${proxy.host}:${proxy.port};https=${proxy.host}:${proxy.port}`;
}

export function reportProxyFailure(host: string, port: number): void {
  const p = pool.find((x) => x.host === host && x.port === port);
  if (p) p.failures++;
}

export function reportProxySuccess(host: string, port: number): void {
  const p = pool.find((x) => x.host === host && x.port === port);
  if (p) p.failures = 0;
}

export function getPoolStats(): { total: number; healthy: number; lastRefresh: string | null } {
  return {
    total: pool.length,
    healthy: pool.filter((p) => p.failures < MAX_FAILURES).length,
    lastRefresh: lastRefresh > 0 ? new Date(lastRefresh).toISOString() : null,
  };
}

let authHandlerInstalled = false;

/** Pre-warm the pool at startup and schedule automatic refresh every TTL_MS */
export function warmProxyPool(): void {
  // Supply credentials for an authenticated (residential) proxy. Electron raises
  // the app 'login' event with authInfo.isProxy for proxy auth challenges.
  if (!authHandlerInstalled) {
    authHandlerInstalled = true;
    app.on('login', (event, _wc, _req, authInfo, callback) => {
      if (!authInfo.isProxy) return; // leave non-proxy (site) auth untouched
      const cp = getCustomProxy();
      if (cp?.username) {
        event.preventDefault();
        callback(cp.username, cp.password ?? '');
      }
    });
  }

  void fetchProxies().catch(() => { /* ignore */ });
  // Auto-refresh on a timer — completely free, pulls from public servers
  setInterval(() => {
    void fetchProxies().catch(() => { /* ignore */ });
  }, TTL_MS);
}
