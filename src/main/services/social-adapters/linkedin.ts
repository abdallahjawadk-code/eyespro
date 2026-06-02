import type { TestResult, Cfg } from './types';
import { get } from './types';
import { postJson } from '../../net/http';

export type PublishResult = { ok: boolean; postUrl?: string; postId?: string; error?: string };

export async function publish(text: string, link?: string, cfg: Cfg = {}): Promise<PublishResult> {
  const token = cfg['access_token'];
  const author = cfg['author_urn'];
  if (!token) return { ok: false, error: 'access_token مفقود — الإعدادات → LinkedIn' };
  if (!author) return { ok: false, error: 'author_urn مفقود — الإعدادات → LinkedIn' };

  let commentary = text;
  if (link?.trim() && !commentary.includes(link.trim())) {
    commentary += `\n\n${link.trim()}`;
  }

  const payload: Record<string, unknown> = {
    author,
    commentary,
    visibility: 'PUBLIC',
    lifecycleState: 'PUBLISHED',
    distribution: { feedDistribution: 'MAIN_FEED' },
  };

  const r = await postJson('https://api.linkedin.com/rest/posts', payload, {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': '202401',
    'X-Restli-Protocol-Version': '2.0.0',
  });
  if (!r.ok) {
    return { ok: false, error: `LinkedIn HTTP ${r.status}: ${r.body.slice(0, 220)}` };
  }
  const postId = r.headers?.['x-restli-id'] as string | undefined;
  return {
    ok: true,
    postId: postId ?? undefined,
    postUrl: postId ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}` : undefined,
  };
}

export async function test(cfg: Cfg): Promise<TestResult> {
  const token = cfg['access_token'];
  if (!token) return { ok: false, error: 'access_token مفقود' };
  const r = await get('https://api.linkedin.com/v2/userinfo', { Authorization: `Bearer ${token}` });
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 150)}` };
  const d = JSON.parse(r.body) as { name?: string; sub?: string };
  return { ok: true, info: d.name ?? d.sub ?? 'LinkedIn Account' };
}
