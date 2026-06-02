/**
 * RFC 8288 Link header parser — feed autodiscovery from HTTP headers.
 */

export interface ParsedLink {
  href: string;
  rel: string;
  type: string;
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse Link header value into parts */
export function parseLinkHeader(raw: string | string[] | undefined): ParsedLink[] {
  if (!raw) return [];
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  const results: ParsedLink[] = [];

  // Split on commas not inside angle brackets
  const parts: string[] = [];
  let buf = '';
  let inBracket = false;
  for (const ch of joined) {
    if (ch === '<') inBracket = true;
    if (ch === '>') inBracket = false;
    if (ch === ',' && !inBracket) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  for (const part of parts) {
    const hrefMatch = part.match(/<([^>]+)>/);
    if (!hrefMatch) continue;
    const href = hrefMatch[1]!.trim();
    const relMatch = part.match(/\brel=([^;,\s]+|"[^"]*"|'[^']*')/i);
    const typeMatch = part.match(/\btype=([^;,\s]+|"[^"]*"|'[^']*')/i);
    results.push({
      href,
      rel: relMatch ? unquote(relMatch[1]!) : '',
      type: typeMatch ? unquote(typeMatch[1]!) : ''
    });
  }
  return results;
}

export function extractFeedLinksFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
  baseUrl: string
): string[] {
  if (!headers) return [];
  const linkRaw = headers.link ?? headers.Link;
  const parsed = parseLinkHeader(linkRaw);
  const feeds: string[] = [];
  for (const l of parsed) {
    const rel = l.rel.toLowerCase();
    if (!rel.includes('alternate') && !rel.includes('feed')) continue;
    const type = l.type.toLowerCase();
    if (
      type.includes('rss') ||
      type.includes('atom') ||
      type.includes('json') ||
      type.includes('feed') ||
      !type
    ) {
      try {
        feeds.push(new URL(l.href, baseUrl).href);
      } catch { /* skip */ }
    }
  }
  return feeds;
}
