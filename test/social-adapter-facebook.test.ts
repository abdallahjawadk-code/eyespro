/**
 * Unit tests for the Facebook Page feed adapter. Network fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { postFormMock } = vi.hoisted(() => ({ postFormMock: vi.fn() }));
vi.mock('../src/main/net/http', () => ({ postForm: postFormMock }));

import { publish, test as testConnection } from '../src/main/services/social-adapters/facebook';

const okBody = (b: unknown) => ({ ok: true, status: 200, body: JSON.stringify(b) });

describe('facebook adapter — publish()', () => {
  beforeEach(() => { postFormMock.mockReset(); });

  it('requires page_token and page_id before any network call', async () => {
    expect((await publish('hi', undefined, { page_id: '1' })).error).toContain('page_token');
    expect((await publish('hi', undefined, { page_token: 'T' })).error).toContain('page_id');
    expect(postFormMock).not.toHaveBeenCalled();
  });

  it('posts to the page feed with message + access_token and returns id and url', async () => {
    postFormMock.mockResolvedValue(okBody({ id: '777_888' }));
    const res = await publish('Hello FB', undefined, { page_token: 'TK', page_id: '777' });

    expect(res).toEqual({
      ok: true,
      postId: '777_888',
      postUrl: 'https://www.facebook.com/777_888',
    });
    const [url, form] = postFormMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v19.0/777/feed');
    expect(form).toMatchObject({ message: 'Hello FB', access_token: 'TK' });
    expect(form).not.toHaveProperty('link');
  });

  it('includes link in the form when provided', async () => {
    postFormMock.mockResolvedValue(okBody({ id: '1' }));
    await publish('hi', 'https://eyes.pro/a', { page_token: 'TK', page_id: '777' });
    expect(postFormMock.mock.calls[0][1]).toMatchObject({ link: 'https://eyes.pro/a' });
  });

  it('omits postUrl when the response has no id', async () => {
    postFormMock.mockResolvedValue(okBody({}));
    const res = await publish('hi', undefined, { page_token: 'TK', page_id: '777' });
    expect(res).toEqual({ ok: true, postId: '', postUrl: undefined });
  });

  it('surfaces the Graph error.message on failure', async () => {
    postFormMock.mockResolvedValue({ ok: false, status: 403, body: JSON.stringify({ error: { message: 'Permissions error' } }) });
    const res = await publish('hi', undefined, { page_token: 'TK', page_id: '777' });
    expect(res).toEqual({ ok: false, error: 'Permissions error' });
  });

  it('falls back to HTTP status when an error body is not JSON', async () => {
    postFormMock.mockResolvedValue({ ok: false, status: 500, body: 'Server Error' });
    const res = await publish('hi', undefined, { page_token: 'TK', page_id: '777' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });
});

describe('facebook adapter — test()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails without page_token', async () => {
    expect((await testConnection({})).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports page name and fan_count on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ name: 'Eyes Pro', fan_count: 1234 }),
    });
    const res = await testConnection({ page_token: 'T', page_id: '777' });
    expect(res.ok).toBe(true);
    expect(res.info).toContain('Eyes Pro');
    // fan_count is rendered via toLocaleString() (digit script is locale-dependent),
    // so assert the label rather than a specific digit format.
    expect(res.info).toContain('likes');
  });
});
