// Real-environment inspection of the Newsroom / Autopilot page (#/autopilot).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(process.cwd(), 'out/main/index.cjs');
const SHOTS = path.resolve(process.cwd(), 'test-results/autopilot-inspect');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(...a);
const consoleMsgs = [];
const pageErrors = [];

const app = await electron.launch({
  args: [ENTRY],
  env: { ...process.env, NODE_ENV: 'production', EYESPRO_BYPASS_LICENSE: '1', EYESPRO_TEST_MODE: '1' },
  timeout: 90_000,
});
log('[launch] launched');
app.process().stderr?.on('data', (d) => {
  const s = String(d);
  if (/No handler registered|second handler|Error occurred in handler|SqliteError|registerAdvanced/.test(s)) {
    process.stdout.write(`[main:err] ${s}`);
  }
});

const page = await app.firstWindow({ timeout: 60_000 });
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') consoleMsgs.push(`[${t}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);

// Read-only IPC probes (do NOT call autopilot.run — it triggers a real pipeline)
const ipc = await page.evaluate(async () => {
  const e = window.eyespro; const out = {};
  try { out.status = await e.autopilot.status(); } catch (x) { out.statusErr = String(x); }
  try { out.config = await e.autopilot.config(); } catch (x) { out.configErr = String(x); }
  try { out.runs = await e.autopilot.runs(10); } catch (x) { out.runsErr = String(x); }
  return out;
}).catch((x) => ({ evalErr: String(x) }));

// Navigate to the page and let it render
const cBefore = consoleMsgs.length, eBefore = pageErrors.length;
await page.evaluate(() => { window.location.hash = '#/autopilot'; });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const root = document.querySelector('.app-frame') || document.body;
  return {
    url: location.hash,
    h1: document.querySelector('h1')?.textContent?.trim() || '(none)',
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input, textarea, select').length,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tbody tr').length,
    errorBoundary: document.querySelectorAll('[data-testid="error-boundary"], .error-boundary').length > 0,
    excerpt: root.innerText.trim().slice(0, 320),
  };
});
await page.screenshot({ path: path.join(SHOTS, 'autopilot.png'), fullPage: true });

log('\n================= AUTOPILOT / NEWSROOM INSPECTION =================\n');
log('IPC status:', JSON.stringify(ipc.status ?? ipc.statusErr));
log('IPC config:', JSON.stringify(ipc.config ?? ipc.configErr)?.slice(0, 300));
log('IPC runs:', JSON.stringify(ipc.runs ?? ipc.runsErr)?.slice(0, 200));
log('');
log(`url: ${info.url} | h1: ${info.h1} | errorBoundary: ${info.errorBoundary}`);
log(`buttons:${info.buttons} inputs:${info.inputs} tables:${info.tables} rows:${info.rows}`);
log('excerpt:', JSON.stringify(info.excerpt));
log('');
log('console(err/warn) during render:', JSON.stringify(consoleMsgs.slice(cBefore), null, 0));
log('pageErrors during render:', JSON.stringify(pageErrors.slice(eBefore)));
log('TOTAL console err/warn:', consoleMsgs.length, '| page errors:', pageErrors.length);
log('==================================================================\n');
await app.close();
