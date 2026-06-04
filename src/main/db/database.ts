import { app } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger';
import { hashPassword } from '../security/password';
import { isEncryptedFile, loadDatabaseFile } from './at-rest';
import { runMigrations } from './migrations';
import { bindDbPersist, flushDbSync, scheduleDbSave } from './persist';
import { getDataDir, getDbPath, getDbWorkingPath } from './paths';

const log = createLogger('db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export { getDbPath, getDbWorkingPath };

/** SQLite magic bytes — first 16 bytes of every valid SQLite 3 database file */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');

function isValidSqliteFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    return read === 16 && head.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function prepareWorkingFile(): void {
  const storePath = getDbPath();
  const workingPath = getDbWorkingPath();
  const dataDir = getDataDir();

  if (fs.existsSync(workingPath)) {
    // Validate it's a real SQLite file — it could be zeroed-out from a crashed
    // secure-delete attempt in shutdownDatabase(), which would cause a
    // "file is not a database" error on next open.
    if (isValidSqliteFile(workingPath)) return;

    log.warn('working db file is corrupt/zeroed — recreating from store', { workingPath });
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(workingPath + ext); } catch { /* ignore */ }
    }
  }

  if (fs.existsSync(storePath)) {
    const buf = isEncryptedFile(storePath)
      ? loadDatabaseFile(storePath, dataDir)
      : fs.readFileSync(storePath);
    fs.writeFileSync(workingPath, buf);
    return;
  }

  // First run — no store file yet, database will be created fresh at workingPath
}

export function initDatabase(): void {
  prepareWorkingFile();
  const openPath = getDbWorkingPath();

  db = new Database(openPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -16000');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  seedIfEmpty();
  bindDbPersist(db);

  log.info('database ready', { openPath });
}

export function touchDbSave(): void {
  scheduleDbSave();
}

export function shutdownDatabase(): void {
  try {
    flushDbSync();
  } catch (e) {
    log.error('shutdown flush failed', { error: (e as Error).message });
  }
  db?.close();
  db = null;

  try {
    const workingPath = getDbWorkingPath();
    const walPath = `${workingPath}-wal`;
    const shmPath = `${workingPath}-shm`;
    
    [workingPath, walPath, shmPath].forEach((fp) => {
      if (fs.existsSync(fp)) {
        try {
          const size = fs.statSync(fp).size;
          if (size > 0) {
            // Overwrite file contents with zeros to secure data at rest (shredding)
            fs.writeFileSync(fp, Buffer.alloc(size));
          }
          fs.unlinkSync(fp);
        } catch (e) {
          log.error('Failed to securely delete working db file', { path: fp, error: (e as Error).message });
        }
      }
    });
    log.info('plaintext working database files securely cleaned up');
  } catch (e) {
    log.error('secure db cleanup failed', { error: (e as Error).message });
  }
}

function seedIfEmpty(): void {
  const d = getDb();
  const count = d.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return;

  const tempPass = randomToken(12);
  const { hash, salt } = hashPassword(tempPass);
  d.prepare(
    `INSERT INTO users (username, password_hash, salt, role, email) VALUES (?, ?, ?, 'super_admin', ?)`
  ).run('admin', hash, salt, 'admin@eyespro.app');

  d.prepare(`INSERT INTO settings (key, value) VALUES ('ui_language', 'ar')`).run();
  d.prepare(`INSERT INTO settings (key, value) VALUES ('ui_theme', 'dark')`).run();
  d.prepare(`INSERT INTO settings (key, value) VALUES ('app_copyright', '© Masar Network — All rights reserved')`).run();
  d.prepare(`INSERT INTO settings (key, value) VALUES ('auto_login', '1')`).run();

  // Sample articles + demo source are seeded for development only — production
  // ships a clean database with no demo content. NODE_ENV is unset in a packaged
  // Electron app, so app.isPackaged is the only reliable production signal here.
  const isDev = !app.isPackaged;
  if (isDev) {
    const samples = [
      ['عنوان مقال تجريبي', 'pending', 'سياسة', 'ملخص تجريبي', 'محتوى المقال…'],
      ['Sample article title', 'published', 'tech', 'Summary', 'Article body…'],
      ['خبر عاجل — مسودة', 'draft', 'عام', '', '']
    ];
    const ins = d.prepare(
      `INSERT INTO articles (title, status, category, summary, content) VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of samples) ins.run(...row);

    d.prepare(`INSERT INTO sources (name, url, enabled) VALUES (?, ?, 1)`).run(
      'Reuters RSS',
      'https://feeds.reuters.com/reuters/worldNews'
    );

    /* eslint-disable no-console */
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Masar Network] © Masar Network — First run default login:');
    console.log('  Username: admin');
    console.log(`  Password: ${tempPass}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    /* eslint-enable no-console */
  }
}

function randomToken(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i]! % chars.length]!;
  return out;
}
