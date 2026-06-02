import type { CatalogEntry } from './types';

/** Known-good RSS endpoints for major domains (skip slow discovery). */
export const DOMAIN_FEED_PATTERNS: Array<{
  host: string;
  feedUrl: string;
  name: string;
  type?: string;
  tags?: string[];
  language?: string;
}> = [
  { host: 'bbc.com', feedUrl: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', tags: ['news'], language: 'en' },
  { host: 'bbc.com', feedUrl: 'https://feeds.bbci.co.uk/arabic/rss.xml', name: 'BBC Arabic', tags: ['news', 'أخبار'], language: 'ar' },
  { host: 'theguardian.com', feedUrl: 'https://www.theguardian.com/world/rss', name: 'The Guardian', tags: ['news'], language: 'en' },
  { host: 'aljazeera.net', feedUrl: 'https://www.aljazeera.net/aljazeerarss', name: 'الجزيرة', tags: ['news', 'أخبار'], language: 'ar' },
  { host: 'alarabiya.net', feedUrl: 'https://www.alarabiya.net/tools/mrss', name: 'العربية', tags: ['news'], language: 'ar' },
  { host: 'techcrunch.com', feedUrl: 'https://techcrunch.com/feed/', name: 'TechCrunch', tags: ['tech'], language: 'en' },
  { host: 'theverge.com', feedUrl: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', tags: ['tech'], language: 'en' },
  { host: 'variety.com', feedUrl: 'https://variety.com/feed/', name: 'Variety', tags: ['افلام', 'movies'], language: 'en' },
  { host: 'nature.com', feedUrl: 'https://www.nature.com/nature.rss', name: 'Nature', tags: ['science', 'علوم'], language: 'en' },
  { host: 'espn.com', feedUrl: 'https://www.espn.com/espn/rss/news', name: 'ESPN', tags: ['sports', 'رياضة'], language: 'en' },
];

export function domainPatternsCatalog(): CatalogEntry {
  return {
    id: 'domain-patterns',
    name: 'مصادر موثّقة',
    description: 'خلاصات معروفة لمواقع شائعة',
    language: 'mixed',
    items: DOMAIN_FEED_PATTERNS.map((p) => ({
      name: p.name,
      website: `https://${p.host}`,
      feedUrl: p.feedUrl,
      type: p.type ?? 'rss',
      tags: p.tags ?? [],
    })),
  };
}

export function lookupDomainFeed(url: string): (typeof DOMAIN_FEED_PATTERNS)[0] | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return DOMAIN_FEED_PATTERNS.find((p) => host === p.host || host.endsWith(`.${p.host}`));
  } catch {
    return undefined;
  }
}
