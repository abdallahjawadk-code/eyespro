// Probe read-only IPC endpoints used by the inspected pages; report ok/err.
import { _electron as electron } from 'playwright-core';
import path from 'node:path';

const app = await electron.launch({
  args: [path.resolve('out/main/index.cjs')],
  env: { ...process.env, NODE_ENV: 'production', EYESPRO_BYPASS_LICENSE: '1', EYESPRO_TEST_MODE: '1' },
  timeout: 90_000,
});
const page = await app.firstWindow({ timeout: 60_000 });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const e = window.eyespro;
  const probes = {
    'analytics.dashboard': () => e.analytics.dashboard(),
    'pipeline.queueStats': () => e.pipeline.queueStats(),
    'analytics.publishLogs': () => e.analytics.publishLogs(20),
    'fetch.qualityTiers': () => e.fetch.qualityTiers(),
    'fetch.shieldOverview': () => e.fetch.shieldOverview(),
    'keywords.list': () => e.keywords.list(),
    'links.healthLog': () => e.links.healthLog(20),
    'quality.queue': () => e.quality.queue(),
    'quality.stats': () => e.quality.stats(),
    'sources.healthAll': () => e.sources.healthAll(),
    'monitor.list': () => e.monitor.list(),
    'monitor.unreadCount': () => e.monitor.unreadCount(),
    'monitor.snapshots': () => e.monitor.snapshots ? e.monitor.snapshots(1) : 'skip',
    'downloader.status': () => e.downloader.status(),
    'downloader.scan': () => e.downloader.scan(),
    'audit.list': () => e.audit.list(20),
    'system.perf': () => e.system.perf(),
    'settings.getAll': () => e.settings.getAll(),
    'app.copyright': () => e.app.copyright(),
    'ollama.status': () => e.ollama.status(),
    'ollama.localModels': () => e.ollama.localModels(),
    'ollama.recommended': () => e.ollama.recommended(),
    'instagram.loggedIn': () => e.instagram.loggedIn(),
    'reports.html': () => e.reports.html ? e.reports.html({ range: '7d' }) : 'skip',
  };
  const res = {};
  for (const [k, fn] of Object.entries(probes)) {
    try {
      const r = await fn();
      if (r === 'skip') { res[k] = 'SKIP (no method)'; continue; }
      const okFlag = (r && typeof r === 'object' && 'ok' in r) ? r.ok : 'noOkField';
      res[k] = okFlag === true ? 'OK' : (okFlag === false ? ('FALSE:' + JSON.stringify(r).slice(0, 120)) : ('RET:' + JSON.stringify(r).slice(0, 80)));
    } catch (x) { res[k] = 'THROW: ' + String(x).slice(0, 120); }
  }
  return res;
});

console.log('\n========== READ-ONLY IPC PROBE ==========');
for (const [k, v] of Object.entries(out)) {
  const mark = v === 'OK' || String(v).startsWith('RET') || String(v).startsWith('SKIP') ? '✅' : '⚠️';
  console.log(`${mark} ${k.padEnd(24)} ${v}`);
}
console.log('=========================================\n');
await app.close();
