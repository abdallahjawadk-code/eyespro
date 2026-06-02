/**
 * Emergency backup restore — run with: node restore-backup.mjs
 * Decrypts the latest .epbak and writes it as eyespro.db.working
 * so the app can start normally and re-encrypt the store on shutdown.
 */
import { createDecipheriv, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOSTNAME   = os.hostname();
const USER_DATA  = path.join(os.homedir(), 'AppData', 'Roaming', 'EyesPro');
const DATA_DIR   = path.join(USER_DATA, 'EyesPro');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const WORKING    = path.join(DATA_DIR, 'eyespro.db.working');

// Must match backup.ts → deriveKey()
function deriveKey() {
  const machine = HOSTNAME + USER_DATA;
  return createHash('sha256').update('EyesPro-backup-v1-' + machine).digest();
}

function decryptBackup(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 28) throw new Error('Backup file too small — corrupted');
  const iv      = buf.subarray(0, 12);
  const tag     = buf.subarray(12, 28);
  const enc     = buf.subarray(28);
  const key     = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// ── Find latest backup ────────────────────────────────────────────
const backups = fs.readdirSync(BACKUP_DIR)
  .filter(f => f.endsWith('.epbak'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (!backups.length) {
  console.error('❌  No backups found in', BACKUP_DIR);
  process.exit(1);
}

const latest = path.join(BACKUP_DIR, backups[0].name);
console.log('📦  Restoring from:', backups[0].name);

// ── Decrypt ───────────────────────────────────────────────────────
let plain;
try {
  plain = decryptBackup(latest);
} catch (e) {
  console.error('❌  Decryption failed:', e.message);
  process.exit(1);
}

// ── Validate SQLite magic ─────────────────────────────────────────
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
if (!plain.subarray(0, 16).equals(SQLITE_MAGIC)) {
  console.error('❌  Decrypted content is not a valid SQLite file');
  console.error('    First 16 bytes:', plain.subarray(0, 16).toString('hex'));
  process.exit(1);
}

console.log(`✅  Decrypted OK — ${(plain.length / 1024 / 1024).toFixed(1)} MB, valid SQLite`);

// ── Write working file ────────────────────────────────────────────
// Clean up any stale working files first
for (const ext of ['', '-wal', '-shm']) {
  const p = WORKING + ext;
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('🗑   Removed stale:', path.basename(p)); }
}

fs.writeFileSync(WORKING, plain);
console.log('💾  Written:', WORKING);
console.log('\n✅  Done — start the app with: npm run dev\n');
