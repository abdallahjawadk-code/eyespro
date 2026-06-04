/**
 * Instagram Public Profile Scraper — free, no API key.
 *
 * Uses Electron BrowserWindow stealth to scrape public Instagram profiles.
 * Injects stealth JS to hide automation signals (same technique as facebook-scraper).
 * Supports optional proxy rotation via proxy-pool.
 */
import { BrowserWindow, session } from 'electron';
import { getNextProxy, getProxyRules, reportProxyFailure, reportProxySuccess } from '../../net/proxy-pool';
import { withRetry, getRandomFingerprint, buildStealthScript, randomDelay } from '../../net/stealth-utils';
import { createLogger } from '../../logger';

const log = createLogger('instagram-scraper');

export interface InstagramPost {
  text: string;
  link: string | null;
  imageUrl: string | null;
  timestamp: string | null;
  shortcode: string | null;
  likeCount: string | null;
}

const IG_PARTITION = 'persist:ig-session';
const LOAD_TIMEOUT = 25_000;
const MAX_POSTS = 20;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';



let igHooksInstalled = false;

function ensureIgHooks(): void {
  if (igHooksInstalled) return;
  igHooksInstalled = true;
  const ses = session.fromPartition(IG_PARTITION);
  ses.setUserAgent(UA);
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.instagram.com/*', 'https://*.cdninstagram.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers['sec-ch-ua'] = '"Not-A.Brand";v="99", "Chromium";v="124", "Google Chrome";v="124"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('sec-ch-ua-') && key.toLowerCase() !== 'sec-ch-ua-mobile' && key.toLowerCase() !== 'sec-ch-ua-platform') {
          delete headers[key];
        }
      }
      callback({ requestHeaders: headers });
    }
  );
}

export async function scrapeInstagramProfile(username: string): Promise<InstagramPost[]> {
  return withRetry(() => _scrapeIg(username), {
    maxAttempts: 3,
    baseDelayMs: 3000,
    onRetry: (n, e) => log.warn(`Instagram retry ${n} for @${username}: ${e.message}`),
  });
}

async function _scrapeIg(username: string): Promise<InstagramPost[]> {
  const cleanUser = username.replace(/^@/, '').replace(/\/$/, '');
  const url = `https://www.instagram.com/${cleanUser}/`;

  const fp = getRandomFingerprint();
  const proxy = getNextProxy();
  let win: BrowserWindow | null = null;

  try {
    ensureIgHooks();
    session.fromPartition(IG_PARTITION).setUserAgent(fp.ua);

    if (proxy) {
      const ses = session.fromPartition(IG_PARTITION);
      await ses.setProxy({ proxyRules: getProxyRules(proxy) });
    }

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: IG_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('dom-ready', () => {
      void win!.webContents.executeJavaScript(buildStealthScript(fp)).catch(() => { /* non-fatal */ });
    });

    let loadTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        new Promise<void>((res, rej) => {
          loadTimeout = setTimeout(() => rej(new Error('Instagram load timeout')), LOAD_TIMEOUT);
          win!.webContents.once('did-finish-load', () => {
            if (loadTimeout) {
              clearTimeout(loadTimeout);
              loadTimeout = undefined;
            }
            res();
          });
        }),
        win.loadURL(url),
      ]);
    } finally {
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = undefined;
      }
    }

    await randomDelay(4000, 6000);
    await win.webContents.executeJavaScript('window.scrollBy(0, 1500)');
    await randomDelay(2000, 3500);

    // Try to extract from shared data JSON (embedded in page)
    const posts: InstagramPost[] = await win.webContents.executeJavaScript(`
      (function() {
        const results = [];
        const seen = new Set();

        // Strategy 1: JSON shared data (most reliable)
        const scripts = document.querySelectorAll('script[type="application/json"]');
        for (const s of scripts) {
          try {
            const data = JSON.parse(s.textContent);
            const str = JSON.stringify(data);
            // Look for post nodes
            const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges
                        || data?.graphql?.user?.edge_owner_to_timeline_media?.edges;
            if (edges && Array.isArray(edges)) {
              for (const edge of edges) {
                if (results.length >= ${MAX_POSTS}) break;
                const node = edge.node;
                if (!node) continue;
                const text = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                const shortcode = node.shortcode;
                const link = shortcode ? 'https://www.instagram.com/p/' + shortcode + '/' : null;
                const imageUrl = node.thumbnail_src || node.display_url || null;
                const timestamp = node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : null;
                const likeCount = String(node.edge_liked_by?.count || node.edge_media_preview_like?.count || '');
                const key = shortcode || text.slice(0, 80);
                if (seen.has(key)) continue;
                seen.add(key);
                results.push({ text: text.slice(0, 2000), link, imageUrl, timestamp, shortcode: shortcode || null, likeCount: likeCount || null });
              }
              if (results.length > 0) return results;
            }
          } catch(e) { /* skip */ }
        }

        // Strategy 2: DOM scraping
        document.querySelectorAll('article').forEach(function(el) {
          if (results.length >= ${MAX_POSTS}) return;
          const imgEl = el.querySelector('img');
          const imageUrl = imgEl ? imgEl.src : null;
          const aEl = el.querySelector('a[href*="/p/"]');
          const link = aEl ? aEl.href : null;
          const shortcodeM = link ? link.match(/\\/p\\/([^/]+)/) : null;
          const shortcode = shortcodeM ? shortcodeM[1] : null;
          const altText = imgEl ? imgEl.alt : '';
          const timeEl = el.querySelector('time');
          const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
          const key = shortcode || altText.slice(0, 80);
          if (!key || seen.has(key)) return;
          seen.add(key);
          results.push({ text: altText.slice(0, 2000), link, imageUrl, timestamp, shortcode, likeCount: null });
        });

        return results;
      })()
    `) as InstagramPost[];

    if (proxy) reportProxySuccess(proxy.host, proxy.port);
    log.info(`Instagram scraped ${posts.length} posts for @${cleanUser}`);
    return posts;

  } catch (e) {
    if (proxy) reportProxyFailure(proxy.host, proxy.port);
    log.warn(`Instagram scrape failed for @${cleanUser}: ${(e as Error).message}`);
    throw e;
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}
