import { fetchUrlGuarded } from '../net/guarded-fetch';
import { getSetting } from './settings';
import { getDomainPolicy } from './domain-policy';

const cache = new Map<string, { allowed: boolean; expires: number }>();

function robotsEnabled(): boolean {
  return getSetting('fetch_respect_robots') !== '0';
}

function parseRobots(body: string, path: string): boolean {
  const agents = body.split(/\n(?=User-agent:)/i);
  let relevant = '';
  for (const block of agents) {
    if (/User-agent:\s*\*/i.test(block) || /User-agent:\s*EyesPro/i.test(block)) {
      relevant = block;
      break;
    }
  }
  if (!relevant && agents[0]) relevant = agents[0]!;
  const rules = relevant.split('\n').map(l => l.trim());
  let allowAll = true;
  for (const line of rules) {
    const disallow = line.match(/^Disallow:\s*(.*)$/i);
    if (!disallow) continue;
    const prefix = (disallow[1] ?? '').trim();
    if (!prefix) { allowAll = true; continue; }
    if (path.startsWith(prefix)) allowAll = false;
  }
  return allowAll;
}

/** Returns whether fetching the URL path is allowed by robots.txt (best-effort). */
export async function isRobotsAllowed(urlStr: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!robotsEnabled()) return { allowed: true };
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  const policy = getDomainPolicy(parsed.hostname);
  if (policy && policy.respect_robots === 0) return { allowed: true };

  const key = parsed.origin;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { allowed: hit.allowed, reason: hit.allowed ? undefined : 'robots.txt disallow' };

  try {
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const res = await fetchUrlGuarded(robotsUrl);
    if (!res.ok) {
      cache.set(key, { allowed: true, expires: Date.now() + 3600_000 });
      return { allowed: true };
    }
    const allowed = parseRobots(res.body, parsed.pathname);
    cache.set(key, { allowed, expires: Date.now() + 3600_000 });
    return { allowed, reason: allowed ? undefined : 'robots.txt disallow' };
  } catch {
    return { allowed: true };
  }
}
