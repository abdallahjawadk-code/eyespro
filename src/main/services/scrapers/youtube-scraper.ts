/**
 * YouTube Channel Scraper — 100% free, no API key.
 *
 * Uses YouTube's native Atom RSS feed:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
 *
 * Supports: channel URLs, @handle URLs, and direct channel IDs.
 */
import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { withRetry } from '../../net/stealth-utils';
import { createLogger } from '../../logger';

const log = createLogger('youtube-scraper');

export interface YoutubeVideo {
  videoId: string;
  title: string;
  link: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  channelName: string;
  viewCount?: string;
}

function extractXmlTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function parseYoutubeAtom(xml: string): YoutubeVideo[] {
  const videos: YoutubeVideo[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;

  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const videoId = extractXmlTag(block, 'yt:videoId');
    const title = extractXmlTag(block, 'title');
    const linkM = /href="([^"]+)"/.exec(block);
    const link = linkM ? linkM[1] : videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
    const description = extractXmlTag(block, 'media:description').slice(0, 1000);
    const thumbM = /url="(https:\/\/i[^"]+)"/.exec(block);
    const thumbnail = thumbM ? thumbM[1] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const publishedAt = extractXmlTag(block, 'published');
    const channelName = extractXmlTag(block, 'name');
    const viewM = /views="(\d+)"/.exec(block);

    if (videoId && title) {
      videos.push({
        videoId,
        title,
        link,
        description,
        thumbnail,
        publishedAt,
        channelName,
        viewCount: viewM ? viewM[1] : undefined,
      });
    }
  }
  return videos;
}

async function resolveChannelId(input: string): Promise<string | null> {
  // Already a channel ID (starts with UC and ~24 chars)
  if (/^UC[\w-]{20,}$/.test(input)) return input;

  // Full URL — extract channel ID or resolve handle
  const url = input.startsWith('http') ? input : `https://www.youtube.com/${input.startsWith('@') ? input : `@${input}`}`;

  // Direct channel URL: /channel/UCxxxxxx
  const chanM = /youtube\.com\/channel\/(UC[\w-]+)/i.exec(url);
  if (chanM) return chanM[1];

  // Handle or custom URL — fetch page and extract canonical channel ID
  try {
    const res = await fetchUrlGuarded(url, { timeout: 15_000 });
    if (!res.ok) return null;

    // Look for channel ID in page meta
    const idM =
      /"channelId":"(UC[\w-]+)"/.exec(res.body) ||
      /\/channel\/(UC[\w-]+)/.exec(res.body) ||
      /<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]+)"/.exec(res.body);

    return idM ? idM[1] : null;
  } catch {
    return null;
  }
}

export async function scrapeYoutubeChannel(channelInput: string, maxVideos = 30): Promise<YoutubeVideo[]> {
  const channelId = await withRetry(() => resolveChannelId(channelInput.trim()) as Promise<string | null>, {
    maxAttempts: 3, baseDelayMs: 1000,
  });
  if (!channelId) throw new Error(`لا يمكن تحديد Channel ID من: ${channelInput}`);

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  log.info(`Fetching YouTube RSS for channel: ${channelId}`);

  const res = await withRetry(() => fetchUrlGuarded(feedUrl, { timeout: 15_000 }), { maxAttempts: 3, baseDelayMs: 2000 });

  if (!res.ok) throw new Error(`YouTube RSS fetch failed: HTTP ${res.status}`);

  const videos = parseYoutubeAtom(res.body).slice(0, maxVideos);
  log.info(`Scraped ${videos.length} videos from YouTube channel ${channelId}`);
  return videos;
}

/** Convert YouTube video to a flat post-like object for competitor snapshots */
export function youtubeVideoToPost(v: YoutubeVideo): { title: string; link: string; summary: string; publishedAt: string } {
  return {
    title: v.title,
    link: v.link,
    summary: v.description || `فيديو جديد من ${v.channelName}: ${v.title}`,
    publishedAt: v.publishedAt,
  };
}
