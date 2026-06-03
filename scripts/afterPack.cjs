/**
 * electron-builder afterPack hook.
 *
 * Runs after the app is packed into appOutDir (win-unpacked) but BEFORE the NSIS
 * installer / portable targets are built — so the fuses are embedded INSIDE the
 * distributed installer (unlike a post-build script, which is too late).
 *
 * Applies the proven security fuse set:
 *   - RunAsNode off                (no --run-as-node Node shell)
 *   - Node CLI inspect off         (no --inspect / --inspect-brk debugging)
 *   - NODE_OPTIONS env off         (no runtime flag injection)
 *   - Cookie encryption on
 *   - Only load app from asar
 *
 * EnableEmbeddedAsarIntegrityValidation is intentionally NOT set: on
 * electron-builder 24.x the asar integrity hash isn't injected into the PE, so
 * enabling that fuse would make the app fail to launch. The above fuses already
 * block debugging/automation (verified: Playwright cannot attach to the result).
 */
'use strict';

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');
const fs = require('node:fs');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exe = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exe)) {
    console.warn('[afterPack] executable not found, skipping fuses:', exe);
    return;
  }
  console.log('[afterPack] applying security fuses to', exe);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('[afterPack] fuses applied (embedded in installer)');
};
