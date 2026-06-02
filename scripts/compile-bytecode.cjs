/**
 * Compiles out/main/index.js → out/main/index.jsc (V8 bytecode)
 * and replaces the entry with a tiny CJS loader.
 *
 * Run after electron-vite build:
 *   node scripts/compile-bytecode.cjs
 */

'use strict';

const bytenode = require('bytenode');
const fs       = require('node:fs');
const path     = require('node:path');

// electron-vite outputs .cjs when format is set to 'cjs'
const MAIN_JS  = path.resolve(__dirname, '../out/main/index.cjs');
const MAIN_JSC = path.resolve(__dirname, '../out/main/index.jsc');

if (!fs.existsSync(MAIN_JS)) {
  console.error('[bytecode] out/main/index.js not found — run npm run build first');
  process.exit(1);
}

console.log('[bytecode] Compiling main process to V8 bytecode…');
bytenode.compileFile({ filename: MAIN_JS, output: MAIN_JSC, electron: true });

// Replace index.cjs with a CJS loader that re-exports everything from the
// bytecode module.  Chunks produced by Vite do `require('../index.cjs')` to
// access shared utilities; without the re-export they would get an empty {}
// and all shared functions would be undefined at runtime.
fs.writeFileSync(
  MAIN_JS,
  `'use strict';
require('bytenode');
module.exports = require('./index.jsc');
`
);

console.log('[bytecode] Done →', MAIN_JSC);
console.log('[bytecode] Loader written →', MAIN_JS);
