import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Electron E2E tests launch the app via the helper in test/e2e/helpers/electron.ts
    // No browser needed — tests drive Electron directly with playwright-core
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
});
