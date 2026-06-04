/**
 * Feature: Competitor Monitor (رصد المنافسين)
 *
 * Supports two source types:
 *   - 'rss'      — fetches and parses an RSS/Atom feed (original behaviour)
 *   - 'facebook' — uses a hidden Electron BrowserWindow to scrape a Facebook page
 */

import { getDb } from '../db/database';
import { fetchPageHtml } from './fetch-pipeline';
import { createArticle } from './articles';
import { runAiChain } from './ai';
import { hammingDistance, articleSimhash } from './dedup';
import { scrapeFacebookPage } from './facebook-scraper';
import { scrapeYoutubeChannel, youtubeVideoToPost } from './scrapers/youtube-scraper';
import { scrapeGoogleNews } from './scrapers/google-news-scraper';
import { scrapeTwitterProfile } from './scrapers/twitter-scraper';
import { checkWebsiteChangeWithDiff } from './website-change-detector';
import { transcribeUrl } from './transcribe';

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

export function isPotentialDuplicate(title: string): boolean {
  try {
    const db = getDb();
    const words = title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 2);

    if (words.length === 0) return false;

    const query = words.map(w => `"${w.replace(/"/g, '""')}"`).join(' OR ');
    const match = db.prepare(`
      SELECT rowid, bm25(articles_fts) as score 
      FROM articles_fts 
      WHERE articles_fts MATCH ? 
      ORDER BY score 
      LIMIT 1
    `).get(query) as { rowid: number; score: number } | undefined;

    if (match && match.score < -1.5) {
      log.info(`FTS duplicate detected for title "${title}". Match score: ${match.score}`);
      return true;
    }
  } catch (e) {
    log.warn(`FTS duplicate check failed: ${(e as Error).message}`);
  }
  return false;
}

function getFinalTitle(title: string): string {
  if (!title) return title;
  const cleanTitle = title.replace(/^\[مكرر\]\s*/, '').trim();
  return isPotentialDuplicate(cleanTitle) ? `[مكرر] ${cleanTitle}` : cleanTitle;
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
    const res = await fetchPageHtml(monitor.feed_url, { timeout: 20000 });
    if (!res.ok || !res.html) throw new Error(res.error || 'فشل جلب تغذية RSS');
    xml = res.html;
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
      insert.run(monitor.id, getFinalTitle(item.title), item.link || null, summary || null, item.pubDate || null);
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

      insert.run(monitor.id, getFinalTitle(title), post.link ?? null, summary, post.timestamp ?? null);
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
      insert.run(monitor.id, getFinalTitle(post.title), post.link, post.summary, post.publishedAt || null, v.thumbnail || null);
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
      insert.run(monitor.id, getFinalTitle(a.title), a.link || null, summary, a.publishedAt || null);
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
      insert.run(monitor.id, getFinalTitle(title), t.link ?? null, t.text.slice(0, 1000), t.publishedAt ?? null);
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

  // Check monitors concurrently (bounded). The serial loop made "check all" take the
  // sum of every monitor's latency — dominated by slow browser-based scrapers (Facebook
  // ~10s each). Batching cuts the wall-clock time to roughly the slowest item per batch.
  const CONCURRENCY = 5;
  for (let i = 0; i < monitors.length; i += CONCURRENCY) {
    const batch = monitors.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((m) =>
        checkMonitor(m.id).then(
          (r) => ({ ok: true, found: r.found }),
          (e) => { log.warn(`Monitor ${m.id} check failed: ${(e as Error).message}`); return { ok: false, found: 0 }; },
        ),
      ),
    );
    for (const r of results) {
      if (r.ok) checked++;
      found += r.found;
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

export interface SnapshotCluster {
  clusterId: number;
  main: CompetitorSnapshot;
  duplicates: CompetitorSnapshot[];
  diffSummary: string;
}

export async function groupSnapshotsIntoSemanticClusters(limit = 100): Promise<SnapshotCluster[]> {
  const db = getDb();
  // Fetch unread competitor snapshots
  const snapshots = db.prepare(
    `SELECT * FROM competitor_snapshots WHERE is_read = 0 ORDER BY seen_at DESC LIMIT ?`
  ).all(limit) as CompetitorSnapshot[];

  if (snapshots.length === 0) return [];

  // Compute SimHash for each snapshot title + summary
  const hashedSnapshots = snapshots.map(s => ({
    snapshot: s,
    hash: articleSimhash(s.title, s.summary ?? '')
  }));

  const clusters: { main: CompetitorSnapshot; duplicates: CompetitorSnapshot[] }[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < hashedSnapshots.length; i++) {
    const itemA = hashedSnapshots[i]!;
    if (processed.has(itemA.snapshot.id)) continue;
    processed.add(itemA.snapshot.id);

    const currentCluster = {
      main: itemA.snapshot,
      duplicates: [] as CompetitorSnapshot[]
    };

    // Find duplicates matching SimHash Hamming distance <= 6
    for (let j = i + 1; j < hashedSnapshots.length; j++) {
      const itemB = hashedSnapshots[j]!;
      if (processed.has(itemB.snapshot.id)) continue;

      if (itemA.hash && itemB.hash) {
        const dist = hammingDistance(itemA.hash, itemB.hash);
        if (dist <= 6) {
          processed.add(itemB.snapshot.id);
          currentCluster.duplicates.push(itemB.snapshot);
        }
      }
    }

    clusters.push(currentCluster);
  }

  // Build an instant, deterministic comparison summary for each cluster.
  //
  // IMPORTANT: this function runs on every Monitor page load (loadAll), so it must
  // NOT call the AI provider — doing one AI request per cluster here blocked the
  // whole screen (and hammered the provider) whenever competitors had overlapping
  // coverage. The expensive AI synthesis lives in synthesizeArticleFromSnapshots,
  // which the user triggers explicitly via the "دمج" button.
  const finalClusters: SnapshotCluster[] = clusters.map((c, idx) => ({
    clusterId: idx + 1,
    main: c.main,
    duplicates: c.duplicates,
    diffSummary: buildDeterministicDiffSummary(c.main, c.duplicates),
  }));

  return finalClusters;
}

/** Fast, AI-free comparison line shown in the cluster detail panel. */
function buildDeterministicDiffSummary(main: CompetitorSnapshot, duplicates: CompetitorSnapshot[]): string {
  if (duplicates.length === 0) {
    return 'خبر فردي لا توجد تغطية موازية له من منافسين آخرين حتى الآن.';
  }
  const all = [main, ...duplicates];
  const count = all.length;

  // Earliest publisher = fastest to break the story.
  const withTime = all
    .map((s) => ({ s, t: new Date(s.published_at || s.seen_at).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const fastest = withTime[0]?.s ?? main;
  const fastestTitle = fastest.title.length > 60 ? fastest.title.slice(0, 58) + '…' : fastest.title;

  return `رُصدت تغطية متوازية من ${count} مصادر لنفس الحدث. الأسبق نشراً: «${fastestTitle}». اضغط «دمج» لتوليد تقرير موحّد بالذكاء الاصطناعي يقارن الزوايا ويدمج الحقائق.`;
}

export async function synthesizeArticleFromSnapshots(snapshotIds: number[]): Promise<number> {
  const db = getDb();
  if (snapshotIds.length === 0) throw new Error('لم يتم تحديد أي معرّفات لدمج الأخبار');

  // Fetch unread snapshots matching snapshotIds
  const placeholders = snapshotIds.map(() => '?').join(',');
  const snapshots = db.prepare(
    `SELECT * FROM competitor_snapshots WHERE id IN (${placeholders})`
  ).all(...snapshotIds) as CompetitorSnapshot[];

  if (snapshots.length === 0) throw new Error('لم يتم العثور على أي لقطات إخبارية مطابقة للدمج');

  // Compile snapshots into context, with on-demand video transcription (Cross-Media Synthesis)
  const compiledBlocks: string[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    let bodyText = s.summary || '';

    // If snapshot is YouTube/video, attempt transcription
    if (s.link && (s.link.includes('youtube.com') || s.link.includes('youtu.be') || s.link.endsWith('.mp4'))) {
      log.info(`Cross-Media Synthesis: Transcribing video link for snapshot ${s.id}...`);
      try {
        const transResult = await transcribeUrl(s.link);
        if (transResult.ok && transResult.text) {
          log.info(`Cross-Media Synthesis: Successfully transcribed video for snapshot ${s.id}`);
          bodyText = `[تفريغ فيديو مرئي] ${transResult.text}\n\n[الوصف]: ${bodyText}`;
        }
      } catch (err) {
        log.warn(`Cross-Media Synthesis: Transcription failed for snapshot ${s.id}: ${(err as Error).message}`);
      }
    }

    compiledBlocks.push(`المصدر ${i + 1} (${s.link || 'منصة'}):\nالعنوان: ${s.title}\nالمحتوى: ${bodyText}`);
  }

  const consolidatedText = compiledBlocks.join('\n\n');

  const prompt = `أنت رئيس تحرير صحفي محترف. لديك البيانات والتغطيات المتعددة التالية لحدث واحد. قم بدمج الحقائق وصياغة تقرير إخباري عربي واحد متكامل ومحايد ومفصل دون تكرار أو حذف معلومات جوهرية. أعد النتيجة بتنسيق JSON فقط مطابق للهيكل التالي تمامًا دون أي نصوص إضافية أو علامات ماركداون:\n{\n  "title": "عنوان التقرير المقترح للموضوع المدمج",\n  "summary": "ملخص التقرير المدمج في جملتين",\n  "content": "محتوى التقرير الصحفي المدمج بالكامل بشكل مفصل واحترافي ورصين"\n}`;

  const aiResult = await runAiChain(prompt, consolidatedText);
  let parsed: { title: string; summary: string; content: string };
  try {
    const cleaned = aiResult.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Regex fallback
    const titleMatch = aiResult.match(/"title"\s*:\s*"([^"]+)"/);
    const summaryMatch = aiResult.match(/"summary"\s*:\s*"([^"]+)"/);
    const contentMatch = aiResult.match(/"content"\s*:\s*"([^"]+)"/);
    parsed = {
      title: titleMatch?.[1] || snapshots[0].title,
      summary: summaryMatch?.[1] || snapshots[0].summary || '',
      content: contentMatch?.[1] || aiResult
    };
  }

  // Create article in DB
  const articleId = createArticle({
    title: parsed.title,
    summary: parsed.summary,
    content: parsed.content,
    status: 'draft',
    ingest_status: 'synthesized_from_competitors',
    source: 'دمج مصادر متعددة'
  });

  // Mark processed snapshots as read and save link to synthesized article
  const updateStmt = db.prepare(
    `UPDATE competitor_snapshots SET rewritten_article_id = ?, is_read = 1 WHERE id = ?`
  );
  db.transaction(() => {
    for (const s of snapshots) {
      updateStmt.run(articleId, s.id);
    }
  })();

  return articleId;
}

export interface TopicAlert {
  id: string;
  topicTitle: string;
  summary: string;
  severity: 'high' | 'medium';
  snapshots: { id: number; monitorName: string; title: string; publishedAt: string | null }[];
  snapshotIds: number[];
}

export async function getTopicAlerts(): Promise<TopicAlert[]> {
  const db = getDb();
  // Fetch unread competitor snapshots from the last 24 hours
  const snapshots = db.prepare(`
    SELECT s.*, m.name as monitor_name 
    FROM competitor_snapshots s
    JOIN competitor_monitors m ON s.monitor_id = m.id
    WHERE s.is_read = 0 AND s.seen_at >= datetime('now', '-24 hours')
    ORDER BY s.seen_at DESC
  `).all() as (CompetitorSnapshot & { monitor_name: string })[];

  if (snapshots.length < 2) return [];

  // Cluster using SimHash
  const hashedSnapshots = snapshots.map(s => ({
    snapshot: s,
    hash: articleSimhash(s.title, s.summary ?? '')
  }));

  const clusters: { main: CompetitorSnapshot & { monitor_name: string }; duplicates: (CompetitorSnapshot & { monitor_name: string })[] }[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < hashedSnapshots.length; i++) {
    const itemA = hashedSnapshots[i]!;
    if (processed.has(itemA.snapshot.id)) continue;
    processed.add(itemA.snapshot.id);

    const currentCluster = {
      main: itemA.snapshot,
      duplicates: [] as (CompetitorSnapshot & { monitor_name: string })[]
    };

    for (let j = i + 1; j < hashedSnapshots.length; j++) {
      const itemB = hashedSnapshots[j]!;
      if (processed.has(itemB.snapshot.id)) continue;

      if (itemA.hash && itemB.hash) {
        const dist = hammingDistance(itemA.hash, itemB.hash);
        if (dist <= 6) {
          processed.add(itemB.snapshot.id);
          currentCluster.duplicates.push(itemB.snapshot);
        }
      }
    }

    clusters.push(currentCluster);
  }

  const alerts: TopicAlert[] = [];

  for (const c of clusters) {
    const allSnaps = [c.main, ...c.duplicates];
    const uniqueMonitors = new Set(allSnaps.map(s => s.monitor_id));
    
    // Trigger alert if at least 2 different competitors publish the same news
    if (uniqueMonitors.size >= 2) {
      const severity = uniqueMonitors.size >= 3 ? 'high' : 'medium';
      
      const monitorNames = allSnaps.map(s => s.monitor_name);
      const uniqueNames = Array.from(new Set(monitorNames));
      
      let alertMsg = `رصد نشاط متزامن لدى ${uniqueNames.length} منافسين (${uniqueNames.join('، ')}) حول هذا الموضوع.`;
      if (severity === 'high') {
        alertMsg = `🚨 تنبيه عاجل: نشاط متزامن مكثف لدى ${uniqueNames.length} منافسين حول: "${c.main.title}". مقترح دمج التغطية فوراً!`;
      }

      alerts.push({
        id: String(c.main.id),
        topicTitle: c.main.title,
        summary: alertMsg,
        severity,
        snapshots: allSnaps.map(s => ({
          id: s.id,
          monitorName: s.monitor_name,
          title: s.title,
          publishedAt: s.published_at || s.seen_at
        })),
        snapshotIds: allSnaps.map(s => s.id)
      });
    }
  }

  return alerts;
}

