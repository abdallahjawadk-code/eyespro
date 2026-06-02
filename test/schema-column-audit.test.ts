/**
 * PROACTIVE schema/column audit — catches the class of bug fixed in v50 (keyword_alerts)
 * and v51 (role_permissions): a service writing columns that don't exist in the migrated
 * schema. We build the real schema from a fully-migrated DB, then scan every main-process
 * source file for `INSERT INTO <table> (cols)` and `UPDATE <table> SET col=...` and assert
 * each referenced column actually exists on that table.
 *
 * Scope: INSERT column lists + UPDATE SET targets (high signal, where both real bugs lived).
 * SELECT/WHERE are intentionally not parsed (too many false positives from joins/aliases).
 */
import { describe, it, expect } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers/test-db';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const clean = (s: string) => s.replace(/[`"[\]]/g, '').trim().toLowerCase();

describe('proactive schema/column audit', () => {
  it('every INSERT/UPDATE column written by services exists in the migrated schema', () => {
    const db = setupTestDb();
    const tableNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
      .map((r) => r.name);
    const schema: Record<string, Set<string>> = {};
    for (const t of tableNames) {
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name.toLowerCase());
      schema[t.toLowerCase()] = new Set(cols);
    }
    teardownTestDb();

    const root = join(process.cwd(), 'src', 'main');
    const files = walk(root).filter((f) => !f.replace(/\\/g, '/').endsWith('src/main/db/migrations.ts'));

    const INSERT_RE = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([`"[\]\w]+)\s*\(([^)]*)\)/gis;
    const UPDATE_RE = /UPDATE\s+([`"[\]\w]+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|`|;)/gi;
    const IDENT = /^[a-z_][a-z0-9_]*$/;          // a real, parseable column name
    const IMPLICIT = new Set(['rowid', 'docid', 'oid', '_rowid_']); // implicit/FTS columns

    const violations: string[] = [];
    const note = (file: string, msg: string) => violations.push(`${file.replace(/\\/g, '/').replace(/.*src\/main\//, 'src/main/')}: ${msg}`);
    const checkCol = (file: string, table: string, col: string, kind: string) => {
      if (!IDENT.test(col) || IMPLICIT.has(col)) return; // skip parse artifacts / implicit cols
      if (!schema[table].has(col)) note(file, `${kind} ${table}.${col} — no such column`);
    };

    for (const f of files) {
      // Strip ${...} template interpolations so they don't leak into column tokens.
      const src = readFileSync(f, 'utf8').replace(/\$\{[^}]*\}/g, ' ');

      for (const m of src.matchAll(INSERT_RE)) {
        const table = clean(m[1]);
        if (!table || !schema[table]) continue; // skip dynamic/unknown tables
        for (const raw of m[2].split(',')) checkCol(f, table, clean(raw.split(/\s/)[0] ?? ''), 'INSERT');
      }

      for (const m of src.matchAll(UPDATE_RE)) {
        const table = clean(m[1]);
        if (!table || !schema[table]) continue;
        for (const assign of m[2].split(',')) {
          const lhs = assign.split('=')[0] ?? '';
          checkCol(f, table, clean(lhs.trim().split(/\s|\./).pop() ?? ''), 'UPDATE');
        }
      }
    }

    if (violations.length) {
      throw new Error(`Schema/column mismatches found (service writes a column the schema lacks):\n  ${violations.join('\n  ')}`);
    }
    expect(violations).toEqual([]);
  });
});
