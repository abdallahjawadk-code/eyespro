import { getDb, touchDbSave } from '../db/database';
import { isSecretKey, prepareSecretForStorage, resolveSettingValue } from '../security/secrets-vault';

/** Placeholder sent by the renderer when a secret is masked — must never overwrite DB. */
export function isMaskedSettingValue(value: string): boolean {
  return /^•{4}/u.test(value);
}

const settingsCache = new Map<string, string>();

export function invalidateSettingsCache(key?: string): void {
  if (key) settingsCache.delete(key);
  else settingsCache.clear();
}

export function getSetting(key: string): string {
  if (settingsCache.has(key)) return settingsCache.get(key)!;
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const raw = row?.value ?? '';
  const resolved = isSecretKey(key) ? resolveSettingValue(raw) : raw.trim();
  const result = isMaskedSettingValue(resolved) ? '' : resolved;
  settingsCache.set(key, result);
  return result;
}

export function setSetting(key: string, value: string): void {
  if (isMaskedSettingValue(value)) return;
  const stored = isSecretKey(key) ? prepareSecretForStorage(value) : value;
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, stored);
  settingsCache.delete(key);
  touchDbSave();
}

/** Keys whose real values must never be sent to the renderer */
const MASKED_KEYS = new Set([
  'telegram_bot_token', 'twitter_bearer_token', 'twitter_api_key',
  'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
  'youtube_access_token', 'facebook_page_token',
  'linkedin_access_token', 'whatsapp_token',
  'instagram_access_token', 'instagram_app_secret',
  'email_smtp_pass',
  'gemini_api_key', 'openai_api_key', 'groq_api_key', 'anthropic_api_key',
  'eyespro_ai_api_key',
]);

function maskSecret(key: string, value: string): string {
  if (!MASKED_KEYS.has(key) || !value) return value;
  // Show only last 4 chars so UI can tell if it's set
  return value.length > 4 ? '••••' + value.slice(-4) : '••••';
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) {
    const resolved = isSecretKey(r.key) ? resolveSettingValue(r.value) : r.value;
    out[r.key] = maskSecret(r.key, resolved);
  }
  return out;
}

/** Returns the actual unmasked value — for internal use only, never send to renderer */
export function getAllSettingsRaw(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[r.key] = isSecretKey(r.key) ? resolveSettingValue(r.value) : r.value;
  }
  return out;
}

export const INTEGRATION_KEYS = [
  'telegram_bot_token',
  'telegram_channel_id',
  'twitter_bearer_token',
  'twitter_api_key',
  'twitter_api_secret',
  'twitter_access_token',
  'twitter_access_secret',
  'youtube_access_token',
  'facebook_page_token',
  'facebook_page_id',
  'linkedin_access_token',
  'linkedin_author_urn',
  'whatsapp_api_url',
  'whatsapp_token',
  'whatsapp_recipient',
  'instagram_app_id',
  'instagram_app_secret',
  'instagram_access_token',
  'instagram_account_id',
  'email_smtp_host',
  'email_smtp_port',
  'email_smtp_user',
  'email_smtp_pass',
  'gemini_api_key',
  'openai_api_key',
  'groq_api_key',
  'anthropic_api_key',
  'ollama_base_url',
  'ai_provider',
  'ai_model',
  'ui_language',
  'ui_theme'
] as const;
