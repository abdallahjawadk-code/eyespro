import { fetchUrlGuarded } from '../../../net/guarded-fetch';
import type { FeedSearchResult } from '../types';
import { expandSearchTerms } from '../topic-expansion';

/** Direct Reddit search RSS (no RSSHub). */
export async function runReddit(query: string, add: (r: FeedSearchResult) => void): Promise<number> {
  let n = 0;
  for (const term of expandSearchTerms(query).slice(0, 2)) {
    const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(term)}&sort=relevance`;
    try {
      const res = await fetchUrlGuarded(url);
      if (res.ok && (res.body.includes('<item') || res.body.includes('<entry'))) {
        add({
          title: `Reddit search: ${term}`,
          feedUrl: url,
          website: 'https://www.reddit.com',
          type: 'rss',
          provider: 'reddit',
          score: 52,
        });
        n++;
      }
    } catch {
      /* skip */
    }
  }
  return n;
}
