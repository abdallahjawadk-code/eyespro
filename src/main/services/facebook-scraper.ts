/**
 * Facebook Page Scraper
 *
 * Uses Electron BrowserWindow + Chrome DevTools Protocol (CDP) stealth injection
 * to browse Facebook as a genuine Chrome user.
 *
 * Key technique: stealth JS injected on every dom-ready via executeJavaScript,
 * hiding all Electron/automation signals that Facebook checks
 * (navigator.webdriver, canvas fingerprint, WebGL, audio, etc).
 */

import { BrowserWindow, session } from 'electron';
import * as cheerio from 'cheerio';
import { withRetry, getRandomFingerprint, buildStealthScript, randomDelay } from '../net/stealth-utils';
import { getNextProxy, getProxyRules, reportProxyFailure, reportProxySuccess } from '../net/proxy-pool';
import { createLogger } from '../logger';

const log = createLogger('facebook-scraper');

const FB_PARTITION  = 'persist:fb-session';
const LOAD_TIMEOUT  = 22_000;
const MAX_POSTS     = 20;
let   fbRequestHookInstalled = false;   // install the webRequest hook only once
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

/**
 * Safe stealth — hides automation signals without touching rendering APIs.
 * Canvas / WebGL / Audio overrides were intentionally omitted because they
 * break Facebook's React renderer and CSRF token generation.
 */
const STEALTH_SCRIPT = `
(function() {
  try {
    // 1. Hide webdriver — the primary automation signal
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    // 2. Expose window.chrome (absent in Electron, present in real Chrome)
    if (!window.chrome) {
      window.chrome = {};
    }
    const NOOP = function() {};
    const EV   = { addListener: NOOP, removeListener: NOOP, hasListener: () => false };
    if (!window.chrome.app) {
      window.chrome.app = { isInstalled: false, InstallState: {}, RunningState: {} };
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        id: undefined,
        connect: () => ({ postMessage: NOOP, disconnect: NOOP, onMessage: EV, onDisconnect: EV }),
        sendMessage: NOOP,
        getManifest: () => ({}),
        getURL: function(p) { return p; },
        onMessage: EV, onConnect: EV, onInstalled: EV,
      };
    }
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return {}; };
    if (!window.chrome.csi) window.chrome.csi = function() { return {}; };

    // 3. Languages — match Arabic region
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ar-SA', 'ar', 'en-US', 'en'],
      configurable: true,
    });

    // 4. Hardware concurrency & memory — look like a real PC
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    try {
      if ('deviceMemory' in navigator)
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
    } catch(e) {}

    // 5. Plugins & mimeTypes — empty in Electron, real Chrome has PDF viewer etc.
    try {
      const makeFakePlugin = function(name, desc, filename, mimeType) {
        const mime = { type: mimeType, suffixes: '', description: desc, enabledPlugin: null };
        const plugin = { name, description: desc, filename, length: 1, item: function(i) { return i === 0 ? mime : null; }, namedItem: function(n) { return n === mimeType ? mime : null; } };
        mime.enabledPlugin = plugin;
        return { plugin: plugin, mime: mime };
      };
      const pdfEntry = makeFakePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', 'application/pdf');
      const plugins = [pdfEntry.plugin];
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          const arr = Object.create(PluginArray.prototype);
          arr[0] = pdfEntry.plugin;
          arr.length = 1;
          arr.item = function(i) { return plugins[i] || null; };
          arr.namedItem = function(n) { return plugins.find(function(p) { return p.name === n; }) || null; };
          arr.refresh = function() {};
          return arr;
        },
        configurable: true,
      });
      Object.defineProperty(navigator, 'mimeTypes', {
        get: function() {
          const arr = Object.create(MimeTypeArray.prototype);
          arr[0] = pdfEntry.mime;
          arr.length = 1;
          arr.item = function(i) { return i === 0 ? pdfEntry.mime : null; };
          arr.namedItem = function(n) { return n === 'application/pdf' ? pdfEntry.mime : null; };
          return arr;
        },
        configurable: true,
      });
    } catch(e) {}

    // 6. Hide Electron globals
    try { Object.defineProperty(window, 'require',      { value: undefined, configurable: true }); } catch(e) {}
    try { Object.defineProperty(window, '__electronApi',{ value: undefined, configurable: true }); } catch(e) {}

    // 7. Override navigator.userAgentData to mock real Chrome and hide Electron
    if (navigator.userAgentData) {
      const mockUserAgentData = {
        brands: [
          { brand: 'Not-A.Brand', version: '99' },
          { brand: 'Chromium', version: '124' },
          { brand: 'Google Chrome', version: '124' }
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            brands: [
              { brand: 'Not-A.Brand', version: '99' },
              { brand: 'Chromium', version: '124' },
              { brand: 'Google Chrome', version: '124' }
            ],
            mobile: false,
            platform: 'Windows',
            platformVersion: '10.0.0',
            architecture: 'x86',
            bitness: '64',
            model: '',
            uaFullVersion: '124.0.0.0',
            fullVersionList: [
              { brand: 'Not-A.Brand', version: '99.0.0.0' },
              { brand: 'Chromium', version: '124.0.0.0' },
              { brand: 'Google Chrome', version: '124.0.0.0' }
            ]
          });
        }
      };
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => mockUserAgentData,
        configurable: true
      });
    }

  } catch(e) {
    // Silent — never break the page
  }
})();
`;

export interface FbPost {
  text: string;
  link: string | null;
  timestamp: string | null;
  postId: string | null;
}

// ─── Stealth helper ───────────────────────────────────────────────────────────

/**
 * Inject stealth script into the page's main world on every dom-ready.
 * Uses executeJavaScript (runs in page's JS context, not the isolated preload).
 * Registered BEFORE loadURL so it fires on every navigation in the window.
 */
function registerStealth(win: BrowserWindow): void {
  win.webContents.on('dom-ready', () => {
    void win.webContents.executeJavaScript(STEALTH_SCRIPT).catch((e) => {
      log.warn(`Stealth inject failed (non-fatal): ${(e as Error).message}`);
    });
  });
}

// ─── Login window ─────────────────────────────────────────────────────────────

/**
 * Install the UA and Referer header hook on the FB session exactly once.
 * Adding it on every window.open() caused handlers to stack up and
 * intercept the login POST with stale/duplicate headers.
 */
function ensureFbSessionHooks(): void {
  if (fbRequestHookInstalled) return;
  fbRequestHookInstalled = true;

  const ses = session.fromPartition(FB_PARTITION);
  ses.setUserAgent(UA);

  // Only inject Referer/Origin for same-site Facebook navigation requests —
  // NOT for XHR/fetch POSTs (login, 2FA) to avoid breaking the auth flow.
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.facebook.com/*', 'https://*.fbcdn.net/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };

      // Spoof Client Hints to match the Google Chrome UA and hide Electron brand
      headers['sec-ch-ua'] = '"Not-A.Brand";v="99", "Chromium";v="124", "Google Chrome";v="124"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';

      // Delete other client hints to prevent exposure of internal versions
      for (const key of Object.keys(headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.startsWith('sec-ch-ua-') && lowerKey !== 'sec-ch-ua-mobile' && lowerKey !== 'sec-ch-ua-platform') {
          delete headers[key];
        }
      }

      // Skip overriding Referer for POSTs so the login CSRF check passes
      if (details.method !== 'POST' && !headers['Referer']) {
        headers['Referer'] = 'https://www.facebook.com/';
      }
      callback({ requestHeaders: headers });
    },
  );
}

export function openFacebookLoginWindow(): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureFbSessionHooks();

    const win = new BrowserWindow({
      width: 980,
      height: 720,
      title: 'فيسبوك — ستُغلق النافذة تلقائياً بعد تسجيل الدخول',
      webPreferences: {
        partition: FB_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });

    win.setMenuBarVisibility(false);

    // Always open devtools to help debug login issues (shows console errors/network errors)
    win.webContents.openDevTools();

    let resolved = false;

    function done(source: string) {
      if (resolved) return;
      resolved = true;
      log.info(`Facebook login resolved via: ${source}`);
      clearTimeout(hardTimeout);
      clearInterval(cookiePoller);
      // Small delay so cookies flush to disk
      setTimeout(() => {
        if (!win.isDestroyed()) win.close();
        resolve();
      }, 1000);
    }

    // Hard 5-minute timeout
    const hardTimeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(cookiePoller);
      if (!win.isDestroyed()) win.close();
      reject(new Error('انتهت مهلة تسجيل الدخول (5 دقائق)'));
    }, 5 * 60 * 1000);

    // Cookie polling — uses the window's own session jar (most reliable)
    const cookiePoller = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(cookiePoller); return; }
      void win.webContents.session.cookies
        .get({ domain: '.facebook.com', name: 'c_user' })
        .then((cookies) => {
          if (cookies.length > 0) done('c_user cookie');
        })
        .catch(() => { /* ignore */ });
    }, 1500);

    // URL fast-path
    function checkUrl(url: string) {
      if (!url.includes('facebook.com')) return;
      const isAuthPage =
        url.includes('/login') || url.includes('login.php') ||
        url.includes('/checkpoint') || url.includes('/recover') ||
        url.includes('/two_step') || url.includes('/identity') ||
        url.includes('/security');
      if (!isAuthPage) {
        // Landed on feed/home — cookie poller will confirm
        setTimeout(() => done('url-navigation'), 1500);
      }
    }

    win.webContents.on('did-navigate',          (_e, url) => { log.info(`FB nav: ${url}`); checkUrl(url); });
    win.webContents.on('did-navigate-in-page',  (_e, url, main) => { if (main) { log.info(`FB spa: ${url}`); checkUrl(url); } });
    win.webContents.on('did-frame-navigate',    (_e, url, _c, _t, main) => { if (main) checkUrl(url); });

    win.on('closed', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(hardTimeout);
        clearInterval(cookiePoller);
        resolve();
      }
    });

    // Register stealth on every dom-ready, then load
    registerStealth(win);
    void win.loadURL('https://www.facebook.com/login');
  });
}

// ─── Session check ────────────────────────────────────────────────────────────

export async function isFacebookLoggedIn(): Promise<boolean> {
  try {
    const cookies = await session
      .fromPartition(FB_PARTITION)
      .cookies.get({ domain: '.facebook.com', name: 'c_user' });
    return cookies.length > 0;
  } catch {
    return false;
  }
}

// ─── Page scraper ─────────────────────────────────────────────────────────────

export async function scrapeFacebookPage(pageUrl: string): Promise<FbPost[]> {
  return withRetry(() => _scrapeFb(pageUrl), {
    maxAttempts: 3,
    baseDelayMs: 3000,
    onRetry: (n, e) => log.warn(`Facebook retry ${n} for ${pageUrl}: ${e.message}`),
  });
}

function parseMbasicFacebookHtml(html: string): FbPost[] {
  const $ = cheerio.load(html);
  const posts: FbPost[] = [];
  const seen = new Set<string>();

  // Mobile basic structures:
  // 1. Stories are typically contained in divs with role="article" or structured containers under #m_newsfeed_stream.
  // 2. Sometimes story bodies have .story_body_container.
  const containers = $('article, div[role="article"], div.story_body_container, #m_newsfeed_stream > div, div[data-ft]');
  
  containers.each((_, el) => {
    const container = $(el);
    
    // Find text
    let text = '';
    const msgEl = container.find('div.msg, p, span.msg, [dir="auto"]');
    if (msgEl.length > 0) {
      text = msgEl.map((_, t) => $(t).text().trim()).get().filter(Boolean).join('\n');
    }
    
    if (!text) {
      text = container.clone().find('script, style, a, abbr').remove().end().text().trim();
    }
    
    if (!text || text.length < 25) return;

    // Find links
    let link = null;
    const linkEl = container.find('a[href*="/posts/"], a[href*="/permalink.php"], a[href*="story_fbid="], a[href*="/story.php"]');
    if (linkEl.length > 0) {
      const rawHref = linkEl.first().attr('href') || '';
      if (rawHref) {
        try {
          const u = new URL(rawHref, 'https://mbasic.facebook.com');
          link = u.toString().replace('mbasic.facebook.com', 'www.facebook.com');
        } catch {
          link = rawHref;
        }
      }
    }

    // Extract post ID
    let postId = null;
    if (link) {
      const m = link.match(/\/posts\/(\d+)/) || link.match(/story_fbid=(\d+)/) || link.match(/permalink\/(\d+)/) || link.match(/id=(\d+)/);
      if (m) postId = m[1];
    }

    const key = postId || text.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    // Parse timestamp
    let timestamp = null;
    const timeEl = container.find('abbr, time');
    if (timeEl.length > 0) {
      const utime = timeEl.first().attr('data-utime');
      if (utime) {
        const seconds = parseInt(utime, 10);
        if (!isNaN(seconds)) {
          const d = new Date(seconds * 1000);
          if (!isNaN(d.getTime())) {
            timestamp = d.toISOString();
          }
        }
      }
      if (!timestamp) {
        timestamp = timeEl.first().text().trim() || null;
      }
    }

    posts.push({
      text: text.slice(0, 2000),
      link,
      timestamp,
      postId
    });
  });

  return posts;
}

async function scrapeViaMobileBasic(pageUrl: string): Promise<FbPost[] | null> {
  const cleanUrl = pageUrl.replace(/www\.facebook\.com/, 'mbasic.facebook.com');
  const url = cleanUrl.startsWith('http') ? cleanUrl : `https://mbasic.facebook.com/${pageUrl}`;
  const fp = getRandomFingerprint();
  const proxy = getNextProxy();

  let win: BrowserWindow | null = null;
  try {
    ensureFbSessionHooks();
    session.fromPartition(FB_PARTITION).setUserAgent(fp.ua);
    if (proxy) {
      await session.fromPartition(FB_PARTITION).setProxy({ proxyRules: getProxyRules(proxy) });
    }

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: FB_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Load page
    await Promise.race([
      new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('mbasic load timeout')), LOAD_TIMEOUT);
        win!.webContents.once('did-finish-load', () => { clearTimeout(t); res(); });
      }),
      win.loadURL(url),
    ]);

    await randomDelay(1500, 3000);
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML') as string;
    
    if (proxy) reportProxySuccess(proxy.host, proxy.port);

    const posts = parseMbasicFacebookHtml(html);
    if (posts.length > 0) {
      log.info(`mbasic scraped ${posts.length} posts for ${url}`);
      return posts;
    }
  } catch (e) {
    if (proxy) reportProxyFailure(proxy.host, proxy.port);
    log.warn(`mbasic Facebook scrape failed for ${url}: ${(e as Error).message}`);
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
  return null;
}

async function _scrapeFb(pageUrl: string): Promise<FbPost[]> {
  // Try mbasic scraper first
  try {
    const fromMbasic = await scrapeViaMobileBasic(pageUrl);
    if (fromMbasic && fromMbasic.length > 0) return fromMbasic;
  } catch (e) {
    log.warn(`mbasic fallback triggered due to error: ${(e as Error).message}`);
  }

  log.info(`mbasic unavailable for ${pageUrl}, falling back to desktop browser scrape`);
  const url = pageUrl.startsWith('http') ? pageUrl : `https://www.facebook.com/${pageUrl}`;
  const fp = getRandomFingerprint();
  const proxy = getNextProxy();

  let win: BrowserWindow | null = null;
  try {
    ensureFbSessionHooks();
    session.fromPartition(FB_PARTITION).setUserAgent(fp.ua);
    if (proxy) {
      await session.fromPartition(FB_PARTITION).setProxy({ proxyRules: getProxyRules(proxy) });
    }

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: FB_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Rotate stealth script with randomized fingerprint
    win.webContents.on('dom-ready', () => {
      void win!.webContents.executeJavaScript(buildStealthScript(fp)).catch(() => {});
    });

    // Load page
    await Promise.race([
      new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('تجاوز وقت التحميل')), LOAD_TIMEOUT);
        win!.webContents.once('did-finish-load', () => { clearTimeout(t); res(); });
      }),
      win.loadURL(url),
    ]);

    await randomDelay(3500, 5000);
    await win.webContents.executeJavaScript('window.scrollBy(0, 1400)');
    await randomDelay(1800, 2800);

    const posts: FbPost[] = await win.webContents.executeJavaScript(`
      (function() {
        const results = [];
        const seen = new Set();

        document.querySelectorAll('[role="article"]').forEach(function(el) {
          if (results.length >= ${MAX_POSTS}) return;
          const textEl = el.querySelector('[data-ad-preview="message"], [dir="auto"]');
          const text = (textEl ? textEl.innerText : el.innerText).trim();
          if (!text || text.length < 20) return;

          let link = null;
          const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
          if (linkEl) link = linkEl.href;

          let timestamp = null;
          const timeEl = el.querySelector('abbr[data-utime], time[datetime]');
          if (timeEl) {
            const utime = timeEl.getAttribute('data-utime');
            timestamp = utime
              ? new Date(parseInt(utime) * 1000).toISOString()
              : timeEl.getAttribute('datetime');
          }

          let postId = null;
          if (link) {
            const m = link.match(/\\/posts\\/(\\d+)/) || link.match(/story_fbid=(\\d+)/) || link.match(/permalink\\/(\\d+)/);
            if (m) postId = m[1];
          }

          const key = postId || text.slice(0, 80);
          if (seen.has(key)) return;
          seen.add(key);
          results.push({ text: text.slice(0, 2000), link, timestamp, postId });
        });

        // Fallback
        if (results.length === 0) {
          document.querySelectorAll('div[dir="auto"]').forEach(function(el) {
            if (results.length >= ${MAX_POSTS}) return;
            const text = el.innerText.trim();
            if (text.length < 60 || text.length > 3000) return;
            const key = text.slice(0, 80);
            if (seen.has(key)) return;
            seen.add(key);
            results.push({ text, link: null, timestamp: null, postId: null });
          });
        }

        return results;
      })()
    `) as FbPost[];

    if (proxy) reportProxySuccess(proxy.host, proxy.port);
    log.info(`Scraped ${posts.length} posts from ${url}`);
    return posts;

  } catch (e) {
    if (proxy) reportProxyFailure(proxy.host, proxy.port);
    log.warn(`Facebook scrape failed: ${(e as Error).message}`);
    throw e;
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}
