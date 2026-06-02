import { app } from 'electron';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../db/database';
import { getBackupDir, getDbPath, getDbWorkingPath } from '../db/paths';
import { createLogger } from '../logger';

const log = createLogger('backup');

function deriveKey(): Buffer {
  const machine = os.hostname() + app.getPath('userData');
  return createHash('sha256').update('EyesPro-backup-v1-' + machine).digest();
}

async function exportDbBytes(): Promise<Buffer> {
  const db = getDb();
  if (typeof db.backup === 'function') {
    const tmp = path.join(os.tmpdir(), `eyespro_bak_${Date.now()}.db`);
    try {
      await db.backup(tmp);
      return fs.readFileSync(tmp);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  return fs.readFileSync(getDbWorkingPath());
}

export async function createEncryptedBackup(label = 'manual'): Promise<{
  ok: true;
  path: string;
  name: string;
  size: number;
}> {
  const raw = await exportDbBytes();
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(raw), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]);
  const name = `eyespro_${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.epbak`;
  const filePath = path.join(getBackupDir(), name);
  fs.writeFileSync(filePath, payload);
  return { ok: true, path: filePath, name, size: payload.length };
}

export function listBackups(): { name: string; path: string; size: number; createdAt: string }[] {
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
    try {
      fs.unlinkSync(b.path);
    } catch {
      /* ignore */
    }
  }
}

export function scheduleDailyBackups(): void {
  const day = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await createEncryptedBackup('auto');
      pruneBackups(14);
    } catch (e) {
      log.warn('scheduled backup failed', { error: (e as Error).message });
    }
  }, day);
  setTimeout(async () => {
    try {
      await createEncryptedBackup('auto');
      pruneBackups(14);
    } catch (e) {
      log.warn('startup backup failed', { error: (e as Error).message });
    }
  }, 60_000);
}

export function decryptBackupFile(filePath: string): Buffer {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 28) throw new Error('Backup file corrupted');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export function restoreFromBackup(filePath: string): void {
  const workingPath = getDbWorkingPath();
  const storePath = getDbPath();
  const bytes = decryptBackupFile(filePath);
  const pre = `${storePath}.pre-restore-${Date.now()}`;
  if (fs.existsSync(storePath)) fs.copyFileSync(storePath, pre);
  fs.writeFileSync(workingPath, bytes);
  fs.writeFileSync(storePath, bytes);
  log.info('backup restored — restart app to reload DB', { filePath, pre });
}
