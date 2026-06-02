import { describe, it, expect, vi } from 'vitest';

// Mock DB dependencies before importing the module under test
vi.mock('../src/main/db/database', () => ({ getDb: vi.fn() }));
vi.mock('../src/main/services/tenant', () => ({
  tenantSqlClause: () => ({ sql: '', params: [] }),
}));

import { simhash, hammingDistance, articleSimhash } from '../src/main/services/dedup';

describe('hammingDistance', () => {
  it('returns 0 for identical values', () => {
    expect(hammingDistance(0xDEADBEEF, 0xDEADBEEF)).toBe(0);
  });

  it('returns 1 for values differing in one bit', () => {
    expect(hammingDistance(0b0001, 0b0011)).toBe(1);
  });

  it('returns 32 for all-zeroes vs all-ones', () => {
    expect(hammingDistance(0x00000000, 0xFFFFFFFF)).toBe(32);
  });

  it('is symmetric', () => {
    const a = 0xABCD1234;
    const b = 0x12345678;
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });
});

describe('simhash', () => {
  it('returns 0 for empty string', () => {
    expect(simhash('')).toBe(0);
  });

  it('returns a number for any text', () => {
    const h = simhash('مقال إخباري عن السياسة الدولية');
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('returns consistent results for the same input', () => {
    const text = 'breaking news about technology';
    expect(simhash(text)).toBe(simhash(text));
  });

  it('produces different hashes for clearly different texts', () => {
    const h1 = simhash('أخبار الرياضة اليومية');
    const h2 = simhash('الطقس غداً ممطر في الشمال');
    // These are very different — distance should be well above 4
    expect(hammingDistance(h1, h2)).toBeGreaterThan(4);
  });

  it('produces near-identical hashes for near-identical texts', () => {
    const base = 'الرئيس يعقد اجتماعاً مع المسؤولين لمناقشة الملف الاقتصادي';
    const tweaked = 'الرئيس يعقد اجتماعاً مع المسؤولين لمناقشة الملف الاقتصادي.';
    const dist = hammingDistance(simhash(base), simhash(tweaked));
    expect(dist).toBeLessThanOrEqual(6);
  });
});

describe('articleSimhash', () => {
  it('returns a number', () => {
    const h = articleSimhash('عنوان المقال', 'ملخص المقال هنا');
    expect(typeof h).toBe('number');
  });

  it('is consistent', () => {
    const h1 = articleSimhash('عنوان', 'ملخص');
    const h2 = articleSimhash('عنوان', 'ملخص');
    expect(h1).toBe(h2);
  });

  it('weights title more than summary', () => {
    // Changing the title should produce larger distance than changing the summary
    const base = articleSimhash('عنوان مهم جداً', 'ملخص طويل ومفيد عن الموضوع الرئيسي');
    const changedTitle = articleSimhash('عنوان مختلف كلياً', 'ملخص طويل ومفيد عن الموضوع الرئيسي');
    const changedSummary = articleSimhash('عنوان مهم جداً', 'ملخص مختلف تماماً وبمحتوى آخر');
    const distTitle = hammingDistance(base, changedTitle);
    const distSummary = hammingDistance(base, changedSummary);
    // Title has 3× weight, so changing it should be at least as impactful
    expect(distTitle).toBeGreaterThanOrEqual(distSummary);
  });
});
