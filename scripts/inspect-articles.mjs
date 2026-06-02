// Real-environment inspection of the Articles & Content page + related routes.
// Launches the production build via Playwright Electron with the license bypass.
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(process.cwd(), 'out/main/index.cjs');
const SHOTS = path.resolve(process.cwd(), 'test-results/articles-inspect');
fs.mkdirSync(SHOTS, { recursive: true });

const consoleMsgs = [];
const pageErrors = [];
const log = (...a) => console.log(...a);

const app = await electron.launch({
  args: [ENTRY],
  env: { ...process.env, NODE_ENV: 'production', EYESPRO_BYPASS_LICENSE: '1', EYESPRO_TEST_MODE: '1' },
  timeout: 90_000,
});
log('[launch] launched');
app.process().stderr?.on('data', (d) => {
  const s = String(d);
  if (/No handler registered|second handler|Error occurred in handler|registerAdvanced/.test(s)) {
    process.stdout.write(`[main:err] ${s}`);
  }
});

const page = await app.firstWindow({ timeout: 60_000 });
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') consoleMsgs.push(`[${t}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);

// Grab a real article id (if any) for the editor route
const ids = await page.evaluate(async () => {
  try {
    const res = await window.eyespro.articles.list({ limit: 5 });
    const rows = res?.data?.rows || res?.data || res?.rows || [];
    return Array.isArray(rows) ? rows.map((r) => r.id).filter(Boolean) : [];
  } catch (e) { return { err: String(e) }; }
});
log('[data] article ids sample:', JSON.stringify(ids));
const existingId = Array.isArray(ids) && ids.length ? ids[0] : null;

const routes = [
  { name: 'articles-library', hash: '#/articles' },
  { name: 'article-editor-new', hash: '#/articles/new' },
];
if (existingId) routes.push({ name: 'article-editor-existing', hash: `#/articles/${existingId}` });

const results = [];
for (const r of routes) {
  const cBefore = consoleMsgs.length, eBefore = pageErrors.length;
  await page.evaluate((h) => { window.location.hash = h; }, r.hash);
  await page.waitForTimeout(2800);

  const info = await page.evaluate(() => {
    const root = document.querySelector('.app-frame') || document.body;
    const txt = root.innerText.trim();
    const errorBoundary = document.querySelectorAll('[data-testid="error-boundary"], .error-boundary').length > 0;
    return {
      url: location.hash,
      h1: document.querySelector('h1')?.textContent?.trim() || '(none)',
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tbody tr').length,
      filterChips: document.querySelectorAll('[class*="filter"], [class*="Filter"], [role="tab"]').length,
      cards: document.querySelectorAll('[class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"]').length,
      errorBoundary,
      excerpt: txt.slice(0, 260),
    };
  });
  const shot = path.join(SHOTS, `${r.name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  results.push({ ...r, info, newConsole: consoleMsgs.slice(cBefore), newErrors: pageErrors.slice(eBefore), shot });
}

log('\n================= ARTICLES INSPECTION REPORT =================\n');
for (const r of results) {
  log(`### ${r.name}  (${r.info.url})`);
  log(`   errorBoundary: ${r.info.errorBoundary} | h1: ${r.info.h1}`);
  log(`   buttons:${r.info.buttons} inputs:${r.info.inputs} tables:${r.info.tables} rows:${r.info.rows} filterChips:${r.info.filterChips} cards:${r.info.cards}`);
  log(`   pageErrors: ${r.newErrors.length ? '\n     - ' + r.newErrors.join('\n     - ') : 'none'}`);
  log(`   console(err/warn): ${r.newConsole.length ? '\n     - ' + r.newConsole.join('\n     - ') : 'none'}`);
  log(`   excerpt: ${JSON.stringify(r.info.excerpt)}`);
  log(`   shot: ${r.shot}\n`);
}
log('TOTAL console err/warn:', consoleMsgs.length, '| page errors:', pageErrors.length);
log('=============================================================\n');
await app.close();
