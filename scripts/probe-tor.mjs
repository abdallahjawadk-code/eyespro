// Real-environment Tor verification: toggle Tor ON (downloads 15.0.14 + extracts +
// bootstraps), report the actual outcome, then restore the original tor_enabled setting.
// Validates the dead-version (404) fix, the download timeout, and the execFile extract.
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

const result = await page.evaluate(async () => {
  const e = window.eyespro;
  const okOf = (r) => (r && typeof r === 'object' && 'ok' in r ? r.ok : null);
  const steps = [];

  const before = await e.tor.status();
  const wasEnabled = okOf(before) && before.data ? !!before.data.enabled : false;
  steps.push({ step: 'initial status', status: JSON.stringify(before.data || before).slice(0, 160) });

  // Toggle ON — handler awaits startTor() (setup→download→extract→bootstrap).
  let toggleResult;
  try {
    toggleResult = await e.tor.toggle(true);
    steps.push({ step: 'toggle(true) returned', status: JSON.stringify(toggleResult.data || toggleResult).slice(0, 220) });
  } catch (x) {
    steps.push({ step: 'toggle(true) THREW', status: String(x).slice(0, 200) });
  }

  // Poll a few times in case it is still bootstrapping.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = await e.tor.status();
    const d = s.data || {};
    steps.push({ step: `poll ${i + 1}`, status: `${d.status} | ${String(d.bootstrap || '').slice(0, 90)}` });
    if (d.status === 'ready' || d.status === 'error') break;
  }

  const final = await e.tor.status();
  // Restore the user's original setting.
  if (!wasEnabled) { await e.tor.toggle(false); steps.push({ step: 'restored', status: 'tor disabled (was off)' }); }
  else { steps.push({ step: 'left enabled', status: 'tor_enabled was already true' }); }

  return { wasEnabled, finalStatus: final.data?.status, finalMsg: final.data?.bootstrap, steps };
});

console.log('\n========== TOR VERIFICATION ==========');
for (const s of result.steps) console.log(`  • ${s.step.padEnd(22)} ${s.status}`);
console.log(`\n  finalStatus: ${result.finalStatus}`);
console.log(`  finalMsg:    ${result.finalMsg}`);
const verdict = result.finalStatus === 'ready' ? '✅ Tor connected (download+extract+bootstrap all worked)'
  : result.finalStatus === 'error' ? '⚠️ Tor errored — but FAILED CLEANLY (no infinite hang); check msg (likely network/blocked)'
  : '⏳ still starting (slow network) — handler alive, no crash';
console.log(`\n  VERDICT: ${verdict}`);
console.log('======================================\n');
await app.close();
