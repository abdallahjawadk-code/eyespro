/**
 * E2E: Full navigation audit — every sidebar route, workspace tab, and legacy redirect.
 *
 * Run: npm run build && npx playwright test --project=electron test/e2e/navigation-full.e2e.ts
 */
import { test, expect } from '@playwright/test';
import type { Page } from 'playwright-core';
import { launchApp, closeApp } from './helpers/electron';
import type { AppFixture } from './helpers/electron';

let fixture: AppFixture;

async function enterApp(page: Page): Promise<void> {
  const enterBtn = page.locator('.wl-cta-btn');
  if (await enterBtn.isVisible({ timeout: 8_000 })) {
    await enterBtn.click();
    await page.waitForSelector('.shell', { timeout: 12_000 });
  }
}

async function collectConsoleErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eConsoleErrors?: string[] };
    return w.__e2eConsoleErrors ?? [];
  });
}

test.beforeAll(async () => {
  fixture = await launchApp();
  const { page } = fixture;

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      void page.evaluate((text) => {
        const w = window as unknown as { __e2eConsoleErrors?: string[] };
        w.__e2eConsoleErrors = w.__e2eConsoleErrors ?? [];
        w.__e2eConsoleErrors.push(text);
      }, msg.text());
    }
  });

  page.on('pageerror', (err) => {
    void page.evaluate((text) => {
      const w = window as unknown as { __e2eConsoleErrors?: string[] };
      w.__e2eConsoleErrors = w.__e2eConsoleErrors ?? [];
      w.__e2eConsoleErrors.push(`PAGEERROR: ${text}`);
    }, err.message);
  });

  await enterApp(page);
});

test.afterAll(async () => {
  await closeApp(fixture);
});

const MAIN_ROUTES = [
  { hash: '/dashboard', label: 'Dashboard' },
  { hash: '/content', label: 'Content Hub' },
  { hash: '/articles', label: 'Articles' },
  { hash: '/articles/new', label: 'New Article Editor' },
  { hash: '/autopilot', label: 'Autopilot' },
  { hash: '/insights', label: 'Insights Hub' },
  { hash: '/monitor', label: 'Monitor' },
  { hash: '/social-video', label: 'Social Video' },
  { hash: '/system', label: 'System' },
  { hash: '/settings', label: 'Settings' },
];

const CONTENT_TABS = ['sources', 'templates', 'trends'] as const;
const INSIGHTS_TABS = ['analytics', 'quality', 'reports', 'health', 'tracker', 'links', 'keywords'] as const;
const SYSTEM_TABS = ['monitor', 'audit'] as const;
const SETTINGS_TABS = ['general', 'ai', 'about'] as const;

const LEGACY_REDIRECTS = [
  '/sources',
  '/templates',
  '/trends',
  '/analytics',
  '/quality',
  '/reports',
  '/link-scan',
  '/keywords',
  '/health',
  '/publish-tracker',
  '/editorial',
  '/pipeline',
];

for (const route of MAIN_ROUTES) {
  test(`route loads without crash: ${route.label} (${route.hash})`, async () => {
    const { page } = fixture;
    await page.evaluate((h) => { window.location.hash = h; }, route.hash);
    await page.waitForTimeout(900);

    await expect(page.locator('.shell')).toBeVisible({ timeout: 12_000 });

    const content = page.locator(
      '.ep-hero h1, .articles-full-page__title, .ed-root, .ep-panel, .page-content, .autopilot-hero, .autopilot-title',
    );
    await expect(content.first()).toBeVisible({ timeout: 15_000 });

    const errors = await collectConsoleErrors(page);
    const blocking = errors.filter(
      (e) =>
        !e.includes('DevTools') &&
        !e.includes('favicon') &&
        !e.includes('ResizeObserver') &&
        !e.includes('net::ERR'),
    );
    expect(blocking, `Console errors on ${route.label}:\n${blocking.join('\n')}`).toHaveLength(0);
  });
}

for (const tab of CONTENT_TABS) {
  test(`Content Hub tab: ${tab}`, async () => {
    const { page } = fixture;
    await page.evaluate((t) => { window.location.hash = `/content?tab=${t}`; }, tab);
    await page.waitForTimeout(700);

    await expect(page.locator('.ep-panel')).toBeVisible({ timeout: 10_000 });

    const activeTab = page.locator('.ep-tabs button[role="tab"].is-active, .ep-tabs button[aria-selected="true"]');
    await expect(activeTab).toBeVisible();
  });
}

for (const tab of INSIGHTS_TABS) {
  test(`Insights tab: ${tab}`, async () => {
    const { page } = fixture;
    await page.evaluate((t) => { window.location.hash = `/insights?tab=${t}`; }, tab);
    await page.waitForTimeout(700);

    await expect(page.locator('.ep-panel')).toBeVisible({ timeout: 10_000 });
    const activeTab = page.locator('.ep-tab-groups button.is-active, .ep-tab-groups button[aria-selected="true"]');
    await expect(activeTab).toBeVisible();
  });
}

for (const tab of SYSTEM_TABS) {
  test(`System tab: ${tab}`, async () => {
    const { page } = fixture;
    await page.evaluate((t) => { window.location.hash = `/system?tab=${t}`; }, tab);
    await page.waitForTimeout(700);

    await expect(page.locator('.ep-panel')).toBeVisible({ timeout: 10_000 });
  });
}

for (const tab of SETTINGS_TABS) {
  test(`Settings tab: ${tab}`, async () => {
    const { page } = fixture;
    await page.evaluate(() => { window.location.hash = '/settings'; });
    await page.waitForTimeout(600);

    const navBtn = page.locator('.ui-settings-nav-btn').nth(
      tab === 'general' ? 0 : tab === 'ai' ? 1 : 2,
    );
    await navBtn.click();
    await page.waitForTimeout(400);

    await expect(page.locator('.ui-settings-main')).toBeVisible();
    await expect(navBtn).toHaveClass(/is-active/);
  });
}

test('Social Video tabs: download and library', async () => {
  const { page } = fixture;
  await page.evaluate(() => { window.location.hash = '/social-video'; });
  await page.waitForTimeout(800);

  const toolbar = page.locator('.ep-panel .ui-toolbar, .ep-panel .Toolbar');
  await expect(page.locator('.ep-panel')).toBeVisible({ timeout: 10_000 });

  const tabBtns = page.locator('.ep-panel button').filter({ hasText: /download|library|تنزيل|مكتبة/i });
  const count = await tabBtns.count();
  expect(count).toBeGreaterThanOrEqual(2);

  for (let i = 0; i < Math.min(count, 2); i++) {
    await tabBtns.nth(i).click();
    await page.waitForTimeout(400);
    await expect(page.locator('.ep-panel')).toBeVisible();
  }
});

for (const legacy of LEGACY_REDIRECTS) {
  test(`legacy redirect resolves: ${legacy}`, async () => {
    const { page } = fixture;
    await page.evaluate((h) => { window.location.hash = h; }, legacy);
    await page.waitForTimeout(800);

    await expect(page.locator('.shell')).toBeVisible({ timeout: 10_000 });

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).not.toBe(`#${legacy}`);
    expect(hash.length).toBeGreaterThan(1);
  });
}

test('sidebar nav links all reachable (excludes welcome)', async () => {
  const { page } = fixture;
  const links = page.locator('.sidebar nav a[href^="#/"]');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(8);

  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute('href');
    expect(href).not.toBe('#/');
    await links.nth(i).click();
    await page.waitForTimeout(700);
    await expect(page.locator('.shell')).toBeVisible({ timeout: 10_000 });
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe(href ?? '');
  }
});
