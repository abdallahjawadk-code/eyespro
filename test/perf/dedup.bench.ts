/**
 * Performance benchmarks — SimHash / dedup hot path
 *
 * Run: npx vitest bench test/perf/dedup.bench.ts
 *
 * Baselines (dev laptop, Node 20):
 *   simhash(100-char string) ~300 µs/op
 *   hammingDistance           ~1 ns/op
 *   sanitizeString            ~1 µs/op
 */
import { bench, describe } from 'vitest';
import { simhash, hammingDistance, articleSimhash } from '../../src/main/services/dedup';
import { sanitizeString, sanitizeUsername } from '../../src/main/security/sanitize';

const SHORT = 'إصلاح أزمة الطاقة في محافظة البصرة';
const MEDIUM = SHORT.repeat(5);
const LONG = SHORT.repeat(20);

describe('simhash', () => {
  bench('short title (~36 chars)', () => {
    simhash(SHORT);
  });

  bench('medium text (~180 chars)', () => {
    simhash(MEDIUM);
  });

  bench('long text (~720 chars)', () => {
    simhash(LONG);
  });

  bench('articleSimhash (title + summary)', () => {
    articleSimhash(SHORT, MEDIUM);
  });
});

describe('hammingDistance', () => {
  const h1 = simhash(SHORT);
  const h2 = simhash(SHORT + ' يستمر');

  bench('two similar hashes', () => {
    hammingDistance(h1, h2);
  });

  bench('identical hashes', () => {
    hammingDistance(h1, h1);
  });

  bench('completely different hashes', () => {
    hammingDistance(0xAAAA5555, 0x5555AAAA);
  });
});

describe('sanitize', () => {
  const clean = 'Breaking news: الأمم المتحدة تعقد اجتماعاً طارئاً';
  const dirty = 'user\x00input\x1Fwithcontrols ' + 'a'.repeat(600);

  bench('sanitizeString — clean input', () => {
    sanitizeString(clean);
  });

  bench('sanitizeString — dirty input + truncation', () => {
    sanitizeString(dirty);
  });

  bench('sanitizeUsername', () => {
    sanitizeUsername('  Admin_User@news.com ');
  });
});
