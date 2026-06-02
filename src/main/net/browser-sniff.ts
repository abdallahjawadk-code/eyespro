/**
 * Playwright network interception — discover JSON article APIs (modern SPAs).
 */
import { getSetting } from '../services/settings';

export interface SniffedJsonFeed {
  url: string;
  itemCount: number;
}

function looksLikeArticleList(data: unknown): { ok: boolean; count: number } {
  if (!data) return { ok: false, count: 0 };
  let arr: unknown[] | null = null;
  if (Array.isArray(data)) arr = data;
  else if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    const nested = o.items ?? o.data ?? o.posts ?? o.articles ?? o.results ?? o.entries;
    if (Array.isArray(nested)) arr = nested;
  }
  if (!arr || arr.length === 0) return { ok: false, count: 0 };
  const first = arr[0] as Record<string, unknown>;
  const hasTitle = !!(first.title ?? first.name ?? first.headline ?? first.rendered_title);
  const hasLink = !!(first.url ?? first.link ?? first.permalink ?? first.slug ?? first.id);
  if (!hasTitle || !hasLink) return { ok: false, count: 0 };
  return { ok: true, count: arr.length };
}

export async function browserSniffJsonFeeds(pageUrl: string): Promise<SniffedJsonFeed[]> {
  if (getSetting('stealth_browser_enabled') !== '1') return [];

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch {
    return [];
  }

  const timeout = Math.min(Number(getSetting('stealth_browser_timeout_ms') || '45000') || 45000, 35000);
  const found = new Map<string, number>();
  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | undefined;

  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    const context = await browser.newContext({ locale: 'ar-SA' });
    const page = await context.newPage();

    page.on('response', (response) => {
      void (async () => {
        try {
          const ct = (response.headers()['content-type'] ?? '').toLowerCase();
          if (!ct.includes('json')) return;
          const u = response.url();
          if (!u.startsWith('http')) return;
          if (u.includes('analytics') || u.includes('google') || u.includes('facebook')) return;
          const status = response.status();
          if (status < 200 || status >= 400) return;
          const body = await response.text();
          if (body.length < 80 || body.length > 800_000) return;
          const data = JSON.parse(body) as unknown;
          const check = looksLikeArticleList(data);
          if (check.ok) {
            const prev = found.get(u) ?? 0;
            if (check.count > prev) found.set(u, check.count);
          }
        } catch { /* ignore */ }
      })();
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout }).catch(async () => {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });
    });
    await page.waitForTimeout(1500);
    await context.close();
  } catch {
    /* ignore */
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }

  return [...found.entries()]
    .map(([url, itemCount]) => ({ url, itemCount }))
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, 8);
}
