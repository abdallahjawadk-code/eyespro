'use strict';

const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const nodePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);
const hasBinary = existsSync(nodePath);

const result = spawnSync('npx', ['electron-builder', 'install-app-deps'], {
  stdio: 'inherit',
  shell: true,
  cwd: path.join(__dirname, '..')
});

if (result.status === 0) {
  process.exit(0);
}

if (hasBinary) {
  console.warn('');
  console.warn('[EyesPro] better-sqlite3 rebuild skipped — file is locked (EBUSY).');
  console.warn('  1. Close EyesPro and any "npm run dev" terminal');
  console.warn('  2. Run: npm run rebuild:native');
  console.warn('');
  process.exit(0);
}

process.exit(result.status ?? 1);
