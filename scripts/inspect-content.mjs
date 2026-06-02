// Real-environment inspection of the Content domain (sources / templates / trends).
// Launches the production build via Playwright Electron with the license bypass,
// drives each tab, and reports console errors, page errors and DOM state.
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(process.cwd(), 'out/main/index.cjs');
const SHOTS = path.resolve(process.cwd(), 'test-results/content-inspect');
fs.mkdirSync(SHOTS, { recursive: true });

const consoleMsgs = [];
const pageErrors = [];

function log(...a) { console.log(...a); }

const app = await electron.launch({
  args: [ENTRY],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    EYESPRO_BYPASS_LICENSE: '1',
    EYESPRO_TEST_MODE: '1',
  },
  timeout: 90_000,
});
log('[launch] electron app launched, waiting for first window...');

app.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`));
app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`));

const page = await app.firstWindow({ timeout: 60_000 });
log('[launch] first window acquired');
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') consoleMsgs.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

const tabs = ['sources', 'templates', 'trends'];
const results = [];

for (const tab of tabs) {
  const before = consoleMsgs.length;
  const beforeErr = pageErrors.length;
  await page.evaluate((tb) => { window.location.hash = `#/content?tab=${tb}`; }, tab);
  await page.waitForTimeout(2500); // allow React Query fetch + render

  // Detect React error boundary
  const crashed = await page.evaluate(() =>
    !!document.body.innerText.match(/something went wrong|حدث خطأ|عذرًا|Error/i) &&
    document.querySelectorAll('[data-testid="error-boundary"], .error-boundary').length > 0
  );

  // Capture the active workspace heading + a text excerpt + interactive element counts
  const info = await page.evaluate(() => {
    const txt = (document.querySelector('main') || document.body).innerText.trim();
    return {
      url: location.hash,
      heading: document.querySelector('h1, h2')?.textContent?.trim() || '(none)',
      activeTab: document.querySelector('[aria-selected="true"], .tab.active, [data-active="true"]')?.textContent?.trim() || '(unknown)',
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tr').length,
      cards: document.querySelectorAll('[class*="card"], [class*="Card"]').length,
      excerpt: txt.slice(0, 400),
    };
  });

  const shot = path.join(SHOTS, `content-${tab}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  results.push({
    tab,
    crashed,
    newConsole: consoleMsgs.slice(before),
    newPageErrors: pageErrors.slice(beforeErr),
    info,
    shot,
  });
}

log('\n================= CONTENT INSPECTION REPORT =================\n');
for (const r of results) {
  log(`### TAB: ${r.tab}  (${r.info.url})`);
  log(`   crashed(errorBoundary): ${r.crashed}`);
  log(`   heading: ${r.info.heading} | activeTab: ${r.info.activeTab}`);
  log(`   buttons:${r.info.buttons} inputs:${r.info.inputs} tables:${r.info.tables} rows:${r.info.rows} cards:${r.info.cards}`);
  log(`   pageErrors: ${r.newPageErrors.length ? '\n     - ' + r.newPageErrors.join('\n     - ') : 'none'}`);
  log(`   console(err/warn): ${r.newConsole.length ? '\n     - ' + r.newConsole.join('\n     - ') : 'none'}`);
  log(`   excerpt: ${JSON.stringify(r.info.excerpt)}`);
  log(`   screenshot: ${r.shot}\n`);
}
log('All console err/warn total:', consoleMsgs.length, '| page errors total:', pageErrors.length);
log('============================================================\n');

await app.close();
