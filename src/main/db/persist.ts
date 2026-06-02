import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { createLogger } from '../logger';
import { getSetting } from '../services/settings';
import { saveDatabaseFile } from './at-rest';
import { getDataDir, getDbPath, getDbWorkingPath } from './paths';

const log = createLogger('db-persist');
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaveAt: string | null = null;
let dbRef: Database.Database | null = null;

export function bindDbPersist(db: Database.Database): void {
  dbRef = db;
}

/** SQLite file magic — first 16 bytes of every valid SQLite 3 file */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');

export function flushDbSync(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dbRef) return;
  const workingPath = getDbWorkingPath();
  const storePath = getDbPath();
  const encrypt = getSetting('db_encryption_at_rest') === '1';
  try {
    dbRef.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
  if (!fs.existsSync(workingPath)) return;
  const plain = fs.readFileSync(workingPath);

  // Safety valve: never overwrite the encrypted store with an invalid
  // (zeroed / truncated) working file. This can happen if the process
  // was interrupted mid-secure-delete and a stale timer fires later.
  if (plain.length < 16 || !plain.subarray(0, 16).equals(SQLITE_MAGIC)) {
    log.error('flushDbSync: working file is not a valid SQLite DB — refusing to overwrite store', {
      workingPath,
      firstBytes: plain.subarray(0, 8).toString('hex'),
    });
    return;
  }

  saveDatabaseFile(storePath, plain, getDataDir(), encrypt);
  lastSaveAt = new Date().toISOString();
}

export function scheduleDbSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      flushDbSync();
    } catch (e) {
      log.error('scheduled db save failed', { error: (e as Error).message });
    }
  }, DEBOUNCE_MS);
}

export function getLastDbSaveAt(): string | null {
  return lastSaveAt;
}

export function dbEncryptionEnabled(): boolean {
  return getSetting('db_encryption_at_rest') === '1';
}
