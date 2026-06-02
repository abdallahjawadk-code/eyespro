import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeUsername, sanitizeInt } from '../src/main/security/sanitize';

describe('sanitizeString', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
  });

  it('strips control characters', () => {
    expect(sanitizeString('hello\x00world')).toBe('helloworld');
    expect(sanitizeString('line\x0Anewline')).toBe('linenewline');
    expect(sanitizeString('tab\x09here')).toBe('tabhere');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('truncates to maxLen', () => {
    expect(sanitizeString('abcdef', 3)).toBe('abc');
  });

  it('converts non-string input to string', () => {
    expect(sanitizeString(42)).toBe('42');
    expect(sanitizeString(true)).toBe('true');
  });

  it('defaults maxLen to 500', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeString(long).length).toBe(500);
  });

  it('preserves Arabic text', () => {
    const arabic = 'مقال إخباري مهم';
    expect(sanitizeString(arabic)).toBe(arabic);
  });
});

describe('sanitizeUsername', () => {
  it('allows alphanumeric, dot, underscore, dash, @', () => {
    expect(sanitizeUsername('user_name.test@domain-1')).toBe('user_name.test@domain-1');
  });

  it('strips spaces and special chars', () => {
    expect(sanitizeUsername('user name!')).toBe('username');
  });

  it('strips Arabic characters', () => {
    expect(sanitizeUsername('مستخدم')).toBe('');
  });

  it('truncates to 64 chars', () => {
    expect(sanitizeUsername('a'.repeat(100)).length).toBe(64);
  });

  it('returns empty string for null', () => {
    expect(sanitizeUsername(null)).toBe('');
  });
});

describe('sanitizeInt', () => {
  it('returns min for NaN input', () => {
    expect(sanitizeInt('abc', 5)).toBe(5);
    expect(sanitizeInt(null, 0)).toBe(0);
  });

  it('clamps to min', () => {
    expect(sanitizeInt(-10, 0)).toBe(0);
    expect(sanitizeInt(3, 5)).toBe(5);
  });

  it('clamps to max', () => {
    expect(sanitizeInt(999, 0, 100)).toBe(100);
  });

  it('parses valid string integers', () => {
    expect(sanitizeInt('42', 0)).toBe(42);
  });

  it('rounds down floats', () => {
    expect(sanitizeInt('3.9', 0)).toBe(3);
  });

  it('handles very large numbers', () => {
    expect(sanitizeInt(2_000_000, 0, 1_000_000)).toBe(1_000_000);
  });
});
