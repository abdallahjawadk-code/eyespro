import type { TestResult, Cfg } from './types';
import { get } from './types';
import { formatTwitterApiError, resolveTwitterOAuth1 } from '../twitter-credentials';

export type PublishResult = { ok: boolean; postUrl?: string; postId?: string; error?: string };

export async function publish(text: string, _link?: string, cfg: Cfg = {}): Promise<PublishResult> {
  void cfg;
  const auth = resolveTwitterOAuth1();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { apiKey, apiSecret, accessToken, accessSecret } = auth.creds;
  const { oauthHeader } = await import('../../net/oauth1');
  const { postJson } = await import('../../net/http');
  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const authHeader = oauthHeader('POST', tweetUrl, {}, apiKey, apiSecret, accessToken, accessSecret);
  const res = await postJson(tweetUrl, { text: text.slice(0, 280) }, { Authorization: authHeader });
  if (!res.ok) {
    return { ok: false, error: formatTwitterApiError(res.body, res.status) };
  }
  try {
    const d = JSON.parse(res.body) as { data?: { id?: string } };
    const id = d.data?.id ?? '';
    return {
      ok: true,
      postId: id,
      postUrl: id ? `https://x.com/i/web/status/${id}` : undefined,
    };
  } catch {
    return { ok: true };
  }
}

function normalizeBearer(raw: string): string {
  const t = raw.trim();
  if (t.includes('%')) {
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }
  return t;
}

function parseTwitterError(body: string, status: number): string {
  return formatTwitterApiError(body, status);
}

const OAUTH_FIELDS: { key: string; label: string }[] = [
  { key: 'api_key', label: 'Consumer Key (API Key)' },
  { key: 'api_secret', label: 'Consumer Secret (API Secret)' },
  { key: 'access_token', label: 'Access Token' },
  { key: 'access_secret', label: 'Access Token Secret' },
];

function missingOAuthFields(cfg: Cfg): string[] {
  return OAUTH_FIELDS.filter((f) => !(cfg[f.key] ?? '').trim()).map((f) => f.label);
}

export async function test(cfg: Cfg): Promise<TestResult> {
  const apiKey = cfg['api_key']?.trim();
  const apiSecret = cfg['api_secret']?.trim();
  const accessToken = cfg['access_token']?.trim();
  const accessSecret = cfg['access_secret']?.trim();

  const oauthFilled = [apiKey, apiSecret, accessToken, accessSecret].filter(Boolean).length;
  if (oauthFilled > 0 && oauthFilled < 4) {
    const missing = missingOAuthFields(cfg);
    return {
      ok: false,
      error: `أكمل حقول OAuth 1.0a الناقصة: ${missing.join('، ')}. من console.x.com → Keys and tokens → Generate Access Token`,
    };
  }

  if (apiKey && apiSecret && accessToken && accessSecret) {
    const { oauthHeader } = await import('../../net/oauth1');
    const auth = oauthHeader(
      'GET',
      'https://api.twitter.com/2/users/me',
      {},
      apiKey,
      apiSecret,
      accessToken,
      accessSecret,
    );
    const r = await get('https://api.twitter.com/2/users/me', { Authorization: auth });
    if (r.status !== 200) {
      return { ok: false, error: parseTwitterError(r.body, r.status) };
    }
    const d = JSON.parse(r.body) as { data?: { username?: string } };
    return {
      ok: true,
      info: `@${d.data?.username ?? '?'} — OAuth 1.0a OK. إذا فشل النشر: تأكد من Read and Write في console.x.com وخطة API (Basic+).`,
    };
  }

  const bearer = cfg['bearer_token']?.trim();
  if (!bearer) {
    return {
      ok: false,
      error: 'للنشر: املأ Consumer Key/Secret + Access Token/Secret من console.x.com (Generate تحت Authentication Tokens)',
    };
  }

  // Bearer = OAuth 2.0 app-only — cannot call /users/me; use a read endpoint instead
  const probeUrl =
    'https://api.twitter.com/2/tweets/search/recent?query=news&max_results=10';
  const r = await get(probeUrl, { Authorization: `Bearer ${normalizeBearer(bearer)}` });
  if (r.status !== 200) {
    const msg = parseTwitterError(r.body, r.status);
    if (r.status === 403 && msg.includes('Application-Only')) {
      return {
        ok: false,
        error: 'Bearer Token لا يكفي لاختبار الحساب — أضف Access Token و Access Token Secret (OAuth 1.0a) من console.x.com',
      };
    }
    return { ok: false, error: msg };
  }
  return {
    ok: true,
    info: 'Bearer Token صالح — للنشر أضف Access Token + Secret (OAuth 1.0a)',
  };
}
