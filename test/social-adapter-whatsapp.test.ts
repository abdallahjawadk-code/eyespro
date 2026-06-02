/**
 * Unit tests for the WhatsApp Cloud API adapter. Network fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { postJsonMock } = vi.hoisted(() => ({ postJsonMock: vi.fn() }));
vi.mock('../src/main/net/http', () => ({ postJson: postJsonMock }));

import { publish, test as testConnection } from '../src/main/services/social-adapters/whatsapp';

const okBody = (b: unknown) => ({ ok: true, status: 200, body: JSON.stringify(b) });

describe('whatsapp adapter — publish()', () => {
  beforeEach(() => { postJsonMock.mockReset(); });

  it('requires api_url, token and recipient before any network call', async () => {
    expect((await publish('hi', undefined, { token: 'T', recipient: '1' })).error).toContain('api_url');
    expect((await publish('hi', undefined, { api_url: 'u', recipient: '1' })).error).toContain('token');
    expect((await publish('hi', undefined, { api_url: 'u', token: 'T' })).error).toContain('recipient');
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('builds the Cloud API payload, strips non-digits from recipient, and returns message id', async () => {
    postJsonMock.mockResolvedValue(okBody({ messages: [{ id: 'wamid.123' }] }));
    const res = await publish('Hello', undefined, {
      api_url: 'https://graph.facebook.com/v19.0/555',
      token: 'TKN',
      recipient: '+1 (555) 234-9999',
    });

    expect(res).toEqual({ ok: true, postId: 'wamid.123' });
    const [url, payload, headers] = postJsonMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v19.0/555/messages');
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '15552349999',
      type: 'text',
      text: { body: 'Hello' },
    });
    expect(headers).toMatchObject({ Authorization: 'Bearer TKN' });
  });

  it('does not double the /messages suffix when api_url already ends with it', async () => {
    postJsonMock.mockResolvedValue(okBody({ messages: [{ id: 'x' }] }));
    await publish('hi', undefined, { api_url: 'https://x/v19.0/5/messages', token: 'T', recipient: '5' });
    expect(postJsonMock.mock.calls[0][0]).toBe('https://x/v19.0/5/messages');
  });

  it('appends the link when not already present and truncates body to 4096 chars', async () => {
    postJsonMock.mockResolvedValue(okBody({ messages: [{ id: 'x' }] }));
    const long = 'A'.repeat(5000);
    await publish(long, 'https://l', { api_url: 'u', token: 'T', recipient: '5' });
    const payload = postJsonMock.mock.calls[0][1] as { text: { body: string } };
    expect(payload.text.body.length).toBe(4096);
  });

  it('surfaces the Graph error.message on failure', async () => {
    postJsonMock.mockResolvedValue({ ok: false, status: 400, body: JSON.stringify({ error: { message: 'Invalid OAuth token' } }) });
    const res = await publish('hi', undefined, { api_url: 'u', token: 'T', recipient: '5' });
    expect(res).toEqual({ ok: false, error: 'Invalid OAuth token' });
  });

  it('returns ok without postId when a success body is unparseable', async () => {
    postJsonMock.mockResolvedValue({ ok: true, status: 200, body: 'not-json' });
    expect(await publish('hi', undefined, { api_url: 'u', token: 'T', recipient: '5' })).toEqual({ ok: true });
  });
});

describe('whatsapp adapter — test()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails without api_url / token', async () => {
    expect((await testConnection({ token: 'T' })).ok).toBe(false);
    expect((await testConnection({ api_url: 'u' })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports verified_name on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ verified_name: 'Eyes Pro' }),
    });
    const res = await testConnection({ api_url: 'https://graph.facebook.com/v19.0/555/messages', token: 'T' });
    expect(res).toEqual({ ok: true, info: 'Eyes Pro' });
  });
});
