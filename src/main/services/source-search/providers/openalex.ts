import { fetchUrlGuarded } from '../../../net/guarded-fetch';
import { discoverSourceCandidates } from '../../source-discovery';
import type { FeedSearchResult } from '../types';
import { expandSearchTerms } from '../topic-expansion';

type OpenAlexSource = {
  id?: string;
  display_name?: string;
  homepage_url?: string;
};

export async function runOpenAlex(query: string, add: (r: FeedSearchResult) => void): Promise<number> {
  let n = 0;
  const term = expandSearchTerms(query).find((t) => t.length >= 3) ?? query;
  const apiUrl = `https://api.openalex.org/sources?search=${encodeURIComponent(term)}&per-page=8`;
  try {
    const res = await fetchUrlGuarded(apiUrl);
    if (!res.ok || !res.body.includes('"results"')) return 0;
    const data = JSON.parse(res.body) as { results?: OpenAlexSource[] };
    const tasks: Promise<void>[] = [];
    for (const src of data.results ?? []) {
      const home = src.homepage_url?.trim();
      if (!home) continue;
      const name = src.display_name ?? home;
      tasks.push(
        discoverSourceCandidates(home, { mode: 'fast', skipBrowser: true }).then((disc) => {
          if (!disc.ok || !disc.best) return;
          add({
            title: name,
            feedUrl: disc.best.feedUrl,
            website: home,
            type: disc.best.type,
            provider: 'openalex',
            score: disc.best.score ?? 60,
            description: 'مصدر أكاديمي — OpenAlex',
          });
          n++;
        })
      );
    }
    await Promise.allSettled(tasks);
  } catch {
    return n;
  }
  return n;
}
