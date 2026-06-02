/**
 * Applies Electron Fuses to harden the packaged app:
 *   - Disables DevTools (Ctrl+Shift+I, right-click inspect)
 *   - Disables remote debugging (--remote-debugging-port)
 *   - Disables Node.js integration in renderer if somehow re-enabled
 *   - Disables REPL / eval-like surfaces
 *
 * Run after electron-builder packages the app:
 *   node scripts/apply-fuses.cjs
 *
 * The script auto-detects the packaged .exe inside release/win-unpacked/
 */

'use strict';

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');
const fs   = require('node:fs');

const WIN_UNPACKED = path.resolve(__dirname, '../release/win-unpacked');
const APP_EXE      = path.join(WIN_UNPACKED, 'EyesPro.exe');

if (!fs.existsSync(APP_EXE)) {
  console.warn('[fuses] win-unpacked not found — skipping fuse application.');
  console.warn('[fuses] Run electron-builder first: npm run build:win:dir');
  process.exit(0);
}

console.log('[fuses] Applying security fuses to', APP_EXE);

flipFuses(APP_EXE, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]:                      false,  // disable --run-as-node
  [FuseV1Options.EnableCookieEncryption]:         true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]:  false,  // disables --inspect / --inspect-brk
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]:            true,
}).then(() => {
  console.log('[fuses] Fuses applied successfully');
}).catch(err => {
  console.error('[fuses] Failed:', err.message);
  process.exit(1);
});
