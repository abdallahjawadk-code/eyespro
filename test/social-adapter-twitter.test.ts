/**
 * Unit tests for the Twitter (X) v2 adapter. OAuth signing, credential
 * resolution, and the network layer are all mocked — no real API calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolveMock, formatErrMock, oauthHeaderMock, postJsonMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  formatErrMock: vi.fn(),
  oauthHeaderMock: vi.fn(() => 'OAuth oauth_signature="sig"'),
  postJsonMock: vi.fn(),
}));

vi.mock('../src/main/services/twitter-credentials', () => ({
  resolveTwitterOAuth1: resolveMock,
  formatTwitterApiError: formatErrMock,
}));
vi.mock('../src/main/net/oauth1', () => ({ oauthHeader: oauthHeaderMock }));
vi.mock('../src/main/net/http', () => ({ postJson: postJsonMock }));

import { publish } from '../src/main/services/social-adapters/twitter';

const goodCreds = {
  ok: true as const,
  creds: { apiKey: 'k', apiSecret: 's', accessToken: 'at', accessSecret: 'as' },
};

describe('twitter adapter — publish()', () => {
  beforeEach(() => {
    resolveMock.mockReset();
    formatErrMock.mockReset();
    postJsonMock.mockReset();
    oauthHeaderMock.mockClear();
  });

  it('returns the resolver error when OAuth1 credentials are not available', async () => {
    resolveMock.mockReturnValue({ ok: false, error: 'missing keys' });
    const res = await publish('hi');
    expect(res).toEqual({ ok: false, error: 'missing keys' });
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('signs and posts the tweet, truncating to 280 chars, and returns id/url', async () => {
    resolveMock.mockReturnValue(goodCreds);
    postJsonMock.mockResolvedValue({ ok: true, status: 201, body: JSON.stringify({ data: { id: '1700000000' } }) });

    const longText = 'x'.repeat(400);
    const res = await publish(longText);

    expect(res).toEqual({
      ok: true,
      postId: '1700000000',
      postUrl: 'https://x.com/i/web/status/1700000000',
    });
    const [url, payload, headers] = postJsonMock.mock.calls[0];
    expect(url).toBe('https://api.twitter.com/2/tweets');
    expect((payload as { text: string }).text.length).toBe(280);
    expect(headers).toMatchObject({ Authorization: 'OAuth oauth_signature="sig"' });
    expect(oauthHeaderMock).toHaveBeenCalledWith(
      'POST', 'https://api.twitter.com/2/tweets', {}, 'k', 's', 'at', 'as',
    );
  });

  it('routes API failures through formatTwitterApiError', async () => {
    resolveMock.mockReturnValue(goodCreds);
    postJsonMock.mockResolvedValue({ ok: false, status: 403, body: '{"detail":"forbidden"}' });
    formatErrMock.mockReturnValue('formatted: forbidden');

    const res = await publish('hi');
    expect(res).toEqual({ ok: false, error: 'formatted: forbidden' });
    expect(formatErrMock).toHaveBeenCalledWith('{"detail":"forbidden"}', 403);
  });

  it('returns ok without id when a success body is unparseable', async () => {
    resolveMock.mockReturnValue(goodCreds);
    postJsonMock.mockResolvedValue({ ok: true, status: 201, body: 'not-json' });
    expect(await publish('hi')).toEqual({ ok: true });
  });
});
