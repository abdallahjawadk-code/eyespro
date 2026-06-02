/**
 * Unit tests for the Telegram social adapter.
 *
 * The network layer is fully mocked — no real Telegram API calls. We assert the
 * adapter's local logic: credential validation, message/link assembly, request
 * shape, and success/error response parsing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// postJson is the only net/http dependency used by publish(); mock it at the seam.
const { postJsonMock } = vi.hoisted(() => ({ postJsonMock: vi.fn() }));
vi.mock('../src/main/net/http', () => ({ postJson: postJsonMock }));

import { publish, test as testConnection } from '../src/main/services/social-adapters/telegram';

function httpOk(body: unknown) {
  return { ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) };
}
function httpErr(status: number, body: string) {
  return { ok: false, status, body };
}

describe('telegram adapter — publish()', () => {
  beforeEach(() => { postJsonMock.mockReset(); });

  it('fails fast (no network call) when bot_token is missing', async () => {
    const res = await publish('hi', undefined, { chat_id: '123' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('bot_token');
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('fails fast when chat_id is missing', async () => {
    const res = await publish('hi', undefined, { bot_token: 'T' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('chat_id');
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('posts to the correct URL with chat_id and text, and returns message id', async () => {
    postJsonMock.mockResolvedValue(httpOk({ result: { message_id: 42 } }));
    const res = await publish('Hello world', undefined, { bot_token: 'ABC', chat_id: '@chan' });

    expect(res).toEqual({ ok: true, postId: '42' });
    expect(postJsonMock).toHaveBeenCalledTimes(1);
    const [url, payload] = postJsonMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botABC/sendMessage');
    expect(payload).toMatchObject({ chat_id: '@chan', text: 'Hello world' });
  });

  it('appends the link when it is not already in the text', async () => {
    postJsonMock.mockResolvedValue(httpOk({ result: { message_id: 1 } }));
    await publish('Breaking news', 'https://eyes.pro/a', { bot_token: 'T', chat_id: 'c' });
    const payload = postJsonMock.mock.calls[0][1] as { text: string };
    expect(payload.text).toBe('Breaking news\n\nhttps://eyes.pro/a');
  });

  it('does NOT duplicate a link already present in the text', async () => {
    postJsonMock.mockResolvedValue(httpOk({ result: { message_id: 1 } }));
    await publish('See https://eyes.pro/a now', 'https://eyes.pro/a', { bot_token: 'T', chat_id: 'c' });
    const payload = postJsonMock.mock.calls[0][1] as { text: string };
    expect(payload.text).toBe('See https://eyes.pro/a now');
  });

  it('surfaces the API "description" field on an error response', async () => {
    postJsonMock.mockResolvedValue(httpErr(400, JSON.stringify({ description: 'chat not found' })));
    const res = await publish('hi', undefined, { bot_token: 'T', chat_id: 'bad' });
    expect(res).toEqual({ ok: false, error: 'chat not found' });
  });

  it('falls back to HTTP status when an error body is not JSON', async () => {
    postJsonMock.mockResolvedValue(httpErr(502, 'Bad Gateway'));
    const res = await publish('hi', undefined, { bot_token: 'T', chat_id: 'c' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('502');
    expect(res.error).toContain('Bad Gateway');
  });

  it('returns ok without postId when a success body is unparseable', async () => {
    postJsonMock.mockResolvedValue({ ok: true, status: 200, body: 'not-json' });
    const res = await publish('hi', undefined, { bot_token: 'T', chat_id: 'c' });
    expect(res).toEqual({ ok: true });
  });
});

describe('telegram adapter — test()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails when bot_token is missing (no network call)', async () => {
    const res = await testConnection({});
    expect(res.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the bot username on a 200 from getMe', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ result: { username: 'eyes_bot' } }),
    });
    const res = await testConnection({ bot_token: 'T' });
    expect(res.ok).toBe(true);
    expect(res.info).toContain('@eyes_bot');
  });

  it('returns an error on a non-200 from getMe', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 401,
      text: async () => 'Unauthorized',
    });
    const res = await testConnection({ bot_token: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });
});
