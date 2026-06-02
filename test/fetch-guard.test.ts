import { describe, it, expect } from 'vitest';
import { isUrlFetchAllowed } from '../src/main/security/url-policy';

describe('url-policy', () => {
  it('blocks localhost-style hosts', () => {
    expect(isUrlFetchAllowed('http://127.0.0.1/test').ok).toBe(false);
  });

  it('blocks invalid scheme', () => {
    expect(isUrlFetchAllowed('javascript:alert(1)').ok).toBe(false);
  });

  it('allows https public url', () => {
    expect(isUrlFetchAllowed('https://example.com/rss').ok).toBe(true);
  });
});
