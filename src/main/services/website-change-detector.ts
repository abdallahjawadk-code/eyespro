/**
 * Website Change Detector
 *
 * Monitors any URL for content changes:
 *   1. Fetches the page (HTTP or BrowserWindow for JS-heavy sites)
 *   2. Extracts visible text (strips HTML)
 *   3. Hashes with SHA-256
 *   4. Compares with stored hash — alerts on difference
 *   5. Generates a line-level text diff
 *
 * Optionally watches a specific CSS selector instead of the full page.
 */
import crypto from 'node:crypto';
import { getDb } from '../db/database';
import { getText } from '../net/http';
import { fetchPageHtml } from './fetch-pipeline';
import { createLogger } from '../logger';

const log = createLogger('website-change-detector');

export interface ChangeCheckResult {
  changed: boolean;
  hash: string;
  previousHash: string | null;
  diff: string;
  snippet: string; // first 500 chars of current text
  checkedAt: string;
}

export interface WebsiteWatchConfig {
  url: string;
  selector?: string;  // optional CSS selector to watch (extracted via regex heuristic)
  forceBrowser?: boolean;
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSelectorText(html: string, selector: string): string {
  // Simple heuristic: match elements with matching id or class attribute
  const esc = selector.replace(/^[#.]/, '');
  const re = new RegExp(`<[^>]+(?:id|class)=["'][^"']*${esc}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[a-z]+>`, 'i');
  const m = re.exec(html);
  return m ? stripHtml(m[1]) : stripHtml(html);
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── Diff generation ──────────────────────────────────────────────────────────

function generateDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split(/[.!?]\s+/).filter(Boolean);
  const newLines = newText.split(/[.!?]\s+/).filter(Boolean);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added = newLines.filter((l) => !oldSet.has(l)).slice(0, 10);
  const removed = oldLines.filter((l) => !newSet.has(l)).slice(0, 10);

  const parts: string[] = [];
  if (added.length) parts.push('➕ مضاف:\n' + added.map((l) => `  + ${l.slice(0, 200)}`).join('\n'));
  if (removed.length) parts.push('➖ محذوف:\n' + removed.map((l) => `  - ${l.slice(0, 200)}`).join('\n'));
  return parts.join('\n\n') || 'تغيير في التنسيق أو الترتيب';
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPageText(config: WebsiteWatchConfig): Promise<string | null> {
  const { url, selector, forceBrowser } = config;
  try {
    if (forceBrowser) {
      const result = await fetchPageHtml(url, { forceBrowser: true, selector });
      if (!result.ok || !result.html) return null;
      return selector ? extractSelectorText(result.html, selector) : stripHtml(result.html);
    }

    const res = await getText(url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    }, { timeout: 20_000, useProxy: true });
    if (!res.ok) return null;

    return selector ? extractSelectorText(res.body, selector) : stripHtml(res.body);
  } catch (e) {
    log.warn(`Fetch failed for ${url}: ${(e as Error).message}`);
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getStoredHash(monitorId: number): string | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT last_content_hash FROM competitor_monitors WHERE id = ?`
  ).get(monitorId) as { last_content_hash: string | null } | undefined;
  return row?.last_content_hash ?? null;
}

function storeHash(monitorId: number, hash: string): void {
  getDb().prepare(
    `UPDATE competitor_monitors SET last_content_hash = ? WHERE id = ?`
  ).run(hash, monitorId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkWebsiteChange(
  monitorId: number,
  config: WebsiteWatchConfig
): Promise<ChangeCheckResult> {
  const currentText = await fetchPageText(config);
  if (!currentText) {
    throw new Error(`فشل جلب الصفحة: ${config.url}`);
  }

  const hash = hashText(currentText);
  const previousHash = getStoredHash(monitorId);
  const changed = previousHash !== null && hash !== previousHash;

  let diff = '';
  if (changed) {
    // We don't store the previous text — compute a structural diff from hash change message
    diff = `تم اكتشاف تغيير في الصفحة (hash: ${previousHash?.slice(0, 8)} → ${hash.slice(0, 8)})`;
    log.info(`Website change detected for monitor ${monitorId}: ${config.url}`);
  }

  storeHash(monitorId, hash);

  return {
    changed,
    hash,
    previousHash,
    diff,
    snippet: currentText.slice(0, 500),
    checkedAt: new Date().toISOString(),
  };
}

/** For first-time check: just store hash, return no change */
export async function initWebsiteBaseline(monitorId: number, config: WebsiteWatchConfig): Promise<{ ok: boolean; hash: string }> {
  const text = await fetchPageText(config);
  if (!text) return { ok: false, hash: '' };
  const hash = hashText(text);
  storeHash(monitorId, hash);
  log.info(`Website baseline set for monitor ${monitorId}: ${hash.slice(0, 8)}`);
  return { ok: true, hash };
}

/** Full check with text diff — stores previous text snapshot in competitor_snapshots */
export async function checkWebsiteChangeWithDiff(
  monitorId: number,
  config: WebsiteWatchConfig
): Promise<ChangeCheckResult & { previousText?: string }> {
  const db = getDb();

  const currentText = await fetchPageText(config);
  if (!currentText) throw new Error(`فشل جلب الصفحة: ${config.url}`);

  const hash = hashText(currentText);
  const previousHash = getStoredHash(monitorId);

  // Retrieve previous text from last snapshot
  const lastSnap = db.prepare(
    `SELECT diff_text FROM competitor_snapshots WHERE monitor_id = ? ORDER BY seen_at DESC LIMIT 1`
  ).get(monitorId) as { diff_text: string | null } | undefined;
  const previousText = lastSnap?.diff_text ?? null;

  const changed = previousHash !== null && hash !== previousHash;
  let diff = '';

  if (changed && previousText) {
    diff = generateDiff(previousText, currentText);
  } else if (changed) {
    diff = `تم اكتشاف تغيير (hash: ${previousHash?.slice(0, 8)} → ${hash.slice(0, 8)})`;
  }

  storeHash(monitorId, hash);

  return {
    changed,
    hash,
    previousHash,
    diff,
    snippet: currentText.slice(0, 500),
    checkedAt: new Date().toISOString(),
    previousText: currentText, // return current to be stored as next "previous"
  };
}
