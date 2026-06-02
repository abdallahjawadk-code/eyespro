import { cleanHtmlPreservingFormatting } from '../../shared/html-cleaner';
import { deepCleanHtml } from '../../shared/content-cleaner';

export interface PageMeta {
  title: string;
  description: string;
  image: string;
  author: string;
  publishedAt: string;
  canonicalUrl: string;
  lang: string;
}

export function extractPageMeta(html: string, baseUrl: string): PageMeta {
  const meta: PageMeta = { title: '', description: '', image: '', author: '', publishedAt: '', canonicalUrl: '', lang: '' };

  const langMatch = html.match(/<html[^>]*\blang=["']([^"']+)["']/i);
  if (langMatch) meta.lang = langMatch[1]!.trim().toLowerCase();

  const canonMatch = html.match(/<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i);
  if (canonMatch) {
    try { meta.canonicalUrl = new URL(canonMatch[1]!, baseUrl).href; } catch { /* ignore */ }
  }

  const metaTagRe = /<meta[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaTagRe.exec(html)) !== null) {
    const tag = m[0]!;
    const propMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (!propMatch || !contentMatch) continue;
    const prop = propMatch[1]!.toLowerCase();
    const content = contentMatch[1]!.trim();
    if (!content) continue;
    switch (prop) {
      case 'og:title': case 'twitter:title': if (!meta.title) meta.title = content; break;
      case 'og:description': case 'twitter:description': if (!meta.description) meta.description = content; break;
      case 'og:image': case 'twitter:image': if (!meta.image) {
        try { meta.image = new URL(content, baseUrl).href; } catch { meta.image = content; }
        break;
      }
      case 'og:url': if (!meta.canonicalUrl) {
        try { meta.canonicalUrl = new URL(content, baseUrl).href; } catch { /* ignore */ }
        break;
      }
      case 'author': case 'article:author': if (!meta.author) meta.author = content; break;
      case 'article:published_time': case 'pubdate': if (!meta.publishedAt) meta.publishedAt = content; break;
    }
  }

  const jsonLdRe = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const ld = JSON.parse(m[1]!) as Record<string, unknown>;
      const items = Array.isArray(ld['@graph']) ? (ld['@graph'] as Record<string, unknown>[]) : [ld];
      for (const item of items) {
        const type = String(item['@type'] ?? '').toLowerCase();
        if (!type.includes('article') && !type.includes('newsarticle') && !type.includes('webpage')) continue;
        if (!meta.title && item['headline']) meta.title = String(item['headline']).trim();
        if (!meta.description && item['description']) meta.description = String(item['description']).trim();
        if (!meta.author) {
          const a = item['author'];
          if (typeof a === 'object' && a !== null && 'name' in a) meta.author = String((a as Record<string, unknown>)['name']).trim();
          else if (typeof a === 'string') meta.author = a.trim();
        }
        if (!meta.publishedAt) {
          const d = item['datePublished'] ?? item['dateCreated'];
          if (d) meta.publishedAt = String(d).trim();
        }
        if (!meta.image) {
          const img = item['image'];
          const imgUrl = typeof img === 'string' ? img : (typeof img === 'object' && img !== null && 'url' in img ? String((img as Record<string, unknown>)['url']) : '');
          if (imgUrl) {
            try { meta.image = new URL(imgUrl, baseUrl).href; } catch { meta.image = imgUrl; }
          }
        }
      }
    } catch { /* malformed JSON-LD */ }
  }

  if (!meta.title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      meta.title = titleMatch[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      meta.title = meta.title.replace(/\s*[|\-–—]\s*.{2,60}$/, '').trim() || meta.title;
    }
  }

  if (!meta.image) {
    const imgMatch = html.match(/<img[^>]+\bsrc=["']([^"']{10,})["']/i);
    if (imgMatch?.[1] && !imgMatch[1]!.includes('data:')) {
      try { meta.image = new URL(imgMatch[1]!, baseUrl).href; } catch { /* ignore */ }
    }
  }

  return meta;
}

export function extractArticleBody(html: string): string {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*\bid=["'](?:content|article|main|post|body)["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*\bclass=["'][^"']*(?:article|post|content|entry|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of contentSelectors) {
    const match = body.match(re);
    if (match?.[1] && match[1].length > 200) {
      body = match[1];
      break;
    }
  }

  return cleanHtmlPreservingFormatting(deepCleanHtml(body)).slice(0, 50000);
}
