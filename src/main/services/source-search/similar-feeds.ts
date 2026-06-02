import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { listCatalogs } from './catalog-registry';
import { lookupDomainFeed } from './domain-patterns';
import type { FeedSearchResult } from './types';

export async function getSimilarFeeds(feedUrl: string, limit = 8): Promise<FeedSearchResult[]> {
  const out: FeedSearchResult[] = [];
  const seen = new Set<string>([feedUrl.toLowerCase()]);

  const known = lookupDomainFeed(feedUrl);
  if (known) {
    out.push({
      title: known.name,
      feedUrl: known.feedUrl,
      website: `https://${known.host}`,
      type: known.type ?? 'rss',
      provider: 'catalog',
      score: 70,
    });
  }

  let host = '';
  try {
    host = new URL(feedUrl).hostname.replace(/^www\./, '');
  } catch {
    return out;
  }

  for (const cat of listCatalogs()) {
    for (const item of cat.items) {
      if (!item.feedUrl) continue;
      const ih = (() => {
        try {
          return new URL(item.website || item.feedUrl).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      if (ih && (ih === host || ih.endsWith(`.${host}`) || host.endsWith(`.${ih}`))) {
        const key = item.feedUrl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: item.name,
          feedUrl: item.feedUrl,
          website: item.website,
          type: item.type ?? 'rss',
          provider: 'catalog',
          category: cat.id,
          score: 65,
        });
      }
    }
  }

  if (out.length < limit) {
    const feedlyUrl = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(host)}&count=8&locale=en`;
    try {
      const res = await fetchUrlGuarded(feedlyUrl);
      if (res.ok && res.body.includes('"results"')) {
        const data = JSON.parse(res.body) as { results?: { feedId?: string; title?: string; website?: string }[] };
        for (const r of data.results ?? []) {
          if (!r.feedId?.startsWith('feed/')) continue;
          const url = r.feedId.slice(5);
          const key = url.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            title: r.title || host,
            feedUrl: url,
            website: r.website,
            type: 'rss',
            provider: 'feedly',
            score: 55,
          });
          if (out.length >= limit) break;
        }
      }
    } catch {
      /* skip */
    }
  }

  return out.slice(0, limit);
}
