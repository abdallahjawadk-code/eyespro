// Real-environment WRITE verification: create→verify→delete round-trips for every
// core entity (restores state), plus graceful-response checks for action handlers.
// Never performs real external publishing or destructive global actions.
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
  const rec = (name, status, detail = '') => out.push({ name, status, detail });
  const okOf = (r) => (r && typeof r === 'object' && 'ok' in r ? r.ok : null);
  const TAG = '__RUNTIME_TEST__';

  // 1) ARTICLES: create → get → delete
  try {
    const c = await e.articles.create({ title: TAG, content: 'runtime verification body', summary: 'rt' });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      const g = await e.articles.get(id);
      const gotIt = okOf(g) && !!g.data;
      const d = await e.articles.delete(id);
      const gone = await e.articles.get(id);
      rec('articles CRUD', okOf(c) && gotIt && okOf(d) ? 'OK' : 'PARTIAL',
        `id=${id} get=${gotIt} del=${okOf(d)} afterDel=${JSON.stringify(gone.data) === 'null' || !gone.data ? 'gone' : 'still'}`);
    } else rec('articles CRUD', 'FAIL', JSON.stringify(c).slice(0, 140));
  } catch (x) { rec('articles CRUD', 'THROW', String(x).slice(0, 140)); }

  // 2) SOURCES: create → list(find) → delete
  try {
    const c = await e.sources.create({ name: TAG, url: 'https://example.com/feed.xml', source_type: 'rss' });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      const list = await e.sources.list();
      const found = okOf(list) && Array.isArray(list.data) && list.data.some((s) => s.id === id);
      const d = await e.sources.delete(id);
      rec('sources CRUD', okOf(c) && found && okOf(d) ? 'OK' : 'PARTIAL', `id=${id} found=${found} del=${okOf(d)}`);
    } else rec('sources CRUD', 'FAIL', JSON.stringify(c).slice(0, 140));
  } catch (x) { rec('sources CRUD', 'THROW', String(x).slice(0, 140)); }

  // 3) TASKS: create → list(find) → delete
  try {
    const c = await e.tasks.create({ name: TAG, type: 'fetch_all', schedule_type: 'manual', enabled: 0 });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      const list = await e.tasks.list();
      const found = okOf(list) && Array.isArray(list.data) && list.data.some((t) => t.id === id);
      const d = await e.tasks.delete(id);
      rec('tasks CRUD', okOf(c) && okOf(d) ? 'OK' : 'PARTIAL', `id=${id} found=${found} del=${okOf(d)}`);
    } else rec('tasks CRUD', 'FAIL', JSON.stringify(c).slice(0, 140));
  } catch (x) { rec('tasks CRUD', 'THROW', String(x).slice(0, 140)); }

  // 4) KEYWORDS: create → list(find) → toggle → delete
  try {
    const c = await e.keywords.create(TAG);
    const id = okOf(c) ? (c.data?.id ?? c.data) : null;
    const list = await e.keywords.list();
    const row = okOf(list) && Array.isArray(list.data) ? list.data.find((k) => k.keyword === TAG) : null;
    const realId = id || row?.id;
    let delOk = null, togOk = null;
    if (realId) { togOk = okOf(await e.keywords.toggle(realId, false)); delOk = okOf(await e.keywords.delete(realId)); }
    rec('keywords CRUD', okOf(c) && realId && delOk ? 'OK' : 'PARTIAL', `id=${realId} toggle=${togOk} del=${delOk}`);
  } catch (x) { rec('keywords CRUD', 'THROW', String(x).slice(0, 140)); }

  // 5) TEMPLATES (article): create → list(find) → delete
  try {
    const c = await e.templates.articleCreate({ name: TAG, body: 'tpl body', category: 'rt' });
    const id = okOf(c) ? (c.data?.id ?? c.data) : null;
    const list = await e.templates.articleList();
    const found = okOf(list) && Array.isArray(list.data) && list.data.some((t) => t.id === id || t.name === TAG);
    const realId = id || (okOf(list) ? list.data.find((t) => t.name === TAG)?.id : null);
    const d = realId != null ? okOf(await e.templates.articleDelete(realId)) : null;
    rec('templates.article CRUD', okOf(c) && found && d ? 'OK' : 'PARTIAL', `id=${realId} found=${found} del=${d}`);
  } catch (x) { rec('templates.article CRUD', 'THROW', String(x).slice(0, 140)); }

  // 6) TEMPLATES (publish): create → list(find) → delete
  try {
    const c = await e.templates.publishCreate(TAG, ['telegram']);
    const id = okOf(c) ? (c.data?.id ?? c.data) : null;
    const list = await e.templates.publishList();
    const realId = id || (okOf(list) && Array.isArray(list.data) ? list.data.find((t) => t.name === TAG)?.id : null);
    const d = realId != null ? okOf(await e.templates.publishDelete(realId)) : null;
    rec('templates.publish CRUD', okOf(c) && d ? 'OK' : 'PARTIAL', `id=${realId} del=${d}`);
  } catch (x) { rec('templates.publish CRUD', 'THROW', String(x).slice(0, 140)); }

  // 7) SOCIAL: save → connections(find) → test(graceful) → delete
  try {
    const c = await e.social.save('telegram', TAG, { bot_token: 'x', chat_id: 'y' });
    const id = okOf(c) ? c.data?.id : null;
    if (id) {
      const conns = await e.social.connections();
      const found = okOf(conns) && Array.isArray(conns.data) && conns.data.some((s) => s.id === id);
      const tested = await e.social.test(id);             // hits no real network (fake creds) — must respond, not crash
      const testResponded = tested && typeof tested === 'object' && 'ok' in tested;
      const d = await e.social.delete(id);
      rec('social CRUD+test', okOf(c) && found && testResponded && okOf(d) ? 'OK' : 'PARTIAL',
        `id=${id} found=${found} testResponded=${testResponded} del=${okOf(d)}`);
    } else rec('social CRUD+test', 'FAIL', JSON.stringify(c).slice(0, 140));
  } catch (x) { rec('social CRUD+test', 'THROW', String(x).slice(0, 140)); }

  // 8) SETTINGS: set → getAll(verify) → clear
  try {
    const s = await e.settings.set('__runtime_test_key__', 'v123');
    const all = await e.settings.getAll();
    const has = okOf(all) && all.data && all.data['__runtime_test_key__'] === 'v123';
    const clear = await e.settings.set('__runtime_test_key__', '');
    rec('settings set/get', okOf(s) && has && okOf(clear) ? 'OK' : 'PARTIAL', `verified=${has}`);
  } catch (x) { rec('settings set/get', 'THROW', String(x).slice(0, 140)); }

  // 9) ACTION HANDLERS — must respond gracefully (ok or clear error), never throw / No-handler.
  const actions = {
    'ai.testProvider': () => e.ai.testProvider ? e.ai.testProvider('openai') : 'skip',
    'pipeline.aiStatus': () => e.pipeline.aiStatus(),
    'backup.list': () => e.backup.list(),
    'updater.check': () => e.updater.check(),
    'autopilot.config': () => e.autopilot.config(),
  };
  for (const [k, fn] of Object.entries(actions)) {
    try {
      const r = await fn();
      if (r === 'skip') { rec(k, 'SKIP'); continue; }
      const responded = r && typeof r === 'object' && 'ok' in r;
      rec(k, responded ? 'RESPONDED' : 'RET', responded ? `ok=${r.ok}` : JSON.stringify(r).slice(0, 80));
    } catch (x) { rec(k, 'THROW', String(x).slice(0, 140)); }
  }

  return out;
});

console.log('\n========== WRITE / ACTION VERIFICATION ==========');
let bad = 0;
for (const r of results) {
  const good = ['OK', 'RESPONDED', 'RET', 'SKIP'].includes(r.status);
  if (!good) bad++;
  console.log(`${good ? '✅' : '⚠️'} ${r.name.padEnd(26)} ${r.status.padEnd(10)} ${r.detail}`);
}
console.log(`\nRESULT: ${results.length - bad}/${results.length} passed, ${bad} flagged.`);
console.log('=================================================\n');
await app.close();
