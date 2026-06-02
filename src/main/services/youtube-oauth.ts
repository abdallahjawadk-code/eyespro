import fs from 'node:fs';
import http from 'node:http';
import { shell } from 'electron';
import { postJson, getText } from '../net/http';
import { getSetting, setSetting, isMaskedSettingValue } from './settings';
import { createLogger } from '../logger';

const log = createLogger('youtube-oauth');

/** Scopes for upload, live, and connection test */
export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
};

export type YoutubeOAuthResult = {
  ok: true;
  channelTitle?: string;
  expiresIn?: number;
  hasRefreshToken: boolean;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type LoopbackOAuthServer = {
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
};

function readCredentialsObject(raw: unknown): GoogleOAuthCredentials {
  if (!raw || typeof raw !== 'object') {
    throw new Error('ملف JSON غير صالح');
  }
  const root = raw as Record<string, unknown>;
  const block = (root.installed ?? root.web ?? root) as Record<string, unknown>;
  const clientId = String(block.client_id ?? '').trim();
  const clientSecret = String(block.client_secret ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('الملف لا يحتوي على client_id و client_secret (ملف OAuth من Google Cloud)');
  }
  const redirectUris = Array.isArray(block.redirect_uris)
    ? block.redirect_uris.map((u) => String(u).trim()).filter(Boolean)
    : [];
  return { clientId, clientSecret, redirectUris };
}

/** Parse Google OAuth client JSON (Desktop or Web credentials download). */
export function parseGoogleOAuthCredentials(jsonText: string): GoogleOAuthCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('تعذّر قراءة ملف JSON — تأكد أنه ملف Credentials من Google Cloud');
  }
  return readCredentialsObject(parsed);
}

export function parseGoogleOAuthCredentialsFile(filePath: string): GoogleOAuthCredentials {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseGoogleOAuthCredentials(text);
}

function pickLoopbackPort(): number {
  return 49152 + Math.floor(Math.random() * 16383);
}

/** Local redirect listener — must be ready before opening the browser. */
function startLoopbackOAuthServer(pathname: string, timeoutMs: number): Promise<LoopbackOAuthServer> {
  const port = pickLoopbackPort();
  const redirectUri = `http://127.0.0.1:${port}${pathname}`;

  return new Promise((resolveReady, rejectReady) => {
    let codeSettled = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;

    const finishCode = (fn: () => void) => {
      if (codeSettled) return;
      codeSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      fn();
    };

    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = (c) => finishCode(() => resolve(c));
      rejectCode = (e) => finishCode(() => reject(e));
    });

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== pathname) {
          res.writeHead(404);
          res.end();
          return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body dir="rtl" style="font-family:sans-serif;text-align:center;padding:2rem">'
            + '<h2>لم يتم الربط</h2><p>يمكنك إغلاق هذه الصفحة والعودة إلى EyesPro.</p></body></html>',
          );
          server.close();
          rejectCode(new Error(err === 'access_denied' ? 'ألغيتَ تسجيل الدخول' : err));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('Missing code');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body dir="rtl" style="font-family:sans-serif;text-align:center;padding:2rem">'
          + '<h2>تم ربط YouTube بنجاح</h2><p>يمكنك إغلاق هذه الصفحة والعودة إلى EyesPro.</p>'
          + '</body></html>',
        );
        server.close();
        resolveCode(code);
      } catch (e) {
        server.close();
        rejectCode(e instanceof Error ? e : new Error(String(e)));
      }
    });

    server.on('error', (e) => rejectReady(e));

    server.listen(port, '127.0.0.1', () => {
      timeoutId = setTimeout(() => {
        server.close();
        rejectCode(new Error('انتهت مهلة تسجيل الدخول — حاول مرة أخرى'));
      }, timeoutMs);

      resolveReady({
        redirectUri,
        waitForCode: () => codePromise,
        close: () => {
          if (timeoutId) clearTimeout(timeoutId);
          server.close();
        },
      });
    });
  });
}

async function exchangeCodeForTokens(
  creds: GoogleOAuthCredentials,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await postJson(
    'https://oauth2.googleapis.com/token',
    {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
    {},
    { timeout: 30_000 },
  );
  if (!res.ok) {
    let detail = res.body.slice(0, 280);
    try {
      const j = JSON.parse(res.body) as { error_description?: string; error?: string };
      detail = j.error_description ?? j.error ?? detail;
    } catch { /* keep raw */ }
    throw new Error(`فشل الحصول على التوكن: ${detail}`);
  }
  return JSON.parse(res.body) as TokenResponse;
}

async function fetchChannelTitle(accessToken: string): Promise<string | undefined> {
  if (isMaskedSettingValue(accessToken) || !/^[\x20-\x7E]+$/.test(accessToken)) {
    return undefined;
  }
  try {
    const r = await getText(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { Authorization: `Bearer ${accessToken}` },
      { timeout: 15_000 },
    );
    if (!r.ok) return undefined;
    const d = JSON.parse(r.body) as { items?: { snippet?: { title?: string } }[] };
    return d.items?.[0]?.snippet?.title;
  } catch {
    return undefined;
  }
}

function persistOAuthClientCredentials(creds: GoogleOAuthCredentials): void {
  setSetting('youtube_client_id', creds.clientId);
  setSetting('youtube_client_secret', creds.clientSecret);
}

function persistTokens(
  creds: GoogleOAuthCredentials,
  tokens: TokenResponse,
): void {
  persistOAuthClientCredentials(creds);
  if (tokens.access_token) setSetting('youtube_access_token', tokens.access_token);
  if (tokens.refresh_token) setSetting('youtube_refresh_token', tokens.refresh_token);
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    setSetting('youtube_token_expires_at', String(expiresAt));
  }
}

/** Refresh access token using stored refresh token + client credentials. */
export async function refreshYoutubeAccessToken(): Promise<string | null> {
  const refreshToken = getSetting('youtube_refresh_token');
  const clientId = getSetting('youtube_client_id');
  const clientSecret = getSetting('youtube_client_secret');
  if (!refreshToken || !clientId || !clientSecret) return null;

  const res = await postJson('https://oauth2.googleapis.com/token', {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!res.ok) return null;
  try {
    const d = JSON.parse(res.body) as TokenResponse;
    if (!d.access_token) return null;
    setSetting('youtube_access_token', d.access_token);
    if (d.expires_in) {
      setSetting('youtube_token_expires_at', String(Date.now() + d.expires_in * 1000));
    }
    return d.access_token;
  } catch {
    return null;
  }
}

/** Returns a valid access token, refreshing when near expiry. */
export async function getValidYoutubeAccessToken(): Promise<string | null> {
  const stored = getSetting('youtube_access_token');
  const expiresRaw = getSetting('youtube_token_expires_at');
  const expiresAt = expiresRaw ? Number(expiresRaw) : 0;
  const stale = expiresAt > 0 && Date.now() > expiresAt - 60_000;

  if (stored && !stale) return stored;
  const refreshed = await refreshYoutubeAccessToken();
  if (refreshed) return refreshed;
  return stored || null;
}

function buildAuthUrl(creds: GoogleOAuthCredentials, redirectUri: string): URL {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', creds.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  return authUrl;
}

/** Parse loopback redirect URL after Google sign-in (manual fallback). */
export function parseOAuthCallbackUrl(raw: string): { code: string; redirectUri: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('رابط غير صالح — الصق الرابط الكامل من شريط عنوان المتصفح');
  }
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
    throw new Error('الرابط يجب أن يبدأ بـ http://127.0.0.1:…/oauth2callback');
  }
  const err = url.searchParams.get('error');
  if (err) {
    throw new Error(err === 'access_denied' ? 'ألغيتَ تسجيل الدخول' : err);
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error('الرابط لا يحتوي على code — أكمل تسجيل الدخول في Google أولاً');
  const redirectUri = `${url.protocol}//${url.host}${url.pathname}`;
  return { code, redirectUri };
}

async function finalizeYoutubeOAuth(
  creds: GoogleOAuthCredentials,
  code: string,
  redirectUri: string,
): Promise<YoutubeOAuthResult> {
  const tokens = await exchangeCodeForTokens(creds, code, redirectUri);
  if (!tokens.access_token) {
    throw new Error(tokens.error_description ?? tokens.error ?? 'لم يُرجَع access_token');
  }

  persistTokens(creds, tokens);
  let channelTitle: string | undefined;
  try {
    channelTitle = await fetchChannelTitle(tokens.access_token);
  } catch (e) {
    log.warn('Could not fetch YouTube channel title', { err: String(e) });
  }
  log.info('YouTube OAuth connected', { channelTitle, hasRefresh: Boolean(tokens.refresh_token) });

  return {
    ok: true,
    channelTitle,
    expiresIn: tokens.expires_in,
    hasRefreshToken: Boolean(tokens.refresh_token),
  };
}

/** Complete OAuth when the browser redirected but EyesPro did not catch the code. */
export async function completeYoutubeOAuthFromCallbackUrl(
  callbackUrl: string,
): Promise<YoutubeOAuthResult> {
  const { code, redirectUri } = parseOAuthCallbackUrl(callbackUrl);
  const clientId = getSetting('youtube_client_id');
  const clientSecret = getSetting('youtube_client_secret');
  if (!clientId || !clientSecret) {
    throw new Error('ارفع ملف JSON أولاً عبر «ربط عبر ملف Google JSON» ثم أعد تسجيل الدخول');
  }
  return finalizeYoutubeOAuth(
    { clientId, clientSecret, redirectUris: [] },
    code,
    redirectUri,
  );
}

/**
 * Full OAuth loop: credentials JSON file → system browser login → save tokens in settings.
 * Google blocks embedded Electron windows; the default browser is required.
 */
export async function connectYoutubeFromCredentialsFile(
  filePath: string,
): Promise<YoutubeOAuthResult> {
  const creds = parseGoogleOAuthCredentialsFile(filePath);
  return connectYoutubeWithCredentials(creds);
}

export async function connectYoutubeWithCredentials(
  creds: GoogleOAuthCredentials,
): Promise<YoutubeOAuthResult> {
  persistOAuthClientCredentials(creds);
  const loopback = await startLoopbackOAuthServer('/oauth2callback', 5 * 60_000);

  try {
    const authUrl = buildAuthUrl(creds, loopback.redirectUri);
    await shell.openExternal(authUrl.toString());

    log.info('YouTube OAuth opened in system browser', { redirectUri: loopback.redirectUri });

    const code = await loopback.waitForCode();
    return finalizeYoutubeOAuth(creds, code, loopback.redirectUri);
  } finally {
    loopback.close();
  }
}
