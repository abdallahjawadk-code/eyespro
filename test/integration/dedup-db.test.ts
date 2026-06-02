import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import type Database from 'better-sqlite3';

// Also mock tenant for this module
import { vi } from 'vitest';
vi.mock('../../src/main/services/tenant', () => ({
  tenantSqlClause: () => ({ sql: '', params: [] }),
  getActiveTenantId: () => null,
}));

let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => teardownTestDb());

import { simhash, hammingDistance, storeSimhash, findNearDuplicates, articleSimhash } from '../../src/main/services/dedup';

function insertArticle(title: string, summary = ''): number {
  const r = db.prepare(`INSERT INTO articles (title, summary, status) VALUES (?, ?, 'draft')`).run(title, summary);
  return Number(r.lastInsertRowid);
}

describe('dedup integration (real SQLite)', () => {
  it('storeSimhash writes a non-zero hash to the DB', () => {
    const id = insertArticle('رئيس الوزراء يعقد اجتماعاً طارئاً', 'تفاصيل الاجتماع');
    storeSimhash(id, 'رئيس الوزراء يعقد اجتماعاً طارئاً', 'تفاصيل الاجتماع');
    type Row = { simhash: number };
    const row = db.prepare('SELECT simhash FROM articles WHERE id = ?').get(id) as Row;
    expect(row.simhash).not.toBe(0);
    expect(typeof row.simhash).toBe('number');
  });

  it('storeSimhash is consistent for the same content', () => {
    const id1 = insertArticle('اختبار التكرار', 'ملخص متطابق');
    const id2 = insertArticle('اختبار التكرار', 'ملخص متطابق');
    storeSimhash(id1, 'اختبار التكرار', 'ملخص متطابق');
    storeSimhash(id2, 'اختبار التكرار', 'ملخص متطابق');
    type Row = { simhash: number };
    const h1 = (db.prepare('SELECT simhash FROM articles WHERE id = ?').get(id1) as Row).simhash;
    const h2 = (db.prepare('SELECT simhash FROM articles WHERE id = ?').get(id2) as Row).simhash;
    expect(h1).toBe(h2);
  });

  it('findNearDuplicates finds near-duplicate articles', () => {
    const base = 'الرئيس يزور المنطقة الشمالية ويلتقي بالمسؤولين المحليين';
    const similar = 'الرئيس يزور المنطقة الشمالية ويلتقي المسؤولين المحليين'; // one word different

    const id = insertArticle(base, '');
    storeSimhash(id, base, '');

    const matches = findNearDuplicates(similar, '', 6);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe(id);
    expect(matches[0].similarity).toBeGreaterThan(0.7);
  });

  it('findNearDuplicates does not flag clearly different articles', () => {
    const id = insertArticle('أسعار النفط ترتفع مع تراجع المخزونات', '');
    storeSimhash(id, 'أسعار النفط ترتفع مع تراجع المخزونات', '');

    const matches = findNearDuplicates('فريق كرة القدم يحقق فوزاً ساحقاً في الدوري', '', 4);
    expect(matches.length).toBe(0);
  });

  it('findNearDuplicates returns empty when no articles have simhash', () => {
    insertArticle('مقال بدون هاش', '');
    // No storeSimhash call → simhash column is NULL
    const matches = findNearDuplicates('أي نص', '', 4);
    expect(matches.length).toBe(0);
  });

  it('similarity is 1.0 for identical articles', () => {
    const text = 'عنوان المقال المتطابق';
    const id = insertArticle(text, '');
    storeSimhash(id, text, '');

    const matches = findNearDuplicates(text, '', 4);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].similarity).toBeCloseTo(1.0, 1);
  });

  it('hammingDistance is 0 between two identical simhashes', () => {
    const h = simhash('نص تجريبي');
    expect(hammingDistance(h, h)).toBe(0);
  });

  it('articleSimhash puts more weight on title than summary', () => {
    const base = articleSimhash('عنوان مهم', 'ملخص طويل جداً جداً جداً');
    const titleChanged = articleSimhash('عنوان مختلف كلياً', 'ملخص طويل جداً جداً جداً');
    const summaryChanged = articleSimhash('عنوان مهم', 'ملخص مختلف كلياً وبمحتوى آخر تماماً');
    expect(hammingDistance(base, titleChanged)).toBeGreaterThanOrEqual(
      hammingDistance(base, summaryChanged)
    );
  });
});
