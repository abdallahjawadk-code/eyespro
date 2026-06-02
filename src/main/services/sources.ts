import { getDb } from '../db/database';
import { fetchUrlGuarded, type GuardedFetchOpts } from '../net/guarded-fetch';
import { detectType, parseFeed, parseFeedMetadata, BINARY_EXT, type FeedType } from '../net/feed-parser';
import { sanitizeString } from '../security/sanitize';
import { getSetting } from './settings';
import { createArticle } from './articles';
import { auditEmitter } from '../events/audit-emitter';
import { getActiveTenantId, tenantSqlClause } from './tenant';
import { isDuplicate, isTitleSimilarSameSource } from './dedup';
import { fetchArticlePage } from './fetch-pipeline';
import { effectiveFetchMode, type FetchMode } from './domain-policy';
import { normalizeUrlForDedup } from '../net/url-utils';
import { sourceFetchHealth, logFetchAudit } from './fetch-audit';
import { isFeedOnlyMode } from './fetch-shield';
import { assessFetchedArticleTier } from './post-fetch-quality';
import { linkFingerprint } from './link-provenance';
import { scanLink } from './link-scan';
import { refreshAdaptiveInterval, applyPublisherTtl } from './adaptive-polling';
import { updateTrustAfterFetch } from './source-trust';
import { runSpreadBatch } from './spread-fetch';
import type { HttpResult } from '../net/http';
import {
  detectSourceUrlAdvanced,
  discoverSourceCandidates,
  normaliseTelegramUrl,
  scoreFeedCandidate
} from './source-discovery';

function randomDelay(): Promise<void> {
  const min = Number(getSetting('fetch_article_delay_min_ms') || '300');
  const max = Number(getSetting('fetch_article_delay_max_ms') || '1500');
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

export interface SourceRow {
  id: number;
  name: string;
  url: string | null;
  enabled: number;
  source_type: string | null;
  category: string | null;
  css_selector: string | null;
  link_extensions: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
  use_ai_extractor?: number;
  include_keywords?: string | null;
  exclude_keywords?: string | null;
  fetch_mode?: string | null;
  last_item_guid?: string | null;
  last_pub_date?: string | null;
  clean_rules_json?: string | null;
  fetch_interval_min?: number;
  next_fetch_at?: string | null;
  trust_score?: number | null;
  feed_etag?: string | null;
  feed_last_modified?: string | null;
  discovery_confidence?: number | null;
}

export function listSources(): SourceRow[] {
  const tenant = tenantSqlClause();
  return getDb()
    .prepare(`SELECT * FROM sources WHERE 1=1${tenant.sql} ORDER BY name`)
    .all(...tenant.params) as SourceRow[];
}

export function getSource(id: number): SourceRow | null {
  const tenant = tenantSqlClause();
  return (
    (getDb()
      .prepare(`SELECT * FROM sources WHERE id = ?${tenant.sql}`)
      .get(id, ...tenant.params) as SourceRow | undefined) ?? null
  );
}

export function createSource(data: Partial<SourceRow>): number {
  const name = sanitizeString(data.name, 200);
  const url  = data.url ? sanitizeString(data.url, 2048) : null;
  const tenantId = getActiveTenantId();
  const normUrl = normaliseTelegramUrl(url);

  const r = getDb()
    .prepare(
      `INSERT INTO sources (name, url, enabled, source_type, category, css_selector, link_extensions, use_ai_extractor, include_keywords, exclude_keywords, fetch_mode, clean_rules_json, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      normUrl,
      data.enabled ?? 1,
      data.source_type ? sanitizeString(data.source_type, 32) : null,
      data.category ?? null,
      data.css_selector ? sanitizeString(data.css_selector, 500) : null,
      data.link_extensions ? sanitizeString(data.link_extensions, 500) : null,
      data.use_ai_extractor ?? 0,
      data.include_keywords ? sanitizeString(data.include_keywords, 2000) : null,
      data.exclude_keywords ? sanitizeString(data.exclude_keywords, 2000) : null,
      sanitizeString(data.fetch_mode ?? 'smart', 32),
      data.clean_rules_json ? sanitizeString(data.clean_rules_json, 8000) : null,
      tenantId
    );
  return Number(r.lastInsertRowid);
}

/** Detect feed URL/type after create and update source row. */
export async function autoDetectAndUpdateSource(id: number, url: string): Promise<DiscoverSourcePayload | null> {
  try {
    const detected = await detectSourceUrlAdvanced(url);
    if (!detected.ok || !detected.feedUrl) return null;
    const tenant = tenantSqlClause();
    const b = detected.best;
    getDb()
      .prepare(
        `UPDATE sources SET url=?, source_type=?, name=COALESCE(NULLIF(name,''), ?),
         discovery_confidence=?, feed_etag=?, feed_last_modified=? WHERE id=?${tenant.sql}`
      )
      .run(
        detected.feedUrl,
        detected.type ?? null,
        detected.title ?? '',
        detected.confidence ?? b?.score ?? null,
        b?.etag ?? null,
        b?.lastModified ?? null,
        id,
        ...tenant.params
      );
    return detected;
  } catch {
    return null;
  }
}

export type DiscoverSourcePayload = Awaited<ReturnType<typeof detectSourceUrlAdvanced>>;

export function updateSource(id: number, data: Partial<SourceRow>): boolean {
  const cur = getSource(id);
  if (!cur) return false;
  const tenant = tenantSqlClause();
  const newUrl = data.url != null
    ? normaliseTelegramUrl(sanitizeString(data.url, 2048))
    : cur.url;
  getDb()
    .prepare(
      `UPDATE sources SET name=?, url=?, enabled=?, source_type=?, category=?, css_selector=?, link_extensions=?, use_ai_extractor=?, include_keywords=?, exclude_keywords=?, fetch_mode=?, clean_rules_json=? WHERE id=?${tenant.sql}`
    )
    .run(
      data.name != null ? sanitizeString(data.name, 200) : cur.name,
      newUrl,
      data.enabled ?? cur.enabled,
      data.source_type !== undefined ? (data.source_type ? sanitizeString(data.source_type, 32) : null) : cur.source_type,
      data.category !== undefined ? data.category : cur.category,
      data.css_selector !== undefined ? (data.css_selector ? sanitizeString(data.css_selector, 500) : null) : cur.css_selector,
      data.link_extensions !== undefined ? (data.link_extensions ? sanitizeString(data.link_extensions, 500) : null) : cur.link_extensions,
      data.use_ai_extractor ?? cur.use_ai_extractor ?? 0,
      data.include_keywords !== undefined ? (data.include_keywords ? sanitizeString(data.include_keywords, 2000) : null) : (cur.include_keywords ?? null),
      data.exclude_keywords !== undefined ? (data.exclude_keywords ? sanitizeString(data.exclude_keywords, 2000) : null) : (cur.exclude_keywords ?? null),
      data.fetch_mode !== undefined ? sanitizeString(data.fetch_mode ?? 'smart', 32) : (cur.fetch_mode ?? 'smart'),
      data.clean_rules_json !== undefined ? (data.clean_rules_json ? sanitizeString(data.clean_rules_json, 8000) : null) : (cur.clean_rules_json ?? null),
      id,
      ...tenant.params
    );
  return true;
}

export function deleteSource(id: number): boolean {
  const tenant = tenantSqlClause();
  const r = getDb().prepare(`DELETE FROM sources WHERE id = ?${tenant.sql}`).run(id, ...tenant.params);
  return r.changes > 0;
}

export function toggleSource(id: number, enabled: boolean): boolean {
  const tenant = tenantSqlClause();
  const r = getDb()
    .prepare(`UPDATE sources SET enabled = ? WHERE id = ?${tenant.sql}`)
    .run(enabled ? 1 : 0, id, ...tenant.params);
  return r.changes > 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── WordPress: auto-build API URL from site URL ───────────────────────────────
function buildWordPressApiUrl(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '');
  return `${base}/wp-json/wp/v2/posts?per_page=100&_embed=1`;
}

// Common RSS/Atom/JSON Feed path probes — tried in order when <link> tag is absent
const RSS_PROBE_PATHS = [
  '/feed', '/feed/', '/rss', '/rss/', '/atom', '/atom/',
  '/feed.xml', '/rss.xml', '/atom.xml', '/feed.json',
  '/index.xml', '/feeds/posts/default', '/blog/feed', '/blog/rss',
  '/news/feed', '/news/rss', '/articles/feed', '/posts/feed',
  '/en/feed', '/ar/feed',
];


/** Try common RSS/Atom/JSON path probes; returns the first live feed URL found. */
async function probeFeedPaths(baseUrl: string): Promise<{ feedUrl: string; type: string } | null> {
  const origin = (() => { try { return new URL(baseUrl).origin; } catch { return null; } })();
  if (!origin) return null;

  // Run all probes in parallel instead of sequentially (was 18 sequential HTTP requests)
  const probes = RSS_PROBE_PATHS.map(async (p, idx) => {
    const candidate = origin + p;
    const r = await fetchUrlGuarded(candidate);
    if (!r.ok || r.body.length < 100) return null;
    const t = detectType(r.body, candidate);
    if (t === 'html') return null;
    return { feedUrl: candidate, type: t, idx };
  });

  const results = await Promise.allSettled(probes);
  // Pick the first successful result (preserving original path order)
  let best: { feedUrl: string; type: string; idx: number } | null = null;
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value) {
      if (!best || res.value.idx < best.idx) best = res.value;
    }
  }
  return best ? { feedUrl: best.feedUrl, type: best.type } : null;
}


/** Extract t.me/channel_name links from HTML and return normalised Telegram URLs. */
function extractTelegramLinks(html: string, baseUrl: string): string[] {
  const re = /https?:\/\/t\.me\/([a-zA-Z0-9_]{3,})/gi;
  const seen = new Set<string>();
  const results: string[] = [];
  let m: RegExpExecArray | null;
  const baseHost = (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
  while ((m = re.exec(html)) !== null) {
    const channel = m[1];
    if (['joinchat', 's', 'share', 'iv'].includes(channel.toLowerCase())) continue;
    const url = `https://t.me/s/${channel}`;
    if (!seen.has(url)) { seen.add(url); results.push(url); }
    if (results.length >= 5) break;
  }
  void baseHost;
  return results;
}

/** Score a discovered feed: returns 0–100 (uses advanced ranking). */
async function scoreFeedFreshness(feedUrl: string): Promise<number> {
  const scored = await scoreFeedCandidate({
    feedUrl,
    type: 'rss',
    method: 'direct',
    confidence: 75,
    score: 75,
    label: 'freshness'
  });
  return scored.score;
}

function persistFeedCacheHeaders(sourceId: number, headers?: Record<string, string | string[]>): void {
  if (!headers) return;
  const etag = typeof headers.etag === 'string' ? headers.etag : undefined;
  const lm = typeof headers['last-modified'] === 'string' ? headers['last-modified'] : undefined;
  if (!etag && !lm) return;
  getDb()
    .prepare(`UPDATE sources SET feed_etag=COALESCE(?, feed_etag), feed_last_modified=COALESCE(?, feed_last_modified) WHERE id=?`)
    .run(etag ?? null, lm ?? null, sourceId);
}

function conditionalOpts(source: SourceRow): GuardedFetchOpts['conditional'] | undefined {
  if (!source.feed_etag && !source.feed_last_modified) return undefined;
  return { etag: source.feed_etag ?? null, lastModified: source.feed_last_modified ?? null };
}

async function fetchFeedGuarded(url: string, sourceId: number, source: SourceRow, timeout = 15000): Promise<HttpResult> {
  const res = await fetchUrlGuarded(url, { conditional: conditionalOpts(source), timeout });
  if (res.permanentRedirectUrl && url === source.url) {
    try {
      getDb().prepare(`UPDATE sources SET url = ? WHERE id = ?`).run(res.permanentRedirectUrl, sourceId);
      source.url = res.permanentRedirectUrl;
    } catch (dbErr) {
      console.error('Failed to update source redirect URL:', dbErr);
    }
  }
  if (res.notModified) return res;
  if (res.ok) persistFeedCacheHeaders(sourceId, res.headers);
  return res;
}

/** Scan existing articles to surface new t.me channel links. */
export async function discoverTelegramFromArticles(limit = 200): Promise<FeedSearchResult[]> {
  type Row = { content: string | null; link: string | null };
  const rows = getDb()
    .prepare(`SELECT content, link FROM articles WHERE content IS NOT NULL ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Row[];

  const seen = new Set<string>();
  // Add already-known telegram sources
  const existing = getDb().prepare(`SELECT url FROM sources WHERE url LIKE '%t.me%'`).all() as { url: string }[];
  for (const e of existing) seen.add(e.url);

  const found: FeedSearchResult[] = [];
  for (const row of rows) {
    const text = (row.content ?? '') + ' ' + (row.link ?? '');
    const links = extractTelegramLinks(text, row.link ?? '');
    for (const url of links) {
      if (seen.has(url)) continue;
      seen.add(url);
      const channel = url.replace('https://t.me/s/', '');
      found.push({ title: `Telegram: @${channel}`, feedUrl: url, website: `https://t.me/${channel}`, type: 'telegram' });
    }
    if (found.length >= 20) break;
  }
  return found;
}

// ── Feed search by topic ──────────────────────────────────────────────────────

export interface FeedSearchResult {
  title: string;
  feedUrl: string;
  website?: string;
  description?: string;
  subscribers?: number;
  type?: string;
  score?: number;         // freshness/quality score 0–100
  telegramChannels?: string[]; // discovered t.me channels on the site
}


/**
 * Search for RSS/feed sources that cover a given topic.
 * Strategy:
 *  1. Feedly public search API  — fast, direct feed URLs + subscriber count
 *  2. Google News RSS           — extract <source> sites → full discovery pipeline
 *  3. RSS path probing          — for any site that slipped through without a feed tag
 *
 * Each candidate is scored for freshness (0–100). Dead feeds (score=0) are filtered.
 * Results sorted: score DESC, subscribers DESC.
 */
export async function searchFeedsByTopic(query: string): Promise<{
  ok: boolean;
  results?: FeedSearchResult[];
  error?: string;
}> {
  const { searchSourcesAdvanced } = await import('./source-search/search');
  const res = await searchSourcesAdvanced({ query, region: 'SA' });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, results: res.results };
}

/** Preview full-article fetch for a source (first item link or sample URL). */
export async function previewSourceFetch(
  sourceId: number,
  sampleUrl?: string
): Promise<{
  ok: boolean;
  preview?: { title: string; summary: string; contentLength: number; image: string; method: string; purityScore: number; warnings: string[] };
  error?: string;
  health?: ReturnType<typeof sourceFetchHealth>;
}> {
  const source = getSource(sourceId);
  if (!source) return { ok: false, error: 'Source not found' };
  let url = sampleUrl?.trim();
  if (!url && source.url) {
    try {
      const res = await fetchUrlGuarded(source.url);
      if (res.ok) {
        const items = parseFeed(res.body, source.url, detectType(res.body, source.url), source.name);
        url = items.find(i => i.link)?.link;
      }
    } catch { /* ignore */ }
  }
  if (!url) return { ok: false, error: 'No sample URL', health: sourceFetchHealth(sourceId) };
  const mode = effectiveFetchMode(new URL(url).hostname, source.fetch_mode) as FetchMode;
  const fetched = await fetchArticlePage({
    url,
    sourceId,
    fetchMode: mode,
    selector: source.css_selector ?? undefined,
    cleanRulesJson: source.clean_rules_json,
    context: 'source',
    skipQualityReject: true
  });
  if (!fetched.ok || !fetched.extracted) {
    return { ok: false, error: fetched.error, health: sourceFetchHealth(sourceId) };
  }
  const ex = fetched.extracted;
  return {
    ok: true,
    health: sourceFetchHealth(sourceId),
    preview: {
      title: ex.title,
      summary: ex.summary.slice(0, 300),
      contentLength: ex.content.length,
      image: ex.image,
      method: fetched.method,
      purityScore: fetched.purityScore,
      warnings: fetched.warnings
    }
  };
}

export function getSourceHealth(sourceId: number) {
  return sourceFetchHealth(sourceId);
}

/**
 * Bulk-import sources from a URL list or OPML-style plain text (one URL per line).
 * Runs full discovery on each URL and returns import summary.
 */
export async function bulkDiscoverSources(urlsOrText: string): Promise<{
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  results: Array<{ url: string; ok: boolean; name?: string; type?: string; error?: string }>;
}> {
  const lines = urlsOrText.split(/[\r\n,]+/).map(l => l.trim()).filter(l => l.match(/^https?:\/\//i));
  const summary = { total: lines.length, imported: 0, skipped: 0, failed: 0, results: [] as Array<{ url: string; ok: boolean; name?: string; type?: string; error?: string }> };

  const knownUrls = new Set(
    (getDb().prepare(`SELECT url FROM sources WHERE url IS NOT NULL`).all() as { url: string }[]).map(r => r.url)
  );

  for (const rawUrl of lines) {
    if (knownUrls.has(rawUrl)) {
      summary.skipped++;
      summary.results.push({ url: rawUrl, ok: false, error: 'موجود مسبقاً' });
      continue;
    }
    try {
      const detected = await detectSourceUrl(rawUrl);
      if (!detected.ok || !detected.feedUrl) {
        summary.failed++;
        summary.results.push({ url: rawUrl, ok: false, error: detected.error });
        continue;
      }
      const name = detected.title || new URL(detected.feedUrl).hostname;
      createSource({ name, url: detected.feedUrl, enabled: 1 });
      knownUrls.add(detected.feedUrl);
      summary.imported++;
      summary.results.push({ url: rawUrl, ok: true, name, type: detected.type });
    } catch (e) {
      summary.failed++;
      summary.results.push({ url: rawUrl, ok: false, error: (e as Error).message.slice(0, 100) });
    }
  }
  return summary;
}

/**
 * Re-discover feed URLs for sources that have errors or are of type 'html'.
 * Updates their URL in the DB if a better feed is found.
 */
export async function rediscoverBrokenSources(limit = 20): Promise<{ checked: number; updated: number }> {
  const rows = getDb()
    .prepare(
      `SELECT id, url, name FROM sources
       WHERE enabled=1 AND (last_error IS NOT NULL OR source_type='html' OR source_type IS NULL)
       ORDER BY last_fetched_at ASC NULLS FIRST LIMIT ?`
    )
    .all(limit) as { id: number; url: string; name: string }[];

  let checked = 0, updated = 0;
  for (const row of rows) {
    if (!row.url) continue;
    checked++;
    try {
      // Try path probing first (faster than full discoverSiteFeed)
      const probed = await probeFeedPaths(row.url);
      if (probed && probed.feedUrl !== row.url) {
        const score = await scoreFeedFreshness(probed.feedUrl);
        if (score > 10) {
          getDb().prepare(`UPDATE sources SET url=?, source_type=?, last_error=NULL WHERE id=?`).run(probed.feedUrl, probed.type, row.id);
          updated++;
          continue;
        }
      }
      const detected = await discoverSourceCandidates(row.url, { mode: 'fast', skipBrowser: true });
      const best = detected.best;
      if (detected.ok && best && best.feedUrl !== row.url && best.score >= 35) {
        getDb()
          .prepare(`UPDATE sources SET url=?, source_type=?, discovery_confidence=?, last_error=NULL WHERE id=?`)
          .run(best.feedUrl, best.type, best.score, row.id);
        updated++;
      }
    } catch { /* skip */ }
  }
  return { checked, updated };
}

function stripHtmlForPreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preview a feed URL before adding as source (no DB row required). */
export async function previewFeedUrl(feedUrl: string): Promise<{
  ok: boolean;
  preview?: { title: string; summary: string; contentLength: number; image: string; method: string; purityScore: number; warnings: string[] };
  feedTitle?: string;
  itemCount?: number;
  error?: string;
}> {
  const url = feedUrl.trim();
  if (!url) return { ok: false, error: 'رابط غير صالح' };
  try {
    const res = await fetchUrlGuarded(url, { maxBytes: 3 * 1024 * 1024 });
    if (!res.ok) {
      const errBody = res.body?.startsWith('Error:') ? res.body : `تعذّر جلب الخلاصة (${res.status || '—'})`;
      return { ok: false, error: errBody.slice(0, 240) };
    }
    const type = detectType(res.body, url);
    const items = parseFeed(res.body, url, type, '');
    const first = items.find((i) => i.link) ?? items[0];
    const plainSummary = stripHtmlForPreview(first?.summary ?? '').slice(0, 400);
    const feedPreview = {
      title: first?.title ?? '—',
      summary: plainSummary || (first?.title ?? '').slice(0, 200),
      contentLength: plainSummary.length,
      image: (first as { image_url?: string })?.image_url ?? '',
      method: 'feed',
      purityScore: plainSummary.length > 80 ? 72 : 45,
      warnings: [] as string[],
    };

    if (!first?.link) {
      feedPreview.warnings.push('لا يوجد رابط مقال — معاينة من الخلاصة فقط');
      return {
        ok: true,
        feedTitle: first?.title,
        itemCount: items.length,
        preview: feedPreview,
      };
    }

    try {
      const fetched = await fetchArticlePage({
        url: first.link,
        fetchMode: 'smart',
        context: 'source',
        skipQualityReject: true,
      });
      if (fetched.ok && fetched.extracted) {
        const ex = fetched.extracted;
        return {
          ok: true,
          feedTitle: first.title,
          itemCount: items.length,
          preview: {
            title: ex.title,
            summary: ex.summary.slice(0, 400),
            contentLength: ex.content.length,
            image: ex.image || (first as { image_url?: string })?.image_url || '',
            method: fetched.method,
            purityScore: fetched.purityScore,
            warnings: fetched.warnings,
          },
        };
      }
      feedPreview.warnings.push(
        fetched.error ? `تعذّر جلب المقال — ${fetched.error.slice(0, 120)}` : 'تعذّر جلب المقال — عُرضت معاينة الخلاصة'
      );
    } catch (e) {
      feedPreview.warnings.push(`تعذّر جلب المقال — ${String(e).slice(0, 120)}`);
    }

    return {
      ok: true,
      feedTitle: first.title,
      itemCount: items.length,
      preview: feedPreview,
    };
  } catch (e) {
    return { ok: false, error: String(e).replace(/^Error:\s*/i, '').slice(0, 240) };
  }
}

// ── URL type detection / source discovery ─────────────────────────────────────


export async function detectSourceUrl(rawUrl: string): Promise<DiscoverSourcePayload> {
  return detectSourceUrlAdvanced(rawUrl);
}

export { discoverSourceCandidates, type FeedCandidate } from './source-discovery';

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchSource(
  sourceId: number,
  userId?: number
): Promise<{ ok: boolean; saved: number; error?: string; notModified?: boolean }> {
  const source = getSource(sourceId);
  if (!source?.url) return { ok: false, saved: 0, error: 'Source URL missing' };

  try {
    const fetchUrl = source.url;

    // For confirmed WordPress sites, hit the REST API directly
    if (source.source_type === 'wordpress' && !source.url.includes('/wp-json/')) {
      const wpUrl = buildWordPressApiUrl(source.url);
      const wpRes = await fetchFeedGuarded(wpUrl, sourceId, source);
      if (wpRes.notModified) {
        getDb().prepare(`UPDATE sources SET last_fetched_at=datetime('now'), last_error=NULL WHERE id=?`).run(sourceId);
        logFetchAudit({ sourceId, url: wpUrl, method: 'http', statusCode: 304, durationMs: 0, bytesRead: 0, ok: true, warnings: ['not_modified'] });
        updateTrustAfterFetch(sourceId, { ok: true, saved: 0, notModified: true });
        refreshAdaptiveInterval(sourceId, { ok: true, saved: 0 });
        return { ok: true, saved: 0, notModified: true };
      }
      if (wpRes.ok) {
        const result = await processFeed(wpRes.body, wpUrl, 'wordpress', source, sourceId, userId);
        updateTrustAfterFetch(sourceId, result);
        refreshAdaptiveInterval(sourceId, result);
        return result;
      }
    }

    // JSON API endpoint stored directly
    if (source.source_type === 'json_api') {
      const apiRes = await fetchFeedGuarded(fetchUrl, sourceId, source);
      if (apiRes.notModified) {
        getDb().prepare(`UPDATE sources SET last_fetched_at=datetime('now'), last_error=NULL WHERE id=?`).run(sourceId);
        logFetchAudit({ sourceId, url: fetchUrl, method: 'http', statusCode: 304, durationMs: 0, bytesRead: 0, ok: true, warnings: ['not_modified'] });
        updateTrustAfterFetch(sourceId, { ok: true, saved: 0, notModified: true });
        refreshAdaptiveInterval(sourceId, { ok: true, saved: 0 });
        return { ok: true, saved: 0, notModified: true };
      }
      if (apiRes.ok) {
        const result = await processFeed(apiRes.body, fetchUrl, 'json_api', source, sourceId, userId);
        updateTrustAfterFetch(sourceId, result);
        refreshAdaptiveInterval(sourceId, result);
        return result;
      }
    }

    const res = await fetchFeedGuarded(fetchUrl, sourceId, source);
    if (res.notModified) {
      getDb().prepare(`UPDATE sources SET last_fetched_at=datetime('now'), last_error=NULL WHERE id=?`).run(sourceId);
      logFetchAudit({ sourceId, url: fetchUrl, method: 'http', statusCode: 304, durationMs: 0, bytesRead: 0, ok: true, warnings: ['not_modified'] });
      updateTrustAfterFetch(sourceId, { ok: true, saved: 0, notModified: true });
      refreshAdaptiveInterval(sourceId, { ok: true, saved: 0 });
      return { ok: true, saved: 0, notModified: true };
    }
    if (!res.ok) {
      // Fallback: try WordPress REST API for unknown-type sources on failure
      if (!source.source_type && !fetchUrl.includes('/wp-json/') && !fetchUrl.includes('t.me')) {
        const wpUrl = buildWordPressApiUrl(fetchUrl);
        const wpRes = await fetchFeedGuarded(wpUrl, sourceId, source);
        if (wpRes.ok) {
          const result = await processFeed(wpRes.body, wpUrl, 'wordpress', source, sourceId, userId);
          updateTrustAfterFetch(sourceId, result);
          refreshAdaptiveInterval(sourceId, result);
          return result;
        }
      }
      throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }

    const detectedType = detectType(res.body, fetchUrl);

    if (detectedType === 'html') {
      const discovered = await discoverSourceCandidates(fetchUrl, { mode: 'fast', skipBrowser: true });
      const best = discovered.best;
      if (best && best.feedUrl !== fetchUrl && best.method !== 'html_fallback' && best.score >= 40) {
        getDb()
          .prepare(`UPDATE sources SET url=?, source_type=?, discovery_confidence=? WHERE id=?`)
          .run(best.feedUrl, best.type, best.score, sourceId);
        const discRes = await fetchFeedGuarded(best.feedUrl, sourceId, { ...source, url: best.feedUrl });
        if (discRes.ok) {
          const discType = detectType(discRes.body, best.feedUrl) as FeedType;
          const result = await processFeed(discRes.body, best.feedUrl, discType, { ...source, url: best.feedUrl, source_type: best.type }, sourceId, userId);
          updateTrustAfterFetch(sourceId, result);
          refreshAdaptiveInterval(sourceId, result);
          return result;
        }
      }
    }

    const result = await processFeed(res.body, fetchUrl, detectedType, source, sourceId, userId);
    updateTrustAfterFetch(sourceId, result);
    refreshAdaptiveInterval(sourceId, result);
    return result;

  } catch (e) {
    const msg = (e as Error).message;
    getDb().prepare(`UPDATE sources SET last_error=? WHERE id=?`).run(msg.slice(0, 500), sourceId);
    updateTrustAfterFetch(sourceId, { ok: false, saved: 0, error: msg });
    return { ok: false, saved: 0, error: msg };
  }
}

async function extractFullContentWithAi(
  html: string
): Promise<{ title: string; description: string; content: string } | null> {
  try {
    const cleanedHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '')
      .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 15000);

    const prompt = `أنت محرك ذكاء اصطناعي مخصص لاستخراج محتوى المقالات الإخبارية من صفحات الويب (HTML).
قم بتحليل الـ HTML واستخرج البيانات بدقة:
1. عنوان المقال (title)
2. ملخص أو وصف المقال (description)
3. المحتوى النصي الكامل للمقال (content) مع تنظيفه من أي إعلانات، روابط تنقل، أو نصوص برمجية.

أعد النتيجة بتنسيق JSON فقط ومطابق تمامًا للهيكل التالي دون أي تعليقات أو نصوص إضافية أو علامات ماركداون:
{
  "title": "عنوان المقال هنا",
  "description": "ملخص أو وصف المقال هنا",
  "content": "المحتوى النصي الكامل للمقال هنا"
}`;

    const { runAiRaw, resolveEffectiveAiProvider, resolveModelForProvider } = await import('./ai');
    const provider = resolveEffectiveAiProvider();
    const model = resolveModelForProvider(provider);
    const response = await runAiRaw(prompt, cleanedHtml, provider, model);

    const cleanedJson = response.replace(/```json|```/g, '').trim();
    const result = JSON.parse(cleanedJson) as { title?: string; description?: string; content?: string };
    if (result.title && result.content) {
      return {
        title: result.title.trim(),
        description: result.description?.trim() || '',
        content: result.content.trim()
      };
    }
  } catch (e) {
    console.error('AI content extraction failed:', e);
  }
  return null;
}

const SITEMAP_MAX_DEPTH = 3; // Prevent infinite recursion

async function processFeed(
  body: string,
  url: string,
  type: FeedType,
  source: SourceRow,
  sourceId: number,
  userId?: number,
  depth = 0
): Promise<{ ok: boolean; saved: number; error?: string }> {
  // Safety: prevent infinite recursion in nested sitemaps
  if (depth > SITEMAP_MAX_DEPTH) {
    return { ok: false, saved: 0, error: `Sitemap recursion limit (${SITEMAP_MAX_DEPTH}) reached` };
  }

  // For sitemap index, recursively fetch child sitemaps
  if (type === 'sitemap' && /<sitemapindex[\s>]/i.test(body)) {
    const childUrls = [...body.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map(m => m[1].trim()).slice(0, 5);
    let total = 0;
    for (const childUrl of childUrls) {
      try {
        const r = await fetchUrlGuarded(childUrl);
        if (r.ok) {
          const r2 = await processFeed(r.body, childUrl, 'sitemap', source, sourceId, userId, depth + 1);
          total += r2.saved;
        }
      } catch { /* skip failed child */ }
    }
    getDb().prepare(`UPDATE sources SET source_type='sitemap', last_fetched_at=datetime('now'), last_error=NULL WHERE id=?`).run(sourceId);
    return { ok: true, saved: total };
  }

  const allItems = parseFeed(body, url, type, source.name);

  const feedMeta = parseFeedMetadata(body, type);
  if (feedMeta.ttlMinutes) {
    applyPublisherTtl(sourceId, feedMeta.ttlMinutes);
  }

  // Build whitelist from source setting (e.g. ".html,.htm,.php")
  const allowedExts: Set<string> | null = source.link_extensions
    ? new Set(source.link_extensions.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))
    : null;

  const lastPubMs = source.last_pub_date ? new Date(source.last_pub_date).getTime() : 0;

  // Filter valid items
  const validItems = allItems.filter(item => {
    if (!item.title?.trim()) return false;
    if (lastPubMs && item.published_at) {
      const t = new Date(item.published_at).getTime();
      if (!isNaN(t) && t <= lastPubMs) return false;
    }
    if (type === 'telegram') return true;
    if (!item.link?.trim()) return false;
    try {
      const itemUrl = new URL(item.link);
      const seg = itemUrl.pathname.split('/').pop() ?? '';
      const dot = seg.lastIndexOf('.');
      const ext = dot > 0 ? seg.slice(dot).toLowerCase() : '';
      // Always block binary / media / document extensions
      if (ext && BINARY_EXT.has(ext)) return false;
      // If source has an explicit whitelist, enforce it (only apply when ext is present)
      if (allowedExts && allowedExts.size > 0 && ext) {
        return allowedExts.has(ext);
      }
      return true;
    } catch { return false; }
  });

  // Auto-detect article-relevant link extensions (exclude binary/media)
  const detectedExts = new Set<string>();
  for (const item of validItems) {
    if (!item.link) continue;
    try {
      const seg = new URL(item.link).pathname.toLowerCase().split('/').pop() ?? '';
      const dot = seg.lastIndexOf('.');
      if (dot > 0) {
        const ext = seg.slice(dot);
        if (ext.length >= 2 && ext.length <= 8 && !BINARY_EXT.has(ext)) {
          detectedExts.add(ext);
        }
      }
    } catch { /* ignore */ }
  }

  // Persist detected metadata
  getDb()
    .prepare(`UPDATE sources SET source_type=?, link_extensions=? WHERE id=?`)
    .run(
      type,
      detectedExts.size > 0 ? [...detectedExts].join(',') : source.link_extensions,
      sourceId
    );

  // Save articles — fetch full content per article link
  let saved = 0;
  const tenant = tenantSqlClause();
  const existsByLink = getDb().prepare(`SELECT 1 FROM articles WHERE link = ?${tenant.sql} LIMIT 1`);
  const existsByTitle = getDb().prepare(`SELECT 1 FROM articles WHERE title = ? AND source = ?${tenant.sql} LIMIT 1`);

  let newestPub = source.last_pub_date ?? '';
  const fetchMode = effectiveFetchMode(
    source.url ? (() => { try { return new URL(source.url!).hostname; } catch { return ''; } })() : '',
    source.fetch_mode
  ) as FetchMode;

  for (const item of validItems.slice(0, 100)) {
    const normLink = item.link ? normalizeUrlForDedup(item.link) : '';
    if (normLink && existsByLink.get(normLink, ...tenant.params)) continue;
    if (!item.link && existsByTitle.get(item.title.trim(), item.source, ...tenant.params)) continue;

    let fullContent = item.content?.trim() ?? '';
    let ogImage = item.image_url || '';
    let ogDesc = item.summary?.trim() || '';
    let fetchMethod: string | null = null;
    let purityScore: number | null = null;
    let fetchWarnings: string[] = [];
    let originalUrl = item.link ?? '';
    let finalUrl = normLink || item.link || '';
    let redirectChain: string[] = [];

    const fullContentEnabled = getSetting('fetch_full_content') !== '0';

    // Threshold above which we consider the RSS itself provides full content
    // (e.g. WordPress full-text RSS).  Anything below → always follow the link.
    const FULL_CONTENT_THRESHOLD = 8000;

    // Fetch the full article page whenever:
    //  • a link exists
    //  • mode is not explicitly feed_only
    //  • source type is not telegram (self-contained posts)
    //  • global full-content fetch is not disabled
    //  • the RSS body hasn't already delivered full-text (> 8 000 chars)
    const shouldFetchFull =
      !!item.link &&
      fullContentEnabled &&
      fetchMode !== 'feed_only' &&
      type !== 'telegram' &&
      (fetchMode !== 'smart' || fullContent.length < FULL_CONTENT_THRESHOLD);

    const articleHost = item.link ? (() => { try { return new URL(item.link!).hostname; } catch { return ''; } })() : '';
    const skipArticleFetch = articleHost && isFeedOnlyMode(articleHost);

    if (shouldFetchFull && !skipArticleFetch) {
      await randomDelay();
      try {
        const fetched = await fetchArticlePage({
          url: item.link!,
          sourceId,
          fetchMode: fetchMode === 'browser' ? 'browser' : fetchMode,
          selector: source.css_selector ?? undefined,
          cleanRulesJson: source.clean_rules_json,
          context: 'source',
          skipQualityReject: true
        });
        if (fetched.ok && fetched.extracted) {
          const ex = fetched.extracted;
          const minChars = Number(getSetting('fetch_quality_min_chars') || '120') || 120;
          if (source.use_ai_extractor && fetched.html && ex.content.length < minChars) {
            const aiExtracted = await extractFullContentWithAi(fetched.html);
            if (aiExtracted && aiExtracted.content.length > ex.content.length) {
              fullContent = aiExtracted.content;
              item.title = aiExtracted.title;
              ogDesc = aiExtracted.description;
            } else {
              fullContent = ex.content.length > fullContent.length ? ex.content : fullContent;
              item.title = ex.title || item.title;
              ogDesc = ex.summary || ogDesc;
            }
          } else {
            if (ex.content.length > fullContent.length) fullContent = ex.content;
            item.title = ex.title || item.title;
            ogDesc = ex.summary || ogDesc;
          }
          ogImage = ex.image || ogImage;
          fetchMethod = fetched.method;
          purityScore = fetched.purityScore;
          fetchWarnings = fetched.warnings;
          originalUrl = fetched.originalUrl;
          finalUrl = ex.canonicalUrl || fetched.finalUrl;
          redirectChain = fetched.redirectChain;
        }
      } catch { /* keep feed content */ }
    }

    // Keyword filtering check
    if (source.include_keywords || source.exclude_keywords) {
      const textToSearch = `${item.title} ${fullContent} ${item.summary || ogDesc || ''}`.toLowerCase();

      if (source.exclude_keywords) {
        const blacklist = source.exclude_keywords.split(',')
          .map(k => k.trim().toLowerCase())
          .filter(Boolean);
        const hasBlacklisted = blacklist.some(k => textToSearch.includes(k));
        if (hasBlacklisted) {
          continue; // Skip saving this article
        }
      }

      if (source.include_keywords) {
        const whitelist = source.include_keywords.split(',')
          .map(k => k.trim().toLowerCase())
          .filter(Boolean);
        if (whitelist.length > 0) {
          const hasWhitelisted = whitelist.some(k => textToSearch.includes(k));
          if (!hasWhitelisted) {
            continue; // Skip saving this article
          }
        }
      }
    }

    const summaryForDedup = item.summary?.trim() || ogDesc || fullContent.slice(0, 500);
    const nearDup = isDuplicate(item.title.trim(), summaryForDedup);
    if (nearDup.duplicate) continue;

    // Levenshtein title similarity deduplication (> 85% similarity same source last 24h)
    if (isTitleSimilarSameSource(item.title.trim(), item.source)) {
      continue;
    }

    const qualityTier = assessFetchedArticleTier({
      title: item.title.trim(),
      summary: summaryForDedup,
      content: fullContent
    });
    if (qualityTier.tier === 'reject') continue;

    const articleLink = finalUrl || normLink || item.link || null;
    const fp = articleLink ? linkFingerprint(articleLink) : null;
    if (articleLink) {
      try { scanLink(articleLink); } catch { /* non-fatal */ }
    }

    createArticle({
      title: item.title.trim(),
      summary: item.summary?.trim() || ogDesc || fullContent.slice(0, 500) || null,
      content: fullContent || null,
      link: articleLink,
      image_url: ogImage || null,
      source: item.source,
      category: item.category || source.category || null,
      published_at: item.published_at || null,
      status: qualityTier.tier === 'review' ? 'pending' : 'pending',
      original_url: originalUrl || null,
      final_url: finalUrl || null,
      redirect_chain_json: redirectChain.length ? JSON.stringify(redirectChain) : null,
      fetch_method: fetchMethod,
      purity_score: purityScore ?? qualityTier.purityScore,
      fetch_warnings_json: [...fetchWarnings, ...qualityTier.warnings].length
        ? JSON.stringify([...fetchWarnings, ...qualityTier.warnings])
        : null,
      quality_tier: qualityTier.tier,
      link_fingerprint: fp
    });
    saved++;
    if (item.published_at && (!newestPub || item.published_at > newestPub)) {
      newestPub = item.published_at;
    }
  }

  getDb()
    .prepare(`UPDATE sources SET last_fetched_at=datetime('now'), last_error=NULL, last_pub_date=COALESCE(?, last_pub_date) WHERE id=?`)
    .run(newestPub || null, sourceId);
  auditEmitter.emitLog({ userId: userId ?? null, action: 'source.fetch', targetType: 'source', targetId: sourceId, details: { saved, type } });
  return { ok: true, saved };
}

export async function fetchAllEnabled(userId?: number): Promise<{ total: number; failed: number }> {
  const tenant = tenantSqlClause();
  const ids = getDb()
    .prepare(`SELECT id FROM sources WHERE enabled=1${tenant.sql}`)
    .all(...tenant.params) as { id: number }[];

  const results = await runSpreadBatch(
    ids.map(({ id }) => () => fetchSource(id, userId)),
    { concurrency: 5, spreadMs: 1000 }
  );

  let total = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) total += r.saved;
    else failed++;
  }
  return { total, failed };
}
