/**
 * Shared helper for integration tests that need a real SQLite database.
 * Creates an in-memory DB with all migrations applied.
 * Must be imported BEFORE the module under test so the vi.mock hoisting works.
 */
import Database from 'better-sqlite3';
import { vi } from 'vitest';
import { runMigrations } from '../../src/main/db/migrations';

// Module-level reference updated by setupTestDb / teardownTestDb
let _db: Database.Database | null = null;

// Mock electron modules that can't run outside Electron
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  app: { getPath: () => '/tmp/eyespro-test' },
  ipcRenderer: {},
}));

vi.mock('../../src/main/db/database', () => ({
  getDb: () => {
    if (!_db) throw new Error('Test DB not initialized — call setupTestDb() first');
    return _db;
  },
}));

export function setupTestDb(): Database.Database {
  _db = new Database(':memory:');
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
  return _db;
}

export function teardownTestDb(): void {
  _db?.close();
  _db = null;
}

/** Insert a minimal user row directly (no argon2, just for FK constraints). */
export function insertRawUser(
  db: Database.Database,
  opts: { username?: string; role?: string } = {}
): number {
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, salt, role, is_active)
       VALUES (?, 'hash', 'salt', ?, 1)`
    )
    .run(opts.username ?? 'testuser', opts.role ?? 'super_admin');
  return Number(r.lastInsertRowid);
}
