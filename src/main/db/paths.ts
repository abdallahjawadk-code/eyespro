import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function getDataDir(): string {
  const dir = path.join(app.getPath('userData'), 'EyesPro');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Encrypted or plain persisted database file */
export function getDbPath(): string {
  return path.join(getDataDir(), 'eyespro.db');
}

/** Runtime working copy (plaintext SQLite + WAL) */
export function getDbWorkingPath(): string {
  return path.join(getDataDir(), 'eyespro.db.working');
}

export function getBackupDir(): string {
  const dir = path.join(getDataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
