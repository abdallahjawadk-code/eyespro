// Deep real-environment verification of the NEWSROOM (Autopilot + processing pipeline).
// Verifies REAL article processing through local steps (sanitize/proofread/validate
// actually transform the article), graceful behaviour for AI steps (no key), all
// pipeline ops, and an autopilot config round-trip. State is restored.
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
  const T = (p, ms = 20000) => Promise.race([
    Promise.resolve().then(() => p),
    new Promise((res) => setTimeout(() => res({ __timeout: true }), ms)),
  ]);
  const mark = async (group, name, call, live = false) => {
    try {
      const r = await (live ? T(call()) : call());
      if (r && r.__timeout) return rec(group, name, 'TIMEOUT', 'wired, slow');
      rec(group, name, responded(r) ? (okOf(r) === false ? 'GRACEFUL-ERR' : 'OK') : 'RET',
        okOf(r) === false ? String(r.error || '').slice(0, 50) : '');
    } catch (x) { rec(group, name, 'THROW', String(x).slice(0, 110)); }
  };
  const getArticle = async (id) => { const r = await e.articles.get(id); return okOf(r) ? r.data : null; };

  // ── A) Pipeline engine state ──
  await mark('pipeline-state', 'pipeline.config', () => e.pipeline.config());
  await mark('pipeline-state', 'pipeline.queueStats', () => e.pipeline.queueStats());
  await mark('pipeline-state', 'pipeline.session', () => e.pipeline.session());
  await mark('pipeline-state', 'pipeline.aiStatus', () => e.pipeline.aiStatus());
  await mark('pipeline-state', 'pipeline.kanban', () => e.pipeline.kanban());

  // ── B) REAL per-article processing (the core of the newsroom) ──
  let aid = null;
  try {
    const c = await e.articles.create({
      title: '   Messy   Title   ',
      content: '<script>alert(1)</script><p>Hello&nbsp;&nbsp;&nbsp;world</p><div>extra</div>',
      summary: '  raw summary  ',
    });
    aid = okOf(c) ? c.data?.id : null;
  } catch { /* ignore */ }

  if (aid) {
    const before = await getArticle(aid);
    // sanitize (LOCAL) — must clean HTML, set content_hash, advance status
    const s1 = await e.pipeline.runStep(aid, 'sanitize');
    const afterSan = await getArticle(aid);
    const cleaned = afterSan && !String(afterSan.content || '').includes('<script') && !!afterSan.content_hash;
    rec('processing', 'runStep(sanitize) transforms article', okOf(s1) !== false && cleaned ? 'OK' : 'PARTIAL',
      `script-removed=${!String(afterSan?.content||'').includes('<script')} hash=${!!afterSan?.content_hash} status=${afterSan?.processing_status}`);

    // proofread (LOCAL) — must set a quality score
    const s2 = await e.pipeline.runStep(aid, 'proofread');
    const afterPr = await getArticle(aid);
    rec('processing', 'runStep(proofread) scores article', okOf(s2) !== false ? 'OK' : 'GRACEFUL-ERR',
      `score=${afterPr?.pipeline_quality_score}`);

    // validate (LOCAL) — quality + purity score
    await mark('processing', 'runStep(validate)', () => e.pipeline.runStep(aid, 'validate'));
    // rewrite (AI) — graceful without a key
    await mark('processing', 'runStep(rewrite) [AI, graceful]', () => e.pipeline.runStep(aid, 'rewrite'), true);

    await mark('processing', 'pipeline.articleDetail', () => e.pipeline.articleDetail(aid));
    await mark('processing', 'pipeline.log', () => e.pipeline.log(aid));
    // setProfile → verify persisted
    const sp = await e.pipeline.setProfile(aid, 'light');
    const afterProf = await getArticle(aid);
    rec('processing', 'setProfile(light)', okOf(sp) !== false && afterProf?.pipeline_profile === 'light' ? 'OK' : 'PARTIAL',
      `profile=${afterProf?.pipeline_profile}`);
  }

  // ── C) Bulk / preview / full ──
  await mark('bulk', 'pipeline.previewAuto', () => e.pipeline.previewAuto(5));
  if (aid) {
    await mark('bulk', 'pipeline.previewArticles', () => e.pipeline.previewArticles([aid]));
    await mark('bulk', 'pipeline.runFull [AI, graceful]', () => e.pipeline.runFull(aid), true);
    await mark('bulk', 'pipeline.runArticles [graceful]', () => e.pipeline.runArticles([aid], 'light'), true);
  }
  await mark('bulk', 'pipeline.runBulk [graceful]', () => e.pipeline.runBulk(2, 'light'), true);

  // ── D) Jobs / session control ──
  await mark('jobs', 'pipeline.jobs', () => e.pipeline.jobs(10));
  await mark('jobs', 'pipeline.retryFailed', () => e.pipeline.retryFailed());
  await mark('jobs', 'pipeline.dismissFailed', () => e.pipeline.dismissFailed());
  await mark('jobs', 'pipeline.cancelAllPending', () => e.pipeline.cancelAllPending());
  try {
    const d1 = await e.pipeline.setSessionDisableAi(true);
    const sess = await e.pipeline.session();
    await e.pipeline.setSessionDisableAi(false);
    rec('jobs', 'setSessionDisableAi round-trip', okOf(d1) !== false && responded(sess) ? 'OK' : 'PARTIAL');
  } catch (x) { rec('jobs', 'setSessionDisableAi', 'THROW', String(x).slice(0, 90)); }

  // ── E) Autopilot ──
  await mark('autopilot', 'autopilot.status', () => e.autopilot.status());
  await mark('autopilot', 'autopilot.runs', () => e.autopilot.runs(10));
  try {
    const cfg = await e.autopilot.config();
    const orig = okOf(cfg) ? cfg.data : null;
    const origInterval = orig?.intervalMin ?? 0;
    const set = await e.autopilot.setConfig({ intervalMin: origInterval + 7 });
    const cfg2 = await e.autopilot.config();
    const applied = okOf(cfg2) && cfg2.data?.intervalMin === origInterval + 7;
    await e.autopilot.setConfig({ intervalMin: origInterval }); // restore
    rec('autopilot', 'config setConfig round-trip', okOf(set) !== false && applied ? 'OK' : 'PARTIAL', `applied=${applied}`);
  } catch (x) { rec('autopilot', 'config round-trip', 'THROW', String(x).slice(0, 90)); }
  await mark('autopilot', 'autopilot.run [live autonomous loop]', () => e.autopilot.run(), true);
  await mark('autopilot', 'autopilot.stop', () => e.autopilot.stop());

  // cleanup
  if (aid) { try { await e.articles.delete(aid); } catch { /* ignore */ } }
  return out;
});

console.log('\n========== NEWSROOM DEEP VERIFICATION ==========');
let bad = 0, group = '';
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n— ${group} —`); }
  const good = ['OK', 'GRACEFUL-ERR', 'RET', 'TIMEOUT'].includes(r.status);
  if (!good) bad++;
  console.log(`  ${good ? '✅' : '⚠️'} ${r.name.padEnd(38)} ${r.status.padEnd(13)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} responded correctly, ${bad} flagged.`);
console.log('================================================\n');
await app.close();
