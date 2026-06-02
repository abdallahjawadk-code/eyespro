import { getSetting } from '../services/settings';
import { shouldUseBrowser } from './stealth-config';
import { isTorActive, getTorSocksPort } from '../services/tor-manager';

export interface BrowserFetchResult {
  ok: boolean;
  body?: string;
  error?: string;
}

export async function browserFetch(urlStr: string, force = false, selector?: string): Promise<BrowserFetchResult> {
  const host = new URL(urlStr).hostname;
  if (!force && !shouldUseBrowser(host)) {
    return { ok: false, error: 'Domain not in stealth_browser_domains' };
  }
  if (force && getSetting('stealth_browser_enabled') !== '1') {
    return { ok: false, error: 'Enable stealth browser in settings' };
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch {
    return {
      ok: false,
      error: 'Install playwright-core and run: npx playwright install chromium'
    };
  }

  const timeout = Number(getSetting('stealth_browser_timeout_ms') || '45000') || 45000;
  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | undefined;
  try {
    const proxyConfig = isTorActive()
      ? { server: `socks5://127.0.0.1:${getTorSocksPort()}` }
      : undefined;

    browser = await playwright.chromium.launch({
      headless: true,
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions'
      ]
    });
    const context = await browser.newContext({
      locale: 'ar-SA',
      userAgent: getSetting('stealth_browser_ua') || undefined,
      permissions: []
    });
    const page = await context.newPage();
    await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout });
    const scrolls = Number(getSetting('stealth_browser_scrolls') || '2') || 2;
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 300));
      await page.waitForTimeout(800 + Math.random() * 1200);
    }
    
    let html = '';
    if (selector) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        html = await page.innerHTML(selector);
      } catch {
        html = await page.content();
      }
    } else {
      html = await page.content();
    }
    
    await context.close();
    return { ok: true, body: html };
  } catch (e) {
    return { ok: false, error: `Browser: ${(e as Error).message.slice(0, 300)}` };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import('playwright-core');
    return true;
  } catch {
    return false;
  }
}
