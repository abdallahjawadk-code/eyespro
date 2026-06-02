import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';
import { prepareSecretForStorage, resolveSettingValue } from '../security/secrets-vault';
import { getSetting } from './settings';
import * as telegramAdapter from './social-adapters/telegram';
import * as facebookAdapter from './social-adapters/facebook';
import * as twitterAdapter from './social-adapters/twitter';
import * as linkedinAdapter from './social-adapters/linkedin';
import * as youtubeAdapter from './social-adapters/youtube';
import * as whatsappAdapter from './social-adapters/whatsapp';

export const SOCIAL_PLATFORMS = [
  'telegram',
  'youtube',
  'twitter',
  'facebook',
  'linkedin',
  'whatsapp',
  'substack',
  'ghost'
] as const;

/** Encrypt each credential value in the config before writing to DB */
function encryptConfig(config: Record<string, string>): string {
  const encrypted: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    encrypted[k] = v ? prepareSecretForStorage(v) : v;
  }
  return JSON.stringify(encrypted);
}

/** Decrypt each credential value when reading from DB */
function decryptConfig(json: string): Record<string, string> {
  try {
    const raw = JSON.parse(json) as Record<string, string>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = v ? resolveSettingValue(v) : v;
    }
    return result;
  } catch {
    return {};
  }
}

export function listConnections() {
  const rows = getDb()
    .prepare(`SELECT id, platform, label, config_json, enabled, created_at FROM social_connections ORDER BY platform`)
    .all() as { id: number; platform: string; label: string; config_json: string; enabled: number; created_at: string }[];

  // Decrypt config before returning — never expose raw vault-encrypted strings to renderer
  return rows.map(({ config_json, ...rest }) => ({
    ...rest,
    config: decryptConfig(config_json)
  }));
}

/**
 * Returns all configured connections — merging social_connections table
 * AND settings table. Users who configured credentials in Settings → Social
 * will see those platforms appear here as synthetic (id < 0) connections.
 */
export function listEffectiveConnections() {
  const real = listConnections();
  const realPlatforms = new Set(real.map(c => c.platform));

  // Settings-table presence checks per platform
  const SETTINGS_PRESENCE: { platform: string; primaryKey: string; label: string }[] = [
    { platform: 'facebook',  primaryKey: 'facebook_page_token',  label: 'Facebook (الإعدادات)' },
    { platform: 'telegram',  primaryKey: 'telegram_bot_token',   label: 'Telegram (الإعدادات)' },
    { platform: 'twitter',   primaryKey: 'twitter_bearer_token', label: 'Twitter (الإعدادات)' },
    { platform: 'linkedin',  primaryKey: 'linkedin_access_token', label: 'LinkedIn (الإعدادات)' },
    { platform: 'youtube',   primaryKey: 'youtube_access_token', label: 'YouTube (الإعدادات)' },
    { platform: 'whatsapp',  primaryKey: 'whatsapp_api_url',     label: 'WhatsApp (الإعدادات)' },
    { platform: 'instagram', primaryKey: 'instagram_access_token', label: 'Instagram (الإعدادات)' },
  ];

  const synthetic: ReturnType<typeof listConnections> = [];
  let syntheticId = -1;

  for (const { platform, primaryKey, label } of SETTINGS_PRESENCE) {
    if (realPlatforms.has(platform)) continue; // already covered by a real connection
    const val = getSetting(primaryKey);
    if (val && val.trim()) {
      synthetic.push({
        id: syntheticId--,
        platform,
        label,
        enabled: 1,
        created_at: '',
        config: {} // config not exposed for settings-based entries
      });
    }
  }

  return [...real, ...synthetic];
}

/** Minimum settings keys required before a platform is considered configured */
const PLATFORM_REQUIRED_KEYS: Record<string, string[]> = {
  telegram:  ['telegram_bot_token', 'telegram_channel_id'],
  facebook:  ['facebook_page_token', 'facebook_page_id'],
  twitter:   ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'],
  linkedin:  ['linkedin_access_token', 'linkedin_author_urn'],
  youtube:   ['youtube_access_token'],
  whatsapp:  ['whatsapp_api_url', 'whatsapp_token'],
};

export function isPlatformConfigured(platform: string): boolean {
  const keys = PLATFORM_REQUIRED_KEYS[platform];
  if (keys?.length) {
    return keys.every(k => getSetting(k).trim().length > 0);
  }
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM social_connections WHERE platform=? AND enabled=1 LIMIT 1`)
    .get(platform) as { ok: number } | undefined;
  return !!row;
}

export function listConfiguredPlatformIds(): string[] {
  const ids = new Set<string>();
  for (const p of SOCIAL_PLATFORMS) {
    if (isPlatformConfigured(p)) ids.add(p);
  }
  return [...ids];
}

export function saveConnection(platform: string, label: string, config: Record<string, string>): number {
  const r = getDb()
    .prepare(`INSERT INTO social_connections (platform, label, config_json, enabled) VALUES (?, ?, ?, 1)`)
    .run(
      sanitizeString(platform, 32),
      sanitizeString(label, 200),
      encryptConfig(config)
    );
  return Number(r.lastInsertRowid);
}

export function deleteConnection(id: number): boolean {
  return getDb().prepare(`DELETE FROM social_connections WHERE id=?`).run(id).changes > 0;
}

/**
 * Mapping: social_connections.config_json field → settings table key
 * Used by getSocialCred() to resolve credentials from either source.
 */
const FIELD_TO_SETTING: Record<string, Record<string, string>> = {
  telegram:  { bot_token: 'telegram_bot_token',  chat_id: 'telegram_channel_id' },
  facebook:  { page_token: 'facebook_page_token', page_id: 'facebook_page_id' },
  twitter:   { bearer_token: 'twitter_bearer_token', api_key: 'twitter_api_key', api_secret: 'twitter_api_secret', access_token: 'twitter_access_token', access_secret: 'twitter_access_secret' },
  linkedin:  { access_token: 'linkedin_access_token', author_urn: 'linkedin_author_urn' },
  whatsapp:  { api_url: 'whatsapp_api_url', token: 'whatsapp_token' },
  youtube:   { access_token: 'youtube_access_token' },
  instagram: { access_token: 'instagram_access_token', account_id: 'instagram_account_id' },
};

/** Returns the first enabled connection config for a platform (decrypted).
 *  Normalises field aliases (e.g. twitter api_key_secret → api_secret). */
export function getConnectionConfig(platform: string): Record<string, string> | null {
  const row = getDb()
    .prepare(`SELECT config_json FROM social_connections WHERE platform=? AND enabled=1 ORDER BY id DESC LIMIT 1`)
    .get(platform) as { config_json: string } | undefined;
  if (!row) return null;
  const cfg = decryptConfig(row.config_json);
  // Normalise Twitter: api_secret might be stored as api_key_secret in some clients
  if (platform === 'twitter' && cfg['api_key_secret'] && !cfg['api_secret']) {
    cfg['api_secret'] = cfg['api_key_secret'];
  }
  return cfg;
}

/**
 * Resolve a credential for a platform+field combination.
 * Priority: social_connections (UI-configured) → settings table (manual config).
 * This bridges the gap between the Connections UI and publish services.
 */
export function getSocialCred(platform: string, field: string): string {
  const p = platform.toLowerCase();

  // Instagram OAuth stores credentials in settings — prefer over stale social_connections
  if (p === 'instagram') {
    const settingKey = FIELD_TO_SETTING.instagram?.[field];
    if (settingKey) {
      const val = getSetting(settingKey);
      if (val) return val;
    }
    const direct = getSetting(`${p}_${field}`);
    if (direct) return direct;
    return getConnectionConfig(p)?.[field] ?? '';
  }

  // 1. Try social_connections first
  const config = getConnectionConfig(p);
  if (config?.[field]) return config[field];

  // 2. Fall back to settings table via field→setting key mapping
  const settingKey = FIELD_TO_SETTING[p]?.[field];
  if (settingKey) {
    const val = getSetting(settingKey);
    if (val) return val;
  }

  // 3. Try direct setting key (facebook_page_token etc.)
  const directKey = `${p}_${field}`;
  return getSetting(directKey) ?? '';
}

/** Test a platform by name — resolves credentials via getSocialCred (settings OR connections). */
export async function testConnectionByPlatform(platform: string): Promise<{ ok: boolean; info?: string; error?: string }> {
  const c = (field: string) => getSocialCred(platform, field);
  // Build cfg from getSocialCred for all known fields
  const fieldMap = FIELD_TO_SETTING[platform] ?? {};
  const cfg: Record<string, string> = {};
  for (const field of Object.keys(fieldMap)) {
    const v = c(field);
    if (v) cfg[field] = v;
  }
  if (platform === 'telegram' && !cfg['bot_token']) {
    const v = getSetting('telegram_bot_token'); if (v) cfg['bot_token'] = v;
  }
  if (platform === 'youtube') {
    const { getValidYoutubeAccessToken } = await import('./youtube-oauth');
    const fresh = await getValidYoutubeAccessToken();
    if (fresh) cfg['access_token'] = fresh;
  }
  if (platform === 'instagram') {
    const { testInstagramConnection } = await import('./instagram-auth');
    const r = await testInstagramConnection();
    if (!r.ok) return { ok: false, error: r.error };
    const extra = r.publishQuota ? ` · ${r.publishQuota}` : '';
    return { ok: true, info: `@${r.username} (${r.accountType})${extra}` };
  }
  return runPlatformTest(platform, cfg);
}

/** Test a saved connection by ID. Returns { ok, info } */
export async function testConnection(id: number): Promise<{ ok: boolean; info?: string; error?: string }> {
  let cfg: Record<string, string>;
  let p: string;

  if (id > 0) {
    // Real connection from social_connections table
    const row = getDb()
      .prepare(`SELECT platform, config_json FROM social_connections WHERE id=?`)
      .get(id) as { platform: string; config_json: string } | undefined;
    if (!row) return { ok: false, error: 'Connection not found' };
    cfg = decryptConfig(row.config_json);
    p = row.platform;
  } else {
    // Synthetic connection from settings table — find platform from listEffectiveConnections
    const eff = listEffectiveConnections();
    const conn = eff.find(c => c.id === id);
    if (!conn) return { ok: false, error: 'Connection not found' };
    p = conn.platform;
    // Build cfg from settings using FIELD_TO_SETTING map
    const fieldMap = FIELD_TO_SETTING[p] ?? {};
    cfg = {};
    for (const [field, settingKey] of Object.entries(fieldMap)) {
      const v = getSetting(settingKey);
      if (v) cfg[field] = v;
    }
  }

  return runPlatformTest(p, cfg);
}

const PLATFORM_ADAPTERS: Record<string, { test: (cfg: Record<string, string>) => Promise<{ ok: boolean; info?: string; error?: string }> }> = {
  telegram:  telegramAdapter,
  facebook:  facebookAdapter,
  twitter:   twitterAdapter,
  linkedin:  linkedinAdapter,
  youtube:   youtubeAdapter,
  whatsapp:  whatsappAdapter,
};

async function runPlatformTest(p: string, cfg: Record<string, string>): Promise<{ ok: boolean; info?: string; error?: string }> {
  const adapter = PLATFORM_ADAPTERS[p];
  if (!adapter) return { ok: false, error: `لا يوجد اختبار اتصال للمنصة: ${p}` };
  try {
    return await adapter.test(cfg);
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

export function platformGuide(platform: string): string {
  const guides: Record<string, string> = {
    telegram: [
      '1. افتح تطبيق Telegram وتحدث مع @BotFather',
      '2. أرسل الأمر /newbot واتبع التعليمات للحصول على Bot Token',
      '3. أضف البوت إلى القناة أو المجموعة وامنحه صلاحية الإدارة',
      '4. للحصول على Chat ID: أضف @userinfobot إلى القناة أو استخدم getUpdates API',
      '   معرف القناة العامة: @channelname — معرف الخاص: -1001234567890',
    ].join('\n'),
    facebook: [
      '1. اذهب إلى https://developers.facebook.com وأنشئ تطبيقاً من نوع Business',
      '2. أضف منتج "Facebook Login" و"Pages API"',
      '3. من Graph API Explorer: اختر تطبيقك → Generate Access Token',
      '4. تأكد من اختيار الصفحة (وليس المستخدم) في القائمة العلوية',
      '5. الصلاحيات المطلوبة: pages_manage_posts, pages_read_engagement, pages_show_list',
      '6. لرفع الفيديو أضف: pages_read_user_content',
      '7. لإبقاء التوكن دائماً: حوّله إلى Long-lived Token عبر /oauth/access_token',
      '8. Page ID: من عنوان صفحتك أو قسم About → Page transparency',
      '',
      '⚠️ تأكد من استخدام PAGE Access Token وليس USER Access Token',
    ].join('\n'),
    twitter: [
      '1. اذهب إلى https://console.x.com وأنشئ تطبيقاً (App)',
      '2. من Keys and tokens انسخ:',
      '   • Consumer Key → twitter_api_key',
      '   • Consumer Secret → twitter_api_secret',
      '   • Bearer Token → twitter_bearer_token (اختياري للاختبار)',
      '3. للنشر: من Authentication Tokens اضغط Generate وانسخ:',
      '   • Access Token → twitter_access_token',
      '   • Access Token Secret → twitter_access_secret',
      '4. تأكد من App permissions = **Read and Write** (وليس Read فقط)',
      '5. بعد تغيير الصلاحيات: Regenerate Access Token + Secret (التوكن القديم يبقى Read only)',
      '6. احفظ في EyesPro ثم «اختبار النشر»',
    ].join('\n'),
    linkedin: [
      '1. اذهب إلى https://www.linkedin.com/developers وأنشئ تطبيقاً',
      '2. أضف المنتجات: Share on LinkedIn, Sign In with LinkedIn using OpenID Connect',
      '3. من OAuth 2.0 Tools: احصل على Access Token بصلاحيات:',
      '   w_member_social, r_liteprofile, r_emailaddress',
      '4. Author URN: بعد الحصول على Token, استدعِ /v2/userinfo للحصول على Sub (ID)',
      '   Format: urn:li:person:XXXXXXX (للأشخاص) أو urn:li:organization:XXXXXXX (للشركات)',
    ].join('\n'),
    youtube: [
      '1. اذهب إلى https://console.cloud.google.com',
      '2. أنشئ مشروعاً جديداً وفعّل YouTube Data API v3',
      '3. من Credentials: أنشئ OAuth 2.0 Client ID (Desktop Application)',
      '4. استخدم OAuth Playground أو أداة خارجية للحصول على Access Token',
      '5. الصلاحيات المطلوبة: https://www.googleapis.com/auth/youtube.upload',
      '⚠️ Access Token تنتهي صلاحيته — ستحتاج إلى Refresh Token لتجديده تلقائياً',
    ].join('\n'),
    whatsapp: [
      '1. اذهب إلى https://developers.facebook.com',
      '2. أنشئ تطبيقاً من نوع Business وأضف منتج WhatsApp',
      '3. من WhatsApp → Getting Started: احصل على:',
      '   - Phone Number ID',
      '   - Access Token (Temporary أو Permanent)',
      '4. API URL: https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages',
    ].join('\n'),
    substack: 'لا توجد API رسمية للنشر — يُنصح بالنسخ اليدوي أو استخدام RSS لاستيراد المحتوى.',
    ghost: [
      '1. اذهب إلى Ghost Admin → Settings → Integrations',
      '2. أنشئ Custom Integration جديداً',
      '3. انسخ Admin API Key',
      '4. API URL: https://your-ghost-site.com',
    ].join('\n'),
  };
  return guides[platform] ?? 'Configure credentials in Settings → Integrations.';
}
