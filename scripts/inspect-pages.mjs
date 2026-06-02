// Generic real-environment sweep of multiple renderer routes/tabs in one launch.
// Captures per-route renderer console errors/warnings, page errors, error-boundary,
// and main-process IPC errors (No handler / SqliteError / handler throw).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(process.cwd(), 'out/main/index.cjs');
const SHOTS = path.resolve(process.cwd(), 'test-results/pages-inspect');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(...a);

const ROUTES = [
  { name: 'dashboard',          hash: '#/dashboard' },
  { name: 'insights-analytics', hash: '#/insights?tab=analytics' },
  { name: 'insights-quality',   hash: '#/insights?tab=quality' },
  { name: 'insights-reports',   hash: '#/insights?tab=reports' },
  { name: 'insights-health',    hash: '#/insights?tab=health' },
  { name: 'insights-tracker',   hash: '#/insights?tab=tracker' },
  { name: 'insights-links',     hash: '#/insights?tab=links' },
  { name: 'insights-keywords',  hash: '#/insights?tab=keywords' },
  { name: 'monitor',            hash: '#/monitor' },
  { name: 'social-video',       hash: '#/social-video' },
  { name: 'system-monitor',     hash: '#/system?tab=monitor' },
  { name: 'system-audit',       hash: '#/system?tab=audit' },
  { name: 'settings',           hash: '#/settings' },
];

let currentRoute = 'startup';
const mainErrors = []; // {route, text}

const app = await electron.launch({
  args: [ENTRY],
  env: { ...process.env, NODE_ENV: 'production', EYESPRO_BYPASS_LICENSE: '1', EYESPRO_TEST_MODE: '1' },
  timeout: 90_000,
});
app.process().stderr?.on('data', (d) => {
  const s = String(d);
  if (/No handler registered|second handler|Error occurred in handler|SqliteError|registerAdvanced|TypeError|ReferenceError/.test(s)) {
    mainErrors.push({ route: currentRoute, text: s.trim().split('\n').slice(0, 3).join(' | ') });
  }
});

const page = await app.firstWindow({ timeout: 60_000 });
const consoleByRoute = {};
const pageErrByRoute = {};
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') {
    const txt = m.text();
    // ignore the dev-only CSP security warning (disappears when packaged)
    if (/Insecure Content-Security-Policy|unsafe-eval/.test(txt)) return;
    (consoleByRoute[currentRoute] ??= []).push(`[${t}] ${txt.slice(0, 220)}`);
  }
});
page.on('pageerror', (e) => { (pageErrByRoute[currentRoute] ??= []).push(`${e.name}: ${e.message}`); });

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);

const results = [];
for (const r of ROUTES) {
  currentRoute = r.name;
  await page.evaluate((h) => { window.location.hash = h; }, r.hash);
  await page.waitForTimeout(2600);
  const info = await page.evaluate(() => {
    const root = document.querySelector('.app-frame') || document.body;
    return {
      url: location.hash,
      errorBoundary: document.querySelectorAll('[data-testid="error-boundary"], .error-boundary').length > 0,
      activeTab: document.querySelector('[aria-selected="true"], .tab.active, [data-active="true"]')?.textContent?.trim() || '',
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      tables: document.querySelectorAll('table').length,
      blank: root.innerText.trim().length < 40,
      excerpt: root.innerText.replace(/\s+/g, ' ').trim().slice(0, 140),
    };
  });
  await page.screenshot({ path: path.join(SHOTS, `${r.name}.png`), fullPage: true });
  results.push({ ...r, info });
}

log('\n================= PAGES SWEEP REPORT =================\n');
for (const r of results) {
  const c = consoleByRoute[r.name] || [];
  const pe = pageErrByRoute[r.name] || [];
  const me = mainErrors.filter((m) => m.route === r.name);
  const flag = (r.info.errorBoundary || r.info.blank || c.length || pe.length || me.length) ? '⚠️ ' : '✅ ';
  log(`${flag}${r.name}  (${r.info.url})`);
  log(`    errBoundary:${r.info.errorBoundary} blank:${r.info.blank} | btn:${r.info.buttons} in:${r.info.inputs} tbl:${r.info.tables}`);
  if (me.length) me.forEach((m) => log(`    [MAIN] ${m.text}`));
  if (pe.length) pe.forEach((m) => log(`    [PAGEERR] ${m}`));
  if (c.length) c.forEach((m) => log(`    [CONSOLE] ${m}`));
  log(`    excerpt: ${r.info.excerpt}`);
}
log('\nstartup main errors:', JSON.stringify(mainErrors.filter((m) => m.route === 'startup')));
log('=====================================================\n');
await app.close();
