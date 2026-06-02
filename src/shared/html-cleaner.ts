/**
 * Safe HTML Cleaner for EyesPro
 *
 * cleanHtmlPreservingFormatting(html) — whitelist-based tag filter.
 *   Keeps: p, br, strong, em, u, b, i, h1-h6, ul, ol, li, blockquote, a
 *   Strips all other tags while preserving their text content.
 *
 * For deep content purification (CMS artifacts, Unicode garbage, etc.)
 * see src/shared/content-cleaner.ts — run deepCleanHtml() BEFORE this function.
 */

export function cleanHtmlPreservingFormatting(html: string | null | undefined): string {
  if (!html) return '';

  // 1. Remove script, style, noscript, nav, header, footer, aside, and HTML comments
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 2. Pre-normalize links: keep only href, strip unsafe protocols
  s = s.replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, content: string) => {
    const trimmedHref = href.trim();
    if (/^(javascript|data|vbscript|blob):/i.test(trimmedHref)) {
      return content; // strip the link but keep the text
    }
    return `<a href="${trimmedHref}" target="_blank">${content}</a>`;
  });

  // 3. Keep whitelisted tags; strip all others (preserve inner text)
  const whitelist = /^\/?(?:p|br|strong|em|u|h[1-6]|ul|ol|li|blockquote|a|b|i)$/i;

  let cleaned = '';
  const parts = s.split(/(<[^>]+>)/g);
  for (const part of parts) {
    if (part.startsWith('<') && part.endsWith('>')) {
      const isClose = part.startsWith('</');
      const tagMatch = part.match(/<\/?([a-z1-6]+)/i);
      const tag = tagMatch ? tagMatch[1]!.toLowerCase() : '';

      if (whitelist.test(tag)) {
        if (isClose) {
          cleaned += `</${tag}>`;
        } else if (tag === 'a') {
          const hrefMatch = part.match(/href=["']([^"']*)["']/i);
          const href = hrefMatch ? hrefMatch[1] : '';
          cleaned += `<a href="${href}" target="_blank">`;
        } else {
          cleaned += `<${tag}>`;
        }
      } else {
        // Block elements: emit a space to prevent word joining
        const isBlock = /^(?:div|section|article|main|header|footer|aside|tr|td|th|caption|figure|figcaption)$/i.test(tag);
        if (isBlock) cleaned += ' ';
      }
    } else {
      cleaned += part;
    }
  }

  // 4. Decode remaining HTML entities and normalize whitespace
  return cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&#xa0;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
