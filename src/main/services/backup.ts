import { app } from 'electron';
import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../db/database';
import { isEncryptedFile, saveDatabaseFile } from '../db/at-rest';
import { getBackupDir, getDataDir, getDbPath, getDbWorkingPath } from '../db/paths';
import { getSetting, setSetting } from './settings';
import { createLogger } from '../logger';

const log = createLogger('backup');

/** SQLite file magic — first 16 bytes of every valid SQLite 3 file */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
/** Backup envelope magic (v2). Legacy v1 files have no magic (raw iv|tag|enc). */
const ENV_MAGIC = Buffer.from('EPBK');
/** Staged restore applied on next startup, before the DB is opened. */
function pendingRestorePath(): string {
  return path.join(getDataDir(), 'pending-restore.db');
}

/** Machine-bound key — backups encrypted with this restore only on the same machine. */
function deriveMachineKey(): Buffer {
  const machine = os.hostname() + app.getPath('userData');
  return createHash('sha256').update('EyesPro-backup-v1-' + machine).digest();
}

/** Passphrase key — portable across machines (for disaster recovery on a new PC). */
function derivePassphraseKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

// ── snapshot ────────────────────────────────────────────────────────────────

/** Consistent online snapshot of the live DB (safe while the app is running). */
async function exportDbBytes(): Promise<Buffer> {
  const db = getDb();
  if (typeof db.backup === 'function') {
    const tmp = path.join(os.tmpdir(), `eyespro_bak_${Date.now()}.db`);
    try {
      await db.backup(tmp);
      return fs.readFileSync(tmp);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
  return fs.readFileSync(getDbWorkingPath());
}

// ── envelope encryption ───────────────────────────────────────────────────────

function encryptBytes(raw: Buffer, passphrase?: string): Buffer {
  const usePass = !!passphrase;
  const salt = usePass ? randomBytes(16) : Buffer.alloc(0);
  const key = usePass ? derivePassphraseKey(passphrase!, salt) : deriveMachineKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(raw), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.concat([ENV_MAGIC, Buffer.from([2, usePass ? 1 : 0])]);
  return Buffer.concat([header, salt, iv, tag, enc]);
}

function decryptBytes(buf: Buffer, passphrase?: string): Buffer {
  try {
    if (buf.subarray(0, 4).equals(ENV_MAGIC)) {
      const mode = buf[5];
      let off = 6;
      let key: Buffer;
      if (mode === 1) {
        const salt = buf.subarray(off, off + 16); off += 16;
        if (!passphrase) throw new Error('هذه النسخة محمية بكلمة مرور — أدخل كلمة المرور');
        key = derivePassphraseKey(passphrase, salt);
      } else {
        key = deriveMachineKey();
      }
      const iv = buf.subarray(off, off + 12); off += 12;
      const tag = buf.subarray(off, off + 16); off += 16;
      const enc = buf.subarray(off);
      const dec = createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);
      return Buffer.concat([dec.update(enc), dec.final()]);
    }
    // Legacy v1 — raw iv|tag|enc, machine key.
    if (buf.length < 28) throw new Error('ملف النسخة الاحتياطية تالف');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const dec = createDecipheriv('aes-256-gcm', deriveMachineKey(), iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(enc), dec.final()]);
  } catch (e) {
    const m = (e as Error).message || '';
    if (/auth|state|bad decrypt/i.test(m)) {
      throw new Error('تعذّر فك التشفير — كلمة المرور غير صحيحة أو الملف تالف أو من جهاز آخر');
    }
    throw e;
  }
}

// ── validation ────────────────────────────────────────────────────────────────

/** Open the decrypted bytes in a throwaway SQLite to prove it's a real, intact DB. */
function validateSqliteBuffer(buf: Buffer): { ok: boolean; error?: string } {
  if (buf.length < 16 || !buf.subarray(0, 16).equals(SQLITE_MAGIC)) {
    return { ok: false, error: 'ليس ملف قاعدة بيانات صالح' };
  }
  const tmp = path.join(os.tmpdir(), `eyespro_vrfy_${Date.now()}.db`);
  try {
    fs.writeFileSync(tmp, buf);
    const d = new Database(tmp, { readonly: true });
    try {
      const ic = d.pragma('integrity_check', { simple: true }) as string;
      if (ic !== 'ok') return { ok: false, error: `فحص السلامة فشل: ${ic}` };
      d.prepare('SELECT COUNT(*) AS c FROM users').get();
      return { ok: true };
    } finally {
      d.close();
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── create / list / prune ─────────────────────────────────────────────────────

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

/** Create a machine-key backup inside the managed backups folder. */
export async function createEncryptedBackup(label = 'manual'): Promise<BackupInfo> {
  const raw = await exportDbBytes();
  const payload = encryptBytes(raw);
  const name = `eyespro_${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.epbak`;
  const filePath = path.join(getBackupDir(), name);
  fs.writeFileSync(filePath, payload);
  try { setSetting('last_backup_at', new Date().toISOString()); } catch { /* ignore */ }
  log.info('backup created', { name, size: payload.length, label });
  return { name, path: filePath, size: payload.length, createdAt: new Date().toISOString() };
}

/** Export a backup to an arbitrary path — optionally passphrase-protected (portable). */
export async function exportBackupTo(destPath: string, passphrase?: string): Promise<BackupInfo> {
  const raw = await exportDbBytes();
  const payload = encryptBytes(raw, passphrase);
  fs.writeFileSync(destPath, payload);
  try { setSetting('last_backup_at', new Date().toISOString()); } catch { /* ignore */ }
  const st = fs.statSync(destPath);
  log.info('backup exported', { destPath, size: payload.length, portable: !!passphrase });
  return { name: path.basename(destPath), path: destPath, size: st.size, createdAt: st.mtime.toISOString() };
}

export function listBackups(): BackupInfo[] {
  const dir = getBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.epbak'))
    .map((f) => {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      return { name: f, path: fp, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pruneBackups(maxKeep = 14): void {
  for (const b of listBackups().slice(maxKeep)) {
    try { fs.unlinkSync(b.path); } catch { /* ignore */ }
  }
}

export function backupStatus(): {
  autoEnabled: boolean;
  lastBackupAt: string | null;
  count: number;
  dir: string;
  totalSize: number;
} {
  const list = listBackups();
  return {
    autoEnabled: getSetting('auto_backup_enabled') !== '0',
    lastBackupAt: getSetting('last_backup_at') || (list[0]?.createdAt ?? null),
    count: list.length,
    dir: getBackupDir(),
    totalSize: list.reduce((s, b) => s + b.size, 0),
  };
}

// ── restore ───────────────────────────────────────────────────────────────────

/**
 * Validate a backup file and STAGE it for restore. We never overwrite the live
 * DB while its connection is open (that races with WAL/checkpoint); instead we
 * drop a `pending-restore.db` that is applied at the next startup before the DB
 * is opened. The caller relaunches the app afterwards.
 */
export function restoreFromBackup(filePath: string, passphrase?: string): void {
  const buf = fs.readFileSync(filePath);
  const bytes = decryptBytes(buf, passphrase);
  const v = validateSqliteBuffer(bytes);
  if (!v.ok) throw new Error(`النسخة الاحتياطية غير صالحة: ${v.error}`);
  fs.writeFileSync(pendingRestorePath(), bytes);
  log.info('restore staged — app will reload DB on next launch', { filePath });
}

/**
 * Applied at startup BEFORE the database is opened. If a staged restore exists,
 * validate it once more, keep a safety copy of the current store, then swap it in.
 */
export function applyPendingRestoreIfAny(): void {
  const pending = pendingRestorePath();
  if (!fs.existsSync(pending)) return;
  try {
    const bytes = fs.readFileSync(pending);
    const v = validateSqliteBuffer(bytes);
    if (!v.ok) {
      log.error('staged restore invalid — discarding', { error: v.error });
      fs.unlinkSync(pending);
      return;
    }
    const storePath = getDbPath();
    const workingPath = getDbWorkingPath();
    // Safety copy of the current store so a bad restore is recoverable.
    if (fs.existsSync(storePath)) {
      try { fs.copyFileSync(storePath, `${storePath}.pre-restore-${Date.now()}`); } catch { /* ignore */ }
    }
    const encrypt = fs.existsSync(storePath) ? isEncryptedFile(storePath) : true;
    saveDatabaseFile(storePath, bytes, getDataDir(), encrypt);
    // Drop the stale working copy + WAL/SHM so the DB is rebuilt from the restored store.
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(workingPath + ext); } catch { /* ignore */ }
    }
    fs.unlinkSync(pending);
    log.info('staged restore applied to store', { storePath, encrypted: encrypt });
  } catch (e) {
    log.error('apply staged restore failed', { error: (e as Error).message });
  }
}

// ── scheduling ────────────────────────────────────────────────────────────────

export function scheduleDailyBackups(): void {
  const day = 24 * 60 * 60 * 1000;
  const run = async () => {
    if (getSetting('auto_backup_enabled') === '0') return;
    try {
      await createEncryptedBackup('auto');
      pruneBackups(14);
    } catch (e) {
      log.warn('scheduled backup failed', { error: (e as Error).message });
    }
  };
  setInterval(() => void run(), day);
  setTimeout(() => void run(), 60_000);
}
