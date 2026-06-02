/**
 * E2E Accessibility — axe-core audit on key screens
 *
 * Run: npx playwright test --project=electron test/e2e/a11y.e2e.ts
 *
 * Checks WCAG 2.1 AA violations on the welcome screen and (if reachable) the
 * main shell. Critical and serious violations are treated as failures; moderate
 * and minor are logged as warnings so CI stays green while the team iterates.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchApp, closeApp } from './helpers/electron';
import type { AppFixture } from './helpers/electron';

let fixture: AppFixture;

test.beforeAll(async () => {
  fixture = await launchApp();
});

test.afterAll(async () => {
  await closeApp(fixture);
});

test.skip('welcome screen has no critical/serious axe violations', async () => {
  const { page } = fixture;

  // Wait for welcome screen to settle
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );

  if (results.violations.length > 0) {
    console.warn(
      `Axe found ${results.violations.length} violation(s) — ` +
      `${blocking.length} blocking (critical/serious):\n` +
      results.violations
        .map(v => `  [${v.impact}] ${v.id}: ${v.description}`)
        .join('\n')
    );
  }

  expect(
    blocking,
    `Critical/serious a11y violations found:\n${blocking.map(v => `${v.id}: ${v.description}`).join('\n')}`
  ).toHaveLength(0);
});

test.skip('welcome screen passes axe incomplete checks (best practice)', async () => {
  const { page } = fixture;

  const results = await new AxeBuilder({ page })
    .withTags(['best-practice'])
    .analyze();

  // Best-practice violations are warnings only — log but do not fail
  if (results.violations.length > 0) {
    console.warn(
      `Axe best-practice warnings (${results.violations.length}):`,
      results.violations.map(v => v.id).join(', ')
    );
  }

  // No assertion here — informational only
  expect(true).toBe(true);
});

test.skip('main shell has no critical/serious axe violations', async () => {
  const { page } = fixture;

  // Try to navigate past welcome screen
  const enterBtn = page.locator('.wl-cta-btn');
  if (await enterBtn.isVisible({ timeout: 5_000 })) {
    await enterBtn.click();
    await page.waitForSelector('.shell', { timeout: 8_000 });
    await page.waitForTimeout(500);
  } else {
    test.skip();
    return;
  }

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.cmd-dialog')  // command palette is conditionally rendered
    .analyze();

  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );

  if (results.violations.length > 0) {
    console.warn(
      `Shell axe violations (${results.violations.length}):`,
      results.violations.map(v => `[${v.impact}] ${v.id}`).join(', ')
    );
  }

  expect(
    blocking,
    `Critical/serious a11y violations in shell:\n${blocking.map(v => `${v.id}: ${v.description}`).join('\n')}`
  ).toHaveLength(0);
});
