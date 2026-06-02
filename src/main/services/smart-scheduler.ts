/**
 * Feature 2 — Performance-based Smart Scheduling
 *
 * Analyses historical publish_logs to find per-platform peak windows
 * (day-of-week × hour-of-day with highest success rates), then suggests
 * the next optimal datetime for scheduling a new publish task.
 *
 * Falls back to sensible defaults when there is insufficient history.
 */

import { getDb } from '../db/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeakWindow {
  platform: string;
  dayOfWeek: number;    // 0 = Sunday … 6 = Saturday
  hour: number;         // 0 – 23
  successRate: number;  // 0.0 – 1.0
  sampleSize: number;
}

export interface ScheduleSuggestion {
  platform: string;
  suggestedAt: string;   // ISO-8601 datetime (local-tz aware)
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

// ─── Fallback peak hours by platform (empirical best-practice) ────────────────

const DEFAULT_PEAK_HOURS: Record<string, number[]> = {
  twitter:   [9, 12, 17],
  facebook:  [13, 15, 20],
  linkedin:  [8, 12, 17],
  telegram:  [9, 13, 18, 21],
  whatsapp:  [8, 12, 20],
  youtube:   [12, 15, 20],
  email:     [8, 10, 14],
};

const DEFAULT_PEAK_DAYS: number[] = [1, 2, 3, 4];  // Mon–Thu

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * Load peak windows for a platform from the last `days` of publish_logs.
 * Requires at least `minSamples` publishes per slot to be considered reliable.
 */
export function getPeakWindows(platform: string, days = 90, minSamples = 3): PeakWindow[] {
  type Row = { dow: number; hour: number; total: number; successes: number };
  const rows = getDb()
    .prepare(
      `SELECT
         CAST(strftime('%w', created_at) AS INTEGER) AS dow,
         CAST(strftime('%H', created_at) AS INTEGER) AS hour,
         COUNT(*) AS total,
         SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes
       FROM publish_logs
       WHERE platform=? AND created_at >= datetime('now', ?)
       GROUP BY dow, hour
       HAVING total >= ?
       ORDER BY CAST(successes AS REAL) / total DESC`
    )
    .all(platform, `-${days} days`, minSamples) as Row[];

  return rows.map((r) => ({
    platform,
    dayOfWeek: r.dow,
    hour: r.hour,
    successRate: r.successes / r.total,
    sampleSize: r.total,
  }));
}

/** Aggregate peak windows for all platforms. */
export function allPlatformPeakWindows(): Record<string, PeakWindow[]> {
  const platforms = (
    getDb()
      .prepare(`SELECT DISTINCT platform FROM publish_logs`)
      .all() as { platform: string }[]
  ).map((r) => r.platform);

  const out: Record<string, PeakWindow[]> = {};
  for (const p of platforms) out[p] = getPeakWindows(p);
  return out;
}

// ─── Suggestion engine ────────────────────────────────────────────────────────

function nextOccurrence(dayOfWeek: number, hour: number, minutesAhead = 30): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);

  // Advance to the correct day-of-week
  let daysToAdd = (dayOfWeek - now.getDay() + 7) % 7;
  // If today matches but the time has passed (or is too soon), push to next week
  if (daysToAdd === 0 && target.getTime() - now.getTime() < minutesAhead * 60_000) {
    daysToAdd = 7;
  }
  target.setDate(target.getDate() + daysToAdd);
  return target;
}

function nearestDefaultSlot(platform: string, minutesAhead = 30): Date {
  const hours = DEFAULT_PEAK_HOURS[platform] ?? [9, 14, 18];
  const now = new Date();
  const candidates: Date[] = [];

  for (const day of DEFAULT_PEAK_DAYS) {
    for (const hour of hours) {
      candidates.push(nextOccurrence(day, hour, minutesAhead));
    }
  }
  // Return the soonest candidate that is at least minutesAhead from now
  const future = candidates.filter((d) => d.getTime() > now.getTime() + minutesAhead * 60_000);
  future.sort((a, b) => a.getTime() - b.getTime());
  return future[0] ?? new Date(now.getTime() + 60 * 60_000);
}

/**
 * Suggest the next optimal scheduling datetime for a platform.
 *
 * @param platform  Target platform name
 * @param daysAhead Maximum days in the future to look (default 14)
 */
export function suggestScheduleTime(platform: string, daysAhead = 14): ScheduleSuggestion {
  const windows = getPeakWindows(platform);

  if (windows.length === 0) {
    // No historical data — use empirical defaults
    const suggested = nearestDefaultSlot(platform);
    return {
      platform,
      suggestedAt: suggested.toISOString(),
      reason: 'استناداً إلى أفضل الممارسات العامة (لا يوجد سجل تاريخي كافٍ)',
      confidence: 'low',
    };
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + daysAhead * 86_400_000);
  const topWindow = windows[0]!;

  // Find next occurrence of the top window within daysAhead
  const candidate = nextOccurrence(topWindow.dayOfWeek, topWindow.hour);
  if (candidate > deadline) {
    // Top window is too far — fall back to defaults
    const suggested = nearestDefaultSlot(platform);
    return {
      platform,
      suggestedAt: suggested.toISOString(),
      reason: 'أفضل نافذة تاريخية بعيدة جداً، جرى اقتراح أقرب فرصة مناسبة',
      confidence: 'medium',
    };
  }

  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return {
    platform,
    suggestedAt: candidate.toISOString(),
    reason: `أعلى معدل نجاح تاريخي: ${dayNames[topWindow.dayOfWeek]} الساعة ${topWindow.hour}:00 (${Math.round(topWindow.successRate * 100)}% من ${topWindow.sampleSize} محاولة)`,
    confidence: topWindow.sampleSize >= 10 ? 'high' : 'medium',
  };
}

/** Suggest schedule times for multiple platforms at once. */
export function suggestMultiPlatformSchedule(platforms: string[]): ScheduleSuggestion[] {
  return platforms.map((p) => suggestScheduleTime(p));
}

// ─── Heatmap data (for UI visualisation) ─────────────────────────────────────

export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  successRate: number;
  total: number;
}

export function publishingHeatmap(platform?: string, days = 90): HeatmapCell[] {
  type Row = { dow: number; hour: number; total: number; successes: number };
  const rows = getDb()
    .prepare(
      `SELECT
         CAST(strftime('%w', created_at) AS INTEGER) AS dow,
         CAST(strftime('%H', created_at) AS INTEGER) AS hour,
         COUNT(*) AS total,
         SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes
       FROM publish_logs
       WHERE (? IS NULL OR platform=?) AND created_at >= datetime('now', ?)
       GROUP BY dow, hour`
    )
    .all(platform ?? null, platform ?? null, `-${days} days`) as Row[];

  return rows.map((r) => ({
    dayOfWeek: r.dow,
    hour: r.hour,
    successRate: r.total > 0 ? r.successes / r.total : 0,
    total: r.total,
  }));
}
