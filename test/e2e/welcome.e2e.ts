/**
 * E2E: Welcome / splash screen
 *
 * Requires: npm run build  (builds out/main/index.js)
 * Run:      npx playwright test --project=electron test/e2e/welcome.e2e.ts
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers/electron';
import type { AppFixture } from './helpers/electron';

let fixture: AppFixture;

test.beforeAll(async () => {
  fixture = await launchApp();
});

test.afterAll(async () => {
  await closeApp(fixture);
});

test('welcome screen loads and shows brand name', async () => {
  const { page } = fixture;
  // App title should be visible
  const title = page.locator('.wl-title, h1');
  await expect(title).toBeVisible({ timeout: 10_000 });
  const text = await title.textContent();
  expect(text).toMatch(/eyespro/i);
});

test('theme toggle button is present', async () => {
  const { page } = fixture;
  const themeBtn = page.locator('.wl-ctrl-btn').first();
  await expect(themeBtn).toBeVisible();
});

test('language toggle button switches label', async () => {
  const { page } = fixture;
  const langBtn = page.locator('.wl-ctrl-btn').nth(1);
  await expect(langBtn).toBeVisible();
  const initialText = await langBtn.textContent();
  await langBtn.click();
  const newText = await langBtn.textContent();
  expect(newText).not.toBe(initialText);
  // Toggle back
  await langBtn.click();
});

test('enter button navigates to dashboard', async () => {
  const { page } = fixture;
  const enterBtn = page.locator('.wl-cta-btn');
  await expect(enterBtn).toBeVisible();
  await enterBtn.click();
  // After click app should leave the welcome screen
  await page.waitForFunction(
    () => !document.querySelector('.wl-root') || document.querySelector('.wl-root.is-leaving') !== null,
    { timeout: 3_000 }
  );
});
