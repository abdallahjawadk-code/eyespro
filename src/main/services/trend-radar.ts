import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';
import { createArticle } from './articles';
import { auditEmitter } from '../events/audit-emitter';

export interface TrendRow {
  id: number;
  title: string;
  region: string;
  source: string;
  traffic: string | null;
  description: string | null;
  status: 'pending' | 'generating' | 'completed' | 'dismissed';
  article_id: number | null;
  created_at: string;
  // v2.0 fields (nullable for backwards compatibility)
  quality_score?: number | null;
  velocity_score?: number | null;
  is_global?: number | null;
  cluster_id?: string | null;
}

/** Quality tier for trend prioritization */
export type TrendQualityTier = 'hot' | 'warm' | 'cold';

/** Trend velocity: how fast a trend is rising */
export interface TrendVelocity {
  trendId: number;
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
  velocityScore: number; // 0-100
}

/** Cluster of similar trends across regions */
export interface TrendCluster {
  id: string;
  canonicalTitle: string;
  trends: TrendRow[];
  regions: string[];
  isGlobal: boolean;
  maxQualityScore: number;
}

import { parseGoogleTrendsRss, parseFeedBySourceType } from './trend-parser';
import { listSources, getSource, markSourceFetched } from './trend-sources';

/**
 * Fetch daily Google Trends feed for a given geographic code (e.g. SA, EG, AE, US, GB).
 *
 * Google changed the RSS endpoint in 2024/2025:
 *   OLD (404): /trends/trendingsearches/daily/rss?geo=SA
 *   NEW:       /trending/rss?geo=SA  (primary)
 *   FALLBACK:  /trends/hottrends/atom/feed?pn=p69  (older regions)
 */
export async function fetchTrendsForGeo(geo: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const region = String(geo || 'SA').toUpperCase().trim().slice(0, 8);

  // Multiple candidate URLs to try in order
  const candidates = [
    `https://trends.google.com/trending/rss?geo=${region}`,
    `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${region}&hl=ar`,
    `https://trends.google.com/trends/hottrends/atom/hourly?geo=${region}&hl=ar&pnrep=1&pn=p1`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Referer': 'https://trends.google.com/',
  };

  let lastError = '';

  for (const url of candidates) {
    try {
      const { getText } = await import('../net/http');
      const res = await getText(url, headers, { maxBytes: 2 * 1024 * 1024, useProxy: true });

      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${url}`;
        continue; // try next candidate
      }

      if (!res.body || res.body.trim().length < 50) {
        lastError = `Empty response from ${url}`;
        continue;
      }

      const trends = parseGoogleTrendsRss(res.body);

      if (trends.length === 0) {
        // Maybe HTML was returned (bot protection), try next
        if (res.body.includes('<!DOCTYPE') || res.body.includes('<html')) {
          lastError = `Bot protection HTML from ${url}`;
          continue;
        }
        // Genuine empty results (no trends currently)
        return { ok: true, count: 0 };
      }

      const db = getDb();
      const insertTrend = db.prepare(`
        INSERT OR IGNORE INTO trends (title, region, source, traffic, description, status, quality_score)
        VALUES (?, ?, 'google_trends', ?, ?, 'pending', ?)
      `);

      let insertedCount = 0;
      for (const trend of trends) {
        // v2.0: Calculate quality score before insertion
        const qualityScore = calculateTrendQuality({
          title: trend.title,
          description: trend.description,
          traffic: trend.traffic,
          source: 'google_trends'
        });
        
        const result = insertTrend.run(
          sanitizeString(trend.title, 200),
          region,
          trend.traffic ? sanitizeString(trend.traffic, 32) : null,
          trend.description ? sanitizeString(trend.description, 1000) : null,
          qualityScore
        );
        
        if (result.changes > 0) insertedCount++;
      }
      
      // v2.0: After inserting all trends, try to detect global trends
      // (same title appearing in multiple regions)
      detectAndMarkGlobalTrends();

      return { ok: true, count: insertedCount };

    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  // All candidates failed — return graceful error
  return {
    ok: false,
    count: 0,
    error: `تعذّر الاتصال بخدمة Google Trends. قد تكون الخدمة محجوبة أو تغيّر الرابط. (${lastError})`
  };
}

/**
 * Retrieve active trends from DB. Excludes dismissed trends.
 */
export function listTrends(geo?: string): TrendRow[] {
  const db = getDb();
  if (geo && geo.trim()) {
    const region = String(geo).toUpperCase().trim();
    return db
      .prepare(`SELECT * FROM trends WHERE region = ? AND status != 'dismissed' ORDER BY id DESC LIMIT 100`)
      .all(region) as TrendRow[];
  }
  return db
    .prepare(`SELECT * FROM trends WHERE status != 'dismissed' ORDER BY id DESC LIMIT 100`)
    .all() as TrendRow[];
}

/**
 * Detect trends appearing in multiple regions and mark them as global.
 * This runs automatically after fetching trends from any region.
 */
export function detectAndMarkGlobalTrends(): void {
  const db = getDb();
  
  // Find titles that appear in 2+ different regions with pending status
  const globalTrends = db.prepare(`
    SELECT title, COUNT(DISTINCT region) as region_count, GROUP_CONCAT(region) as regions
    FROM trends 
    WHERE status = 'pending' 
    GROUP BY LOWER(title)
    HAVING region_count >= 2
  `).all() as { title: string; region_count: number; regions: string }[];
  
  // Mark these trends as global
  for (const row of globalTrends) {
    db.prepare(`
      UPDATE trends 
      SET is_global = 1, updated_at = datetime('now')
      WHERE LOWER(title) = LOWER(?) AND status = 'pending'
    `).run(row.title);
  }
  
  if (globalTrends.length > 0) {
    console.log(`[TrendRadar] Marked ${globalTrends.length} trends as global: ${globalTrends.map(t => t.title.slice(0, 30)).join(', ')}`);
  }
}

/**
 * Update trend status to 'dismissed' (soft-delete).
 */
export function dismissTrend(trendId: number): boolean {
  const db = getDb();
  const r = db.prepare(`UPDATE trends SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?`).run(trendId);
  return r.changes > 0;
}

/**
 * Update trend title / description before (or after) generation.
 */
export function updateTrend(trendId: number, data: { title?: string; description?: string }): boolean {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.title !== undefined)       { fields.push('title = ?');       params.push(sanitizeString(data.title, 200)); }
  if (data.description !== undefined) { fields.push('description = ?'); params.push(sanitizeString(data.description, 2000)); }
  if (!fields.length) return false;
  fields.push("updated_at = datetime('now')");
  params.push(trendId);
  const r = db.prepare(`UPDATE trends SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return r.changes > 0;
}

/**
 * Reset a completed trend back to 'pending' so it can be regenerated.
 */
export function resetTrend(trendId: number): boolean {
  const db = getDb();
  const r = db.prepare(`UPDATE trends SET status = 'pending', article_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(trendId);
  return r.changes > 0;
}

/**
 * Get a single trend by id.
 */
export function getTrend(trendId: number): TrendRow | null {
  return (getDb().prepare(`SELECT * FROM trends WHERE id = ?`).get(trendId) as TrendRow) ?? null;
}

/**
 * Count trends by status.
 */
export function trendStats(): { 
  pending: number; 
  generating: number; 
  completed: number; 
  dismissed: number;
  hot: number;
  global: number;
} {
  const statusRows = getDb()
    .prepare(`SELECT status, COUNT(*) AS c FROM trends GROUP BY status`)
    .all() as { status: string; c: number }[];
  const map: Record<string, number> = {};
  for (const r of statusRows) map[r.status] = r.c;
  
  // v2.0: Count hot trends (high quality + velocity)
  const hotCount = getDb()
    .prepare(`SELECT COUNT(*) as c FROM trends 
              WHERE status = 'pending' 
              AND (quality_score >= 70 OR velocity_score >= 60)`)
    .get() as { c: number };
  
  // v2.0: Count global trends (appearing in multiple regions)
  const globalCount = getDb()
    .prepare(`SELECT COUNT(*) as c FROM trends WHERE is_global = 1 AND status = 'pending'`)
    .get() as { c: number };
  
  return {
    pending:    map['pending']    ?? 0,
    generating: map['generating'] ?? 0,
    completed:  map['completed']  ?? 0,
    dismissed:  map['dismissed']  ?? 0,
    hot: hotCount.c,
    global: globalCount.c,
  };
}

/**
 * Calculate trend quality score (0-100) based on multiple factors
 */
export function calculateTrendQuality(trend: { 
  title: string; 
  description: string | null; 
  traffic: string | null;
  source: string;
}): number {
  let score = 50; // base score
  
  // Traffic volume bonus (e.g., "+500%" or "100K+ searches")
  if (trend.traffic) {
    const traffic = trend.traffic.toLowerCase();
    if (traffic.includes('k') || traffic.includes('thousand')) score += 15;
    if (traffic.includes('m') || traffic.includes('million')) score += 25;
    if (traffic.includes('+')) {
      const match = traffic.match(/\+?(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num >= 100) score += 20;
        else if (num >= 50) score += 10;
        else if (num >= 10) score += 5;
      }
    }
  }
  
  // Description richness (related news items)
  if (trend.description) {
    const newsCount = (trend.description.match(/•/g) || []).length;
    score += Math.min(newsCount * 5, 20); // max +20 for 4+ news items
    
    // Has context beyond just news links
    if (trend.description.length > 200) score += 5;
  }
  
  // Title quality
  if (trend.title.length >= 10 && trend.title.length <= 100) score += 5;
  
  // Source reliability bonus
  if (trend.source === 'google_trends') score += 10;
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Get quality tier for display prioritization
 */
export function getTrendQualityTier(qualityScore: number, velocityScore?: number): TrendQualityTier {
  const effectiveScore = Math.max(qualityScore, velocityScore ?? 0);
  if (effectiveScore >= 70) return 'hot';
  if (effectiveScore >= 40) return 'warm';
  return 'cold';
}

/**
 * Simple text similarity for trend clustering (0-1)
 */
function similarityScore(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const na = normalize(a);
  const nb = normalize(b);
  
  if (na === nb) return 1;
  
  // Jaccard similarity on word sets
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
}

/**
 * Cluster similar trends across regions
 */
export function clusterTrends(trends: TrendRow[], similarityThreshold = 0.6): TrendCluster[] {
  const clusters: TrendCluster[] = [];
  const assigned = new Set<number>();
  
  for (const trend of trends) {
    if (assigned.has(trend.id)) continue;
    
    // Find similar trends
    const similar = trends.filter(t => {
      if (t.id === trend.id) return true;
      if (assigned.has(t.id)) return false;
      return similarityScore(trend.title, t.title) >= similarityThreshold;
    });
    
    if (similar.length > 0) {
      const cluster: TrendCluster = {
        id: `cluster_${trend.id}_${Date.now()}`,
        canonicalTitle: trend.title,
        trends: similar,
        regions: [...new Set(similar.map(t => t.region))],
        isGlobal: similar.length > 1 && new Set(similar.map(t => t.region)).size > 1,
        maxQualityScore: Math.max(...similar.map(t => t.quality_score ?? 50))
      };
      
      clusters.push(cluster);
      similar.forEach(t => assigned.add(t.id));
    }
  }
  
  return clusters.sort((a, b) => b.maxQualityScore - a.maxQualityScore);
}

/**
 * List trends with quality scores, optionally filtered by tier
 */
export function listTrendsWithQuality(geo?: string, minTier?: TrendQualityTier): TrendRow[] {
  const db = getDb();
  let sql = `SELECT * FROM trends WHERE status != 'dismissed'`;
  const params: unknown[] = [];
  
  if (geo && geo.trim()) {
    sql += ` AND region = ?`;
    params.push(geo.toUpperCase().trim());
  }
  
  if (minTier) {
    const minScore = minTier === 'hot' ? 70 : minTier === 'warm' ? 40 : 0;
    sql += ` AND (quality_score >= ? OR velocity_score >= ?)`;
    params.push(minScore, minScore);
  }
  
  sql += ` ORDER BY COALESCE(quality_score, 50) DESC, id DESC LIMIT 100`;
  
  return db.prepare(sql).all(...params) as TrendRow[];
}

function unescapeAiJsonField(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/**
 * Generate an article draft from a trend using the configured AI provider.
 * Re-running on a completed trend resets it and creates a new draft.
 */
export async function generateCoverage(trendId: number, userId?: number): Promise<{ ok: boolean; articleId?: number; error?: string }> {
  const db = getDb();
  const trend = db.prepare(`SELECT * FROM trends WHERE id = ?`).get(trendId) as TrendRow | undefined;
  if (!trend) {
    return { ok: false, error: 'Trend not found' };
  }

  if (trend.status === 'generating') {
    return { ok: false, error: 'جاري توليد مقال لهذا التريند بالفعل. انتظر اكتمال العملية أو أعد المحاولة لاحقاً.' };
  }

  if (trend.status === 'dismissed') {
    return { ok: false, error: 'تم تجاهل هذا التريند.' };
  }

  const { checkAiProviderReady, runAiRaw, resolveEffectiveAiProvider, resolveModelForProvider } = await import('./ai');
  const health = await checkAiProviderReady();
  if (!health.ok) {
    return { ok: false, error: health.error ?? 'مزود الذكاء الاصطناعي غير جاهز.' };
  }

  if (trend.status === 'completed') {
    resetTrend(trendId);
  }

  db.prepare(`UPDATE trends SET status = 'generating', updated_at = datetime('now') WHERE id = ?`).run(trendId);

  try {
    const isGlobal = !['SA', 'EG', 'AE', 'JO', 'MA', 'KW', 'QA', 'LB'].includes(trend.region);
    const regionName = trend.region === 'SA' ? 'المملكة العربية السعودية'
      : trend.region === 'EG' ? 'جمهورية مصر العربية'
      : trend.region === 'AE' ? 'الإمارات العربية المتحدة'
      : trend.region;

    const prompt = `أنت رئيس تحرير شبكة إخبارية عربية محترفة.
الموضوع التريند الحالي والأكثر بحثاً هو: "${trend.title}" في منطقة "${regionName}" (${trend.region}).
سياق الخبر وأهم الروابط الإخبارية المتعلقة به:
${trend.description || 'لا يوجد سياق إضافي'}

المطلوب: كتابة مسودة مقال إخباري احترافي وتفصيلي باللغة العربية الفصحى يغطي هذا الموضوع بشكل شامل ودقيق.
${isGlobal ? 'تنبيه: هذا تريند عالمي، يرجى تعريبه وصياغته وتكييفه لغوياً وإخبارياً ليكون مناسباً ومهماً للقارئ العربي.' : ''}

شروط الصياغة:
1. عنوان صحفي جذاب ومباشر.
2. مقدمة سريعة للموضوع توضح سبب كونه تريند وبحثاً شائعاً.
3. تفاصيل كاملة في فقرات منظمة ومنسقة صحفياً ومبنية على السياق.
4. خاتمة إخبارية موجزة.
5. ملخص قصير جداً للمقال (لا يتجاوز 250 حرفاً) لاستخدامه كمقتطف (Summary).

يجب إرجاع النتيجة حصرياً بصيغة JSON مطابقة تماماً للنموذج التالي دون أي نصوص إضافية، تعليقات، أو علامات ماركداون (مثل \`\`\`json):
{
  "title": "عنوان المقال المقترح",
  "summary": "الملخص أو المقتطف القصير للمقال",
  "content": "محتوى المقال بالكامل مقسماً لفقرات"
}`;

    const provider = resolveEffectiveAiProvider();
    const model = resolveModelForProvider(provider);
    const response = await runAiRaw(prompt, trend.description ?? '', provider, model);

    // Robust JSON extraction — handle markdown fences, leading text, trailing text
    let result: { title?: string; summary?: string; content?: string } | null = null;
    const attempts = [
      // 1. Strip markdown fences and try direct parse
      () => JSON.parse(response.replace(/```(?:json)?/g, '').trim()),
      // 2. Extract first {...} block from the response
      () => {
        const m = response.match(/\{[\s\S]*?\}(?=\s*$)/) ?? response.match(/\{[\s\S]+\}/);
        if (!m) throw new Error('no json block');
        return JSON.parse(m[0]);
      },
      // 3. Extract just the fields with regex as last resort
      () => {
        const t = response.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
        const s = response.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
        const c = response.match(/"content"\s*:\s*"((?:[^"\\]|\\.|\n)*)"/)?.[1];
        if (!t || !c) throw new Error('regex extraction failed');
        return {
          title: unescapeAiJsonField(t),
          summary: s ? unescapeAiJsonField(s) : undefined,
          content: unescapeAiJsonField(c),
        };
      },
    ];

    for (const attempt of attempts) {
      try {
        const parsed = attempt() as { title?: string; summary?: string; content?: string };
        result = {
          title: parsed.title?.trim(),
          summary: parsed.summary?.trim(),
          content: parsed.content?.trim(),
        };
        break;
      } catch { /* try next */ }
    }

    if (!result?.title || !result?.content) {
      // Final fallback: use the raw response as content, trend title as article title
      if (response.trim().length > 100) {
        result = {
          title: trend.title,
          summary: response.slice(0, 240),
          content: response.trim(),
        };
      } else {
        throw new Error('فشل الذكاء الاصطناعي في إرجاع الهيكل الصحيح للمقال. الاستجابة: ' + response.slice(0, 200));
      }
    }

    // Create the article draft in database
    const articleId = createArticle({
      title: (result.title ?? '').trim(),
      summary: result.summary?.trim() || (result.content ?? '').slice(0, 240),
      content: (result.content ?? '').trim(),
      status: 'draft',
      source: `رادار التريندات (${trend.region})`,
      category: 'تريندات'
    });

    db.prepare(`
      UPDATE trends
      SET status = 'completed', article_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(articleId, trendId);

    auditEmitter.emitLog({
      userId: userId ?? null,
      action: 'trend.generate',
      targetType: 'article',
      targetId: articleId,
      details: { trendId, title: trend.title, region: trend.region }
    });

    return { ok: true, articleId };
  } catch (e) {
    db.prepare(`UPDATE trends SET status = 'pending', updated_at = datetime('now') WHERE id = ?`).run(trendId);
    return { ok: false, error: (e as Error).message };
  }
}

/* ── Multi-source fetching ──────────────────────────────────────────────── */

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Referer': 'https://trends.google.com/',
};

/**
 * Extract article links from a raw RSS/Atom XML body.
 * Returns an array aligned with the parsed trends array (same index = same item).
 */
function extractItemLinks(xml: string, limit: number): (string | null)[] {
  const links: (string | null)[] = [];

  // Atom: <link href="…" rel="alternate" … />  or  <link>…</link>
  if (xml.includes('<entry')) {
    const entries = [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)];
    for (const m of entries) {
      const b = m[1];
      // <link rel="alternate" href="…" />
      const hrefM = b.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/) ??
                    b.match(/<link[^>]*rel=["']alternate["'][^>]+href=["']([^"']+)["']/);
      // plain <link>…</link>
      const textM = b.match(/<link[^>]*>([^<]+)<\/link>/);
      const link = hrefM?.[1] ?? textM?.[1] ?? null;
      links.push(link?.trim() || null);
      if (links.length >= limit) break;
    }
    return links;
  }

  // RSS 2.0: <item>…<link>…</link>…</item>
  const items = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)];
  for (const m of items) {
    const b = m[1];
    const linkM = b.match(/<link[^>]*>([^<]+)<\/link>/) ??
                  // CDATA form: <link><![CDATA[…]]></link>
                  b.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    links.push(linkM?.[1]?.trim() || null);
    if (links.length >= limit) break;
  }
  return links;
}

/**
 * Fetch a trend article page and return an enriched description string,
 * or null if the fetch fails or produces no useful content.
 * Caps fetched body at 2 000 chars to keep trend descriptions concise.
 */
async function enrichTrendDescription(articleUrl: string): Promise<string | null> {
  try {
    const { fetchArticlePage } = await import('./fetch-pipeline');
    const res = await fetchArticlePage({
      url: articleUrl,
      fetchMode: 'smart',
      context: 'ingest',
      skipQualityReject: true,
    });
    if (!res.ok || !res.extracted) return null;
    const ex = res.extracted;
    const body = ex.content
      ? ex.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
      : ex.summary?.slice(0, 2000) ?? null;
    return body && body.length > 80 ? body : null;
  } catch {
    return null;
  }
}

/** Build the full fetch URL for a source.
 *  Wikipedia sources store only the base path; we append yesterday's date. */
function buildFetchUrl(src: { type: string; url: string }): string {
  if (src.type === 'wikipedia') {
    // Wikimedia REST API requires an explicit date; use yesterday to ensure data is ready.
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${src.url.replace(/\/$/, '')}/${yy}/${mm}/${dd}`;
  }
  return src.url;
}

/** Detect the language code embedded in a Wikipedia base URL (ar / en / fr …). */
function wikiLang(url: string): string {
  const m = url.match(/\/metrics\/pageviews\/top\/([a-z-]+)\.wikipedia/);
  return m ? m[1] : 'ar';
}

/**
 * Fetch trends from a single source (by its DB id).
 */
export async function fetchFromSource(sourceId: number): Promise<{ ok: boolean; count: number; error?: string }> {
  const src = getSource(sourceId);
  if (!src) return { ok: false, count: 0, error: 'المصدر غير موجود' };
  if (!src.is_enabled) return { ok: false, count: 0, error: 'المصدر معطّل' };

  const fetchUrl = buildFetchUrl(src);
  const isJson   = src.type === 'wikipedia';

  const headers: Record<string, string> = isJson
    ? { ...FETCH_HEADERS, 'Accept': 'application/json' }
    : FETCH_HEADERS;

  try {
    const { getText } = await import('../net/http');
    const res = await getText(fetchUrl, headers, { maxBytes: 2 * 1024 * 1024, useProxy: true });

    if (!res.ok) {
      const err = `HTTP ${res.status}`;
      markSourceFetched(sourceId, err);
      return { ok: false, count: 0, error: err };
    }

    if (!res.body || res.body.trim().length < 50) {
      const err = 'استجابة فارغة';
      markSourceFetched(sourceId, err);
      return { ok: false, count: 0, error: err };
    }

    // For XML sources, reject HTML (bot protection)
    if (!isJson && (res.body.includes('<!DOCTYPE') || res.body.includes('<html'))) {
      const err = 'حماية ضد الروبوتات (HTML بدلاً من XML)';
      markSourceFetched(sourceId, err);
      return { ok: false, count: 0, error: err };
    }

    const lang   = src.type === 'wikipedia' ? wikiLang(src.url) : 'ar';
    const trends = parseFeedBySourceType(res.body, src.type, lang);

    if (trends.length === 0) {
      markSourceFetched(sourceId);
      return { ok: true, count: 0 };
    }

    // ── Extract article links from raw XML for full-content enrichment ─────
    // Parse <link> tags from the raw feed body so we can follow them.
    const itemLinkMap = extractItemLinks(res.body, trends.length);

    const db = getDb();
    const insertTrend = db.prepare(`
      INSERT OR IGNORE INTO trends (title, region, source, traffic, description, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    let inserted = 0;
    for (let i = 0; i < trends.length; i++) {
      const trend = trends[i]!;
      let description = trend.description ?? null;

      // Enrich description by fetching the article's full content
      const articleLink = itemLinkMap[i];
      if (articleLink) {
        try {
          const articleRes = await enrichTrendDescription(articleLink);
          if (articleRes) description = articleRes;
        } catch { /* keep RSS description */ }
      }

      const r = insertTrend.run(
        sanitizeString(trend.title, 200),
        sanitizeString(src.region_tag, 20),
        sanitizeString(src.name, 120),
        trend.traffic ? sanitizeString(trend.traffic, 32) : null,
        description  ? sanitizeString(description, 2000) : null
      );
      if (r.changes > 0) inserted++;
    }

    markSourceFetched(sourceId);
    return { ok: true, count: inserted };
  } catch (e) {
    const err = (e as Error).message;
    markSourceFetched(sourceId, err);
    return { ok: false, count: 0, error: err };
  }
}

/**
 * Fetch trends from all enabled sources.
 */
export async function fetchAllSources(): Promise<{ total: number; failed: number; inserted: number }> {
  const sources = listSources().filter(s => s.is_enabled);
  let failed = 0;
  let inserted = 0;

  for (const src of sources) {
    const res = await fetchFromSource(src.id);
    if (!res.ok) failed++;
    else inserted += res.count;
  }

  return { total: sources.length, failed, inserted };
}
