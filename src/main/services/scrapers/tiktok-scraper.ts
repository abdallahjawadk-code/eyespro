/**
 * TikTok Profile Scraper — free, no API key.
 *
 * Strategy (in order):
 *   1. RSSHub public instance — returns Atom feed with video entries
 *   2. BrowserWindow stealth on tiktok.com (fallback)
 *
 * RSSHub is open-source and has multiple public instances that proxy TikTok.
 */
import { BrowserWindow, session } from 'electron';
import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { getNextProxy, getProxyRules, reportProxyFailure, reportProxySuccess } from '../../net/proxy-pool';
import { withRetry, getRandomFingerprint, buildStealthScript } from '../../net/stealth-utils';
import { createLogger } from '../../logger';

const log = createLogger('tiktok-scraper');

export interface TikTokVideo {
  text: string;
  link: string | null;
  videoId: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  author: string;
  likes: string | null;
  views: string | null;
}

const RSSHUB_INSTANCES = [
  'https://rsshub.app',
  'https://rsshub.rssforever.com',
  'https://hub.slarker.me',
  'https://rsshub.ktachibana.party',
];

const TK_PARTITION = 'persist:tk-session';
const LOAD_TIMEOUT = 28_000;
const MAX_VIDEOS = 20;

// ─── RSSHub strategy ─────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*<\\/${tag}>`, 'i').exec(xml);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function parseTikTokFeed(xml: string, handle: string): TikTokVideo[] {
  const videos: TikTokVideo[] = [];
  // Support both RSS <item> and Atom <entry>
  const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null && videos.length < MAX_VIDEOS) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || (/<link[^>]+href="([^"]+)"/.exec(block)?.[1] ?? '');
    const publishedAt = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    const desc = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content');
    const text = desc.replace(/<[^>]+>/g, '').trim() || title;

    // Extract video ID from URL
    const idM = /video\/(\d+)/.exec(link);
    const videoId = idM ? idM[1] : null;

    // Extract thumbnail from img tag in description
    const thumbM = /<img[^>]+src="([^"]+)"/.exec(desc);
    const thumbnail = thumbM ? thumbM[1] : null;

    if (title || text) {
      videos.push({
        text: text.slice(0, 2000),
        link: link || null,
        videoId,
        thumbnail,
        publishedAt: publishedAt || null,
        author: handle,
        likes: null,
        views: null,
      });
    }
  }
  return videos;
}

async function scrapeViaRSSHub(handle: string): Promise<TikTokVideo[] | null> {
  const cleanHandle = handle.replace(/^@/, '');
  for (const instance of RSSHUB_INSTANCES) {
    try {
      const url = `${instance}/tiktok/user/@${cleanHandle}`;
      const res = await fetchUrlGuarded(url, { timeout: 10_000 });

      if (!res.ok) continue;
      if (!res.body.includes('<item') && !res.body.includes('<entry')) continue;

      const videos = parseTikTokFeed(res.body, cleanHandle);
      if (videos.length > 0) {
        log.info(`RSSHub scraped ${videos.length} TikTok videos for @${cleanHandle} via ${instance}`);
        return videos;
      }
    } catch { /* try next instance */ }
  }
  return null;
}

// ─── BrowserWindow stealth (fallback) ────────────────────────────────────────



async function scrapeViaBrowser(handle: string): Promise<TikTokVideo[]> {
  const cleanHandle = handle.replace(/^@/, '');
  const url = `https://www.tiktok.com/@${cleanHandle}`;

  const fp = getRandomFingerprint();
  const proxy = getNextProxy();
  let win: BrowserWindow | null = null;

  try {
    const ses = session.fromPartition(TK_PARTITION);
    ses.setUserAgent(fp.ua);
    if (proxy) await ses.setProxy({ proxyRules: getProxyRules(proxy) });

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: TK_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('dom-ready', () => {
      void win!.webContents.executeJavaScript(buildStealthScript(fp)).catch(() => {});
    });

    await Promise.race([
      new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('TikTok load timeout')), LOAD_TIMEOUT);
        win!.webContents.once('did-finish-load', () => { clearTimeout(t); res(); });
      }),
      win.loadURL(url),
    ]);

    await new Promise((r) => setTimeout(r, 5000));
    await win.webContents.executeJavaScript('window.scrollBy(0, 1500)');
    await new Promise((r) => setTimeout(r, 2500));

    const videos: TikTokVideo[] = await win.webContents.executeJavaScript(`
      (function() {
        const results = [];
        const seen = new Set();

        // Strategy 1: __UNIVERSAL_DATA__ JSON (TikTok SSR data)
        try {
          const dataEl = document.getElementById('__UNIVERSAL_DATA__');
          if (dataEl) {
            const data = JSON.parse(dataEl.textContent);
            const items = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo?.stats
              ? null
              : (function findItems(obj, depth) {
                  if (depth > 6 || !obj || typeof obj !== 'object') return null;
                  if (Array.isArray(obj) && obj.length > 0 && obj[0]?.id && obj[0]?.desc) return obj;
                  for (const v of Object.values(obj)) {
                    const r = findItems(v, depth + 1);
                    if (r) return r;
                  }
                  return null;
                })(data, 0);

            if (items && Array.isArray(items)) {
              for (const item of items) {
                if (results.length >= ${MAX_VIDEOS}) break;
                const videoId = item.id || item.aweme_id;
                const text = item.desc || '';
                const link = videoId ? 'https://www.tiktok.com/@${cleanHandle}/video/' + videoId : null;
                const thumbnail = item.video?.cover || item.video?.originCover || item.video?.dynamicCover || null;
                const publishedAt = item.createTime ? new Date(item.createTime * 1000).toISOString() : null;
                const likes = item.stats?.diggCount != null ? String(item.stats.diggCount) : null;
                const views = item.stats?.playCount != null ? String(item.stats.playCount) : null;
                const key = videoId || text.slice(0, 80);
                if (!seen.has(key)) {
                  seen.add(key);
                  results.push({ text: text.slice(0, 2000), link, videoId: videoId || null, thumbnail, publishedAt, author: '${cleanHandle}', likes, views });
                }
              }
              if (results.length > 0) return results;
            }
          }
        } catch(e) {}

        // Strategy 2: DOM scraping
        document.querySelectorAll('[data-e2e="user-post-item"]').forEach(function(el) {
          if (results.length >= ${MAX_VIDEOS}) return;
          const aEl = el.querySelector('a');
          const link = aEl ? aEl.href : null;
          const idM = link ? link.match(/video\\/(\\d+)/) : null;
          const videoId = idM ? idM[1] : null;
          const imgEl = el.querySelector('img');
          const thumbnail = imgEl ? imgEl.src : null;
          const text = imgEl ? imgEl.alt : (link || '');
          const key = videoId || text.slice(0, 80);
          if (!key || seen.has(key)) return;
          seen.add(key);
          results.push({ text: text.slice(0, 2000), link, videoId, thumbnail, publishedAt: null, author: '${cleanHandle}', likes: null, views: null });
        });

        return results;
      })()
    `) as TikTokVideo[];

    if (proxy) reportProxySuccess(proxy.host, proxy.port);
    log.info(`Browser scraped ${videos.length} TikTok videos for @${cleanHandle}`);
    return videos;

  } catch (e) {
    if (proxy) reportProxyFailure(proxy.host, proxy.port);
    log.warn(`TikTok browser scrape failed for @${cleanHandle}: ${(e as Error).message}`);
    throw e;
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scrapeTikTokProfile(handle: string): Promise<TikTokVideo[]> {
  const fromRSS = await withRetry(() => scrapeViaRSSHub(handle) as Promise<TikTokVideo[]>, {
    maxAttempts: 2,
  }).catch(() => null);
  if (fromRSS && fromRSS.length > 0) return fromRSS;

  log.info(`RSSHub unavailable for @${handle}, falling back to browser scrape`);
  try {
    return await withRetry(() => scrapeViaBrowser(handle), {
      maxAttempts: 3,
      baseDelayMs: 2500,
      onRetry: (n, e) => log.warn(`TikTok browser retry ${n}: ${e.message}`),
    });
  } catch (e) {
    // TikTok aggressively blocks automated access (ERR_EMPTY_RESPONSE / timeouts).
    // Surface a clear, actionable Arabic message instead of the raw Chromium code.
    const raw = (e as Error).message || '';
    const blocked = /ERR_EMPTY_RESPONSE|ERR_CONNECTION|ERR_TIMED_OUT|timeout|ERR_FAILED|ERR_HTTP2/i.test(raw);
    throw new Error(
      blocked
        ? `تعذّر جلب منشورات TikTok لـ @${handle.replace(/^@/, '')} — المنصة تحجب الطلبات الآلية حالياً. أعد المحاولة لاحقاً أو فعّل بروكسي في الإعدادات.`
        : `تعذّر رصد حساب TikTok لـ @${handle.replace(/^@/, '')}. حاول مرة أخرى لاحقاً.`
    );
  }
}
