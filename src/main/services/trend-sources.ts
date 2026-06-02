/* ── trend-sources.ts ─────────────────────────────────────────────────────
   CRUD service for user-managed trend sources stored in `trend_sources` table.
──────────────────────────────────────────────────────────────────────────── */

import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';

export type SourceType = 'google_trends_geo' | 'rss' | 'atom' | 'youtube' | 'reddit' | 'wikipedia';

export interface TrendSourceRow {
  id: number;
  name: string;
  type: SourceType;
  url: string;
  region_tag: string;
  is_builtin: number;   // 1 = cannot be deleted by user
  is_enabled: number;   // 1 = active
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
}

/** Metadata displayed to the user about each supported source type */
export const SOURCE_TYPE_INFO: Record<SourceType, { labelAr: string; labelEn: string; hint: string; example: string }> = {
  google_trends_geo: {
    labelAr: 'Google Trends (منطقة جغرافية)',
    labelEn: 'Google Trends (Geo)',
    hint: 'رابط RSS من Google Trends لمنطقة محددة. صيغة الرابط: https://trends.google.com/trending/rss?geo=XX',
    example: 'https://trends.google.com/trending/rss?geo=SA',
  },
  rss: {
    labelAr: 'خلاصة RSS',
    labelEn: 'RSS Feed',
    hint: 'أي خلاصة RSS 2.0 (مواقع أخبار، Google News، إلخ).',
    example: 'https://news.google.com/rss?gl=SA&hl=ar&ceid=SA:ar',
  },
  atom: {
    labelAr: 'خلاصة Atom',
    labelEn: 'Atom Feed',
    hint: 'أي خلاصة Atom 1.0.',
    example: 'https://www.reddit.com/r/worldnews/top.atom',
  },
  youtube: {
    labelAr: 'يوتيوب (قناة / تريندينج)',
    labelEn: 'YouTube Feed',
    hint: 'رابط RSS لقناة يوتيوب أو قائمة التريندات. صيغة: https://www.youtube.com/feeds/videos.xml?channel_id=UC… أو chart=most_popular&regionCode=SA',
    example: 'https://www.youtube.com/feeds/videos.xml?chart=most_popular&regionCode=SA',
  },
  reddit: {
    labelAr: 'Reddit (سبريديت)',
    labelEn: 'Reddit Subreddit',
    hint: 'خلاصة RSS لأي سبريديت Reddit. صيغة: https://www.reddit.com/r/{subreddit}/top.rss?t=day',
    example: 'https://www.reddit.com/r/worldnews/top.rss?t=day',
  },
  wikipedia: {
    labelAr: 'ويكيبيديا (أكثر المقالات قراءةً)',
    labelEn: 'Wikipedia Trending',
    hint: 'يجلب أكثر 50 مقالة مقروءة يومياً عبر Wikimedia REST API. أدخل رابط القاعدة فقط.',
    example: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ar.wikipedia.org/all-access',
  },
};

export function listSources(): TrendSourceRow[] {
  return getDb()
    .prepare(`SELECT * FROM trend_sources ORDER BY is_builtin DESC, id ASC`)
    .all() as TrendSourceRow[];
}

export function getSource(id: number): TrendSourceRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM trend_sources WHERE id = ?`)
    .get(id) as TrendSourceRow | undefined;
}

export interface AddSourcePayload {
  name: string;
  type: SourceType;
  url: string;
  region_tag?: string;
}

export function addSource(payload: AddSourcePayload): { ok: boolean; id?: number; error?: string } {
  try {
    const name = sanitizeString(payload.name.trim(), 120);
    const url  = sanitizeString(payload.url.trim(), 500);
    const type = payload.type as string;
    const region = sanitizeString((payload.region_tag ?? 'CUSTOM').trim().toUpperCase(), 20);

    if (!name || !url) return { ok: false, error: 'الاسم والرابط مطلوبان' };

    const allowed: SourceType[] = ['google_trends_geo', 'rss', 'atom', 'youtube', 'reddit', 'wikipedia'];
    if (!allowed.includes(type as SourceType)) {
      return { ok: false, error: 'نوع المصدر غير مدعوم' };
    }

    const result = getDb()
      .prepare(`INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES (?, ?, ?, ?, 0, 1)`)
      .run(name, type, url, region);

    if (result.changes === 0) {
      return { ok: false, error: 'هذا الرابط موجود مسبقاً في قائمة المصادر' };
    }

    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function deleteSource(id: number): { ok: boolean; error?: string } {
  const src = getSource(id);
  if (!src) return { ok: false, error: 'المصدر غير موجود' };
  if (src.is_builtin) return { ok: false, error: 'لا يمكن حذف المصادر المدمجة' };

  getDb().prepare(`DELETE FROM trend_sources WHERE id = ?`).run(id);
  return { ok: true };
}

export function toggleSource(id: number, enabled: boolean): { ok: boolean } {
  const r = getDb()
    .prepare(`UPDATE trend_sources SET is_enabled = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, id);
  return { ok: r.changes > 0 };
}

export function markSourceFetched(id: number, error?: string): void {
  getDb().prepare(`
    UPDATE trend_sources
    SET last_fetched_at = datetime('now'), last_error = ?
    WHERE id = ?
  `).run(error ?? null, id);
}
