import { getSocialCred } from './social';

const OAUTH_FIELDS: { field: string; labelAr: string }[] = [
  { field: 'api_key', labelAr: 'Consumer Key (مفتاح API)' },
  { field: 'api_secret', labelAr: 'Consumer Secret (سر API)' },
  { field: 'access_token', labelAr: 'Access Token' },
  { field: 'access_secret', labelAr: 'Access Token Secret' },
];

export type TwitterOAuth1Creds = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

function cleanTwitterCred(v: string): string {
  return v.trim().replace(/\s+/g, '');
}

export function resolveTwitterOAuth1():
  | { ok: true; creds: TwitterOAuth1Creds }
  | { ok: false; error: string } {
  const missing: string[] = [];
  const raw: Record<string, string> = {};
  for (const { field, labelAr } of OAUTH_FIELDS) {
    const v = getSocialCred('twitter', field).trim();
    raw[field] = v;
    if (!v) missing.push(labelAr);
  }
  if (missing.length) {
    return {
      ok: false,
      error: `Twitter/X: حقول OAuth 1.0a ناقصة: ${missing.join('، ')}. من console.x.com → Keys and tokens → Generate Access Token`,
    };
  }
  return {
    ok: true,
    creds: {
      apiKey: cleanTwitterCred(raw.api_key!),
      apiSecret: cleanTwitterCred(raw.api_secret!),
      accessToken: cleanTwitterCred(raw.access_token!),
      accessSecret: cleanTwitterCred(raw.access_secret!),
    },
  };
}

/** User-facing error from X API JSON body */
export function formatTwitterApiError(body: string, status: number): string {
  let detail = '';
  let title = '';
  try {
    const j = JSON.parse(body) as {
      detail?: string;
      title?: string;
      errors?: { message?: string }[];
    };
    detail = j.detail ?? j.errors?.[0]?.message ?? '';
    title = j.title ?? '';
  } catch {
    detail = body.slice(0, 200);
  }

  const blob = `${title} ${detail}`.toLowerCase();

  if (status === 403 && blob.includes('oauth1 app permissions')) {
    return 'صلاحيات التطبيق Read only — غيّرها إلى Read and Write في console.x.com ثم Regenerate لـ Access Token و Secret';
  }
  if (status === 403 && blob.includes('application-only')) {
    return 'Bearer Token لا يكفي للنشر — أكمل Access Token + Access Token Secret (OAuth 1.0a) في الإعدادات';
  }
  if (status === 403 && (blob.includes('subset') || blob.includes('pay-per-use') || blob.includes('elevated'))) {
    return 'خطة X API الحالية لا تسمح بالنشر — ترقية الحساب إلى Basic أو Pay-per-use من console.x.com';
  }
  if (status === 401 || blob.includes('invalid') || blob.includes('could not authenticate')) {
    return 'مفاتيح Twitter غير صحيحة — تحقق من Consumer Key/Secret و Access Token/Secret (Regenerate من console.x.com)';
  }
  if (status === 402 || blob.includes('does not have any credits')) {
    return 'حساب X API بلا رصيد (Credits) — من console.x.com → Billing أضف Credits أو اشترك في Basic/Pay-per-use';
  }
  if (status === 429) {
    return 'تجاوزت حد طلبات X API — انتظر قليلاً ثم أعد المحاولة';
  }

  if (detail) return `Twitter HTTP ${status}: ${detail}`;
  if (title) return `Twitter HTTP ${status}: ${title}`;
  return `Twitter HTTP ${status}: ${body.slice(0, 180)}`;
}

/** Post a test tweet then delete it — verifies write access without leaving a post. */
export async function probeTwitterPublish(): Promise<{ ok: boolean; error?: string; info?: string }> {
  const auth = resolveTwitterOAuth1();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { apiKey, apiSecret, accessToken, accessSecret } = auth.creds;
  const { oauthHeader } = await import('../net/oauth1');
  const { postJson, deleteRequest } = await import('../net/http');
  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const text = `EyesPro publish test ${Date.now()}`;
  const authHeader = oauthHeader('POST', tweetUrl, {}, apiKey, apiSecret, accessToken, accessSecret);
  const res = await postJson(tweetUrl, { text }, { Authorization: authHeader });
  if (!res.ok) {
    return { ok: false, error: formatTwitterApiError(res.body, res.status) };
  }
  let tweetId = '';
  try {
    tweetId = (JSON.parse(res.body) as { data?: { id?: string } }).data?.id ?? '';
  } catch { /* ignore */ }
  if (tweetId) {
    const delUrl = `https://api.twitter.com/2/tweets/${tweetId}`;
    const delAuth = oauthHeader('DELETE', delUrl, {}, apiKey, apiSecret, accessToken, accessSecret);
    await deleteRequest(delUrl, { Authorization: delAuth }).catch(() => undefined);
  }
  return { ok: true, info: 'صلاحية النشر على Twitter تعمل ✅ (تم اختبار تغريدة وحذفها)' };
}
