/**
 * Electron launch helper for E2E tests.
 *
 * Usage:
 *   const { app, page } = await launchApp();
 *   // ... test ...
 *   await closeApp(fixture);
 *
 * Requires a production build (`npm run build`) before running.
 * In CI, run: npm run build && npx playwright test --project=electron
 */
import { _electron as electron } from 'playwright-core';
import type { ElectronApplication, Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
}

const ENTRY_POINT = path.resolve(process.cwd(), 'out/main/index.cjs');

/** Throws a clear error if the build artifact is missing, rather than a cryptic Electron crash. */
function assertBuildExists(): void {
  if (!fs.existsSync(ENTRY_POINT)) {
    throw new Error(
      `E2E smoke check failed: build artifact not found at ${ENTRY_POINT}\n` +
      `Run "npm run build" before executing E2E tests.`
    );
  }
}

export async function launchApp(): Promise<AppFixture> {
  assertBuildExists();

  const app = await electron.launch({
    args: [ENTRY_POINT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      EYESPRO_TEST_MODE: '1',
    },
    timeout: 15_000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Give the React tree a moment to mount before tests run assertions
  await page.waitForTimeout(300);

  return { app, page };
}

export async function closeApp(fixture: AppFixture | null | undefined): Promise<void> {
  if (!fixture) return;
  try {
    await fixture.app.close();
  } catch {
    // App may have already exited — ignore
  }
}
