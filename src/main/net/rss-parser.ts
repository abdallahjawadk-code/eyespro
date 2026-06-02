export interface ParsedFeedItem {
  title: string;
  link: string;
  content: string;
  summary: string;
  image_url: string;
  source: string;
  category: string;
}

function getTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function getAttr(block: string, tag: string, attr: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}

function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRss(
  xml: string,
  source: { name: string; category?: string | null }
): ParsedFeedItem[] {
  const articles: ParsedFeedItem[] = [];
  const items = [
    ...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)
  ];
  for (const m of items) {
    const block = m[1];
    const title = cleanHtml(getTag(block, 'title'));
    if (!title) continue;
    const link = getTag(block, 'link') || getAttr(block, 'link', 'href') || '';
    const desc =
      getTag(block, 'description') || getTag(block, 'content:encoded') || getTag(block, 'summary') || '';
    const content = cleanHtml(desc);
    articles.push({
      title,
      link,
      content,
      summary: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
      image_url: getAttr(block, 'media:thumbnail', 'url') || getAttr(block, 'enclosure', 'url') || '',
      source: source.name,
      category: source.category || ''
    });
  }
  return articles;
}
