// Cleanup: remove any data that live feature-probe network calls may have ingested
// (test sources/monitors/trend-sources were already deleted; this clears ingested rows).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';

const app = await electron.launch({
  args: [path.resolve('out/main/index.cjs')],
  env: { ...process.env, NODE_ENV: 'production', EYESPRO_BYPASS_LICENSE: '1', EYESPRO_TEST_MODE: '1' },
  timeout: 90_000,
});
const page = await app.firstWindow({ timeout: 60_000 });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);

const report = await page.evaluate(async () => {
  const e = window.eyespro;
  const TAG = '__RT_FEATURE__';
  const okOf = (r) => (r && typeof r === 'object' && 'ok' in r ? r.ok : null);
  const log = {};

  // Articles ingested by the test source (article.source === source name === TAG)
  const list = await e.articles.list({ limit: 1000 });
  const arts = okOf(list) && Array.isArray(list.data) ? list.data
    : (okOf(list) && Array.isArray(list.data?.items) ? list.data.items : []);
  const testArts = arts.filter((a) => a.source === TAG);
  let deleted = 0;
  for (const a of testArts) { if (okOf(await e.articles.delete(a.id))) deleted++; }
  log.articlesDeleted = `${deleted}/${testArts.length}`;

  // Residual test-tagged sources / monitors / trend-sources (should already be 0)
  const srcs = await e.sources.list();
  log.residualSources = (okOf(srcs) && Array.isArray(srcs.data)) ? srcs.data.filter((s) => s.name === TAG).length : '?';
  const mons = await e.monitor.list();
  log.residualMonitors = (okOf(mons) && Array.isArray(mons.data)) ? mons.data.filter((m) => m.name === TAG).length : '?';
  const tsrc = await e.trendRadar.listSources();
  log.residualTrendSources = (okOf(tsrc) && Array.isArray(tsrc.data)) ? tsrc.data.filter((s) => s.name === TAG).length : '?';

  return log;
});

console.log('\n========== CLEANUP REPORT ==========');
console.log(JSON.stringify(report, null, 2));
console.log('====================================\n');
await app.close();
