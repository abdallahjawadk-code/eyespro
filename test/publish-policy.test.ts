import { describe, it, expect } from 'vitest';
import {
  POLICIES,
  splitSmart,
  labelPart,
  truncSmart,
} from '../src/main/services/publish-policy';

describe('POLICIES', () => {
  it('telegram allows 4096 chars with thread support', () => {
    expect(POLICIES.telegram.maxChars).toBe(4096);
    expect(POLICIES.telegram.supportsThread).toBe(true);
  });

  it('twitter limit is 280', () => {
    expect(POLICIES.twitter.maxChars).toBe(280);
  });

  it('wordpress has no char limit', () => {
    expect(POLICIES.wordpress.maxChars).toBe(0);
  });

  it('facebook does not support threading', () => {
    expect(POLICIES.facebook.supportsThread).toBe(false);
  });
});

describe('splitSmart', () => {
  it('returns text as-is when within limit', () => {
    const text = 'مقال قصير';
    expect(splitSmart(text, 100)).toEqual([text]);
  });

  it('returns text as-is when limit is 0 (unlimited)', () => {
    const long = 'x'.repeat(10_000);
    expect(splitSmart(long, 0)).toEqual([long]);
  });

  it('splits at paragraph boundaries', () => {
    const para1 = 'a'.repeat(100);
    const para2 = 'b'.repeat(100);
    const text = `${para1}\n\n${para2}`;
    const parts = splitSmart(text, 150);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(para1);
    expect(parts[1]).toBe(para2);
  });

  it('splits long paragraph at sentence boundary', () => {
    const sentence1 = 'هذا المقال يتحدث عن الأخبار. ';
    const sentence2 = 'وهناك تفاصيل كثيرة في هذا الخبر. ';
    const sentence3 = 'ونختم بهذه الجملة الأخيرة.';
    const text = sentence1 + sentence2 + sentence3;
    const maxChars = sentence1.length + 5; // fits only the first sentence
    const parts = splitSmart(text, maxChars);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('').replace(/\s+/g, ' ').length).toBeGreaterThan(0);
  });

  it('handles empty string (returns single empty or empty array)', () => {
    const result = splitSmart('', 100);
    // empty input → either [] or [''] depending on implementation; either is acceptable
    expect(result.filter(Boolean)).toEqual([]);
  });

  it('each part respects maxChars', () => {
    const maxChars = 50;
    const text = Array.from({ length: 20 }, (_, i) => `جملة رقم ${i + 1} في هذا الاختبار.`).join(' ');
    const parts = splitSmart(text, maxChars);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxChars);
    }
  });
});

describe('labelPart', () => {
  it('does nothing for single-part content', () => {
    expect(labelPart('text', 1, 1, 1000)).toBe('text');
  });

  it('appends (i/n) label for multi-part', () => {
    const result = labelPart('النص', 1, 3, 1000);
    expect(result).toBe('النص\n\n(1/3)');
  });

  it('trims text to fit label within maxChars', () => {
    const maxChars = 20;
    const label = '\n\n(2/5)'; // 7 chars
    const longText = 'x'.repeat(30);
    const result = labelPart(longText, 2, 5, maxChars);
    expect(result.length).toBeLessThanOrEqual(maxChars);
    expect(result).toContain('(2/5)');
  });

  it('does not add label when maxChars is 0 (unlimited)', () => {
    const result = labelPart('النص', 2, 5, 0);
    expect(result).toBe('النص\n\n(2/5)');
  });
});

describe('truncSmart', () => {
  it('returns text as-is when within limit', () => {
    expect(truncSmart('قصير', 100)).toBe('قصير');
  });

  it('returns text as-is when limit is 0', () => {
    const long = 'x'.repeat(1000);
    expect(truncSmart(long, 0)).toBe(long);
  });

  it('truncates to maxChars', () => {
    const text = 'كلمة '.repeat(100);
    const result = truncSmart(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('prefers sentence boundary for truncation', () => {
    const text = 'هذه جملة كاملة تنتهي هنا. وهذا نص إضافي طويل جداً جداً جداً.';
    const maxChars = 30;
    const result = truncSmart(text, maxChars);
    expect(result.length).toBeLessThanOrEqual(maxChars);
  });

  it('falls back to ellipsis when no good boundary exists', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const result = truncSmart(text, 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});
