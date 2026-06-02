import { getDb } from '../db/database';
import { getArticle } from './articles';
import { getSocialCred, isPlatformConfigured } from './social';
import { POLICIES, splitSmart, labelPart } from './publish-policy';
import * as facebookAdapter from './social-adapters/facebook';
import * as twitterAdapter from './social-adapters/twitter';
import * as telegramAdapter from './social-adapters/telegram';
import * as linkedinAdapter from './social-adapters/linkedin';
import * as whatsappAdapter from './social-adapters/whatsapp';
import { getSetting } from './settings';

export type PublishInput = {
  articleId: number;
  platform: string;
  text: string;
  link?: string;
};

export type PublishOutcome = {
  ok: boolean;
  platform: string;
  postUrl?: string;
  postId?: string;
  error?: string;
};

type AdapterPublish = (
  text: string,
  link?: string,
  cfg?: Record<string, string>,
) => Promise<{ ok: boolean; postUrl?: string; postId?: string; error?: string }>;

const PUBLISHERS: Record<string, { publish: AdapterPublish }> = {
  facebook: facebookAdapter,
  twitter: twitterAdapter,
  telegram: telegramAdapter,
  linkedin: linkedinAdapter,
  whatsapp: whatsappAdapter,
};

function buildCfg(platform: string): Record<string, string> {
  const fields: Record<string, string[]> = {
    facebook: ['page_token', 'page_id'],
    twitter: ['api_key', 'api_secret', 'access_token', 'access_secret'],
    telegram: ['bot_token', 'chat_id'],
    linkedin: ['access_token', 'author_urn'],
    whatsapp: ['api_url', 'token'],
  };
  const cfg: Record<string, string> = {};
  for (const field of fields[platform] ?? []) {
    const v = getSocialCred(platform, field);
    if (v) cfg[field] = v;
  }
  if (platform === 'whatsapp') {
    const recipient = getSetting('whatsapp_recipient').trim();
    if (recipient) cfg['recipient'] = recipient;
  }
  return cfg;
}

function prepareParts(platform: string, text: string): string[] {
  const policy = POLICIES[platform] ?? { maxChars: 0, supportsThread: false };
  const parts = splitSmart(text, policy.maxChars);
  if (!policy.supportsThread || parts.length <= 1) {
    return parts.length ? [parts[0]!] : [''];
  }
  return parts.map((part, i) => labelPart(part, i + 1, parts.length, policy.maxChars));
}

function logPublish(row: PublishOutcome & { articleId: number }): void {
  getDb()
    .prepare(
      `INSERT INTO publish_logs (article_id, platform, success, post_url, error)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(row.articleId, row.platform, row.ok ? 1 : 0, row.postUrl ?? null, row.error ?? null);
}

export function listPublishPlatforms(): string[] {
  return Object.keys(PUBLISHERS).filter((p) => isPlatformConfigured(p));
}

export async function publishOne(input: PublishInput): Promise<PublishOutcome> {
  const platform = input.platform.toLowerCase();
  const publisher = PUBLISHERS[platform];
  if (!publisher) {
    return { ok: false, platform, error: `المنصة غير مدعومة للنشر التلقائي: ${platform}` };
  }
  if (!isPlatformConfigured(platform)) {
    return { ok: false, platform, error: `منصة ${platform} غير مُعدّة — اذهب إلى الإعدادات → التكاملات` };
  }

  const article = getArticle(input.articleId);
  if (!article) {
    return { ok: false, platform, error: 'المقال غير موجود' };
  }

  const text = input.text.trim();
  if (!text) {
    return { ok: false, platform, error: 'نص المنشور فارغ' };
  }

  const cfg = buildCfg(platform);
  const parts = prepareParts(platform, text);
  let last: { ok: boolean; postUrl?: string; postId?: string; error?: string } = { ok: false, error: 'فشل غير معروف' };

  for (const part of parts) {
    last = await publisher.publish(part, input.link?.trim() || undefined, cfg);
    if (!last.ok) break;
  }

  const outcome: PublishOutcome = {
    ok: last.ok,
    platform,
    postUrl: last.postUrl,
    postId: last.postId,
    error: last.error,
  };
  logPublish({ ...outcome, articleId: input.articleId });
  return outcome;
}

export async function publishCrossPost(
  articleId: number,
  platforms: string[],
  text: string,
  link?: string,
): Promise<PublishOutcome[]> {
  const unique = [...new Set(platforms.map((p) => p.toLowerCase()))];
  const results: PublishOutcome[] = [];
  for (const platform of unique) {
    results.push(await publishOne({ articleId, platform, text, link }));
  }
  return results;
}
