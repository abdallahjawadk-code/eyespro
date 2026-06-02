/**
 * Universal feed parser — RSS/Atom, JSONFeed, Sitemap, WordPress API,
 * HTML scraping, Telegram public channels.
 * 
 * IMPROVEMENTS (v2.0):
 * - Robust HTML parsing with Cheerio + Regex fallback
 * - Sitemap recursion depth limit
 * - Error logging for debugging
 * - Multi-strategy Telegram parsing
 */

import { load as cheerioLoad } from 'cheerio';
import { cleanHtmlPreservingFormatting } from '../../shared/html-cleaner';
import { deepCleanHtml, deepCleanText } from '../../shared/content-cleaner';

const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG_FEED_PARSER === '1';

function logParserError(type: string, error: unknown, context?: string) {
  if (!DEBUG) return;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[FeedParser:${type}] ${context ?? ''}: ${msg}`);
}

export interface FeedItem {
  title: string;
  link: string;
  content: string;
  summary: string;
  image_url: string;
  source: string;
  category: string;
  published_at?: string;
}

export type FeedType = 'rss' | 'atom' | 'jsonfeed' | 'sitemap' | 'wordpress' | 'json_api' | 'html' | 'telegram';

/** Publisher hints extracted from feed XML/JSON (TTL, WebSub hub). */
export interface FeedMetadata {
  ttlMinutes?: number;
  webSubHub?: string;
  lastBuildDate?: string;
}

export function parseFeedMetadata(body: string, type: FeedType): FeedMetadata {
  const meta: FeedMetadata = {};
  if (type !== 'rss' && type !== 'atom') return meta;

  const ttlMatch = body.match(/<ttl[^>]*>\s*(\d+)\s*<\/ttl>/i);
  if (ttlMatch) {
    const ttl = parseInt(ttlMatch[1], 10);
    if (!Number.isNaN(ttl) && ttl > 0) {
      meta.ttlMinutes = Math.min(360, Math.max(15, ttl));
    }
  }

  const hubMatch =
    body.match(/<link[^>]+rel=["']hub["'][^>]+href=["']([^"']+)["']/i) ??
    body.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']hub["']/i);
  if (hubMatch?.[1]) meta.webSubHub = hubMatch[1];

  const buildMatch = body.match(/<lastBuildDate[^>]*>([\s\S]*?)<\/lastBuildDate>/i);
  if (buildMatch?.[1]) meta.lastBuildDate = buildMatch[1].trim();

  return meta;
}

// ── Type detection (v2: Improved JSON API detection) ───────────────────────────

function isValidJsonApiItem(item: Record<string, unknown>): boolean {
  // Must have at least 2 of these fields to be considered a valid API item
  const requiredFields = ['title', 'url', 'link', 'content', 'body', 'description', 'summary', 'publishedAt', 'date'];
  const hasFields = requiredFields.filter(f => 
    item[f] !== undefined && 
    item[f] !== null && 
    String(item[f]).length > 0
  );
  return hasFields.length >= 2;
}

export function detectType(body: string, url: string): FeedType {
  const t = body.trimStart();
  const u = url.toLowerCase();

  if (u.includes('t.me/') || u.includes('telegram.me/')) return 'telegram';
  if (u.includes('/wp-json/wp/v2/posts')) return 'wordpress';
  if (/<sitemapindex[\s>]/i.test(t) || /<urlset[\s>]/i.test(t)) return 'sitemap';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t) as unknown;
      
      // Array of items (most common)
      const arr = Array.isArray(j) ? j : (j as Record<string, unknown>)?.items as unknown[];
      
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null) {
        const first = arr[0] as Record<string, unknown>;
        
        // WordPress API: specific structure
        if (first.id && typeof first.title === 'object' && (first.title as Record<string, string>)?.rendered) {
          return 'wordpress';
        }
        
        // JSON API: array of article-like objects
        if (isValidJsonApiItem(first)) {
          return 'json_api';
        }
      }
      
      // JSONFeed: object with version and items
      if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
        const o = j as Record<string, unknown>;
        if ((o.version || o.items) && !Array.isArray(j)) {
          return 'jsonfeed';
        }
        // Single article object with multiple fields
        if (isValidJsonApiItem(o)) {
          return 'json_api';
        }
      }
    } catch (err) {
      logParserError('detectType', err, 'JSON parsing failed');
    }
    
    // URL-based fallback detection
    if (u.includes('/api/') || u.includes('wp-json') || u.includes('/v1/') || u.includes('/v2/')) {
      return 'json_api';
    }
    return 'jsonfeed';
  }
  if (/<feed[\s>]/i.test(t)) return 'atom';
  if (/<rss[\s>]/i.test(t) || /<channel[\s>]/i.test(t)) return 'rss';
  if (t.startsWith('<')) return 'html';
  return 'rss';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function getAttr(block: string, tag: string, attr: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}

function stripHtml(s: string): string {
  return deepCleanText(s);
}

function cleanContent(html: string): string {
  return cleanHtmlPreservingFormatting(deepCleanHtml(html));
}

function makeItem(overrides: Partial<FeedItem> & { title: string; link: string }, sourceName: string): FeedItem {
  const content = overrides.content ?? '';
  return {
    content,
    summary: overrides.summary ?? deepCleanText(content.slice(0, 500)),
    image_url: overrides.image_url ?? '',
    source: sourceName,
    category: overrides.category ?? '',
    published_at: overrides.published_at,
    ...overrides,
  };
}

// Binary / media / office extensions — never an article URL anywhere
export const BINARY_EXT = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.avif',
  '.mp4', '.mp3', '.avi', '.mov', '.mkv', '.webm', '.m4v', '.wav', '.ogg', '.flac', '.m4a',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.exe', '.dmg', '.apk', '.msi', '.deb',
  '.css', '.js', '.ts', '.map', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
]);

// Data / feed format extensions — not articles when found as links inside HTML pages,
// but CAN be valid article URLs inside RSS/Atom/JSON/Sitemap feed items (e.g. AMP JSON, news XML)
export const FEED_FORMAT_EXT = new Set(['.rss', '.atom', '.xml', '.json', '.yaml', '.toml', '.csv']);

// Combined set used only for HTML page scraping (parseHtmlPage)
const NON_ARTICLE_EXT = new Set([...BINARY_EXT, ...FEED_FORMAT_EXT]);

function normalizeDate(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString();
}

// ── RSS / Atom ────────────────────────────────────────────────────────────────

export function parseRssFeed(xml: string, sourceName: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi),
  ];
  for (const m of blocks) {
    const b = m[1];
    const title = stripHtml(getTag(b, 'title'));
    if (!title) continue;
    const rawLink = getTag(b, 'link') || getAttr(b, 'link', 'href') || '';
    const guid = getTag(b, 'guid');
    const link = rawLink || (/^https?:\/\//.test(guid) ? guid : '') || '';
    const desc = getTag(b, 'content:encoded') || getTag(b, 'description') || getTag(b, 'content') || getTag(b, 'summary') || '';
    const content = cleanContent(desc);
    const mediaContent = getAttr(b, 'media:content', 'url');
    const mediaType = getAttr(b, 'media:content', 'medium') || getAttr(b, 'media:content', 'type');
    const image_url =
      getAttr(b, 'media:thumbnail', 'url') ||
      (mediaType && !mediaType.startsWith('video') ? mediaContent : '') ||
      getAttr(b, 'enclosure', 'url') || '';
    const published_at = normalizeDate(getTag(b, 'pubDate') || getTag(b, 'published') || getTag(b, 'updated') || '');
    items.push(makeItem({ title, link, content, image_url, published_at }, sourceName));
  }
  return items;
}

// ── JSON Feed ─────────────────────────────────────────────────────────────────

export function parseJsonFeed(body: string, sourceName: string): FeedItem[] {
  try {
    const j = JSON.parse(body);
    const list: unknown[] = Array.isArray(j) ? j : (j?.items ?? []);
    return list.map((e: unknown) => {
      const entry = e as Record<string, unknown>;
      const title = stripHtml(String(entry.title ?? entry.name ?? ''));
      const link = String(entry.url ?? entry.link ?? entry.external_url ?? '');
      const content = cleanContent(String(entry.content_html ?? entry.content_text ?? entry.summary ?? ''));
      const image_url = String(entry.image ?? entry.banner_image ?? '');
      const published_at = normalizeDate(String(entry.date_published ?? entry.date_modified ?? ''));
      return makeItem({ title, link, content, image_url, published_at }, sourceName);
    }).filter(i => i.title && i.link);
  } catch {
    return [];
  }
}

// ── Sitemap XML (v2: Depth-Limited Recursion via processFeed) ─────────────────

export function parseSitemap(xml: string, sourceName: string): FeedItem[] {
  // sitemapindex → child sitemaps (return as items with link, no content yet)
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const locs = [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map(m => m[1].trim());
    return locs.filter(Boolean).map(link =>
      makeItem({ title: link, link, content: '' }, sourceName)
    );
  }
  // urlset → article URLs
  const entries = [...xml.matchAll(/<url[\s>]([\s\S]*?)<\/url>/gi)];
  return entries.map(m => {
    const block = m[1];
    const link = getTag(block, 'loc');
    if (!link) return null;
    const title = getTag(block, 'news:title') || getTag(block, 'title') || link;
    const image_url = getAttr(block, 'image:image', 'url') || getTag(block, 'image:loc') || '';
    const published_at = normalizeDate(getTag(block, 'lastmod') || getTag(block, 'news:publication_date') || '');
    const category = getTag(block, 'news:keywords') || getTag(block, 'news:section') || '';
    return makeItem({ title: stripHtml(title), link, content: '', image_url, published_at, category }, sourceName);
  }).filter((i): i is FeedItem => i !== null && !!i.link);
}

// ── WordPress REST API ────────────────────────────────────────────────────────

export function parseWordPress(body: string, sourceName: string): FeedItem[] {
  try {
    const posts = JSON.parse(body) as Record<string, unknown>[];
    if (!Array.isArray(posts)) return [];
    return posts.map(p => {
      const title = stripHtml(String((p.title as Record<string, string>)?.rendered ?? p.title ?? ''));
      const link = String(p.link ?? p.guid ?? '');
      const content = cleanContent(String((p.content as Record<string, string>)?.rendered ?? p.content ?? ''));
      const summary = stripHtml(String((p.excerpt as Record<string, string>)?.rendered ?? ''));
      const embedded = p._embedded as Record<string, unknown> | undefined;
      const featuredMedia = embedded?.['wp:featuredmedia'] as Record<string, unknown>[] | undefined;
      const image_url = String(
        p.jetpack_featured_media_url ??
        featuredMedia?.[0]?.['source_url'] ??
        ((featuredMedia?.[0]?.['media_details'] as Record<string, unknown>)?.['sizes'] as Record<string, Record<string, unknown>>)?.['large']?.['source_url'] ??
        ''
      );
      const wpTerms = embedded?.['wp:term'] as Record<string, unknown>[][] | undefined;
      const category = String(wpTerms?.[0]?.[0]?.['name'] ?? '');
      const published_at = normalizeDate(String(p.date ?? p.modified ?? ''));
      return makeItem({ title, link, content, summary, image_url, category, published_at }, sourceName);
    }).filter(i => i.title && i.link);
  } catch {
    return [];
  }
}

// ── Generic JSON article APIs ─────────────────────────────────────────────────

export function parseJsonApi(body: string, sourceName: string): FeedItem[] {
  try {
    const data = JSON.parse(body) as unknown;
    let arr: unknown[] = [];
    if (Array.isArray(data)) arr = data;
    else if (typeof data === 'object' && data !== null) {
      const o = data as Record<string, unknown>;
      const nested = o.items ?? o.data ?? o.posts ?? o.articles ?? o.results ?? o.entries;
      if (Array.isArray(nested)) arr = nested;
    }
    if (!Array.isArray(arr)) return [];
    return arr.map(p => {
      const row = p as Record<string, unknown>;
      const titleRaw = row.title ?? row.name ?? row.headline;
      const title = stripHtml(
        typeof titleRaw === 'object' && titleRaw !== null && 'rendered' in titleRaw
          ? String((titleRaw as Record<string, string>).rendered)
          : String(titleRaw ?? '')
      );
      const link = String(row.url ?? row.link ?? row.permalink ?? row.canonicalUrl ?? row.slug ?? '');
      const contentRaw = row.content ?? row.body ?? row.description ?? row.summary ?? '';
      const content = cleanContent(
        typeof contentRaw === 'object' && contentRaw !== null && 'rendered' in contentRaw
          ? String((contentRaw as Record<string, string>).rendered)
          : String(contentRaw ?? '')
      );
      const summary = stripHtml(String(row.excerpt ?? row.description ?? row.summary ?? '')).slice(0, 500);
      const image_url = String(row.image ?? row.thumbnail ?? row.featured_image ?? '');
      const published_at = normalizeDate(String(row.publishedAt ?? row.published_at ?? row.date ?? row.created_at ?? ''));
      return makeItem({ title, link, content, summary, image_url, published_at }, sourceName);
    }).filter(i => i.title && i.link);
  } catch {
    return [];
  }
}

// ── HTML Scraping (v2: Cheerio + Regex Fallback) ──────────────────────────────

const HTML_ARTICLE_SELECTORS = [
  'article h2 a', 'article h3 a', 'article h1 a',
  '.post h2 a', '.post h3 a', '.entry-title a',
  '.article h2 a', '.article-title a',
  '[class*="post"] h2 a', '[class*="article"] h2 a',
  'h2.entry-title a', 'h1.entry-title a',
  '.news-item h2 a', '.news-item h3 a',
  '.item h2 a', '.item-title a',
  'a[rel="bookmark"]',
  '.headline a', '.title a'
];

export function parseHtmlPage(html: string, baseUrl: string, sourceName: string): FeedItem[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  const scoredItems = new Map<string, { title: string; score: number }>();

  // Strategy 1: Cheerio CSS Selectors (robust)
  try {
    const $ = cheerioLoad(html, { scriptingEnabled: false });
    
    for (const selector of HTML_ARTICLE_SELECTORS) {
      $(selector).each((_, el) => {
        const $el = $(el);
        let href = $el.attr('href')?.trim() ?? '';
        let text = $el.text().trim();
        
        // Try parent element if text is too short
        if (!text || text.length < 5) {
          text = $el.parent().text().trim();
        }
        
        if (!text || text.length < 10 || text.length > 300) return;
        
        // Resolve relative URL
        try {
          href = new URL(href, baseUrl).toString();
        } catch { return; }
        
        // Same domain check
        try {
          if (new URL(href).hostname !== base.hostname) return;
        } catch { return; }
        
        // Skip non-article paths
        const path = new URL(href).pathname;
        if (/^\/?(#|$)/.test(path)) return;
        if (/\/(category|tag|author|page|search|login|register|wp-admin|wp-content|wp-includes)\//i.test(path)) return;
        if (path.split('/').filter(Boolean).length < 1) return;
        
        // Skip binary extensions
        const pathExt = path.match(/\.([a-z0-9]{1,8})$/i)?.[0]?.toLowerCase() ?? '';
        if (pathExt && NON_ARTICLE_EXT.has(pathExt)) return;
        
        // Calculate score based on selector quality
        let score = 100;
        if (selector.includes('article')) score += 20;
        if (selector.includes('entry-title')) score += 15;
        if (selector.includes('bookmark')) score += 10;
        
        // Prefer deeper paths
        const depth = path.split('/').filter(Boolean).length;
        score += depth * 5;
        
        // Prefer longer, meaningful titles
        if (text.length > 30) score += 10;
        
        // Keep highest score for same URL
        const existing = scoredItems.get(href);
        if (!existing || existing.score < score) {
          scoredItems.set(href, { title: text, score });
        }
      });
    }
  } catch (err) {
    logParserError('HTML', err, 'Cheerio parsing failed, falling back to regex');
  }

  // Strategy 2: Regex Fallback (when Cheerio fails or for extra coverage)
  if (scoredItems.size === 0) {
    const linkRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;

    while ((m = linkRe.exec(html)) !== null) {
      let href = m[1].trim();
      const text = stripHtml(m[2]).trim();
      if (!text || text.length < 10 || text.length > 300) continue;

      try {
        href = new URL(href, baseUrl).toString();
      } catch { continue; }

      try {
        if (new URL(href).hostname !== base.hostname) continue;
      } catch { continue; }

      const path = new URL(href).pathname;
      if (/^\/?(#|$)/.test(path)) continue;
      if (/\/(category|tag|author|page|search|login|register|wp-admin)\//i.test(path)) continue;
      if (path.split('/').filter(Boolean).length < 1) continue;

      if (seen.has(href)) continue;
      seen.add(href);

      const pathExt = path.match(/\.([a-z0-9]{1,8})$/i)?.[0]?.toLowerCase() ?? '';
      if (pathExt && NON_ARTICLE_EXT.has(pathExt)) continue;

      scoredItems.set(href, { title: text, score: 50 });
    }
  }

  // Convert to items and sort by score
  scoredItems.forEach((value, href) => {
    items.push(makeItem({ title: value.title, link: href, content: '' }, sourceName));
  });

  return items
    .sort((a, b) => (scoredItems.get(b.link)?.score ?? 0) - (scoredItems.get(a.link)?.score ?? 0))
    .slice(0, 100);
}

// ── Telegram public channel (v2: Multi-Strategy Parsing) ───────────────────────

const TELEGRAM_SELECTORS = [
  // Strategy 1: Full message widget blocks (most detailed)
  {
    block: '<div[^>]+class=["\'][^"\']*tgme_widget_message\\b[^"\']*["\'][^>]*data-post=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>\\s*<\\/div>',
    text: '<div[^>]+class=["\'][^"\']*tgme_widget_message_text[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/div>',
    time: '<time[^>]+datetime=["\']([^"\']+)["\']',
    image: '<a[^>]+style=["\'][^"\']*background-image:url\\(["\\\']?([^\\)"\\\']+)["\\\']?\\)',
    link: '<a[^>]+href=["\'](https:\\/\\/t\\.me\\/[^"\']+)["\']'
  },
  // Strategy 2: Message bubbles (alternative layout)
  {
    block: '<div[^>]+class=["\'][^"\']*message[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>',
    text: '<div[^>]+class=["\'][^"\']*text[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/div>',
    time: '<time[^>]+datetime=["\']([^"\']+)["\']|<span[^>]+class=["\'][^"\']*time[^"\']*["\'][^>]*>([^<]+)',
    image: '<img[^>]+src=["\']([^"\']+)["\']',
    link: 'href=["\'](https:\\/\\/t\\.me\\/[^"\']+)["\']'
  },
  // Strategy 3: Simple text extraction (fallback)
  {
    block: null,
    text: '<div[^>]+class=["\'][^"\']*tgme_widget_message_text[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/div>',
    time: null,
    image: null,
    link: null
  }
];

export function parseTelegram(html: string, sourceName: string): FeedItem[] {
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let strategyUsed = 0;

  // Try each strategy in order
  for (let sIdx = 0; sIdx < TELEGRAM_SELECTORS.length && items.length === 0; sIdx++) {
    const sel = TELEGRAM_SELECTORS[sIdx];
    strategyUsed = sIdx + 1;

    if (sel.block) {
      const blockRe = new RegExp(sel.block, 'gi');
      let bm: RegExpExecArray | null;

      while ((bm = blockRe.exec(html)) !== null) {
        const block = bm[2] ?? bm[1];
        const postId = bm[1]?.includes('/') ? bm[1] : null;

        // Extract text
        const textRe = new RegExp(sel.text, 'i');
        const textMatch = textRe.exec(block);
        const text = textMatch ? stripHtml(textMatch[1]).trim() : '';
        if (!text || text.length < 5) continue;

        // Check for duplicates
        const textHash = text.slice(0, 50);
        if (seen.has(textHash)) continue;
        seen.add(textHash);

        // Extract metadata
        const title = text.length > 120 ? text.slice(0, 117) + '...' : text;
        
        let link = '';
        if (sel.link) {
          const linkRe = new RegExp(sel.link, 'i');
          link = linkRe.exec(block)?.[1] ?? '';
        }
        if (!link && postId) {
          link = `https://t.me/${postId}`;
        }

        let image_url = '';
        if (sel.image) {
          const imgRe = new RegExp(sel.image, 'i');
          image_url = imgRe.exec(block)?.[1] ?? '';
        }

        let published_at = '';
        if (sel.time) {
          const timeRe = new RegExp(sel.time, 'i');
          const timeMatch = timeRe.exec(block);
          published_at = normalizeDate(timeMatch?.[1] ?? timeMatch?.[2] ?? '');
        }

        items.push(makeItem({ 
          title, 
          link, 
          content: text, 
          summary: text.slice(0, 500), 
          image_url, 
          published_at 
        }, sourceName));
      }
    } else if (sel.text) {
      // Simple fallback without blocks
      const textRe = new RegExp(sel.text, 'gi');
      let sm: RegExpExecArray | null;
      let idx = 0;
      
      while ((sm = textRe.exec(html)) !== null && idx < 50) {
        const text = stripHtml(sm[1]).trim();
        if (!text || text.length < 5) continue;
        
        const textHash = text.slice(0, 50);
        if (seen.has(textHash)) continue;
        seen.add(textHash);

        const title = text.length > 120 ? text.slice(0, 117) + '...' : text;
        items.push(makeItem({ title, link: '', content: text, summary: text.slice(0, 500) }, sourceName));
        idx++;
      }
    }
  }

  if (DEBUG && items.length > 0) {
    console.warn(`[FeedParser:Telegram] Parsed ${items.length} items using strategy ${strategyUsed}`);
  }

  return items;
}

// ── Unified parse entry-point ─────────────────────────────────────────────────

export function parseFeed(
  body: string,
  url: string,
  type: FeedType,
  sourceName: string
): FeedItem[] {
  switch (type) {
    case 'rss':
    case 'atom':
      return parseRssFeed(body, sourceName);
    case 'jsonfeed':
      return parseJsonFeed(body, sourceName);
    case 'sitemap':
      return parseSitemap(body, sourceName);
    case 'wordpress':
      return parseWordPress(body, sourceName);
    case 'json_api':
      return parseJsonApi(body, sourceName);
    case 'html':
      return parseHtmlPage(body, url, sourceName);
    case 'telegram':
      return parseTelegram(body, sourceName);
    default:
      return parseRssFeed(body, sourceName);
  }
}
