/**
 * E2E: Content & Sources Page — Tab switches and panels
 *
 * Requires: npm run build
 * Run:      npx playwright test --project=electron test/e2e/content-hub.e2e.ts
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers/electron';
import type { AppFixture } from './helpers/electron';

let fixture: AppFixture;

test.beforeAll(async () => {
  fixture = await launchApp();
  // Navigate past the welcome screen
  const enterBtn = fixture.page.locator('.wl-cta-btn');
  if (await enterBtn.isVisible({ timeout: 5_000 })) {
    await enterBtn.click();
    await fixture.page.waitForSelector('.shell', { timeout: 8_000 });
  }
});

test.afterAll(async () => {
  await closeApp(fixture);
});

test('can navigate to Content & Sources page', async () => {
  const { page } = fixture;
  const contentLink = page.locator('a[href="#/content"]');
  await expect(contentLink).toBeVisible();
  await contentLink.click();
  // Wait for the main panel to load
  await page.waitForSelector('.sd-panel', { timeout: 8_000 });
  const title = page.locator('.sd-hdr-title');
  await expect(title).toBeVisible();
});

test('can switch between all five discovery tabs', async () => {
  const { page } = fixture;

  // The modes navigation tab buttons
  const modeTabs = page.locator('.sd-modes button[role="tab"]');
  await expect(modeTabs).toHaveCount(5);

  // 1. Topic search tab (active by default)
  await expect(modeTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  const searchInput = page.locator('.sd-toolbar input');
  await expect(searchInput).toBeVisible();

  // 2. URL detection tab
  await modeTabs.nth(1).click();
  await expect(modeTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const urlInput = page.locator('.sd-toolbar input');
  await expect(urlInput).toBeVisible();

  // 3. Catalog tab
  await modeTabs.nth(2).click();
  await expect(modeTabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  const catalogGrid = page.locator('.sd-catalog-grid');
  await expect(catalogGrid).toBeVisible();

  // 4. Import tab
  await modeTabs.nth(3).click();
  await expect(modeTabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  const bulkTextarea = page.locator('.sd-bulk textarea');
  await expect(bulkTextarea).toBeVisible();

  // 5. Community suggestion tab
  await modeTabs.nth(4).click();
  await expect(modeTabs.nth(4)).toHaveAttribute('aria-selected', 'true');
  const suggestNameInput = page.locator('.sd-community input').first();
  await expect(suggestNameInput).toBeVisible();

  // Switch back to Topic search tab
  await modeTabs.nth(0).click();
  await expect(modeTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
});
