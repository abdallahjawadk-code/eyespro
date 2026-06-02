/**
 * Feature 8 — OPML Import & Bulk Source Management
 *
 * Parses OPML (Outline Processor Markup Language) files — the standard
 * interchange format for RSS/Atom subscription lists exported from
 * feed readers (Feedly, NewsBlur, Inoreader, etc.).
 *
 * Supports:
 *   - Flat and nested OPML structures (folders become categories)
 *   - RSS, Atom, and HTML link type feeds
 *   - Auto-categorisation from folder names
 *   - Duplicate detection (skips existing sources by URL)
 *   - Preview before import (dry-run)
 */

import { readFile } from 'fs/promises';
import { fetchUrlGuarded } from '../net/guarded-fetch';
import { createSource, listSources } from './sources';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpmlOutline {
  text: string;
  title?: string;
  xmlUrl?: string;       // feed URL (present on leaf nodes)
  htmlUrl?: string;      // website URL
  type?: string;         // 'rss' | 'atom' | 'link' | 'folder'
  category?: string;     // inferred from parent folder name
  children?: OpmlOutline[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  sources: { name: string; url: string; category: string; status: 'created' | 'skipped' | 'error' }[];
}

// ─── XML parser (no dependencies — uses regex on well-formed OPML) ────────────

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i');
  return tag.match(re)?.[1]?.trim() ?? '';
}

function parseOutlines(xml: string, parentCategory = ''): OpmlOutline[] {
  const outlines: OpmlOutline[] = [];
  // Match each <outline ...> or <outline ...>...</outline>
  const re = /<outline\s([^>]*?)(?:\/>|>([\s\S]*?)<\/outline>)/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const attribs = m[1]!;
    const inner = m[2] ?? '';

    const text    = attr(attribs, 'text') || attr(attribs, 'title');
    const title   = attr(attribs, 'title') || text;
    const xmlUrl  = attr(attribs, 'xmlUrl');
    const htmlUrl = attr(attribs, 'htmlUrl');
    const type    = attr(attribs, 'type').toLowerCase();

    if (!text) continue;

    if (!xmlUrl && inner) {
      // This is a folder — recurse with folder name as category
      const folderCategory = text;
      const children = parseOutlines(inner, folderCategory);
      if (children.length > 0) {
        outlines.push({ text, title, category: parentCategory || folderCategory, children });
      }
    } else if (xmlUrl) {
      outlines.push({
        text,
        title,
        xmlUrl,
        htmlUrl,
        type: type || 'rss',
        category: parentCategory,
      });
    }
  }

  return outlines;
}

/** Parse an OPML XML string into a tree of `OpmlOutline` nodes. */
export function parseOpml(xml: string): OpmlOutline[] {
  // Extract <body> content (everything between <body> and </body>)
  const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? xml;
  return parseOutlines(body);
}

// ─── Flatten tree ─────────────────────────────────────────────────────────────

function flattenLeaves(outlines: OpmlOutline[], inherited = ''): OpmlOutline[] {
  const leaves: OpmlOutline[] = [];
  for (const o of outlines) {
    const cat = o.category || inherited;
    if (o.xmlUrl) {
      leaves.push({ ...o, category: cat });
    } else if (o.children) {
      leaves.push(...flattenLeaves(o.children, o.text || cat));
    }
  }
  return leaves;
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Import feeds from a parsed OPML tree into the sources table.
 * Returns counts + per-source status.
 */
export async function importOutlines(outlines: OpmlOutline[]): Promise<ImportResult> {
  const leaves = flattenLeaves(outlines);
  const result: ImportResult = { created: 0, skipped: 0, errors: [], sources: [] };

  // Build a set of existing source URLs for dedup check
  const existing = new Set(
    (listSources() as { url: string | null }[])
      .map((s) => s.url?.toLowerCase())
      .filter(Boolean) as string[]
  );

  for (const leaf of leaves) {
    const url = leaf.xmlUrl!.trim();
    const name = leaf.title || leaf.text || url;
    const category = leaf.category || '';

    if (existing.has(url.toLowerCase())) {
      result.skipped++;
      result.sources.push({ name, url, category, status: 'skipped' });
      continue;
    }

    try {
      createSource({ name, url, enabled: 1, category });
      existing.add(url.toLowerCase());
      result.created++;
      result.sources.push({ name, url, category, status: 'created' });
    } catch (e) {
      result.errors.push(`${name}: ${(e as Error).message}`);
      result.sources.push({ name, url, category, status: 'error' });
    }
  }

  return result;
}

/** Parse an OPML XML string and import all feeds. */
export async function importOpml(xml: string): Promise<ImportResult> {
  const outlines = parseOpml(xml);
  if (outlines.length === 0) {
    return { created: 0, skipped: 0, errors: ['لم يتم العثور على مصادر في ملف OPML'], sources: [] };
  }
  return importOutlines(outlines);
}

/** Read an OPML file from disk and import it. */
export async function importOpmlFile(filePath: string): Promise<ImportResult> {
  try {
    const xml = await readFile(filePath, 'utf-8');
    return importOpml(xml);
  } catch (e) {
    return { created: 0, skipped: 0, errors: [(e as Error).message], sources: [] };
  }
}

/**
 * Preview what would be imported without writing to the DB.
 * Returns the flattened list of feed items found.
 */
export function previewOpml(xml: string): { feeds: OpmlOutline[]; folders: string[] } {
  const outlines = parseOpml(xml);
  const leaves = flattenLeaves(outlines);
  const folders = [...new Set(leaves.map((l) => l.category).filter(Boolean))] as string[];
  return { feeds: leaves, folders };
}

/** Fetch OPML from HTTPS URL and import feeds. */
export async function importOpmlFromUrl(pageUrl: string): Promise<ImportResult> {
  const url = pageUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    return { created: 0, skipped: 0, errors: ['الرابط يجب أن يبدأ بـ http:// أو https://'], sources: [] };
  }
  try {
    const res = await fetchUrlGuarded(url);
    if (!res.ok || !res.body) {
      return { created: 0, skipped: 0, errors: [res.body || 'تعذّر تحميل OPML'], sources: [] };
    }
    return importOpml(res.body);
  } catch (e) {
    return { created: 0, skipped: 0, errors: [(e as Error).message], sources: [] };
  }
}
