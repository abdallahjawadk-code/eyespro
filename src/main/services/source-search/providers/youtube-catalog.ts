import type { FeedSearchResult } from '../types';
import type { SectorId } from '../topics';

const YT_CHANNELS: Array<{
  name: string;
  channelId: string;
  tags: string[];
  sectors: SectorId[];
}> = [
  { name: 'NASA', channelId: 'UCLA_DiR1FfKNvjuUpBHmylQ', tags: ['science', 'علوم'], sectors: ['science', 'all'] },
  { name: 'Kurzgesagt', channelId: 'UCsXVk37bltHxD1rDPwtNM8Q', tags: ['science'], sectors: ['science', 'all'] },
  { name: 'Veritasium', channelId: 'UCHnyfMqiRRG3uOCqxjnMOQ', tags: ['science'], sectors: ['science'] },
  { name: 'Marques Brownlee', channelId: 'UCBJycsmduvYEL83R_U4JriQ', tags: ['tech'], sectors: ['tech', 'all'] },
  { name: 'Linus Tech Tips', channelId: 'UCXuqSBlHAE6Xw-yeJA0Tunw', tags: ['tech'], sectors: ['tech'] },
  { name: 'IGN', channelId: 'UCKy1tqh7bwU6f9hhbPkR5uw', tags: ['gaming', 'افلام'], sectors: ['gaming', 'entertainment'] },
  { name: 'GameSpot', channelId: 'UCbu2mswpgKPrIBbd5k9wyLg', tags: ['gaming'], sectors: ['gaming'] },
  { name: 'Vox', channelId: 'UCLXo7UDZvByw2ixzpQDltgQ', tags: ['news', 'culture'], sectors: ['news', 'arts', 'lifestyle'] },
  { name: 'TED', channelId: 'UCAuUUnT6oDeKwE6v1VRuHhg', tags: ['science', 'culture'], sectors: ['science', 'arts', 'all'] },
  { name: 'Nat Geo', channelId: 'UCpVm7bg6pXKo1Pr6k5kxG9A', tags: ['science', 'travel'], sectors: ['science', 'lifestyle'] },
];

function ytRss(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function runYoutubeCatalog(
  query: string,
  sector: SectorId,
  add: (r: FeedSearchResult) => void
): number {
  let n = 0;
  const ql = query.toLowerCase();
  for (const ch of YT_CHANNELS) {
    if (sector !== 'all' && !ch.sectors.includes(sector) && !ch.sectors.includes('all')) continue;
    const hay = `${ch.name} ${ch.tags.join(' ')}`.toLowerCase();
    if (ql && !hay.includes(ql) && !ch.tags.some((t) => ql.includes(t.toLowerCase()))) {
      continue;
    }
    add({
      title: `YouTube — ${ch.name}`,
      feedUrl: ytRss(ch.channelId),
      website: `https://www.youtube.com/channel/${ch.channelId}`,
      type: 'youtube',
      provider: 'youtube',
      score: 50,
      description: 'خلاصة فيديو YouTube',
    });
    n++;
  }
  return n;
}
