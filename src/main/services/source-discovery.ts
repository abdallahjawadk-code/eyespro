/**
 * Advanced multi-candidate source / feed discovery.
 * HTTP Link headers, HTML autodiscovery, path probes, WordPress, JSON API, browser XHR sniff.
 */
import { createHash } from 'node:crypto';
import { getDb } from '../db/database';
import { fetchUrlGuarded } from '../net/guarded-fetch';
import { extractFeedLinksFromHeaders } from '../net/link-header';
import { browserSniffJsonFeeds } from '../net/browser-sniff';
import { detectType, parseFeed, type FeedType } from '../net/feed-parser';
import { sanitizeString } from '../security/sanitize';
import { getSetting } from './settings';

export type DiscoveryMethod =
  | 'direct'
  | 'http_link'
  | 'html_link'
  | 'path_probe'
  | 'wordpress'
  | 'json_api'
  | 'browser_xhr'
  | 'sitemap'
  | 'telegram'
  | 'html_fallback';

export interface FeedCandidate {
  feedUrl: string;
  type: string;
  method: DiscoveryMethod;
  /** Preliminary confidence 0–100 (before freshness) */
  confidence: number;
  /** Final score 0–100 after freshness probe */
  score: number;
  label: string;
  itemCount?: number;
  freshRate?: number;
  etag?: string;
  lastModified?: string;
  hasWebSub?: boolean;
}

export interface DiscoverSourceResult {
  ok: boolean;
  inputUrl: string;
  title?: string;
  candidates: FeedCandidate[];
  best?: FeedCandidate;
  error?: string;
  runId?: number;
}

const RSS_PROBE_PATHS = [
  '/feed', '/feed/', '/rss', '/rss/', '/atom', '/atom/',
  '/feed.xml', '/rss.xml', '/atom.xml', '/feed.json',
  '/index.xml', '/feeds/posts/default', '/blog/feed', '/blog/rss',
  '/news/feed', '/news/rss', '/articles/feed', '/posts/feed',
  '/en/feed', '/ar/feed',
  '/.well-known/feeds', '/.well-known/feed',
];

const JSON_API_PROBE_PATHS = [
  '/wp-json/wp/v2/posts?per_page=20&_embed=0',
  '/api/v2/posts?limit=20',
  '/api/posts?limit=20',
  '/api/articles?limit=20',
  '/api/news?limit=20',
  '/v1/articles?limit=20',
  '/v2/posts?limit=20',
];

const METHOD_BASE: Record<DiscoveryMethod, number> = {
  direct: 88,
  http_link: 82,
  html_link: 78,
  path_probe: 72,
  wordpress: 80,
  json_api: 76,
  browser_xhr: 74,
  sitemap: 35,
  telegram: 90,
  html_fallback: 28
};

function discoveryMode(): 'fast' | 'thorough' {
  const m = getSetting('discovery_mode') || 'thorough';
  return m === 'fast' ? 'fast' : 'thorough';
}

export function normaliseTelegramUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(?:t\.me|telegram\.me)\/(?!s\/)([^/?#]+)/i);
  if (m) return `https://t.me/s/${m[1]}`;
  return url;
}

function buildWordPressApiUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts?per_page=20&_embed=0`;
}

function extractPageTitle(body: string, fallbackUrl: string): string {
  const m = body.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  if (m?.[1]) return m[1].replace(/\s+/g, ' ').trim().slice(0, 200);
  try { return new URL(fallbackUrl).hostname; } catch { return fallbackUrl.slice(0, 100); }
}

function discoverFeedUrlFromHtml(html: string, baseUrl: string): string | null {
  const linkRe = /<link\s+[^>]*rel=["']alternate["'][^>]*>/gi;
  const feeds: { href: string; type: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (typeMatch && hrefMatch) {
      const type = typeMatch[1].toLowerCase();
      const href = hrefMatch[1].trim();
      if (type.includes('rss') || type.includes('atom') || type.includes('json') || type.includes('feed')) {
        feeds.push({ href, type });
      }
    }
  }
  const anchorRe = /href=["']([^"']*(?:feed|rss|atom)[^"']*\.(?:xml|rss|atom|json))["']/gi;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1].trim();
    if (!feeds.some(f => f.href === href)) feeds.push({ href, type: 'rss+xml' });
  }
  if (!feeds.length) return null;
  const preferred = feeds.find(f => f.type.includes('rss+xml') || f.type.includes('atom+xml')) || feeds[0]!;
  try { return new URL(preferred.href, baseUrl).toString(); } catch { return null; }
}

function detectJsonApi(body: string): boolean {
  try {
    const data = JSON.parse(body.trim()) as unknown;
    if (Array.isArray(data) && data.length > 0) {
      const f = data[0] as Record<string, unknown>;
      return !!(f.title || f.name || (f.title && typeof f.title === 'object')) && !!(f.link || f.url || f.id);
    }
    if (typeof data === 'object' && data !== null) {
      const o = data as Record<string, unknown>;
      const arr = o.items ?? o.data ?? o.posts;
      if (Array.isArray(arr) && arr.length > 0) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function hasWebSubHub(xml: string): boolean {
  return /<link[^>]+rel=["']hub["']/i.test(xml) || /<link[^>]+rel=["']self["']/i.test(xml);
}

async function probeFeedPaths(origin: string): Promise<{ feedUrl: string; type: string } | null> {
  for (const path of RSS_PROBE_PATHS) {
    const candidate = origin.replace(/\/$/, '') + path;
    try {
      const r = await fetchUrlGuarded(candidate);
      if (!r.ok || r.body.length < 80) continue;
      const t = detectType(r.body, candidate);
      if (t !== 'html') return { feedUrl: candidate, type: t };
    } catch { /* next */ }
  }
  return null;
}

async function probeJsonApiPaths(origin: string): Promise<{ feedUrl: string } | null> {
  const base = origin.replace(/\/$/, '');
  for (const path of JSON_API_PROBE_PATHS) {
    const candidate = base + path;
    try {
      const r = await fetchUrlGuarded(candidate);
      if (r.ok && detectJsonApi(r.body)) return { feedUrl: candidate };
    } catch { /* next */ }
  }
  return null;
}

function candidateKey(c: { feedUrl: string; type: string }): string {
  try {
    return new URL(c.feedUrl).href.toLowerCase();
  } catch {
    return c.feedUrl.toLowerCase();
  }
}

function addCandidate(
  map: Map<string, FeedCandidate>,
  partial: Omit<FeedCandidate, 'score'> & { score?: number }
): void {
  const key = candidateKey(partial);
  const existing = map.get(key);
  const score = partial.score ?? partial.confidence;
  const next: FeedCandidate = {
    ...partial,
    score,
    label: partial.label || `${partial.method} · ${partial.type}`
  };
  if (!existing || next.confidence > existing.confidence) {
    map.set(key, next);
  }
}

/** Probe feed and compute freshness + extract ETag */
export async function scoreFeedCandidate(c: FeedCandidate): Promise<FeedCandidate> {
  try {
    const r = await fetchUrlGuarded(c.feedUrl);
    if (!r.ok) return { ...c, score: Math.max(0, c.confidence - 40) };

    const etag = typeof r.headers?.etag === 'string' ? r.headers.etag : undefined;
    const lastModified =
      typeof r.headers?.['last-modified'] === 'string' ? r.headers['last-modified'] : undefined;

    const type = detectType(r.body, c.feedUrl);
    if (type === 'html' && c.method !== 'html_fallback') {
      return { ...c, score: Math.max(5, c.confidence - 50) };
    }

    let itemCount = 0;
    let freshRate = 0;
    let hasWebSub = false;

    if (type === 'json_api' || (type === 'wordpress' && c.method === 'json_api')) {
      itemCount = detectJsonApi(r.body) ? 10 : 0;
      freshRate = itemCount > 0 ? 0.8 : 0;
    } else if (type !== 'html') {
      const items = parseFeed(r.body, c.feedUrl, type as FeedType, '');
      itemCount = items.length;
      hasWebSub = hasWebSubHub(r.body);
      const cutoff = Date.now() - 30 * 24 * 3600_000;
      const recent = items.filter(i => {
        if (!i.published_at) return true;
        const d = new Date(i.published_at).getTime();
        return !isNaN(d) && d >= cutoff;
      });
      freshRate = items.length > 0 ? recent.length / items.length : 0;
    }

    const freshnessScore = Math.round(10 + freshRate * 55 + Math.min(itemCount, 25) * 1.2);
    const webSubBonus = hasWebSub ? 8 : 0;
    const finalScore = Math.min(100, Math.round(c.confidence * 0.45 + freshnessScore * 0.55 + webSubBonus));

    return {
      ...c,
      type: type === 'html' ? c.type : type,
      score: finalScore,
      itemCount,
      freshRate,
      etag,
      lastModified,
      hasWebSub
    };
  } catch {
    return { ...c, score: Math.max(0, c.confidence - 35) };
  }
}

export async function rankCandidates(candidates: FeedCandidate[]): Promise<FeedCandidate[]> {
  const scored = await Promise.all(candidates.map(c => scoreFeedCandidate(c)));
  return scored
    .filter(c => c.score > 0 || c.method === 'html_fallback')
    .sort((a, b) => b.score - a.score);
}

export function persistDiscoveryRun(
  inputUrl: string,
  candidates: FeedCandidate[],
  best?: FeedCandidate
): number {
  const hash = createHash('sha256').update(inputUrl.toLowerCase()).digest('hex').slice(0, 32);
  const r = getDb()
    .prepare(
      `INSERT INTO source_discovery_runs (input_url, input_hash, candidates_json, chosen_json, best_score, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      sanitizeString(inputUrl, 2048),
      hash,
      JSON.stringify(candidates.slice(0, 12)),
      best ? JSON.stringify(best) : null,
      best?.score ?? 0
    );
  return Number(r.lastInsertRowid);
}

/**
 * Discover all feed candidates for a URL, rank by score, return best.
 */
export async function discoverSourceCandidates(
  rawUrl: string,
  opts?: { mode?: 'fast' | 'thorough'; skipBrowser?: boolean; skipProbes?: boolean }
): Promise<DiscoverSourceResult> {
  let url = rawUrl.trim();
  if (!url.match(/^https?:\/\//i)) url = 'https://' + url;
  try { new URL(url); } catch {
    return { ok: false, inputUrl: url, candidates: [], error: 'رابط غير صالح' };
  }

  const mode = opts?.mode ?? discoveryMode();
  const map = new Map<string, FeedCandidate>();
  let pageTitle = '';

  if (/t\.me|telegram\.me/i.test(url)) {
    const tgUrl = normaliseTelegramUrl(url) ?? url;
    const channel = tgUrl.replace(/.*\/s\//, '').replace(/\/.*/, '');
    const c: FeedCandidate = {
      feedUrl: tgUrl,
      type: 'telegram',
      method: 'telegram',
      confidence: METHOD_BASE.telegram,
      score: METHOD_BASE.telegram,
      label: `Telegram @${channel}`
    };
    return { ok: true, inputUrl: url, title: `Telegram: @${channel}`, candidates: [c], best: c };
  }

  let origin = '';
  try { origin = new URL(url).origin; } catch { /* ignore */ }

  const res = await fetchUrlGuarded(url);
  if (res.ok && res.body.length > 50) {
    pageTitle = extractPageTitle(res.body, url);
    const directType = detectType(res.body, url);

    if (directType !== 'html') {
      addCandidate(map, {
        feedUrl: url,
        type: directType,
        method: 'direct',
        confidence: METHOD_BASE.direct,
        label: `مباشر · ${directType.toUpperCase()}`
      });
    } else {
      for (const feedUrl of extractFeedLinksFromHeaders(res.headers, url)) {
        addCandidate(map, {
          feedUrl,
          type: 'rss',
          method: 'http_link',
          confidence: METHOD_BASE.http_link,
          label: 'HTTP Link header'
        });
      }

      const htmlFeed = discoverFeedUrlFromHtml(res.body, url);
      if (htmlFeed) {
        addCandidate(map, {
          feedUrl: htmlFeed,
          type: 'rss',
          method: 'html_link',
          confidence: METHOD_BASE.html_link,
          label: 'HTML <link rel="alternate">'
        });
      }
    }
  }

  if (origin && !opts?.skipProbes) {
    const probed = await probeFeedPaths(origin);
    if (probed) {
      addCandidate(map, {
        feedUrl: probed.feedUrl,
        type: probed.type,
        method: 'path_probe',
        confidence: METHOD_BASE.path_probe,
        label: `مسار شائع · ${probed.feedUrl.split('/').pop()}`
      });
    }

    const jsonApi = await probeJsonApiPaths(origin);
    if (jsonApi) {
      addCandidate(map, {
        feedUrl: jsonApi.feedUrl,
        type: 'json_api',
        method: 'json_api',
        confidence: METHOD_BASE.json_api,
        label: 'JSON API'
      });
    }

    const wpUrl = buildWordPressApiUrl(origin);
    try {
      const wpRes = await fetchUrlGuarded(wpUrl);
      if (wpRes.ok && detectJsonApi(wpRes.body)) {
        addCandidate(map, {
          feedUrl: origin,
          type: 'wordpress',
          method: 'wordpress',
          confidence: METHOD_BASE.wordpress,
          label: 'WordPress REST'
        });
      }
    } catch { /* ignore */ }
  }

  if (mode === 'thorough' && !opts?.skipBrowser && origin && map.size < 4) {
    const sniffed = await browserSniffJsonFeeds(url);
    for (const s of sniffed) {
      addCandidate(map, {
        feedUrl: s.url,
        type: 'json_api',
        method: 'browser_xhr',
        confidence: METHOD_BASE.browser_xhr + Math.min(s.itemCount, 10),
        label: `XHR JSON · ${s.itemCount} عناصر`
      });
    }
  }

  if (map.size === 0 && res.ok) {
    addCandidate(map, {
      feedUrl: url,
      type: 'html',
      method: 'html_fallback',
      confidence: METHOD_BASE.html_fallback,
      label: 'كشط HTML (لا خلاصة)'
    });
  } else if (![...map.values()].some(c => c.score >= 50 || c.confidence >= 70)) {
    addCandidate(map, {
      feedUrl: url,
      type: 'html',
      method: 'html_fallback',
      confidence: METHOD_BASE.html_fallback,
      label: 'كشط HTML (احتياطي)'
    });
  }

  if (!res.ok && map.size === 0) {
    if (origin) {
      const wpUrl = buildWordPressApiUrl(origin);
      const wpRes = await fetchUrlGuarded(wpUrl);
      if (wpRes.ok && detectJsonApi(wpRes.body)) {
        addCandidate(map, {
          feedUrl: origin,
          type: 'wordpress',
          method: 'wordpress',
          confidence: METHOD_BASE.wordpress,
          label: 'WordPress REST'
        });
      }
    }
    if (map.size === 0) {
      return { ok: false, inputUrl: url, candidates: [], error: `تعذّر الاتصال (${res.status || 0})` };
    }
  }

  const preliminary = [...map.values()];
  const ranked = await rankCandidates(preliminary);
  const viable = ranked.filter(c => c.method !== 'html_fallback' || ranked.length === 1);
  const best = viable[0] ?? ranked[0];
  const runId = persistDiscoveryRun(url, ranked, best);

  if (!best) {
    return { ok: false, inputUrl: url, candidates: ranked, error: 'لم يُعثر على مصدر صالح', runId };
  }

  return {
    ok: true,
    inputUrl: url,
    title: pageTitle || (() => { try { return new URL(best.feedUrl).hostname; } catch { return ''; } })(),
    candidates: ranked,
    best,
    runId
  };
}

/** Backward-compatible single-result detect */
export async function detectSourceUrlAdvanced(rawUrl: string): Promise<{
  ok: boolean;
  type?: string;
  feedUrl?: string;
  title?: string;
  error?: string;
  candidates?: FeedCandidate[];
  best?: FeedCandidate;
  runId?: number;
  confidence?: number;
}> {
  const r = await discoverSourceCandidates(rawUrl);
  if (!r.ok || !r.best) {
    return { ok: false, error: r.error, candidates: r.candidates, runId: r.runId };
  }
  return {
    ok: true,
    type: r.best.type,
    feedUrl: r.best.feedUrl,
    title: r.title,
    candidates: r.candidates,
    best: r.best,
    runId: r.runId,
    confidence: r.best.score
  };
}
