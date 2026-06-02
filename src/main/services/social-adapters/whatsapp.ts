import type { TestResult, Cfg } from './types';
import { get } from './types';
import { postJson } from '../../net/http';

export type PublishResult = { ok: boolean; postUrl?: string; postId?: string; error?: string };

export async function publish(text: string, link?: string, cfg: Cfg = {}): Promise<PublishResult> {
  const apiUrl = cfg['api_url'];
  const token = cfg['token'];
  const recipient = cfg['recipient'];
  if (!apiUrl) return { ok: false, error: 'whatsapp_api_url مفقود — الإعدادات → WhatsApp' };
  if (!token) return { ok: false, error: 'whatsapp_token مفقود — الإعدادات → WhatsApp' };
  if (!recipient) {
    return { ok: false, error: 'whatsapp_recipient مفقود — أضف رقم المستلم في الإعدادات (E.164)' };
  }

  let body = text;
  if (link?.trim() && !body.includes(link.trim())) body += `\n\n${link.trim()}`;

  const r = await postJson(
    apiUrl.endsWith('/messages') ? apiUrl : `${apiUrl.replace(/\/$/, '')}/messages`,
    {
      messaging_product: 'whatsapp',
      to: recipient.replace(/\D/g, ''),
      type: 'text',
      text: { body: body.slice(0, 4096) },
    },
    { Authorization: `Bearer ${token}` },
  );
  if (!r.ok) {
    try {
      const e = JSON.parse(r.body) as { error?: { message?: string } };
      return { ok: false, error: e.error?.message ?? `HTTP ${r.status}` };
    } catch {
      return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 180)}` };
    }
  }
  try {
    const d = JSON.parse(r.body) as { messages?: { id?: string }[] };
    const id = d.messages?.[0]?.id;
    return { ok: true, postId: id };
  } catch {
    return { ok: true };
  }
}

export async function test(cfg: Cfg): Promise<TestResult> {
  const apiUrl = cfg['api_url'];
  const token = cfg['token'];
  if (!apiUrl) return { ok: false, error: 'api_url مفقود' };
  if (!token) return { ok: false, error: 'token مفقود' };
  const idMatch = apiUrl.match(/graph\.facebook\.com\/v[\d.]+\/(\d+)/);
  const phoneId = idMatch?.[1];
  const probeUrl = phoneId
    ? `https://graph.facebook.com/v19.0/${phoneId}`
    : apiUrl.replace(/\/messages\/?$/i, '').replace(/\/$/, '');
  const r = await get(probeUrl, { Authorization: `Bearer ${token}` });
  if (r.status !== 200) {
    try {
      const e = JSON.parse(r.body) as { error?: { message?: string } };
      return { ok: false, error: e.error?.message ?? `HTTP ${r.status}` };
    } catch { return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 150)}` }; }
  }
  try {
    const d = JSON.parse(r.body) as { verified_name?: string; display_phone_number?: string; id?: string };
    return { ok: true, info: d.verified_name ?? d.display_phone_number ?? d.id ?? 'WhatsApp Business' };
  } catch {
    return { ok: true, info: 'اتصال WhatsApp API ناجح' };
  }
}
