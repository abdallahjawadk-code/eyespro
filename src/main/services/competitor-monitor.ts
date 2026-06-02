/**
 * Feature: Competitor Monitor (رصد المنافسين)
 *
 * Supports two source types:
 *   - 'rss'      — fetches and parses an RSS/Atom feed (original behaviour)
 *   - 'facebook' — uses a hidden Electron BrowserWindow to scrape a Facebook page
 */

import { getDb } from '../db/database';
import { getText } from '../net/http';
import { createArticle } from './articles';
import { runAiChain } from './ai';
import { scrapeFacebookPage } from './facebook-scraper';
import { scrapeYoutubeChannel, youtubeVideoToPost } from './scrapers/youtube-scraper';
import { scrapeGoogleNews } from './scrapers/google-news-scraper';
import { scrapeTwitterProfile } from './scrapers/twitter-scraper';
import { checkWebsiteChangeWithDiff } from './website-change-detector';
import { withRetry } from '../net/stealth-utils';
import { createLogger } from '../logger';

const log = createLogger('competitor-monitor');

// ─── Types ────────────────────────────────────────────────────────────────────

export type MonitorSourceType = 'rss' | 'facebook' | 'youtube' | 'google_news' | 'twitter' | 'instagram' | 'tiktok' | 'website';

export interface CompetitorMonitor {
  id: number;
  name: string;
  source_type: MonitorSourceType;
  feed_url: string;           // RSS URL (empty string for browser-based scrapers)
  fb_page_url: string | null; // Facebook page URL
  website_url: string | null;
  extra_config: string | null; // JSON: { handle, query, channelId, selector, forceBrowser }
  last_checked_at: string | null;
  last_item_guid: string | null;
  last_content_hash: string | null; // for website change detection
  active: number;
  created_at: string;
}

export interface ExtraConfig {
  handle?: string;       // Twitter @handle or Instagram username
  query?: string;        // Google News search query
  channelId?: string;    // YouTube channel ID or handle
  selector?: string;     // CSS selector for website monitor
  forceBrowser?: boolean; // Force BrowserWindow for website monitor
  language?: string;     // Google News language (default: 'ar')
  country?: string;      // Google News country (default: 'SA')
}

export interface CompetitorSnapshot {
  id: number;
  monitor_id: number;
  title: string;
  link: string | null;
  summary: string | null;
  published_at: string | null;
  seen_at: string;
  is_read: number;
  rewritten_article_id: number | null;
}

// ─── RSS parsing ──────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const cdataM = cdataRe.exec(xml);
  if (cdataM) return cdataM[1].trim();
  const plainM = plainRe.exec(xml);
  if (plainM) return plainM[1].trim();
  return '';
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractTag(block, 'feedburner:origLink');
    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');
    const guid = extractTag(block, 'guid') || link || title;
    if (title) items.push({ title, link, description, pubDate, guid });
  }
  return items;
}

// ─── Monitor management ───────────────────────────────────────────────────────

export function addMonitor(
  name: string,
  feedUrl: string,
  websiteUrl?: string,
  sourceType: MonitorSourceType = 'rss',
  fbPageUrl?: string,
  extraConfig?: ExtraConfig,
): { id: number } {
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO competitor_monitors
       (name, source_type, feed_url, fb_page_url, website_url, extra_config, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`
  ).run(
    name,
    sourceType,
    feedUrl,
    fbPageUrl ?? null,
    websiteUrl ?? null,
    extraConfig ? JSON.stringify(extraConfig) : null,
  );
  return { id: r.lastInsertRowid as number };
}

function parseExtraConfig(monitor: CompetitorMonitor): ExtraConfig {
  try { return monitor.extra_config ? (JSON.parse(monitor.extra_config) as ExtraConfig) : {}; }
  catch { return {}; }
}

export function deleteMonitor(id: number): void {
  getDb().prepare(`DELETE FROM competitor_monitors WHERE id = ?`).run(id);
}

export function listMonitors(): CompetitorMonitor[] {
  return getDb()
    .prepare(`SELECT * FROM competitor_monitors ORDER BY created_at DESC`)
    .all() as CompetitorMonitor[];
}

// ─── RSS check ────────────────────────────────────────────────────────────────

async function checkRssMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();

  let xml: string;
  try {
    const res = await withRetry(
      () => getText(monitor.feed_url, {}, { useProxy: true }),
      { maxAttempts: 3, baseDelayMs: 2000,
        onRetry: (n, e) => log.warn(`RSS retry ${n} for monitor ${monitor.id}: ${e.message}`) }
    );
    if (!res.ok) throw new Error(res.body.slice(0, 100));
    xml = res.body;
  } catch (e) {
    log.warn(`RSS fetch failed for monitor ${monitor.id}: ${(e as Error).message}`);
    throw e;
  }

  const items = parseRss(xml);
  if (!items.length) return { found: 0 };

  const lastGuid = monitor.last_item_guid;
  let found = 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_snapshots
       (monitor_id, title, link, summary, published_at, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  );

  const tx = db.transaction(() => {
    for (const item of items) {
      if (lastGuid && item.guid === lastGuid) break;
      const summary = item.description.replace(/<[^>]+>/g, '').slice(0, 1000).trim();
      insert.run(monitor.id, item.title, item.link || null, summary || null, item.pubDate || null);
      found++;
    }
  });
  tx();

  db.prepare(
    `UPDATE competitor_monitors SET last_checked_at = datetime('now'), last_item_guid = ? WHERE id = ?`
  ).run(items[0]?.guid ?? lastGuid, monitor.id);

  return { found };
}

// ─── Facebook check ───────────────────────────────────────────────────────────

async function checkFacebookMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();

  if (!monitor.fb_page_url) throw new Error('رابط صفحة فيسبوك غير محدد');

  const posts = await scrapeFacebookPage(monitor.fb_page_url);
  if (!posts.length) return { found: 0 };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_snapshots
       (monitor_id, title, link, summary, published_at, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  );

  let found = 0;
  const tx = db.transaction(() => {
    for (const post of posts) {
      // Use first 120 chars of text as title
      const title = post.text.split('\n')[0].slice(0, 120) || 'منشور فيسبوك';
      const summary = post.text.slice(0, 1000);
      const guid = post.postId ?? post.text.slice(0, 80);

      // Skip already-seen posts by checking link/guid
      const existing = db.prepare(
        `SELECT id FROM competitor_snapshots WHERE monitor_id = ? AND (link = ? OR summary = ?)`
      ).get(monitor.id, post.link ?? '', summary.slice(0, 100));
      if (existing) continue;

      insert.run(monitor.id, title, post.link ?? null, summary, post.timestamp ?? null);
      found++;
      void guid; // suppress unused warning
    }
  });
  tx();

  db.prepare(
    `UPDATE competitor_monitors SET last_checked_at = datetime('now') WHERE id = ?`
  ).run(monitor.id);

  return { found };
}

// ─── YouTube check ────────────────────────────────────────────────────────────

async function checkYoutubeMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();
  const cfg = parseExtraConfig(monitor);
  const channelInput = cfg.channelId || monitor.feed_url;
  if (!channelInput) throw new Error('YouTube: channel ID or URL is required');

  const videos = await scrapeYoutubeChannel(channelInput, 30);
  if (!videos.length) return { found: 0 };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_snapshots
       (monitor_id, title, link, summary, published_at, thumbnail_url, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 0)`
  );

  let found = 0;
  const tx = db.transaction(() => {
    for (const v of videos) {
      const post = youtubeVideoToPost(v);
      const existing = db.prepare(
        `SELECT id FROM competitor_snapshots WHERE monitor_id = ? AND link = ?`
      ).get(monitor.id, post.link);
      if (existing) continue;
      insert.run(monitor.id, post.title, post.link, post.summary, post.publishedAt || null, v.thumbnail || null);
      found++;
    }
  });
  tx();

  db.prepare(`UPDATE competitor_monitors SET last_checked_at = datetime('now') WHERE id = ?`).run(monitor.id);
  return { found };
}

// ─── Google News check ────────────────────────────────────────────────────────

async function checkGoogleNewsMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();
  const cfg = parseExtraConfig(monitor);
  const query = cfg.query || monitor.feed_url;
  if (!query) throw new Error('Google News: search query is required');

  const articles = await scrapeGoogleNews({
    query,
    language: cfg.language ?? 'ar',
    country: cfg.country ?? 'SA',
    maxResults: 30,
  });
  if (!articles.length) return { found: 0 };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_snapshots
       (monitor_id, title, link, summary, published_at, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  );

  let found = 0;
  const tx = db.transaction(() => {
    for (const a of articles) {
      const existing = db.prepare(
        `SELECT id FROM competitor_snapshots WHERE monitor_id = ? AND link = ?`
      ).get(monitor.id, a.link);
      if (existing) continue;
      const summary = a.summary || `${a.source}: ${a.title}`;
      insert.run(monitor.id, a.title, a.link || null, summary, a.publishedAt || null);
      found++;
    }
  });
  tx();

  db.prepare(`UPDATE competitor_monitors SET last_checked_at = datetime('now') WHERE id = ?`).run(monitor.id);
  return { found };
}

// ─── Twitter check ────────────────────────────────────────────────────────────

async function checkTwitterMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();
  const cfg = parseExtraConfig(monitor);
  const handle = cfg.handle || monitor.feed_url;
  if (!handle) throw new Error('Twitter: handle is required');

  const tweets = await scrapeTwitterProfile(handle);
  if (!tweets.length) return { found: 0 };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_snapshots
       (monitor_id, title, link, summary, published_at, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  );

  let found = 0;
  const tx = db.transaction(() => {
    for (const t of tweets) {
      const title = t.text.split('\n')[0].slice(0, 120) || 'تغريدة';
      const key = t.tweetId || t.text.slice(0, 80);
      const existing = db.prepare(
        `SELECT id FROM competitor_snapshots WHERE monitor_id = ? AND (link = ? OR summary = ?)`
      ).get(monitor.id, t.link ?? '', key);
      if (existing) continue;
      insert.run(monitor.id, title, t.link ?? null, t.text.slice(0, 1000), t.publishedAt ?? null);
      found++;
    }
  });
  tx();

  db.prepare(`UPDATE competitor_monitors SET last_checked_at = datetime('now') WHERE id = ?`).run(monitor.id);
  return { found };
}

// Instagram & TikTok competitor monitoring was removed — their scrapers were
// unreliable. Existing rows of those types are skipped gracefully in checkMonitor.

// ─── Website change check ─────────────────────────────────────────────────────

async function checkWebsiteMonitor(monitor: CompetitorMonitor): Promise<{ found: number }> {
  const db = getDb();
  const cfg = parseExtraConfig(monitor);
  const url = monitor.website_url || monitor.feed_url;
  if (!url) throw new Error('Website monitor: URL is required');

  const result = await checkWebsiteChangeWithDiff(monitor.id, {
    url,
    selector: cfg.selector,
    forceBrowser: cfg.forceBrowser,
  });

  if (!result.changed) return { found: 0 };

  db.prepare(
    `INSERT INTO competitor_snapshots
       (monitor_id, title, link, summary, diff_text, seen_at, is_read)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  ).run(
    monitor.id,
    `تغيير مكتشف في: ${url}`,
    url,
    result.snippet,
    result.diff || null,
  );

  db.prepare(`UPDATE competitor_monitors SET last_checked_at = datetime('now') WHERE id = ?`).run(monitor.id);
  return { found: 1 };
}

// ─── Unified check ────────────────────────────────────────────────────────────

export async function checkMonitor(id: number): Promise<{ found: number }> {
  const db = getDb();
  const monitor = db
    .prepare(`SELECT * FROM competitor_monitors WHERE id = ?`)
    .get(id) as CompetitorMonitor | undefined;
  if (!monitor) throw new Error(`Monitor ${id} not found`);

  switch (monitor.source_type) {
    case 'facebook':    return checkFacebookMonitor(monitor);
    case 'youtube':     return checkYoutubeMonitor(monitor);
    case 'google_news': return checkGoogleNewsMonitor(monitor);
    case 'twitter':     return checkTwitterMonitor(monitor);
    case 'instagram':
    case 'tiktok':
      // Removed — scrapers were unreliable. Skip existing rows without erroring the run.
      return { found: 0 };
    case 'website':     return checkWebsiteMonitor(monitor);
    default:            return checkRssMonitor(monitor);
  }
}

export async function checkAllMonitors(): Promise<{ checked: number; found: number }> {
  const monitors = listMonitors().filter((m) => m.active);
  let checked = 0;
  let found = 0;
  for (const m of monitors) {
    try {
      const r = await checkMonitor(m.id);
      found += r.found;
      checked++;
    } catch (e) {
      log.warn(`Monitor ${m.id} check failed: ${(e as Error).message}`);
    }
  }
  return { checked, found };
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export function listSnapshots(monitorId?: number, limit = 100): CompetitorSnapshot[] {
  const db = getDb();
  if (monitorId != null) {
    return db
      .prepare(`SELECT * FROM competitor_snapshots WHERE monitor_id = ? ORDER BY seen_at DESC LIMIT ?`)
      .all(monitorId, limit) as CompetitorSnapshot[];
  }
  return db
    .prepare(`SELECT * FROM competitor_snapshots ORDER BY seen_at DESC LIMIT ?`)
    .all(limit) as CompetitorSnapshot[];
}

export function markRead(snapshotId: number): void {
  getDb().prepare(`UPDATE competitor_snapshots SET is_read = 1 WHERE id = ?`).run(snapshotId);
}

export function getUnreadCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as cnt FROM competitor_snapshots WHERE is_read = 0`)
    .get() as { cnt: number };
  return row.cnt;
}

// ─── AI rewrite ───────────────────────────────────────────────────────────────

export async function rewriteSnapshot(snapshotId: number): Promise<{ articleId: number }> {
  const db = getDb();
  const snapshot = db
    .prepare(`SELECT * FROM competitor_snapshots WHERE id = ?`)
    .get(snapshotId) as CompetitorSnapshot | undefined;
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

  const articleId = createArticle({
    title: snapshot.title,
    content: snapshot.summary ?? '',
    summary: snapshot.summary ?? '',
    link: snapshot.link ?? undefined,
    status: 'draft',
    ingest_status: 'from_competitor',
  });

  const prompt = `أعد كتابة الخبر التالي بأسلوب صحفي احترافي باللغة العربية، مع الحفاظ على المعلومات الأساسية:\n\nالعنوان: ${snapshot.title}\n\nالمحتوى: ${snapshot.summary ?? ''}`;

  try {
    const rewritten = await runAiChain(prompt, '');
    db.prepare(`UPDATE articles SET content = ?, status = 'draft' WHERE id = ?`).run(rewritten.trim(), articleId);
  } catch (e) {
    log.warn(`AI rewrite failed for snapshot ${snapshotId}: ${(e as Error).message}`);
  }

  db.prepare(
    `UPDATE competitor_snapshots SET rewritten_article_id = ?, is_read = 1 WHERE id = ?`
  ).run(articleId, snapshotId);

  return { articleId };
}
