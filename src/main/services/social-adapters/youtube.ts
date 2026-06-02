import type { TestResult, Cfg } from './types';
import { get } from './types';

export async function test(cfg: Cfg): Promise<TestResult> {
  const token = cfg['access_token'];
  if (!token) return { ok: false, error: 'access_token مفقود' };
  const r = await get(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { Authorization: `Bearer ${token}` }
  );
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 150)}` };
  const d = JSON.parse(r.body) as { items?: { snippet?: { title?: string } }[] };
  return { ok: true, info: d.items?.[0]?.snippet?.title ?? 'YouTube Channel' };
}
