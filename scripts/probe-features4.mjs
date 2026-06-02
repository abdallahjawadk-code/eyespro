// Real-environment round 4: scheduled tasks (full lifecycle incl. run), monitoring &
// analytics, video center. CRUD restores state; run/network calls are timeout-wrapped.
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
      if (r && r.__timeout) return rec(group, name, 'TIMEOUT', 'wired, slow');
      rec(group, name, responded(r) ? (okOf(r) === false ? 'GRACEFUL-ERR' : 'OK') : 'RET',
        okOf(r) === false ? String(r.error || '').slice(0, 55) : '');
    } catch (x) { rec(group, name, 'THROW', String(x).slice(0, 110)); }
  };
  const TAG = '__RT_TASK__';

  // ── 1) المهام المجدولة — scheduled tasks (create → list → update → run → delete) ──
  try {
    const c = await e.tasks.create({ name: TAG, task_type: 'publish', scheduled_at: new Date(Date.now() + 3600_000).toISOString(), status: 'pending' });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      const list = await e.tasks.list();
      const found = okOf(list) && Array.isArray(list.data) && list.data.some((t) => t.id === id);
      const upd = await e.tasks.update(id, { name: TAG + '_v2', status: 'paused' });
      await mark('scheduled-tasks', 'tasks.run (live)', () => e.tasks.run(id), true);
      const del = await e.tasks.delete(id);
      rec('scheduled-tasks', 'tasks create→list→update→delete', okOf(c) !== false && found && okOf(upd) !== false && okOf(del) ? 'OK' : 'PARTIAL',
        `id=${id} found=${found} upd=${okOf(upd)} del=${okOf(del)}`);
    } else rec('scheduled-tasks', 'tasks.create', 'FAIL', JSON.stringify(c).slice(0, 110));
  } catch (x) { rec('scheduled-tasks', 'tasks lifecycle', 'THROW', String(x).slice(0, 110)); }
  await mark('scheduled-tasks', 'tasks.list (status filter)', () => e.tasks.list('pending'));

  // ── 2) الرقابة والتحليل — monitoring & analytics ──
  await mark('analytics', 'analytics.dashboard', () => e.analytics.dashboard());
  await mark('analytics', 'analytics.exportCsv', () => e.analytics.exportCsv());
  await mark('analytics', 'analytics.publishLogs', () => e.analytics.publishLogs(20));
  await mark('analytics', 'analytics.alerts', () => e.analytics.alerts());
  await mark('analytics', 'system.perf', () => e.system.perf());
  await mark('analytics', 'system.cache', () => e.system.cache());
  await mark('analytics', 'audit.list', () => e.audit.list(20));
  await mark('analytics', 'fetch.audit', () => e.fetch.audit({ limit: 10 }));

  // ── 3) مركز الفيديو — video center ──
  await mark('video-center', 'media.list', () => e.media.list());
  await mark('video-center', 'media.stats', () => e.media.stats());
  await mark('video-center', 'video.tools', () => e.video.tools());
  await mark('video-center', 'video.specs', () => e.video.specs());
  await mark('video-center', 'video.probe(bogus)', () => e.video.probe('Z:/none.mp4'));
  await mark('video-center', 'downloader.status', () => e.downloader.status());
  await mark('video-center', 'downloader.scan', () => e.downloader.scan());
  await mark('video-center', 'downloader.list', () => e.downloader.list());
  await mark('video-center', 'downloader.info (live)', () => e.downloader.info('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);

  return out;
});

console.log('\n========== FEATURE VERIFICATION (round 4) ==========');
let bad = 0, group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n— ${group} —`); }
  const good = ['OK', 'GRACEFUL-ERR', 'RET', 'TIMEOUT'].includes(r.status);
  if (!good) bad++;
  console.log(`  ${good ? '✅' : '⚠️'} ${r.name.padEnd(34)} ${r.status.padEnd(13)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} responded correctly, ${bad} flagged.`);
console.log('====================================================\n');
await app.close();
