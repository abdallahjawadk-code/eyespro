/**
 * Backup / restore round-trip — data-loss-critical path.
 * Verifies: snapshot → encrypt → decrypt → integrity-validate → stage → apply,
 * plus passphrase portability (wrong/missing password must fail closed).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupTestDb, teardownTestDb, insertRawUser } from './helpers/test-db';
import {
  createEncryptedBackup,
  exportBackupTo,
  restoreFromBackup,
  applyPendingRestoreIfAny,
  listBackups,
} from '../src/main/services/backup';
import { getDataDir, getDbPath } from '../src/main/db/paths';

const dataDir = '/tmp/eyespro-test'; // app.getPath() mock returns this for every key
function cleanDataDir() {
  try { fs.rmSync(getDataDir(), { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('backup round-trip', () => {
  beforeEach(() => {
    cleanDataDir();
    const db = setupTestDb();
    insertRawUser(db, { username: 'owner' });
    db.prepare(`INSERT INTO articles (title, status) VALUES ('canary', 'draft')`).run();
  });
  afterEach(() => { teardownTestDb(); cleanDataDir(); });

  it('creates an encrypted machine-key backup and lists it', async () => {
    const b = await createEncryptedBackup('test');
    expect(fs.existsSync(b.path)).toBe(true);
    expect(b.size).toBeGreaterThan(1000);
    // Encrypted: the raw file must NOT contain the SQLite magic in cleartext.
    const raw = fs.readFileSync(b.path);
    expect(raw.subarray(0, 16).toString()).not.toContain('SQLite');
    expect(listBackups().some((x) => x.path === b.path)).toBe(true);
  });

  it('stages a valid SQLite snapshot on restore (machine key)', async () => {
    const b = await createEncryptedBackup('test');
    restoreFromBackup(b.path);
    const pending = path.join(getDataDir(), 'pending-restore.db');
    expect(fs.existsSync(pending)).toBe(true);
    // Staged bytes must be a real, openable DB carrying our canary row.
    const staged = new Database(pending, { readonly: true });
    const row = staged.prepare(`SELECT title FROM articles WHERE title='canary'`).get() as { title: string };
    staged.close();
    expect(row?.title).toBe('canary');
  });

  it('applies a staged restore into the store and clears the pending file', () => {
    const buf = fs.readFileSync(makeTempDb());
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(path.join(getDataDir(), 'pending-restore.db'), buf);
    applyPendingRestoreIfAny();
    expect(fs.existsSync(path.join(getDataDir(), 'pending-restore.db'))).toBe(false);
    expect(fs.existsSync(getDbPath())).toBe(true);
  });

  it('portable backup requires the correct passphrase', async () => {
    const dest = path.join(os.tmpdir(), `eyespro_portable_${Date.now()}.epbak`);
    await exportBackupTo(dest, 'correct horse');
    try {
      // No passphrase → must throw (fail closed).
      expect(() => restoreFromBackup(dest)).toThrow();
      // Wrong passphrase → must throw.
      expect(() => restoreFromBackup(dest, 'wrong pass')).toThrow();
      // Correct passphrase → stages successfully.
      restoreFromBackup(dest, 'correct horse');
      expect(fs.existsSync(path.join(getDataDir(), 'pending-restore.db'))).toBe(true);
    } finally {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    }
  });

  it('rejects a corrupt / non-SQLite backup', () => {
    const bad = path.join(os.tmpdir(), `eyespro_bad_${Date.now()}.epbak`);
    fs.writeFileSync(bad, Buffer.from('not a backup at all'));
    try {
      expect(() => restoreFromBackup(bad)).toThrow();
    } finally {
      try { fs.unlinkSync(bad); } catch { /* ignore */ }
    }
  });
});

/** A throwaway on-disk SQLite file with the minimal schema validate() checks for. */
function makeTempDb(): string {
  const p = path.join(os.tmpdir(), `eyespro_src_${Date.now()}.db`);
  const d = new Database(p);
  d.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  d.prepare('INSERT INTO users (id) VALUES (1)').run();
  d.close();
  return p;
}

void dataDir;
