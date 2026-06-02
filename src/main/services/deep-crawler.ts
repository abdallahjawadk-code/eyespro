import { getDb } from '../db/database';
import { fetchUrlGuarded } from '../net/guarded-fetch';
import * as cheerio from 'cheerio';
import { createLogger } from '../logger';

const log = createLogger('deep-crawler');

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
}

export interface CrawlResult {
  monitorId: number;
  pagesCrawled: number;
  snapshotsCreated: number;
  error?: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively crawl a website starting from a base URL, tracking links,
 * extracting article snippets, and inserting them as competitor snapshots.
 */
export async function crawlWebsite(
  monitorId: number,
  startUrl: string,
  opts: CrawlOptions = {}
): Promise<CrawlResult> {
  const db = getDb();
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 30;

  log.info(`Initializing deep crawl for Monitor #${monitorId} at ${startUrl} (max depth: ${maxDepth}, max pages: ${maxPages})`);

  // Clear previous session visited cache for this monitor to ensure fresh scans
  try {
    db.prepare('DELETE FROM crawler_visited_urls WHERE monitor_id = ?').run(monitorId);
  } catch (err) {
    log.error('Failed to clear crawler visited cache:', { error: (err as Error).message });
  }

  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  let pagesCrawled = 0;
  let snapshotsCreated = 0;

  let host = '';
  try {
    host = new URL(startUrl).hostname.toLowerCase();
  } catch {
    return { monitorId, pagesCrawled: 0, snapshotsCreated: 0, error: 'رابط البدء غير صالح' };
  }

  while (queue.length > 0 && pagesCrawled < maxPages) {
    const current = queue.shift();
    if (!current) break;

    const { url, depth } = current;

    // Check if already visited in SQLite
    const isVisited = db
      .prepare('SELECT 1 FROM crawler_visited_urls WHERE monitor_id = ? AND url = ?')
      .get(monitorId, url);
    if (isVisited) {
      continue;
    }

    // Insert into visited URLs database
    try {
      db.prepare('INSERT OR IGNORE INTO crawler_visited_urls (monitor_id, url) VALUES (?, ?)').run(monitorId, url);
    } catch (err) {
      log.error(`Failed logging visited URL: ${url}`, { error: (err as Error).message });
    }

    log.info(`Crawler fetching URL [${pagesCrawled + 1}/${maxPages}]: ${url} (depth: ${depth})`);

    // Fetch page HTML
    try {
      const res = await fetchUrlGuarded(url, { timeout: 15000 });

      pagesCrawled++;

      if (!res.ok) {
        log.warn(`Crawler failed fetching ${url}: HTTP ${res.status}`);
        continue;
      }

      const contentType = (res.headers?.['content-type'] ?? '').toString().toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        log.info(`Skipping non-HTML page ${url} with Content-Type: ${contentType}`);
        continue;
      }

      // Load into Cheerio for parsing
      const $ = cheerio.load(res.body);

      // Extract metadata
      const title = $('title').text().trim() || $('h1').text().trim() || 'صفحة فرعية';

      // Clean non-content HTML nodes
      $('script, style, iframe, nav, footer, header, noscript, svg, form').remove();

      // Extract body text
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const snippet = bodyText.slice(0, 300) + (bodyText.length > 300 ? '...' : '');

      // Register new competitor snapshots for child pages
      if (url !== startUrl && title.length > 5 && bodyText.length > 150) {
        const existing = db
          .prepare('SELECT id FROM competitor_snapshots WHERE monitor_id = ? AND link = ?')
          .get(monitorId, url);

        if (!existing) {
          db.prepare(`
            INSERT INTO competitor_snapshots (monitor_id, title, link, summary, seen_at, is_read)
            VALUES (?, ?, ?, ?, datetime('now'), 0)
          `).run(monitorId, title, url, snippet);
          snapshotsCreated++;
        }
      }

      // Enqueue discovered child links if under depth limit
      if (depth < maxDepth) {
        $('a[href]').each((_, el) => {
          try {
            const href = $(el).attr('href');
            if (!href) return;

            // Resolve relative URLs
            const resolvedUrl = new URL(href, url).toString();
            const uObj = new URL(resolvedUrl);

            // Restrict to same hostname/domain to prevent external spidering
            if (uObj.hostname.toLowerCase() === host) {
              uObj.hash = ''; // strip hash fragments
              // Remove tracking parameters
              uObj.searchParams.delete('utm_source');
              uObj.searchParams.delete('utm_medium');
              uObj.searchParams.delete('utm_campaign');

              const cleanUrl = uObj.toString();

              // Verify URL is not already logged in queue or database
              const alreadyVisited = db
                .prepare('SELECT 1 FROM crawler_visited_urls WHERE monitor_id = ? AND url = ?')
                .get(monitorId, cleanUrl);

              if (!alreadyVisited && !queue.some((q) => q.url === cleanUrl)) {
                queue.push({ url: cleanUrl, depth: depth + 1 });
              }
            }
          } catch {}
        });
      }
    } catch (err) {
      log.error(`Error processing crawl url ${url}:`, { error: (err as Error).message });
    }

    // Polite rate-limiting sleep (500ms - 1500ms)
    await delay(500 + Math.random() * 1000);
  }

  log.info(`Deep crawl session finished. Crawled ${pagesCrawled} pages, discovered ${snapshotsCreated} new snapshots.`);
  return { monitorId, pagesCrawled, snapshotsCreated };
}
