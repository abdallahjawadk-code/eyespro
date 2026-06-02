/* ── trend-parser.ts ───────────────────────────────────────────────────────
   Parses Google Trends RSS / Atom XML into structured trend objects.
   Also provides generic RSS 2.0 and Atom 1.0 parsers for custom sources.
   Handles CDATA, URL-encoded Unicode text, and multiple nested news items.
──────────────────────────────────────────────────────────────────────────── */

import type { SourceType } from './trend-sources';

/** Extract the first match of a tag (with optional CDATA wrapper). */
function getTag(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'),
  );
  return m ? m[1].trim() : '';
}

/** Safely decode a percent-encoded URI component (e.g. %D8%A7%D9%84 → عربي). */
function safeDecodeUri(s: string): string {
  if (!s) return s;
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    // Partial encoding — replace each encoded sequence individually
    return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => {
      try { return decodeURIComponent(m); } catch { return m; }
    });
  }
}

/** Strip HTML tags from a string */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export interface ParsedTrend {
  title: string;
  traffic: string | null;
  description: string | null;
}

/* ── Google Trends RSS ───────────────────────────────────────────────────── */

export function parseGoogleTrendsRss(xml: string): ParsedTrend[] {
  const blocks = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)];
  const results: ParsedTrend[] = [];

  for (const m of blocks) {
    const b = m[1];

    const title = safeDecodeUri(getTag(b, 'title'));
    if (!title) continue;

    const traffic = getTag(b, 'ht:approx_traffic') || null;

    // Main description (may be HTML or plain text)
    const rawDesc = safeDecodeUri(getTag(b, 'description'))
      .replace(/<[^>]+>/g, '') // strip any HTML tags
      .trim();

    // ── Extract all related news items ───────────────────────────────────
    // Google Trends RSS nests news inside <ht:news_item>…</ht:news_item>
    const relatedNews: string[] = [];

    const nestedBlocks = [...b.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi)];

    if (nestedBlocks.length > 0) {
      for (const nb of nestedBlocks) {
        const newsTitle  = safeDecodeUri(getTag(nb[1], 'ht:news_item_title'));
        const newsSource = safeDecodeUri(getTag(nb[1], 'ht:news_item_source'));
        if (newsTitle) {
          relatedNews.push(newsSource ? `${newsTitle} — ${newsSource}` : newsTitle);
        }
      }
    } else {
      // Fallback: some older feeds use flat (non-nested) tags
      const newsTitle  = safeDecodeUri(getTag(b, 'ht:news_item_title'));
      const newsSource = safeDecodeUri(getTag(b, 'ht:news_item_source'));
      if (newsTitle) {
        relatedNews.push(newsSource ? `${newsTitle} — ${newsSource}` : newsTitle);
      }
    }

    // ── Combine description (no raw URLs exposed) ─────────────────────────
    let description = rawDesc;

    if (relatedNews.length > 0) {
      const newsBlock =
        `أبرز الأخبار المرتبطة:\n` +
        relatedNews.slice(0, 5).map(n => `• ${n}`).join('\n');
      description = description ? `${description}\n\n${newsBlock}` : newsBlock;
    }

    results.push({
      title,
      traffic,
      description: description || null,
    });
  }

  return results;
}

/* ── Generic RSS 2.0 parser ──────────────────────────────────────────────── */

export function parseRssFeed(xml: string): ParsedTrend[] {
  const blocks = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)];
  const results: ParsedTrend[] = [];

  for (const m of blocks) {
    const b = m[1];
    const title = stripHtml(safeDecodeUri(getTag(b, 'title')));
    if (!title) continue;

    const rawDesc = stripHtml(safeDecodeUri(getTag(b, 'description') || getTag(b, 'content:encoded')));
    const description = rawDesc.slice(0, 600) || null;

    results.push({ title, traffic: null, description });
  }

  return results;
}

/* ── Generic Atom 1.0 parser (also covers YouTube & Reddit) ──────────────── */

export function parseAtomFeed(xml: string): ParsedTrend[] {
  const blocks = [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)];
  const results: ParsedTrend[] = [];

  for (const m of blocks) {
    const b = m[1];
    const title = stripHtml(safeDecodeUri(getTag(b, 'title') || getTag(b, 'media:title')));
    if (!title) continue;

    const rawDesc = stripHtml(
      safeDecodeUri(
        getTag(b, 'summary') ||
        getTag(b, 'content') ||
        getTag(b, 'media:description')
      )
    );
    const description = rawDesc.slice(0, 600) || null;

    results.push({ title, traffic: null, description });
  }

  return results;
}

/* ── Wikipedia Trending (Wikimedia REST API) ─────────────────────────────── */

/** Pages to exclude from Wikipedia trending (meta/system pages) */
const WIKI_SKIP_PATTERNS = [
  /^(صفحة_رئيسية|Main_Page|Special:|Wikipedia:|ويكيبيديا:|بوابة:|Portal:|Help:|مساعدة:|نقاش_)/i,
];

interface WikiApiItem { article: string; rank: number; views: number }

export function parseWikipediaJson(json: string, lang = 'ar'): ParsedTrend[] {
  let data: { items?: [{ articles?: WikiApiItem[] }] };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    return [];
  }

  const articles = data?.items?.[0]?.articles ?? [];
  const results: ParsedTrend[] = [];

  for (const item of articles) {
    if (!item.article) continue;
    const title = decodeURIComponent(item.article.replace(/_/g, ' '));
    if (WIKI_SKIP_PATTERNS.some(p => p.test(item.article))) continue;
    const views = item.views ? `${item.views.toLocaleString()} مشاهدة` : null;
    const wikiBase = lang === 'ar' ? 'ar.wikipedia.org/wiki' : 'en.wikipedia.org/wiki';
    results.push({
      title,
      traffic: views,
      description: `ترتيب #${item.rank} في ويكيبيديا (${lang}) — https://${wikiBase}/${item.article}`,
    });
    if (results.length >= 30) break; // cap at 30 items
  }

  return results;
}

/* ── Auto-detect feed type and parse ─────────────────────────────────────── */

export function detectFeedType(xml: string): 'google_trends' | 'rss' | 'atom' | 'unknown' {
  if (xml.includes('ht:approx_traffic') || xml.includes('trends.google.com')) return 'google_trends';
  if (xml.includes('<feed') && xml.includes('xmlns')) return 'atom';
  if (xml.includes('<rss') || xml.includes('<channel>')) return 'rss';
  return 'unknown';
}

export function parseFeedBySourceType(body: string, sourceType: SourceType, lang = 'ar'): ParsedTrend[] {
  switch (sourceType) {
    case 'google_trends_geo':
      return parseGoogleTrendsRss(body);
    case 'youtube':
    case 'atom':
    case 'reddit':
      return parseAtomFeed(body);
    case 'wikipedia':
      return parseWikipediaJson(body, lang);
    case 'rss':
    default: {
      // Auto-detect: some RSS hosts accidentally serve Atom
      const detected = detectFeedType(body);
      if (detected === 'google_trends') return parseGoogleTrendsRss(body);
      if (detected === 'atom') return parseAtomFeed(body);
      return parseRssFeed(body);
    }
  }
}
