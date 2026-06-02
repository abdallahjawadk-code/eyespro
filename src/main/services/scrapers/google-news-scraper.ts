/**
 * Google News Scraper — 100% free, no API key.
 *
 * Uses Google News RSS search endpoint:
 *   https://news.google.com/rss/search?q=QUERY&hl=ar&gl=SA&ceid=SA:ar
 *
 * Supports topic search, country targeting, and article link decoding.
 */
import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { withRetry } from '../../net/stealth-utils';
import { createLogger } from '../../logger';

const log = createLogger('google-news-scraper');

export interface GoogleNewsArticle {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  summary: string;
}

export interface GoogleNewsOptions {
  query: string;
  language?: string; // e.g. 'ar', 'en'
  country?: string;  // e.g. 'SA', 'EG', 'AE', 'US'
  maxResults?: number;
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  const m = cdataRe.exec(xml) || plainRe.exec(xml);
  return m ? m[1].trim() : '';
}

function decodeGoogleNewsUrl(encodedUrl: string): string {
  // Google News wraps article links in a redirect. Strip it.
  try {
    const url = new URL(encodedUrl);
    // Real article link is in the `url` query param for some formats
    const param = url.searchParams.get('url');
    if (param) return param;
  } catch { /* ignore */ }
  return encodedUrl;
}

function parseGoogleNewsRss(xml: string, maxResults: number): GoogleNewsArticle[] {
  const articles: GoogleNewsArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null && articles.length < maxResults) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const rawLink = extractTag(block, 'link');
    const link = decodeGoogleNewsUrl(rawLink);
    const source = extractTag(block, 'source');
    const publishedAt = extractTag(block, 'pubDate');
    const summary = extractTag(block, 'description')
      .replace(/<[^>]+>/g, '')
      .slice(0, 800)
      .trim();

    if (title) {
      articles.push({ title, link, source, publishedAt, summary });
    }
  }
  return articles;
}

export async function scrapeGoogleNews(opts: GoogleNewsOptions): Promise<GoogleNewsArticle[]> {
  const { query, language = 'ar', country = 'SA', maxResults = 30 } = opts;
  const ceid = `${country}:${language}`;
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=${language}&gl=${country}&ceid=${ceid}`;

  log.info(`Fetching Google News RSS: query="${query}" (${ceid})`);

  const res = await withRetry(() => fetchUrlGuarded(url, { timeout: 15_000 }), { maxAttempts: 3, baseDelayMs: 1500 });

  if (!res.ok) throw new Error(`Google News RSS fetch failed: HTTP ${res.status}`);

  const articles = parseGoogleNewsRss(res.body, maxResults);
  log.info(`Scraped ${articles.length} articles from Google News for "${query}"`);
  return articles;
}

/** Get trending news for a region without a specific query */
export async function scrapeGoogleNewsTrending(country = 'SA', language = 'ar', maxResults = 30): Promise<GoogleNewsArticle[]> {
  const ceid = `${country}:${language}`;
  const url = `https://news.google.com/rss?gl=${country}&hl=${language}&ceid=${ceid}`;

  log.info(`Fetching Google News trending for ${ceid}`);

  const res = await fetchUrlGuarded(url, { timeout: 15_000 });

  if (!res.ok) throw new Error(`Google News trending fetch failed: HTTP ${res.status}`);

  const articles = parseGoogleNewsRss(res.body, maxResults);
  log.info(`Scraped ${articles.length} trending articles from Google News (${ceid})`);
  return articles;
}
