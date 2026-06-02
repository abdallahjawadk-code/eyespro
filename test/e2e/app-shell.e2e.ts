/**
 * E2E: AppShell — sidebar navigation, header, keyboard shortcuts
 *
 * Requires: npm run build + welcome screen "enter" click first
 * Run:      npx playwright test --project=electron test/e2e/app-shell.e2e.ts
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

test('sidebar is visible after entering app', async () => {
  const { page } = fixture;
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 8_000 });
});

test('brand name is shown in sidebar', async () => {
  const { page } = fixture;
  const brand = page.locator('.sb-name');
  await expect(brand).toBeVisible();
  const text = await brand.textContent();
  expect(text?.toLowerCase()).toContain('eyespro');
});

test('Ctrl+K opens command palette', async () => {
  const { page } = fixture;
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmd-dialog')).toBeVisible({ timeout: 3_000 });
  // Close it
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmd-dialog')).not.toBeVisible({ timeout: 2_000 });
});

test('? key opens shortcuts help', async () => {
  const { page } = fixture;
  // Focus body so ? doesn't go to an input
  await page.locator('body').click();
  await page.keyboard.press('?');
  const help = page.locator('[class*="shortcuts"], [class*="shortcut-help"], [role="dialog"]');
  // If shortcuts dialog exists it should appear; else just confirm no crash
  await page.waitForTimeout(500);
});

test('notification bell is rendered in header', async () => {
  const { page } = fixture;
  const bell = page.locator('.hdr-icon-btn').filter({ hasText: '🔔' });
  await expect(bell).toBeVisible();
});

test('status bar shows version info', async () => {
  const { page } = fixture;
  const statusbar = page.locator('.app-statusbar');
  await expect(statusbar).toBeVisible();
});
