/**
 * Unit tests for the YouTube adapter connection check. Network fully mocked.
 * (This adapter exposes only test(); video publishing lives in the video pipeline.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { test as testConnection } from '../src/main/services/social-adapters/youtube';

describe('youtube adapter — test()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails without access_token (no network call)', async () => {
    expect((await testConnection({})).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the channel title on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ items: [{ snippet: { title: 'Eyes Pro News' } }] }),
    });
    expect(await testConnection({ access_token: 'T' })).toEqual({ ok: true, info: 'Eyes Pro News' });
  });

  it('falls back to a default label when no channel items are returned', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    expect(await testConnection({ access_token: 'T' })).toEqual({ ok: true, info: 'YouTube Channel' });
  });

  it('returns an error on a non-200 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 401, text: async () => 'Unauthorized' });
    const res = await testConnection({ access_token: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });
});
