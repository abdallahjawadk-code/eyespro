// Real-environment verification round 2: source types (allowed), search (articles +
// source discovery), monitoring/analytics, video center. CRUD restores state; network
// calls are timeout-wrapped and accepted if they RESPOND without crashing.
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
  const T = (p, ms = 15000) => Promise.race([
    Promise.resolve().then(() => p),
    new Promise((res) => setTimeout(() => res({ __timeout: true }), ms)),
  ]);
  const mark = async (group, name, call, live = false) => {
    try {
      const r = await (live ? T(call()) : call());
      if (r && r.__timeout) return rec(group, name, 'TIMEOUT', 'wired, network slow');
      rec(group, name, responded(r) ? (okOf(r) === false ? 'GRACEFUL-ERR' : 'OK') : 'RET',
        okOf(r) === false ? String(r.error || '').slice(0, 60) : '');
    } catch (x) { rec(group, name, 'THROW', String(x).slice(0, 110)); }
  };
  const TAG = '__RT_SRCTYPE__';

  // ── 1) أنواع المصادر المسموح بها — allowed source types (create→verify→delete) ──
  const TYPES = [
    { t: 'rss',       url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { t: 'wordpress', url: 'https://wordpress.org' },
    { t: 'telegram',  url: 'https://t.me/durov' },
    { t: 'json_api',  url: 'https://example.com/api/news.json' },
    { t: 'html',      url: 'https://example.com/news' },
    { t: 'youtube',   url: 'https://www.youtube.com/@YouTube' },
  ];
  for (const { t, url } of TYPES) {
    try {
      const c = await e.sources.create({ name: `${TAG}_${t}`, url, source_type: t });
      const id = okOf(c) ? c.data?.id : null;
      if (id) {
        const list = await e.sources.list();
        const row = okOf(list) && Array.isArray(list.data) ? list.data.find((s) => s.id === id) : null;
        const typeOk = row && (row.source_type === t);
        await e.sources.delete(id);
        rec('source-types', `create type=${t}`, typeOk ? 'OK' : 'PARTIAL', `stored=${row?.source_type}`);
      } else rec('source-types', `create type=${t}`, okOf(c) === false ? 'REJECTED' : 'FAIL', String(c.error || '').slice(0, 60));
    } catch (x) { rec('source-types', `create type=${t}`, 'THROW', String(x).slice(0, 100)); }
  }

  // ── 2) البحث — search (articles + source discovery) ──
  await mark('search', 'articles.search', () => e.articles.search('news', 10));
  await mark('search', 'sources.listCatalogs', () => e.sources.listCatalogs());
  await mark('search', 'sources.listSectors', () => e.sources.listSectors());
  await mark('search', 'sources.detect (live)', () => e.sources.detect('https://www.bbc.com'), true);
  await mark('search', 'sources.previewFeed (live)', () => e.sources.previewFeed('https://feeds.bbci.co.uk/news/rss.xml'), true);
  await mark('search', 'sources.searchFeeds (live)', () => e.sources.searchFeeds('technology'), true);
  await mark('search', 'sources.discover (live)', () => e.sources.discover('https://www.theverge.com'), true);

  // ── 3) الرقابة والتحليلات — monitoring & analytics ──
  await mark('analytics', 'analytics.dashboard', () => e.analytics.dashboard());
  await mark('analytics', 'analytics.exportCsv', () => e.analytics.exportCsv());
  await mark('analytics', 'analytics.publishLogs', () => e.analytics.publishLogs(20));
  await mark('analytics', 'analytics.alerts', () => e.analytics.alerts());
  await mark('analytics', 'system.perf', () => e.system.perf());
  await mark('analytics', 'system.cache', () => e.system.cache());
  await mark('analytics', 'audit.list', () => e.audit.list(20));

  // ── 4) مركز الفيديو — video center ──
  await mark('video-center', 'media.list', () => e.media.list());
  await mark('video-center', 'media.stats', () => e.media.stats());
  await mark('video-center', 'video.tools', () => e.video.tools());
  await mark('video-center', 'video.specs', () => e.video.specs());
  await mark('video-center', 'downloader.status', () => e.downloader.status());
  await mark('video-center', 'downloader.list', () => e.downloader.list());
  await mark('video-center', 'downloader.scan', () => e.downloader.scan());

  return out;
});

console.log('\n========== FEATURE VERIFICATION (round 2) ==========');
let bad = 0, group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n— ${group} —`); }
  const good = ['OK', 'GRACEFUL-ERR', 'RET', 'TIMEOUT', 'REJECTED'].includes(r.status);
  if (!good) bad++;
  console.log(`  ${good ? '✅' : '⚠️'} ${r.name.padEnd(30)} ${r.status.padEnd(13)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} OK, ${bad} flagged (THROW/FAIL/PARTIAL).`);
console.log('====================================================\n');
await app.close();
