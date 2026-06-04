/**
 * Twitter / X Scraper — free, no API key.
 *
 * Strategy (in order of preference):
 *   1. Nitter RSS mirror (lightweight, no browser needed)
 *   2. Direct BrowserWindow stealth scrape of x.com (fallback)
 *
 * Nitter instances are public open-source Twitter frontends that expose RSS.
 * Falls back to browser scraping if all Nitter instances are down.
 */
import { BrowserWindow, session } from 'electron';
import * as cheerio from 'cheerio';
import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { getNextProxy, getProxyRules, reportProxyFailure, reportProxySuccess } from '../../net/proxy-pool';
import { withRetry, getRandomFingerprint, buildStealthScript, randomDelay } from '../../net/stealth-utils';
import { createLogger } from '../../logger';

const log = createLogger('twitter-scraper');

export interface Tweet {
  text: string;
  link: string | null;
  tweetId: string | null;
  publishedAt: string | null;
  author: string;
}

// Public Nitter instances — tried in order
const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.mint.lgbt',
  'https://nitter.cz',
];

const TW_PARTITION = 'persist:tw-session';
const LOAD_TIMEOUT = 25_000;
const MAX_TWEETS = 25;

// ─── Twitter Embed Syndication Widget Scraper (Preferred — lightweight, official) ─────

async function scrapeViaSyndication(handle: string): Promise<Tweet[] | null> {
  const cleanHandle = handle.replace(/^@/, '');
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${cleanHandle}`;
  try {
    const res = await fetchUrlGuarded(url, { timeout: 15_000 });
    if (!res.ok) return null;

    const $ = cheerio.load(res.body);
    const scriptText = $('#__NEXT_DATA__').html();
    if (!scriptText) return null;

    const parsed = JSON.parse(scriptText);
    const entries = parsed?.props?.pageProps?.timeline?.entries;
    if (!Array.isArray(entries)) return null;

    const tweets: Tweet[] = [];
    for (const entry of entries) {
      if (tweets.length >= MAX_TWEETS) break;
      const tweetData = entry?.content?.tweet || entry?.tweet || entry?.item?.content?.tweet;
      if (!tweetData) continue;

      const tweetId = tweetData.id_str || String(tweetData.id);
      const text = tweetData.text || tweetData.full_text || '';
      if (!text || text.length < 10) continue;

      let publishedAt: string | null = null;
      if (tweetData.created_at) {
        const d = new Date(tweetData.created_at);
        if (!isNaN(d.getTime())) {
          publishedAt = d.toISOString();
        }
      }
      const link = `https://x.com/${cleanHandle}/status/${tweetId}`;

      tweets.push({
        text: text.slice(0, 2000),
        link,
        tweetId,
        publishedAt,
        author: cleanHandle,
      });
    }

    if (tweets.length > 0) {
      log.info(`Syndication scraped ${tweets.length} tweets for @${cleanHandle}`);
      return tweets;
    }
  } catch (e) {
    log.warn(`Syndication scrape failed for @${cleanHandle}: ${(e as Error).message}`);
  }
  return null;
}

// ─── Nitter RSS (Preferred fallback — no browser needed) ───────────────────────────────

function extractRssTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*<\\/${tag}>`, 'i').exec(xml);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function parseNitterRss(xml: string, handle: string): Tweet[] {
  const tweets: Tweet[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null && tweets.length < MAX_TWEETS) {
    const block = m[1];
    const title = extractRssTag(block, 'title');
    const link = extractRssTag(block, 'link');
    const publishedAt = extractRssTag(block, 'pubDate');
    const desc = extractRssTag(block, 'description').replace(/<[^>]+>/g, '').trim();
    const text = desc || title;
    const idM = /\/status\/(\d+)/.exec(link);

    if (text) {
      tweets.push({
        text: text.slice(0, 2000),
        link: link || null,
        tweetId: idM ? idM[1] : null,
        publishedAt: publishedAt || null,
        author: handle,
      });
    }
  }
  return tweets;
}

async function scrapeViaNitter(handle: string): Promise<Tweet[] | null> {
  const cleanHandle = handle.replace(/^@/, '');
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${cleanHandle}/rss`;
      const res = await fetchUrlGuarded(url, { timeout: 10_000 });

      if (!res.ok) continue;
      if (!res.body.includes('<rss') && !res.body.includes('<feed')) continue;

      const tweets = parseNitterRss(res.body, cleanHandle);
      if (tweets.length > 0) {
        log.info(`Nitter scraped ${tweets.length} tweets for @${cleanHandle} via ${instance}`);
        return tweets;
      }
    } catch { /* try next instance */ }
  }
  return null;
}

// ─── BrowserWindow stealth (fallback) ────────────────────────────────────────

async function scrapeViaBrowser(handle: string): Promise<Tweet[]> {
  const cleanHandle = handle.replace(/^@/, '');
  const url = `https://x.com/${cleanHandle}`;

  // Rotate fingerprint on every attempt
  const fp = getRandomFingerprint();
  const stealthScript = buildStealthScript(fp);

  const proxy = getNextProxy();
  let win: BrowserWindow | null = null;

  try {
    const ses = session.fromPartition(TW_PARTITION);
    ses.setUserAgent(fp.ua);  // rotated UA

    if (proxy) {
      await ses.setProxy({ proxyRules: getProxyRules(proxy) });
    }

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: TW_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('dom-ready', () => {
      void win!.webContents.executeJavaScript(stealthScript).catch(() => { /* non-fatal */ });
    });

    let loadTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        new Promise<void>((res, rej) => {
          loadTimeout = setTimeout(() => rej(new Error('Twitter load timeout')), LOAD_TIMEOUT);
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

    await randomDelay(3500, 5500); // human-like random delay
    await win.webContents.executeJavaScript('window.scrollBy(0, 1200)');
    await new Promise((r) => setTimeout(r, 2000));

    const tweets: Tweet[] = await win.webContents.executeJavaScript(`
      (function() {
        const results = [];
        const seen = new Set();
        document.querySelectorAll('article[data-testid="tweet"]').forEach(function(el) {
          if (results.length >= ${MAX_TWEETS}) return;
          const textEl = el.querySelector('[data-testid="tweetText"]');
          const text = textEl ? textEl.innerText.trim() : '';
          if (!text || text.length < 10) return;
          const key = text.slice(0, 80);
          if (seen.has(key)) return;
          seen.add(key);
          let link = null, tweetId = null;
          const timeEl = el.querySelector('time');
          const aEl = timeEl ? timeEl.closest('a') : null;
          if (aEl && aEl.href) {
            link = aEl.href;
            const m = link.match(/\\/status\\/(\\d+)/);
            if (m) tweetId = m[1];
          }
          const publishedAt = timeEl ? timeEl.getAttribute('datetime') : null;
          results.push({ text: text.slice(0, 2000), link, tweetId, publishedAt, author: '${cleanHandle}' });
        });
        return results;
      })()
    `) as Tweet[];

    if (proxy) reportProxySuccess(proxy.host, proxy.port);
    log.info(`Browser scraped ${tweets.length} tweets for @${cleanHandle}`);
    return tweets;

  } catch (e) {
    if (proxy) reportProxyFailure(proxy.host, proxy.port);
    log.warn(`Twitter browser scrape failed for @${cleanHandle}: ${(e as Error).message}`);
    throw e;
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scrapeTwitterProfile(handle: string): Promise<Tweet[]> {
  // Try syndication first (fast, official widget timeline)
  const fromSyndication = await withRetry(() => scrapeViaSyndication(handle) as Promise<Tweet[]>, {
    maxAttempts: 2,
    onRetry: (n, e) => log.warn(`Syndication retry ${n} for @${handle}: ${e.message}`),
  }).catch(() => null);
  if (fromSyndication && fromSyndication.length > 0) return fromSyndication;

  // Try Nitter second (fast, no browser) — with auto retry
  const fromNitter = await withRetry(() => scrapeViaNitter(handle) as Promise<Tweet[]>, {
    maxAttempts: 2,
    onRetry: (n, e) => log.warn(`Nitter retry ${n} for @${handle}: ${e.message}`),
  }).catch(() => null);
  if (fromNitter && fromNitter.length > 0) return fromNitter;

  // Fall back to browser stealth with retry + rotating fingerprint
  log.info(`Syndication and Nitter unavailable for @${handle}, falling back to browser scrape`);
  return withRetry(() => scrapeViaBrowser(handle), {
    maxAttempts: 3,
    baseDelayMs: 2000,
    onRetry: (n, e) => log.warn(`Browser retry ${n} for @${handle}: ${e.message}`),
  });
}
