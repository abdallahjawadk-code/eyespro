/**
 * Feature 6 — Content Recycling (Periodic Re-sharing)
 *
 * Automatically re-shares old high-performing articles on configured platforms
 * after a defined "rest" period. Prevents good content from being forgotten.
 *
 * Rules stored in DB table: recycle_rules (added in migration v22)
 * - minAgeDays:        article must be at least this old before recycling
 * - maxRepublishCount: don't recycle more than N times total
 * - platforms:         which platforms to post to
 * - enabled:           rule on/off switch
 *
 * Called periodically by the scheduler tick.
 */

import { getDb } from '../db/database';
import { createTask } from './scheduler';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecycleRule {
  id:               number;
  name:             string;
  platforms:        string[];
  minAgeDays:       number;   // e.g. 180 (6 months)
  maxRepublishCount: number;  // e.g. 2
  minWordCount:     number;   // only recycle substantial articles
  enabled:          boolean;
  createdAt:        string;
}

export interface RecycleCandidate {
  id:            number;
  title:         string;
  publishedAt:   string | null;
  recycleCount:  number;
  lastRecycled:  string | null;
  wordCount:     number | null;
}

// ─── CRUD for rules ───────────────────────────────────────────────────────────

export function listRecycleRules(): RecycleRule[] {
  type Row = { id: number; name: string; platforms_json: string; min_age_days: number; max_republish_count: number; min_word_count: number; enabled: number; created_at: string };
  return (getDb().prepare(`SELECT * FROM recycle_rules ORDER BY id DESC`).all() as Row[])
    .map((r) => ({
      id: r.id, name: r.name,
      platforms: JSON.parse(r.platforms_json) as string[],
      minAgeDays: r.min_age_days,
      maxRepublishCount: r.max_republish_count,
      minWordCount: r.min_word_count,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    }));
}

export function createRecycleRule(data: Omit<RecycleRule, 'id' | 'createdAt'>): number {
  const r = getDb()
    .prepare(
      `INSERT INTO recycle_rules
         (name, platforms_json, min_age_days, max_republish_count, min_word_count, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name,
      JSON.stringify(data.platforms),
      data.minAgeDays,
      data.maxRepublishCount,
      data.minWordCount ?? 200,
      data.enabled ? 1 : 0,
    );
  return Number(r.lastInsertRowid);
}

export function updateRecycleRule(id: number, data: Partial<Omit<RecycleRule, 'id' | 'createdAt'>>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name              !== undefined) { sets.push('name=?');                vals.push(data.name); }
  if (data.platforms         !== undefined) { sets.push('platforms_json=?');      vals.push(JSON.stringify(data.platforms)); }
  if (data.minAgeDays        !== undefined) { sets.push('min_age_days=?');        vals.push(data.minAgeDays); }
  if (data.maxRepublishCount !== undefined) { sets.push('max_republish_count=?'); vals.push(data.maxRepublishCount); }
  if (data.minWordCount      !== undefined) { sets.push('min_word_count=?');      vals.push(data.minWordCount); }
  if (data.enabled           !== undefined) { sets.push('enabled=?');             vals.push(data.enabled ? 1 : 0); }
  if (!sets.length) return;
  getDb().prepare(`UPDATE recycle_rules SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
}

export function deleteRecycleRule(id: number): void {
  getDb().prepare(`DELETE FROM recycle_rules WHERE id=?`).run(id);
}

// ─── Candidate detection ──────────────────────────────────────────────────────

export function findRecycleCandidates(rule: RecycleRule): RecycleCandidate[] {
  type Row = {
    id: number; title: string; published_at: string | null;
    recycle_count: number; last_recycled: string | null; word_count: number | null;
  };

  const rows = getDb()
    .prepare(
      `SELECT
         a.id, a.title, a.published_at, a.word_count,
         COALESCE(r.recycle_count, 0) AS recycle_count,
         r.last_recycled
       FROM articles a
       LEFT JOIN article_recycle_log r ON r.article_id = a.id
       WHERE a.status = 'published'
         AND a.published_at <= datetime('now', ?)
         AND (a.word_count IS NULL OR a.word_count >= ?)
         AND (r.recycle_count IS NULL OR r.recycle_count < ?)
         AND (r.last_recycled IS NULL OR r.last_recycled <= datetime('now', '-30 days'))
       ORDER BY a.published_at DESC
       LIMIT 50`
    )
    .all(
      `-${rule.minAgeDays} days`,
      rule.minWordCount,
      rule.maxRepublishCount,
    ) as Row[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    publishedAt: r.published_at,
    recycleCount: r.recycle_count,
    lastRecycled: r.last_recycled,
    wordCount: r.word_count,
  }));
}

// ─── Recycle execution ────────────────────────────────────────────────────────

export async function recycleArticle(articleId: number, platforms: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    getDb()
      .prepare(
        `INSERT INTO article_recycle_log (article_id, platforms_json, recycled_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(article_id) DO UPDATE SET
           recycle_count = recycle_count + 1,
           last_recycled = datetime('now'),
           platforms_json = excluded.platforms_json`
      )
      .run(articleId, JSON.stringify(platforms));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Process all enabled recycle rules and schedule candidates.
 * Called by the scheduler (e.g. once per day).
 */
export async function processRecycleQueue(): Promise<{ scheduled: number }> {
  const rules = listRecycleRules().filter((r) => r.enabled);
  let scheduled = 0;

  for (const rule of rules) {
    const candidates = findRecycleCandidates(rule);
    // Pick up to 3 articles per rule per run to avoid spam
    const batch = candidates.slice(0, 3);

    for (const c of batch) {
      // Schedule for next optimal time (30 min from now as default)
      const scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString();
      createTask({
        name:         `إعادة نشر: ${c.title.slice(0, 60)}`,
        task_type:    'publish',
        article_id:   c.id,
        platforms:    JSON.stringify(rule.platforms),
        scheduled_at: scheduledAt,
        status:       'pending',
      });
      scheduled++;
    }
  }

  return { scheduled };
}
