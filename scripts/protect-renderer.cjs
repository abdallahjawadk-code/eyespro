#!/usr/bin/env node
/**
 * protect-renderer.cjs
 * Obfuscates the Vite-built renderer JavaScript bundles to make reverse-
 * engineering significantly harder. Runs AFTER `npm run build` and BEFORE
 * `electron-builder` packages the app.
 *
 * Requires (dev):  javascript-obfuscator
 * Gracefully skips if the package is not installed (won't break CI).
 *
 * Usage:  node scripts/protect-renderer.cjs
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Check for javascript-obfuscator ───────────────────────────────────────────
let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch {
  console.warn(
    '[protect-renderer] javascript-obfuscator not found — skipping obfuscation.\n' +
    '                   Run: npm install --save-dev javascript-obfuscator'
  );
  process.exit(0);
}

// ── Locate renderer asset directory ───────────────────────────────────────────
const rendererAssets = path.join(__dirname, '..', 'out', 'renderer', 'assets');

if (!fs.existsSync(rendererAssets)) {
  console.warn('[protect-renderer] Renderer assets not found at', rendererAssets);
  console.warn('                   Run `npm run build` first.');
  process.exit(1);
}

// ── Obfuscation options ────────────────────────────────────────────────────────
// Conservative settings chosen for compatibility with minified React bundles.
// Aggressive options (controlFlowFlattening, selfDefending) can break React.
const OBFUSCATOR_OPTIONS = {
  compact: true,

  // ── Identity renaming ────────────────────────────────────────────────────────
  identifierNamesGenerator: 'hexadecimal',  // rename vars to 0x-style names
  renameGlobals: false,                      // keep global identifiers intact
  renameProperties: false,                   // property renaming breaks React

  // ── String obfuscation ───────────────────────────────────────────────────────
  stringArray: true,
  stringArrayEncoding: ['base64'],           // encode extracted strings
  stringArrayThreshold: 0.6,                 // obfuscate 60 % of string literals
  splitStrings: true,
  splitStringsChunkLength: 10,
  rotateStringArray: true,
  shuffleStringArray: true,

  // ── DevTools protection ──────────────────────────────────────────────────────
  // debugProtection uses new Function() which is blocked by Electron's CSP
  // (script-src 'self' without 'unsafe-eval') and breaks the app at runtime.
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,               // keep console for error tracking

  // ── Structural transforms — DISABLED for React safety ────────────────────────
  controlFlowFlattening: false,              // breaks React reconciler
  deadCodeInjection: false,                  // inflates bundle unnecessarily
  selfDefending: false,                      // can throw in strict async code
  transformObjectKeys: false,                // breaks React key/ref access
  unicodeEscapeSequence: false,              // would break RTL Arabic strings

  // ── Source map ───────────────────────────────────────────────────────────────
  sourceMap: false,
};

// ── Process files ─────────────────────────────────────────────────────────────
const jsFiles = fs.readdirSync(rendererAssets)
  .filter(f => f.endsWith('.js') && !f.endsWith('.min.js'));

if (jsFiles.length === 0) {
  console.log('[protect-renderer] No .js files found in renderer assets — nothing to do.');
  process.exit(0);
}

let total = 0;
let failed = 0;

for (const file of jsFiles) {
  const filePath = path.join(rendererAssets, file);
  const originalSize = fs.statSync(filePath).size;

  process.stdout.write(`  Obfuscating ${file} (${(originalSize / 1024).toFixed(1)} KB)… `);

  try {
    const source = fs.readFileSync(filePath, 'utf8');

    const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_OPTIONS);
    const obfuscated = result.getObfuscatedCode();

    fs.writeFileSync(filePath, obfuscated, 'utf8');

    const newSize = Buffer.byteLength(obfuscated, 'utf8');
    const ratio = ((newSize / originalSize - 1) * 100).toFixed(0);
    const sign  = ratio > 0 ? '+' : '';
    process.stdout.write(`done  (${(newSize / 1024).toFixed(1)} KB, ${sign}${ratio}%)\n`);
    total++;
  } catch (err) {
    process.stdout.write(`FAILED\n`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

console.log(`\n[protect-renderer] ${total} file(s) obfuscated${failed > 0 ? `, ${failed} failed` : ''}.`);

if (failed > 0) {
  // Non-fatal: the build can still proceed with partially obfuscated files.
  console.warn('[protect-renderer] Warning: some files were not obfuscated.');
}
