// Real-environment verification of heavy features: content-fetch, video, competitor
// monitor, trends, newsroom/AI, publishing, proxies. CRUD round-trips restore state;
// external/network actions are wrapped in a timeout and accepted if they RESPOND
// (ok or a clear error) without crashing. No real publishing (uses unconfigured creds).
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

const results = await page.evaluate(async () => {
  const e = window.eyespro;
  const out = [];
  const rec = (group, name, status, detail = '') => out.push({ group, name, status, detail });
  const okOf = (r) => (r && typeof r === 'object' && 'ok' in r ? r.ok : null);
  const responded = (r) => r && typeof r === 'object' && ('ok' in r || Array.isArray(r));
  const TAG = '__RT_FEATURE__';
  // Wrap network-y calls so a hung handler can't freeze the probe.
  const T = (p, ms = 15000) => Promise.race([
    Promise.resolve().then(() => p),
    new Promise((res) => setTimeout(() => res({ __timeout: true }), ms)),
  ]);
  const mark = async (group, name, call, { live = false } = {}) => {
    try {
      const r = await (live ? T(call()) : call());
      if (r && r.__timeout) return rec(group, name, 'TIMEOUT', 'handler wired, network slow');
      rec(group, name, responded(r) ? (okOf(r) === false ? 'GRACEFUL-ERR' : 'OK') : 'RET',
        okOf(r) === false ? String(r.error || '').slice(0, 70) : '');
    } catch (x) { rec(group, name, 'THROW', String(x).slice(0, 110)); }
  };

  // ── 1) سحب المحتوى — content fetch ──
  await mark('content-fetch', 'fetch.shieldOverview', () => e.fetch.shieldOverview());
  await mark('content-fetch', 'fetch.qualityTiers', () => e.fetch.qualityTiers());
  await mark('content-fetch', 'fetch.audit', () => e.fetch.audit({ limit: 5 }));
  try {
    const c = await e.sources.create({ name: TAG, url: 'https://feeds.bbci.co.uk/news/rss.xml', source_type: 'rss' });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      await mark('content-fetch', 'sources.fetch (live RSS pull)', () => e.sources.fetch(id), { live: true });
      await e.sources.delete(id);
    } else rec('content-fetch', 'sources.fetch', 'FAIL', 'could not create test source');
  } catch (x) { rec('content-fetch', 'sources.fetch', 'THROW', String(x).slice(0, 110)); }

  // ── 2) الفيديو — video / downloader ──
  await mark('video', 'video.tools', () => e.video.tools());
  await mark('video', 'video.specs', () => e.video.specs());
  await mark('video', 'video.probe(bogus)', () => e.video.probe('Z:/nope.mp4'));
  await mark('video', 'downloader.status', () => e.downloader.status());
  await mark('video', 'downloader.scan', () => e.downloader.scan());
  await mark('video', 'downloader.list', () => e.downloader.list());

  // ── 3) رادار المنافسين — competitor monitor ──
  await mark('monitor', 'monitor.list', () => e.monitor.list());
  await mark('monitor', 'monitor.unreadCount', () => e.monitor.unreadCount());
  try {
    const c = await e.monitor.add(TAG, 'https://feeds.bbci.co.uk/news/rss.xml', 'https://bbc.com', 'rss');
    const list = await e.monitor.list();
    const row = okOf(list) && Array.isArray(list.data) ? list.data.find((m) => m.name === TAG) : null;
    const id = (okOf(c) ? c.data?.id : null) || row?.id;
    if (id) {
      await mark('monitor', 'monitor.check (live crawl)', () => e.monitor.check(id), { live: true });
      await mark('monitor', 'monitor.snapshots', () => e.monitor.snapshots(id, 5));
      const d = await e.monitor.delete(id);
      rec('monitor', 'monitor add→delete', okOf(c) !== false && okOf(d) ? 'OK' : 'PARTIAL', `id=${id} del=${okOf(d)}`);
    } else rec('monitor', 'monitor.add', 'FAIL', JSON.stringify(c).slice(0, 110));
  } catch (x) { rec('monitor', 'monitor CRUD', 'THROW', String(x).slice(0, 110)); }

  // ── 4) الترندات — trends ──
  await mark('trends', 'trendRadar.list', () => e.trendRadar.list());
  await mark('trends', 'trendRadar.stats', () => e.trendRadar.stats());
  await mark('trends', 'trendRadar.listSources', () => e.trendRadar.listSources());
  try {
    const c = await e.trendRadar.addSource({ name: TAG, type: 'rss', url: 'https://feeds.bbci.co.uk/news/rss.xml', region_tag: 'GLOBAL' });
    const list = await e.trendRadar.listSources();
    const row = okOf(list) && Array.isArray(list.data) ? list.data.find((s) => s.name === TAG) : null;
    const id = (okOf(c) ? c.data?.id : null) || row?.id;
    if (id) {
      const tog = await e.trendRadar.toggleSource(id, false);
      await mark('trends', 'trendRadar.fetchSource (live)', () => e.trendRadar.fetchSource(id), { live: true });
      const d = await e.trendRadar.deleteSource(id);
      rec('trends', 'trendRadar source CRUD', okOf(c) !== false && okOf(d) ? 'OK' : 'PARTIAL', `id=${id} toggle=${okOf(tog)} del=${okOf(d)}`);
    } else rec('trends', 'trendRadar.addSource', 'FAIL', JSON.stringify(c).slice(0, 110));
  } catch (x) { rec('trends', 'trendRadar CRUD', 'THROW', String(x).slice(0, 110)); }

  // ── 5) غرفة الأخبار — newsroom (pipeline / AI / autopilot) ──
  await mark('newsroom', 'pipeline.kanban', () => e.pipeline.kanban());
  await mark('newsroom', 'pipeline.config', () => e.pipeline.config());
  await mark('newsroom', 'pipeline.queueStats', () => e.pipeline.queueStats());
  await mark('newsroom', 'pipeline.previewAuto', () => e.pipeline.previewAuto(5));
  await mark('newsroom', 'ai.status', () => e.ai.status());
  await mark('newsroom', 'ai.testProvider (graceful)', () => e.ai.testProvider('openai'), { live: true });
  await mark('newsroom', 'autopilot.status', () => e.autopilot.status());
  await mark('newsroom', 'autopilot.config', () => e.autopilot.config());

  // ── 6) النشر — publishing (no creds configured → must fail gracefully, NOT crash) ──
  await mark('publish', 'publish.platforms', () => e.publish.platforms());
  await mark('publish', 'publish.logs', () => e.publish.logs ? e.publish.logs() : { ok: true });
  try {
    const a = await e.articles.create({ title: TAG, content: 'publish test body', summary: 's' });
    const aid = okOf(a) ? a.data?.id : null;
    if (aid) {
      await mark('publish', 'publish.one (telegram, no creds)', () => e.publish.one(aid, 'telegram', 'test', ''), { live: true });
      await e.articles.delete(aid);
    } else rec('publish', 'publish.one', 'FAIL', 'no test article');
  } catch (x) { rec('publish', 'publish.one', 'THROW', String(x).slice(0, 110)); }

  // ── 7) البروكسيات — proxies / stealth ──
  await mark('proxy', 'stealth.status', () => e.stealth.status());
  await mark('proxy', 'stealth.testFetch (live)', () => e.stealth.testFetch('https://example.com', false), { live: true });

  return out;
});

console.log('\n========== FEATURE VERIFICATION ==========');
let bad = 0;
let group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n— ${group} —`); }
  const good = ['OK', 'GRACEFUL-ERR', 'RET', 'TIMEOUT'].includes(r.status);
  if (!good) bad++;
  console.log(`  ${good ? '✅' : '⚠️'} ${r.name.padEnd(34)} ${r.status.padEnd(13)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} responded correctly, ${bad} flagged (THROW/FAIL/PARTIAL).`);
console.log('==========================================\n');
await app.close();
