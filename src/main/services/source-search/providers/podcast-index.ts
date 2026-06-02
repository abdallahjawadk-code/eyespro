import { createHash } from 'node:crypto';
import { getText } from '../../../net/http';
import { isUrlFetchAllowedAsync } from '../../../security/fetch-guard';
import { getSetting } from '../../settings';
import type { FeedSearchResult } from '../types';
import { expandSearchTerms } from '../topic-expansion';

type PodcastFeed = {
  title?: string;
  url?: string;
  link?: string;
  description?: string;
};

function podcastHeaders(): Record<string, string> | null {
  const apiKey = getSetting('podcastindex_api_key')?.trim();
  const apiSecret = getSetting('podcastindex_api_secret')?.trim();
  if (!apiKey || !apiSecret) return null;
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = createHash('sha1').update(apiKey + apiSecret + apiHeaderTime).digest('hex');
  return {
    'X-Auth-Date': String(apiHeaderTime),
    'X-Auth-Key': apiKey,
    Authorization: hash,
    'User-Agent': 'EyesPro/1.0',
  };
}

export async function runPodcastIndex(query: string, add: (r: FeedSearchResult) => void): Promise<number> {
  const headers = podcastHeaders();
  if (!headers) return 0;
  let n = 0;
  const term = expandSearchTerms(query)[0] ?? query;
  const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(term)}&max=12`;
  try {
    const allowed = await isUrlFetchAllowedAsync(url);
    if (!allowed.ok) return 0;
    const res = await getText(url, headers, { maxBytes: 2 * 1024 * 1024 });
    if (!res.ok) return 0;
    const data = JSON.parse(res.body) as { feeds?: PodcastFeed[] };
    for (const f of data.feeds ?? []) {
      const feedUrl = f.url?.trim();
      if (!feedUrl) continue;
      try {
        new URL(feedUrl);
      } catch {
        continue;
      }
      add({
        title: f.title ?? feedUrl,
        feedUrl,
        website: f.link,
        description: f.description?.slice(0, 180),
        type: 'podcast',
        provider: 'podcast',
        score: 62,
      });
      n++;
    }
  } catch {
    return n;
  }
  return n;
}
