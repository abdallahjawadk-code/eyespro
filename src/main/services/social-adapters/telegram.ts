import type { TestResult, Cfg } from './types';
import { get } from './types';
import { postJson } from '../../net/http';

export type PublishResult = { ok: boolean; postUrl?: string; postId?: string; error?: string };

export async function publish(text: string, link?: string, cfg: Cfg = {}): Promise<PublishResult> {
  const token = cfg['bot_token'];
  const chatId = cfg['chat_id'];
  if (!token) return { ok: false, error: 'bot_token مفقود — الإعدادات → Telegram' };
  if (!chatId) return { ok: false, error: 'chat_id / channel_id مفقود — الإعدادات → Telegram' };

  let msg = text;
  if (link?.trim() && !msg.includes(link.trim())) msg += `\n\n${link.trim()}`;

  const r = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: msg,
    disable_web_page_preview: false,
  });
  if (!r.ok) {
    try {
      const e = JSON.parse(r.body) as { description?: string };
      return { ok: false, error: e.description ?? `HTTP ${r.status}` };
    } catch {
      return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 180)}` };
    }
  }
  try {
    const d = JSON.parse(r.body) as { result?: { message_id?: number } };
    const mid = d.result?.message_id;
    return { ok: true, postId: mid != null ? String(mid) : undefined };
  } catch {
    return { ok: true };
  }
}

export async function test(cfg: Cfg): Promise<TestResult> {
  const token = cfg['bot_token'];
  if (!token) return { ok: false, error: 'bot_token مفقود' };
  const r = await get(`https://api.telegram.org/bot${token}/getMe`);
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 200)}` };
  const d = JSON.parse(r.body) as { result?: { username?: string; first_name?: string } };
  return { ok: true, info: `Bot: @${d.result?.username ?? d.result?.first_name ?? '?'}` };
}
