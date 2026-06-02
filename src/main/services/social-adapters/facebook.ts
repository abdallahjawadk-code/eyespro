import type { TestResult, Cfg } from './types';
import { get } from './types';
import { postForm } from '../../net/http';

export type PublishResult = { ok: boolean; postUrl?: string; postId?: string; error?: string };

export async function publish(message: string, link?: string, cfg: Cfg = {}): Promise<PublishResult> {
  const token = cfg['page_token'];
  const pageId = cfg['page_id'];
  if (!token) return { ok: false, error: 'page_token مفقود — الإعدادات → Facebook' };
  if (!pageId) return { ok: false, error: 'page_id مفقود — الإعدادات → Facebook' };

  const form: Record<string, string> = { message, access_token: token };
  if (link?.trim()) form.link = link.trim();

  const r = await postForm(`https://graph.facebook.com/v19.0/${pageId}/feed`, form);
  if (!r.ok) {
    try {
      const e = JSON.parse(r.body) as { error?: { message?: string } };
      return { ok: false, error: e.error?.message ?? `HTTP ${r.status}` };
    } catch {
      return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 180)}` };
    }
  }
  try {
    const d = JSON.parse(r.body) as { id?: string };
    const postId = d.id ?? '';
    return {
      ok: true,
      postId,
      postUrl: postId ? `https://www.facebook.com/${postId}` : undefined,
    };
  } catch {
    return { ok: true };
  }
}

export async function test(cfg: Cfg): Promise<TestResult> {
  const token = cfg['page_token'];
  const pageId = cfg['page_id'];
  if (!token) return { ok: false, error: 'page_token مفقود' };
  const target = pageId ? `${pageId}?fields=name,fan_count` : 'me';
  const r = await get(`https://graph.facebook.com/v19.0/${target}&access_token=${token}`);
  if (r.status !== 200) {
    try {
      const e = JSON.parse(r.body) as { error?: { message?: string } };
      return { ok: false, error: e.error?.message ?? `HTTP ${r.status}` };
    } catch { return { ok: false, error: `HTTP ${r.status}` }; }
  }
  const d = JSON.parse(r.body) as { name?: string; fan_count?: number };
  return { ok: true, info: `${d.name ?? 'Page'}${d.fan_count ? ` · ${d.fan_count.toLocaleString()} likes` : ''}` };
}
