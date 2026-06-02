/**
 * Unit tests for the LinkedIn Posts API adapter. Network fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { postJsonMock } = vi.hoisted(() => ({ postJsonMock: vi.fn() }));
vi.mock('../src/main/net/http', () => ({ postJson: postJsonMock }));

import { publish, test as testConnection } from '../src/main/services/social-adapters/linkedin';

const cfg = { access_token: 'TK', author_urn: 'urn:li:person:1' };

describe('linkedin adapter — publish()', () => {
  beforeEach(() => { postJsonMock.mockReset(); });

  it('requires access_token and author_urn before any network call', async () => {
    expect((await publish('hi', undefined, { author_urn: 'u' })).error).toContain('access_token');
    expect((await publish('hi', undefined, { access_token: 'T' })).error).toContain('author_urn');
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('posts the correct payload + versioned headers and derives id/url from x-restli-id', async () => {
    postJsonMock.mockResolvedValue({ ok: true, status: 201, body: '', headers: { 'x-restli-id': 'urn:li:share:99' } });
    const res = await publish('Hello LinkedIn', undefined, cfg);

    expect(res).toEqual({
      ok: true,
      postId: 'urn:li:share:99',
      postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent('urn:li:share:99')}`,
    });
    const [url, payload, headers] = postJsonMock.mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(payload).toMatchObject({
      author: 'urn:li:person:1',
      commentary: 'Hello LinkedIn',
      visibility: 'PUBLIC',
      lifecycleState: 'PUBLISHED',
      distribution: { feedDistribution: 'MAIN_FEED' },
    });
    expect(headers).toMatchObject({
      Authorization: 'Bearer TK',
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    });
  });

  it('appends the link into commentary when not already present', async () => {
    postJsonMock.mockResolvedValue({ ok: true, status: 201, body: '', headers: {} });
    await publish('News', 'https://eyes.pro/a', cfg);
    const payload = postJsonMock.mock.calls[0][1] as { commentary: string };
    expect(payload.commentary).toBe('News\n\nhttps://eyes.pro/a');
  });

  it('returns ok with undefined id/url when the x-restli-id header is absent', async () => {
    postJsonMock.mockResolvedValue({ ok: true, status: 201, body: '', headers: {} });
    const res = await publish('hi', undefined, cfg);
    expect(res).toEqual({ ok: true, postId: undefined, postUrl: undefined });
  });

  it('returns an HTTP error string on failure', async () => {
    postJsonMock.mockResolvedValue({ ok: false, status: 422, body: 'Unprocessable', headers: {} });
    const res = await publish('hi', undefined, cfg);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('422');
  });
});

describe('linkedin adapter — test()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails without access_token', async () => {
    expect((await testConnection({})).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the account name from userinfo on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ name: 'Eyes Pro' }),
    });
    expect(await testConnection({ access_token: 'T' })).toEqual({ ok: true, info: 'Eyes Pro' });
  });
});
