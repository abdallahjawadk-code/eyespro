/**
 * Instagram OAuth — Business Login for Instagram (Meta Graph API v19.0)
 *
 * Uses the Facebook Login for Business flow which supports Instagram Business
 * and Creator accounts connected to a Facebook Page.
 *
 * ⚠️  Scope changes (January 27, 2025):
 *   OLD (deprecated): instagram_basic, instagram_content_publish
 *   NEW (required):   instagram_business_basic, instagram_business_content_publish
 *
 * Flow:
 *   1. Read instagram_app_id + instagram_app_secret from settings
 *   2. Open Facebook OAuth dialog → user authorises
 *   3. Intercept redirect to eyespro.local, exchange code → short-lived token
 *   4. Exchange short-lived token → long-lived token (60 days, via fb_exchange_token)
 *   5. Fetch IG Business Account + Page Access Token from /me/accounts (paginated)
 *   6. Store page access_token as instagram_access_token (required for publish)
 *      and instagram_account_id (IG user id)
 *
 * References:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
 *   https://developers.facebook.com/docs/instagram-platform/content-publishing/
 */

import { BrowserWindow, session } from 'electron';
import https from 'node:https';
import { getSetting, setSetting } from './settings';
import { createLogger } from '../logger';

const log = createLogger('instagram-auth');

const IG_PARTITION  = 'persist:ig-session';
const REDIRECT_URI  = 'https://eyespro.local/instagram-auth';
const GRAPH_BASE    = 'https://graph.facebook.com/v19.0';

/**
 * Updated scopes — old instagram_basic / instagram_content_publish were deprecated
 * on Jan 27 2025 and no longer work.
 */
const OAUTH_SCOPE = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
].join(',');

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.on('data', (c: Buffer) => { raw += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(raw) as Record<string, unknown>); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function httpsPost(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const payload = new URLSearchParams(body).toString();
  const parsed  = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c: Buffer) => { raw += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(raw) as Record<string, unknown>); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Token exchange helpers ──────────────────────────────────────────────────

/**
 * Exchange OAuth authorization code for a short-lived user access token.
 * Uses graph.facebook.com (Facebook Login for Business flow).
 */
async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
): Promise<string> {
  const res = await httpsPost(`${GRAPH_BASE}/oauth/access_token`, {
    client_id:     appId,
    client_secret: appSecret,
    redirect_uri:  REDIRECT_URI,
    code,
  });
  const token = res['access_token'];
  if (typeof token !== 'string' || !token)
    throw new Error((res['error'] as Record<string, unknown>)?.['message'] as string ?? 'Token exchange failed — no access_token returned');
  return token;
}

/**
 * Exchange a short-lived token for a long-lived token (60 days).
 * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
 */
async function getLongLivedToken(
  shortToken: string,
  appId: string,
  appSecret: string,
): Promise<string> {
  const res = await httpsGet(
    `${GRAPH_BASE}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`,
  );
  const token = res['access_token'];
  if (typeof token !== 'string' || !token)
    throw new Error((res['error'] as Record<string, unknown>)?.['message'] as string ?? 'Long-lived token exchange failed');
  return token;
}

interface InstagramPageCredentials {
  igId: string;
  pageToken: string;
  pageName: string;
  igUsername?: string;
}

/**
 * Find the first Facebook Page linked to an Instagram Business/Creator account.
 * Returns the Page Access Token (not the user token) — required for reliable publishing.
 */
async function fetchInstagramCredentials(userToken: string): Promise<InstagramPageCredentials | null> {
  let nextUrl: string | null =
    `${GRAPH_BASE}/me/accounts` +
    `?fields=instagram_business_account{id,username},access_token,name` +
    `&limit=25` +
    `&access_token=${encodeURIComponent(userToken)}`;

  while (nextUrl) {
    const res = await httpsGet(nextUrl);

    if (res['error']) {
      const err = res['error'] as Record<string, unknown>;
      throw new Error(String(err['message'] ?? 'فشل جلب صفحات Facebook من Meta'));
    }

    const pages = res['data'] as Array<{
      name?: string;
      access_token?: string;
      instagram_business_account?: { id: string; username?: string };
    }> | undefined;

    if (Array.isArray(pages)) {
      for (const page of pages) {
        const ig = page.instagram_business_account;
        if (ig?.id && page.access_token) {
          return {
            igId:        ig.id,
            pageToken:   page.access_token,
            pageName:    page.name ?? ig.username ?? ig.id,
            igUsername:  ig.username,
          };
        }
      }
    }

    nextUrl = (res['paging'] as { next?: string } | undefined)?.next ?? null;
  }

  log.warn('No Instagram Business Account found on any Facebook Page');
  return null;
}

function graphErrorMessage(res: Record<string, unknown>, fallback: string): string {
  const err = res['error'] as Record<string, unknown> | undefined;
  if (!err) return fallback;
  const userMsg = err['error_user_msg'] as string | undefined;
  const msg     = err['message'] as string | undefined;
  return userMsg ?? msg ?? fallback;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function isInstagramConnected(): boolean {
  const token = getSetting('instagram_access_token');
  const igId  = getSetting('instagram_account_id');
  return typeof token === 'string' && token.trim().length > 20
    && typeof igId === 'string' && igId.trim().length > 0;
}

/**
 * Verify the stored token and account ID by calling the Graph API.
 * Returns account username + account_type on success.
 */
export async function testInstagramConnection(): Promise<
  { ok: true; username: string; accountType: string; publishQuota?: string } |
  { ok: false; error: string }
> {
  const token   = getSetting('instagram_access_token');
  const igId    = getSetting('instagram_account_id');

  if (!token || !igId) {
    return { ok: false, error: 'لم يتم ضبط بيانات الاعتماد — سجّل الدخول أولاً' };
  }

  try {
    const res = await httpsGet(
      `${GRAPH_BASE}/${encodeURIComponent(igId)}` +
      `?fields=id,username,name,followers_count,media_count` +
      `&access_token=${encodeURIComponent(token)}`,
    );

    if (res['error']) {
      const err = res['error'] as Record<string, unknown>;
      const code = err['code'] as number | undefined;
      if (code === 190) {
        return { ok: false, error: 'انتهت صلاحية التوكن — سجّل الدخول مجدداً من الإعدادات → Instagram' };
      }
      return { ok: false, error: graphErrorMessage(res, 'Graph API error') };
    }

    const accountType = (res['followers_count'] !== undefined) ? 'BUSINESS/CREATOR' : 'PROFESSIONAL';
    const username    = (res['username'] as string) ?? (res['name'] as string) ?? igId;

    // Verify content-publish permission (fails early if App Review not approved)
    const limitRes = await httpsGet(
      `${GRAPH_BASE}/${encodeURIComponent(igId)}/content_publishing_limit` +
      `?fields=quota_duration,quota_total,quota_usage` +
      `&access_token=${encodeURIComponent(token)}`,
    );

    if (limitRes['error']) {
      const err  = limitRes['error'] as Record<string, unknown>;
      const code = err['code'] as number | undefined;
      if (code === 10 || code === 200 || code === 190) {
        return {
          ok: false,
          error:
            'صلاحية النشر غير متاحة — تأكد من:\n' +
            '• موافقة Meta على instagram_business_content_publish في App Review\n' +
            '• ربط حساب Instagram Business/Creator بصفحة Facebook\n' +
            '• إعادة تسجيل الدخول بعد الموافقة',
        };
      }
      log.warn('content_publishing_limit check failed', { error: graphErrorMessage(limitRes, '') });
    } else {
      const data  = limitRes['data'] as Array<{ quota_usage?: number; quota_total?: number }> | undefined;
      const usage = data?.[0]?.quota_usage;
      const total = data?.[0]?.quota_total;
      if (typeof usage === 'number' && typeof total === 'number' && usage >= total) {
        return { ok: false, error: `تم استنفاد حد النشر اليومي (${usage}/${total}) — حاول غداً` };
      }
    }

    const publishQuota = (() => {
      const data  = limitRes['data'] as Array<{ quota_usage?: number; quota_total?: number }> | undefined;
      const usage = data?.[0]?.quota_usage;
      const total = data?.[0]?.quota_total;
      return (typeof usage === 'number' && typeof total === 'number')
        ? `${usage}/${total} منشورات (24 ساعة)`
        : undefined;
    })();

    return { ok: true, username, accountType, publishQuota };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Pre-flight before video publish — same checks as test, fast-fail with actionable errors. */
export async function assertInstagramPublishReady(): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = await testInstagramConnection();
  return check.ok ? { ok: true } : { ok: false, error: check.error };
}

/**
 * Open the Facebook OAuth dialog in a BrowserWindow.
 * Intercepts the redirect to REDIRECT_URI, exchanges code for token,
 * upgrades to long-lived token, and stores credentials.
 */
export async function openInstagramAuthWindow(): Promise<void> {
  const appId     = (getSetting('instagram_app_id') ?? '').trim();
  const appSecret = (getSetting('instagram_app_secret') ?? '').trim();

  if (!appId || !appSecret) {
    throw new Error(
      'يجب ضبط instagram_app_id و instagram_app_secret في الإعدادات قبل تسجيل الدخول',
    );
  }

  const ses = session.fromPartition(IG_PARTITION);

  // Block the fake redirect domain from resolving — we intercept it ourselves
  ses.webRequest.onBeforeRequest(
    { urls: [`${REDIRECT_URI}*`] },
    (_, cb) => cb({ cancel: true }),
  );

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width:  620,
      height: 720,
      title:  'تسجيل الدخول إلى Instagram عبر Meta',
      webPreferences: {
        partition:        IG_PARTITION,
        nodeIntegration:  false,
        contextIsolation: true,
      },
    });

    win.setMenuBarVisibility(false);

    let resolved = false;

    function done(err?: Error) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 800);
      if (err) reject(err); else resolve();
    }

    const timeout = setTimeout(
      () => done(new Error('انتهت مهلة تسجيل الدخول (5 دقائق)')),
      5 * 60 * 1000,
    );

    async function handleUrl(url: string): Promise<boolean> {
      if (!url.startsWith(REDIRECT_URI)) return false;

      const parsed    = new URL(url);
      const code      = parsed.searchParams.get('code');
      const errorDesc = parsed.searchParams.get('error_description')
                     ?? parsed.searchParams.get('error');

      if (errorDesc) { done(new Error(decodeURIComponent(errorDesc))); return true; }
      if (!code)      { done(new Error('لم يُستلم رمز التفويض من Meta')); return true; }

      try {
        // 1. Exchange code for short-lived token
        const shortToken = await exchangeCodeForToken(code, appId, appSecret);

        // 2. Upgrade to long-lived user token (60 days) — required before fetching page tokens
        const longUserToken = await getLongLivedToken(shortToken, appId, appSecret);

        // 3. Resolve IG account + Page Access Token (publish uses page token, not user token)
        const creds = await fetchInstagramCredentials(longUserToken);
        if (!creds) {
          throw new Error(
            'لم يُعثر على حساب Instagram Business أو Creator مرتبط بصفحة Facebook.\n' +
            '→ اربط الحساب بصفحة Facebook من Meta Business Suite ثم أعد المحاولة',
          );
        }

        // 4. Persist credentials (page token for API publish calls)
        setSetting('instagram_access_token', creds.pageToken);
        setSetting('instagram_account_id', creds.igId);

        log.info(`Instagram auth success — @${creds.igUsername ?? creds.igId} via page "${creds.pageName}"`);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
      return true;
    }

    win.webContents.on('will-navigate',    (_e, url) => { void handleUrl(url); });
    win.webContents.on('will-redirect',    (_e, url) => { void handleUrl(url); });
    win.webContents.on('did-navigate',     (_e, url) => { void handleUrl(url); });

    win.on('closed', () => {
      if (!resolved) done(new Error('أُغلقت نافذة تسجيل الدخول'));
    });

    // Build the Facebook OAuth dialog URL
    const authUrl =
      `https://www.facebook.com/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPE)}` +
      `&response_type=code` +
      `&display=popup`;

    void win.loadURL(authUrl);
  });
}

export async function disconnectInstagram(): Promise<void> {
  setSetting('instagram_access_token', '');
  setSetting('instagram_account_id', '');
  try {
    const ses = session.fromPartition(IG_PARTITION);
    await ses.clearStorageData();
  } catch { /* ignore */ }
  log.info('Instagram disconnected');
}
