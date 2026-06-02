import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../src/shared/html-sanitize';

describe('html-sanitize', () => {
  it('strips script tags', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out.includes('<script')).toBe(false);
    expect(out.includes('ok')).toBe(true);
  });

  it('strips onerror handlers', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(out.includes('onerror')).toBe(false);
  });
});
