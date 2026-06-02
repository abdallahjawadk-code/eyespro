/**
 * E2E runtime smoke — institutionalizes the deterministic parts of the manual
 * runtime probes (scripts/probe-*.mjs) as a CI gate. Catches the bug classes found
 * this session: missing IPC handlers, SqliteError column mismatches (v50/v51), and
 * broken/blank screens — none of which the unit suite detects.
 *
 * Network-dependent checks (Tor download, live RSS, proxy pool) are intentionally
 * excluded: they belong in manual probes, not a deterministic CI gate.
 *
 * Requires: npm run build. Runs under --project=electron with the license bypassed.
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers/electron';
import type { AppFixture } from './helpers/electron';

let fixture: AppFixture;

test.beforeAll(async () => {
  fixture = await launchApp({ bypassLicense: true });
});
test.afterAll(async () => {
  await closeApp(fixture);
});

/** Run an IPC call in the renderer and return { ok } (or an error marker). */
async function ipc(method: string, ...args: unknown[]): Promise<{ ok: boolean | null; err?: string }> {
  return fixture.page.evaluate(
    async ({ method, args }) => {
      const path = method.split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fn: any = (window as any).eyespro;
      for (const p of path) fn = fn?.[p];
      if (typeof fn !== 'function') return { ok: null, err: `no method ${method}` };
      try {
        const r = await fn(...args);
        return { ok: r && typeof r === 'object' && 'ok' in r ? r.ok : (Array.isArray(r) ? true : null) };
      } catch (e) { return { ok: false, err: String(e).slice(0, 160) }; }
    },
    { method, args },
  );
}

// ── Read-path IPC: every screen's data source must resolve ok (no throw / no SqliteError) ──
const READ_CHANNELS = [
  'dashboard.stats', 'articles.list', 'sources.list', 'publish.platforms',
  'social.platforms', 'analytics.dashboard', 'analytics.alerts', 'settings.getAll',
  'system.perf', 'pipeline.kanban', 'pipeline.config', 'permissions.list', // ← v51 regression guard
  'keywords.list', 'trendRadar.list', 'monitor.list', 'media.list', 'ai.status', 'tasks.list',
];

for (const ch of READ_CHANNELS) {
  test(`read IPC ok: ${ch}`, async () => {
    const r = await ipc(ch, ch === 'articles.list' ? {} : undefined);
    expect(r.ok, `${ch} → ${r.err ?? r.ok}`).not.toBe(false);
    expect(r.ok, `${ch} returned no handler`).not.toBe(null);
  });
}

// ── Write round-trips: create → verify → delete (state restored) ──
test('article CRUD round-trip', async () => {
  const res = await fixture.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).eyespro;
    const c = await e.articles.create({ title: '__SMOKE__', content: 'body', summary: 's' });
    const id = c?.ok ? c.data?.id : null;
    if (!id) return { ok: false };
    const g = await e.articles.get(id);
    const d = await e.articles.delete(id);
    return { ok: !!c.ok && !!g.ok && !!d.ok };
  });
  expect(res.ok).toBe(true);
});

test('keyword CRUD round-trip (guards migration v50)', async () => {
  const res = await fixture.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).eyespro;
    const c = await e.keywords.create('__smoke_kw__');         // threw "no column enabled" before v50
    const list = await e.keywords.list();
    const row = c?.ok && Array.isArray(list?.data) ? list.data.find((k: { keyword: string }) => k.keyword === '__smoke_kw__') : null;
    if (row) await e.keywords.delete(row.id);
    return { ok: !!c?.ok && !!row };
  });
  expect(res.ok).toBe(true);
});

test('source CRUD round-trip', async () => {
  const res = await fixture.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).eyespro;
    const c = await e.sources.create({ name: '__SMOKE_SRC__', url: 'https://example.com/feed.xml', source_type: 'rss', skipDetect: true });
    const id = c?.ok ? c.data?.id : null;
    if (id) await e.sources.delete(id);
    return { ok: !!c?.ok && !!id };
  });
  expect(res.ok).toBe(true);
});

// ── Route sweep: no error boundary, no blank screen ──
const ROUTES = [
  '#/dashboard', '#/content?tab=sources', '#/articles', '#/autopilot',
  '#/insights?tab=analytics', '#/insights?tab=keywords', '#/system?tab=monitor', '#/settings',
];
for (const hash of ROUTES) {
  test(`route renders: ${hash}`, async () => {
    const { page } = fixture;
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const root = document.querySelector('.app-frame') || document.body;
      return {
        errorBoundary: document.querySelectorAll('[data-testid="error-boundary"], .error-boundary').length,
        len: (root as HTMLElement).innerText.trim().length,
      };
    });
    expect(info.errorBoundary, `${hash} hit an error boundary`).toBe(0);
    expect(info.len, `${hash} rendered blank`).toBeGreaterThan(40);
  });
}
