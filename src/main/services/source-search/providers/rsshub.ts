import { fetchUrlGuarded } from '../../../net/guarded-fetch';
import { getSetting } from '../../settings';
import type { FeedSearchResult } from '../types';
import { expandSearchTerms } from '../topic-expansion';
import type { SectorId } from '../topics';

const SECTOR_SUBREDDITS: Record<string, string[]> = {
  entertainment: ['movies', 'television', 'netflix', 'boxoffice'],
  science: ['science', 'askscience', 'space'],
  arts: ['Art', 'design', 'literature'],
  sports: ['sports', 'soccer', 'nba'],
  tech: ['technology', 'gadgets', 'programming'],
  gaming: ['gaming', 'Games', 'pcgaming'],
  lifestyle: ['travel', 'food', 'Cooking'],
  news: ['worldnews', 'news'],
};

function rsshubBase(): string {
  const base = (getSetting('rsshub_base_url') || 'https://rsshub.app').replace(/\/$/, '');
  return base;
}

function parseRssTitles(xml: string, feedUrl: string, label: string): FeedSearchResult | null {
  if (!xml.includes('<item') && !xml.includes('<entry')) return null;
  return {
    title: label,
    feedUrl,
    type: 'rss',
    provider: 'rsshub',
    score: 58,
  };
}

export async function runRsshub(
  query: string,
  sector: SectorId,
  add: (r: FeedSearchResult) => void
): Promise<number> {
  let n = 0;
  const base = rsshubBase();
  const terms = expandSearchTerms(query).slice(0, 2);

  for (const term of terms) {
    const searchUrl = `${base}/reddit/search/${encodeURIComponent(term)}`;
    try {
      const res = await fetchUrlGuarded(searchUrl);
      if (res.ok) {
        const item = parseRssTitles(res.body, searchUrl, `Reddit: ${term}`);
        if (item) {
          add(item);
          n++;
        }
      }
    } catch {
      /* skip */
    }
  }

  const subs = (sector !== 'all' ? SECTOR_SUBREDDITS[sector] ?? [] : ['worldnews', 'news']).slice(0, 4);
  for (const sub of subs) {
    const feedUrl = `${base}/reddit/r/${sub}`;
    try {
      const res = await fetchUrlGuarded(feedUrl);
      if (res.ok && (res.body.includes('<item') || res.body.includes('<entry'))) {
        add({
          title: `Reddit r/${sub}`,
          feedUrl,
          website: `https://reddit.com/r/${sub}`,
          type: 'rss',
          provider: 'rsshub',
          score: 55,
        });
        n++;
      }
    } catch {
      /* skip */
    }
  }

  return n;
}
