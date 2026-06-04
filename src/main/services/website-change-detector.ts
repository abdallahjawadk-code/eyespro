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
import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { getDb } from '../db/database';

import { fetchPageHtml } from './fetch-pipeline';
import { createLogger } from '../logger';
import { runAiChain, resolveEffectiveAiProvider } from './ai';

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

export function extractMainArticleContent(html: string): string {
  try {
    const $ = cheerio.load(html);
    
    // 1. Remove obvious boilerplate/non-content tags
    $('script, style, noscript, iframe, link, svg, video, audio, object, embed').remove();
    $('header, footer, nav, aside, [role="banner"], [role="navigation"], [role="contentinfo"]').remove();
    
    // Remove common sidebar, menu, ad and footer classes/ids
    $('.sidebar, #sidebar, .menu, #menu, .nav, #nav, .footer, #footer, .header, #header, .ads, .ad, #ads, .comments, #comments, .related, .share-buttons').remove();

    let bestContainer: Cheerio<AnyNode> | null = null;
    let maxScore = 0;

    // 2. Look for standard article container tags first
    const standardSelectors = [
      'article', 'main', '[role="main"]', '#content', '#main',
      '.post', '.article', '.entry-content', '.post-content', '.story-body', '.article-body', '.post-body'
    ];

    for (const selector of standardSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        for (let i = 0; i < el.length; i++) {
          const item = el[i];
          if (!item) continue;
          const textLength = $(item).text().trim().length;
          // Simple scoring: text length + weighting standard containers
          const score = textLength * 1.5;
          if (score > maxScore) {
            maxScore = score;
            bestContainer = $(item);
          }
        }
      }
    }

    // 3. If standard elements don't give a clear winner, use density scoring on divs
    if (maxScore < 200) {
      const divs = $('div, section');
      for (let i = 0; i < divs.length; i++) {
        const item = divs[i];
        if (!item) continue;
        const div = $(item);
        
        // Count paragraphs in this specific container
        const pCount = div.find('p').length;
        const text = div.clone().find('div, section').remove().end().text().trim();
        const textLength = text.length;

        // Density score formula
        const score = textLength + (pCount * 50);
        if (score > maxScore) {
          maxScore = score;
          bestContainer = div;
        }
      }
    }

    if (bestContainer && maxScore > 100) {
      // Extract clean text from the best container
      // Map paragraphs/headers to maintain some structural spacing
      const blocks: string[] = [];
      const subElements = bestContainer.find('p, h1, h2, h3, h4, li');
      for (let i = 0; i < subElements.length; i++) {
        const el = subElements[i];
        if (!el) continue;
        const txt = $(el).text().trim();
        if (txt) blocks.push(txt);
      }

      if (blocks.length > 0) {
        return blocks.join('\n\n');
      }
      return bestContainer.text().trim().replace(/\s+/g, ' ');
    }
  } catch (e) {
    log.warn(`Zero-Config extraction error: ${(e as Error).message}`);
  }

  // Fallback to stripHtml of raw body
  return stripHtml(html);
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── Diff generation ──────────────────────────────────────────────────────────


// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function extractMainArticleContentViaAi(html: string): Promise<string | null> {
  const provider = resolveEffectiveAiProvider();
  if (provider === 'unconfigured' || provider === 'off') {
    return null;
  }
  try {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, link, svg, video, audio, object, embed').remove();
    const bodyHtml = $('body').html() || html;
    const truncated = bodyHtml.slice(0, 10000);
    const prompt = 'أنت خبير في تحليل صفحات الويب واستخلاص الأخبار. اقرأ كود HTML التالي واستخلص نص الخبر أو المقال الإخباري الرئيسي فقط بدقة وبشكل كامل ونظيف. تجنب استخلاص أي روابط خارجية، إعلانات، لوائح تنقل، أو نصوص حقوق نشر. أعد نص الخبر فقط:';
    log.info('Triggering AI Semantic Extractor Fallback...');
    const result = await runAiChain(prompt, truncated);
    return result.trim() || null;
  } catch (e) {
    log.warn(`AI Semantic Extractor failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchPageText(config: WebsiteWatchConfig): Promise<string | null> {
  const { url, selector, forceBrowser } = config;
  try {
    const result = await fetchPageHtml(url, { forceBrowser: !!forceBrowser, selector, timeout: 20000 });
    if (!result.ok || !result.html) return null;
    const html = result.html;

    let text = selector ? extractSelectorText(html, selector) : extractMainArticleContent(html);

    // AI Fallback if heuristic returns empty/incomplete content from a non-empty page
    if (!selector && (!text || text.length < 150) && html.length > 1000) {
      const aiText = await extractMainArticleContentViaAi(html);
      if (aiText && aiText.length > 150) {
        log.info('AI Semantic Extractor successfully retrieved article content.');
        text = aiText;
      }
    }

    return text;
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

function getStoredBaselineText(monitorId: number): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT last_content_text FROM competitor_monitors WHERE id = ?`
    ).get(monitorId) as { last_content_text: string | null } | undefined;
    return row?.last_content_text ?? null;
  } catch {
    return null;
  }
}

function storeBaselineText(monitorId: number, text: string): void {
  try {
    getDb().prepare(
      `UPDATE competitor_monitors SET last_content_text = ? WHERE id = ?`
    ).run(text, monitorId);
  } catch (err) {
    log.warn(`Failed to store baseline text: ${(err as Error).message}`);
  }
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
    diff = `تم اكتشاف تغيير في الصفحة (hash: ${previousHash?.slice(0, 8)} → ${hash.slice(0, 8)})`;
    log.info(`Website change detected for monitor ${monitorId}: ${config.url}`);
  }

  storeHash(monitorId, hash);
  storeBaselineText(monitorId, currentText);

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
  storeBaselineText(monitorId, text);
  log.info(`Website baseline set for monitor ${monitorId}: ${hash.slice(0, 8)}`);
  return { ok: true, hash };
}

/** Full check with text diff — stores previous text snapshot in competitor_snapshots */
export async function checkWebsiteChangeWithDiff(
  monitorId: number,
  config: WebsiteWatchConfig
): Promise<ChangeCheckResult & { previousText?: string }> {
  const currentText = await fetchPageText(config);
  if (!currentText) throw new Error(`فشل جلب الصفحة: ${config.url}`);

  const hash = hashText(currentText);
  const previousHash = getStoredHash(monitorId);
  const previousText = getStoredBaselineText(monitorId);

  const changed = previousHash !== null && hash !== previousHash;
  let diff = '';

  if (changed && previousText) {
    diff = JSON.stringify({ oldText: previousText, newText: currentText });
  } else if (changed) {
    diff = JSON.stringify({ oldText: '', newText: currentText });
  }

  storeHash(monitorId, hash);
  storeBaselineText(monitorId, currentText);

  return {
    changed,
    hash,
    previousHash,
    diff,
    snippet: currentText.slice(0, 500),
    checkedAt: new Date().toISOString(),
  };
}
