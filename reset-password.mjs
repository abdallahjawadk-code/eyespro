/**
 * Reset admin password — run with: node reset-password.mjs
 * Works on the live .working database.
 */
import { createRequire } from 'node:module';
import { scryptSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = path.join(
  os.homedir(),
  'AppData', 'Roaming', 'EyesPro', 'EyesPro', 'eyespro.db.working'
);

const NEW_PASSWORD = 'Admin@12345';

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(NEW_PASSWORD, salt, 64, SCRYPT_OPTS).toString('hex');

const db = new Database(DB_PATH);

const info = db.prepare(
  `UPDATE users SET password_hash=?, salt=?, is_active=1, must_change_password=0 WHERE username='admin'`
).run(hash, salt);

if (info.changes === 0) {
  // Create admin if not exists
  db.prepare(
    `INSERT INTO users (username, password_hash, salt, role, email, is_active) VALUES ('admin', ?, ?, 'super_admin', 'admin@eyespro.app', 1)`
  ).run(hash, salt);
  console.log('✓ Admin user created.');
} else {
  console.log('✓ Password reset successfully.');
}

db.close();
console.log('');
console.log('  Username: admin');
console.log(`  Password: ${NEW_PASSWORD}`);
console.log('');
