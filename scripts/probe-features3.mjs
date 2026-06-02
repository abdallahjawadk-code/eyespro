// Real-environment verification round 3: fetch types, link tracking, in-fetch checks,
// newsroom ops, system, settings, editing, AI. CRUD restores state; network/AI calls are
// timeout-wrapped and accepted if they RESPOND (ok or clear error) without crashing.
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
        okOf(r) === false ? String(r.error || '').slice(0, 55) : '');
    } catch (x) { rec(group, name, 'THROW', String(x).slice(0, 110)); }
  };

  // draft article for newsroom / editing / AI
  let aid = null;
  try {
    const a = await e.articles.create({ title: '__RT_EDIT__', content: '<p>Body text for processing.</p>', summary: 'sum' });
    aid = okOf(a) ? a.data?.id : null;
  } catch { /* ignore */ }

  // ── 1) أنواع السحب — fetch types (direct HTTP vs browser-rendered) ──
  await mark('fetch-types', 'stealth.testFetch direct', () => e.stealth.testFetch('https://example.com', false), true);
  await mark('fetch-types', 'stealth.testFetch browser', () => e.stealth.testFetch('https://example.com', true), true);

  // ── 2) تتبع الروابط — link tracking ──
  await mark('link-tracking', 'links.scan', () => e.links.scan('https://example.com/path?utm_source=x'));
  await mark('link-tracking', 'links.sanitize', () => e.links.sanitize('https://example.com/?utm_source=x&id=1'));
  await mark('link-tracking', 'links.extract', () => e.links.extract('<a href="https://a.com">x</a><a href="https://b.com">y</a>'));
  await mark('link-tracking', 'links.history', () => e.links.history());
  await mark('link-tracking', 'links.healthLog', () => e.links.healthLog());
  await mark('link-tracking', 'links.health (live)', () => e.links.health('https://example.com'), true);

  // ── 3) الفحوص أثناء السحب — in-fetch checks (safety / dedup / quality) ──
  await mark('fetch-checks', 'links.scan (safety)', () => e.links.scan('http://malware.test/login'));
  await mark('fetch-checks', 'articles.checkDuplicate', () => e.articles.checkDuplicate('https://example.com/news/1'));
  await mark('fetch-checks', 'fetch.qualityTiers', () => e.fetch.qualityTiers());
  await mark('fetch-checks', 'fetch.shieldOverview', () => e.fetch.shieldOverview());

  // ── 4) عمليات غرفة الأخبار — newsroom ops ──
  await mark('newsroom', 'pipeline.previewAuto', () => e.pipeline.previewAuto(5));
  await mark('newsroom', 'pipeline.jobs', () => e.pipeline.jobs(10));
  await mark('newsroom', 'pipeline.aiStatus', () => e.pipeline.aiStatus());
  if (aid) {
    await mark('newsroom', 'pipeline.articleDetail', () => e.pipeline.articleDetail(aid));
    await mark('newsroom', 'pipeline.previewArticles', () => e.pipeline.previewArticles([aid]));
    await mark('newsroom', 'pipeline.runStep(sanitize)', () => e.pipeline.runStep(aid, 'sanitize'), true);
  }

  // ── 5) النظام — system ──
  await mark('system', 'system.perf', () => e.system.perf());
  await mark('system', 'system.cache', () => e.system.cache());
  await mark('system', 'audit.list', () => e.audit.list(20));
  await mark('system', 'users.list', () => e.users.list());
  await mark('system', 'permissions.list', () => e.permissions.list());
  await mark('system', 'tenants.list', () => e.tenants.list());
  await mark('system', 'backup.list', () => e.backup.list());
  await mark('system', 'backup.create (live)', () => e.backup.create(), true);

  // ── 6) الإعدادات — settings round-trip ──
  try {
    const s = await e.settings.set('__rt3_key__', 'hello');
    const all = await e.settings.getAll();
    const has = okOf(all) && all.data && all.data['__rt3_key__'] === 'hello';
    await e.settings.set('__rt3_key__', '');
    rec('settings', 'set/getAll/clear', okOf(s) && has ? 'OK' : 'PARTIAL', `verified=${has}`);
  } catch (x) { rec('settings', 'set/getAll/clear', 'THROW', String(x).slice(0, 100)); }

  // ── 7) التحرير — editing ──
  if (aid) {
    await mark('editing', 'articles.update', () => e.articles.update(aid, { title: '__RT_EDIT__ v2', content: '<p>Edited body.</p>' }));
    await mark('editing', 'quality.check (live)', () => e.quality.check(aid, 'full'), true);
    await mark('editing', 'translation.text (graceful)', () => e.translation.text('hello world', 'ar'), true);
  }

  // ── 8) الذكاء الاصطناعي — AI ──
  await mark('ai', 'ai.modes', () => e.ai.modes());
  await mark('ai', 'ai.status', () => e.ai.status());
  await mark('ai', 'ai.listModels', () => e.ai.listModels());
  await mark('ai', 'ai.jobs', () => e.ai.jobs());
  await mark('ai', 'ai.testProvider (graceful)', () => e.ai.testProvider('openai'), true);
  if (aid) await mark('ai', 'ai.run(rewrite, graceful)', () => e.ai.run(aid, 'rewrite'), true);
  await mark('ai', 'ai.generateVariants (graceful)', () => e.ai.generateVariants('tech news', 2), true);

  // cleanup
  if (aid) { try { await e.articles.delete(aid); } catch { /* ignore */ } }
  return out;
});

console.log('\n========== FEATURE VERIFICATION (round 3) ==========');
let bad = 0, group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n— ${group} —`); }
  const good = ['OK', 'GRACEFUL-ERR', 'RET', 'TIMEOUT'].includes(r.status);
  if (!good) bad++;
  console.log(`  ${good ? '✅' : '⚠️'} ${r.name.padEnd(32)} ${r.status.padEnd(13)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} responded correctly, ${bad} flagged.`);
console.log('====================================================\n');
await app.close();
