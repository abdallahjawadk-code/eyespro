/**
 * Deep content purification for fetched articles.
 *
 * Two public functions:
 *   deepCleanHtml(html)  — for article.content (HTML with whitelisted tags)
 *   deepCleanText(text)  — for article.title / article.summary (plain text)
 *
 * Handles: invisible Unicode, broken entities, CMS artifacts, ad/share injections,
 * Arabic-specific issues, duplicate paragraphs, and typography normalization.
 */

// ─── HTML entity decoder ─────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  // structural (only decoded in plain-text context)
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // whitespace
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', hairsp: ' ', zwsp: '',
  // punctuation
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sbquo: '‚', bdquo: '„',
  // symbols
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾',
  times: '×', divide: '÷', minus: '−',
  // more whitespace variants
  zwnj: '', zwj: '', lrm: '', rlm: '', lre: '', rle: '', pdf: '',
  lro: '', rlo: '',
};

/** Decode one pass of HTML entities (both named and numeric). */
function decodeEntitiesOnce(s: string): string {
  return s
    .replace(/&([a-zA-Z]{2,8});/g, (full, name: string) => {
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v !== undefined ? v : full;
    })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex: string) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#([0-9]{1,7});/g, (_, dec: string) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ''; }
    });
}

/**
 * Decode HTML entities.
 * Runs twice to resolve double-encoded sequences like `&amp;amp;` → `&amp;` → `&`.
 */
function decodeEntities(s: string): string {
  return decodeEntitiesOnce(decodeEntitiesOnce(s));
}

/** Decode HTML entities for read-only display (compare view, previews). */
export function decodeContentForDisplay(s: string): string {
  if (!s) return '';
  return decodeEntities(s);
}

// ─── Invisible / problematic Unicode ────────────────────────────────────────

/**
 * Characters to remove completely (invisible, directional overrides, etc.).
 * Kept as a single compiled regex for performance.
 */
const INVISIBLE_UNICODE = new RegExp(
  '[' +
  '­'         + // soft hyphen
  '​-‏'  + // zero-width space / ZWNJ / ZWJ / LRM / RLM
  '‪-‮'  + // LRE / RLE / PDF / LRO / RLO (directional overrides)
  '⁠-⁤'  + // word joiner, invisible operators
  '⁪-⁯'  + // inhibit symmetric swapping, etc.
  '﻿'         + // BOM / zero-width no-break space
  '￼'         + // object replacement character
  ']',
  'g'
);

/** ASCII control characters except TAB (09) and LF (0A). */
const CTRL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// ─── CMS / platform artifact patterns ───────────────────────────────────────

/** WordPress Gutenberg block comments: <!-- wp:paragraph --> … <!-- /wp:paragraph --> */
const WP_BLOCK_COMMENTS = /<!--\s*\/?wp:[^\s>][^>]*-->/gi;

/** WordPress shortcodes: [caption id="..." lang="..."] … [/caption] or self-closing [embed /] */
const WP_SHORTCODES = /\[(?:\/)?(?:caption|gallery|embed|audio|video|playlist|columns?|vc_[a-z_]+|et_[a-z_]+)[^\]]*\]/gi;

/** Known junk container patterns (share bars, newsletters, popups, ads, related articles). */
const JUNK_CONTAINER_CLASSES = new RegExp(
  '<[a-z][^>]*\\b(?:class|id)=["\'][^"\']*(?:' + [
    'share[-_]?bar', 'social[-_]?share', 'addthis', 'sharethis',
    'follow[-_]?us', 'newsletter[-_]?(?:box|form|signup|popup)',
    'cookie[-_]?(?:banner|notice|bar|consent)', 'subscribe[-_]?(?:box|form|cta)',
    'ad[-_]?(?:container|wrapper|slot|banner|unit)', 'advertisement',
    'sponsored[-_]?content', 'promo[-_]?(?:box|banner)',
    'popup[-_]?(?:overlay|modal)', 'modal[-_]?(?:overlay|backdrop)',
    'related[-_]?(?:posts?|articles?|stories)', 'you[-_]?may[-_]?(?:like|also)',
    'more[-_]?from', 'recommended', 'taboola', 'outbrain',
    'sidebar[-_]?widget', 'widget[-_]?area',
  ].join('|') + ')[^"\']*["\'][^>]*>[\\s\\S]*?<\\/[a-z]+>',
  'gi'
);

/** Media embed tags that add nothing to text content. */
const MEDIA_EMBEDS = [
  /<iframe[\s\S]*?<\/iframe>/gi,
  /<object[\s\S]*?<\/object>/gi,
  /<embed[^>]*\/?>/gi,
  /<canvas[\s\S]*?<\/canvas>/gi,
  /<svg[\s\S]*?<\/svg>/gi,
  /<map[\s\S]*?<\/map>/gi,
  /<picture[\s\S]*?<\/picture>/gi,
  /<figure[\s\S]*?<\/figure>/gi,
];

/** Noisy HTML attributes — content-irrelevant metadata on any tag. */
const NOISY_ATTRS = new RegExp(
  '\\s+(?:' + [
    'srcset', 'sizes', 'loading', 'decoding', 'fetchpriority',
    'referrerpolicy', 'crossorigin', 'integrity',
    'data-[a-z][a-z0-9-]*',  // all data-* attributes
  ].join('|') + ')="[^"]*"',
  'gi'
);

/** Base64 data URIs in src/href — usually tiny tracker pixels or broken images. */
const BASE64_DATA_URI = /(?:src|href)=["']data:[^;]{0,64};base64,[^"']{0,8192}["']/gi;

// ─── Text-level noise patterns ───────────────────────────────────────────────

/**
 * Arabic Kashida / Tatweel (ـ) abuse:
 * - More than one consecutive Kashida → keep one (legitimate use in calligraphy)
 * - Isolated Kashida not flanked by Arabic letters → remove
 */
const ARABIC_BLOCK = /[؀-ۿݐ-ݿࢠ-ࣿ]/;
function cleanKashida(s: string): string {
  // Collapse runs of Kashida
  s = s.replace(/ـ{2,}/g, 'ـ');
  // Remove isolated Kashida (not between Arabic characters)
  s = s.replace(/(^|[^؀-ۿݐ-ݿ])ـ([^؀-ۿݐ-ݿ]|$)/g, '$1$2');
  return s;
}

/** Repeated punctuation normalization (works for both Arabic and Latin). */
function normalizePunctuation(s: string): string {
  return s
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/؟{2,}/g, '؟')
    .replace(/!؟|؟!/g, '؟')          // mixed ! and ؟
    .replace(/\.{4,}/g, '...')         // 4+ dots → ellipsis
    .replace(/،{2,}/g, '،')            // Arabic comma
    .replace(/،\s*،/g, '،')
    .replace(/…\s*\.+|\.+\s*…/g, '…')  // ellipsis + extra dots
    .replace(/…{2,}/g, '…');
}

/**
 * Common "social cruft" injected by CMS themes — lines that are navigation /
 * sharing prompts rather than article text. Matched only outside HTML tags.
 */
const TEXT_CRUD_PATTERNS: RegExp[] = [
  /^\s*(?:اشترك|اشتركي)\s+(?:في|معنا|الآن|بالنشرة)[^\n<]*/gim,
  /^\s*تابعنا\s+(?:على|عبر)[^\n<]*/gim,
  /^\s*شارك\s+(?:هذا|المقال|الخبر|المحتوى)[^\n<]*/gim,
  /^\s*(?:اقرأ|شاهد|انظر)\s+أيضا?ً?:?[^\n<]*/gim,
  // eslint-disable-next-line security/detect-unsafe-regex -- ^ anchor + [^\n<]* negated class; no polynomial backtracking possible
  /^\s*قد\s+يهمك(?:\s+أيضا?ً?)?:?[^\n<]*/gim,
  /^\s*(?:للمزيد|لمزيد من المعلومات)[^\n<]*/gim,
  /^\s*(?:المصدر|Source)\s*:[^\n<]*/gim,
  /^\s*(?:Read\s+more|Continue\s+reading|See\s+also):?[^\n<]*/gim,
  /^\s*(?:Subscribe|Follow\s+us)\s+(?:now|to|on)?[^\n<]*/gim,
  /^\s*(?:Advertisement|Sponsored)[^\n<]*/gim,
  /^\s*\[?\s*(?:إعلان|إعلانات)\s*\]?[^\n<]*/gim,
];

// ─── Duplicate paragraph removal ─────────────────────────────────────────────

/**
 * Remove exact duplicate text blocks (paragraphs).
 * Operates on raw text (without tags) to catch duplicates regardless of HTML wrapper.
 * Returns the HTML with duplicate blocks removed.
 */
function removeDuplicateParagraphs(html: string): string {
  // We work at the tag-block level: split on closing block tags
  const parts = html.split(/(?<=<\/(?:p|li|h[1-6]|blockquote)>)/gi);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    // Fingerprint = lowercased stripped text, trimmed
    const fingerprint = part.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (fingerprint.length < 20) { out.push(part); continue; }  // keep short/structural
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(part);
  }
  return out.join('');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deep-clean HTML article content.
 *
 * Designed to run BEFORE `cleanHtmlPreservingFormatting()` during ingestion,
 * and as a replacement for the basic `sanitizeContent()` in the pipeline step.
 *
 * Does NOT strip whitelisted tags — that is still the job of `cleanHtmlPreservingFormatting()`.
 */
export function deepCleanHtml(html: string): string {
  if (!html) return '';
  let s = html;

  // ── Structural / CMS cleanup ─────────────────────────────────────────────

  // Normalize line endings
  s = s.replace(/\r\n?/g, '\n');

  // WordPress Gutenberg annotations
  s = s.replace(WP_BLOCK_COMMENTS, '');
  s = s.replace(WP_SHORTCODES, '');

  // Known junk containers (share bars, ads, popups)
  s = s.replace(JUNK_CONTAINER_CLASSES, '');

  // Non-content embeds
  for (const re of MEDIA_EMBEDS) s = s.replace(re, '');

  // Inline scripts/styles/events (belt-and-suspenders over base cleaner)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  s = s.replace(/\s+on[a-z]{3,20}=["'][^"']*["']/gi, '');

  // Noisy attributes & base64 data URIs
  s = s.replace(NOISY_ATTRS, '');
  s = s.replace(BASE64_DATA_URI, '');

  // ── Entity decoding ──────────────────────────────────────────────────────
  // Decode non-structural entities only (&lt; &gt; &amp; &quot; left as-is
  // so they don't confuse the downstream tag parser).
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(160|xa0);/gi, ' ')   // NBSP variants
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      // Skip < > & " characters — they're meaningful inside HTML
      if (cp === 0x3C || cp === 0x3E || cp === 0x26 || cp === 0x22) return _;
      try { return String.fromCodePoint(cp); } catch { return ''; }
    })
    .replace(/&#([0-9]+);/gi, (_, dec: string) => {
      const cp = parseInt(dec, 10);
      if (cp === 60 || cp === 62 || cp === 38 || cp === 34) return _;
      try { return String.fromCodePoint(cp); } catch { return ''; }
    })
    .replace(/&([a-zA-Z]{2,8});/g, (full, name: string) => {
      if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name.toLowerCase())) return full;
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v !== undefined ? v : full;
    });

  // ── Unicode cleanup (applies to both tags and text — harmless inside tags) ──
  s = s.replace(INVISIBLE_UNICODE, '');
  s = s.replace(CTRL_CHARS, '');
  // NBSP → regular space (after entity decode)
  s = s.replace(/ /g, ' ');

  // ── Text-level noise ─────────────────────────────────────────────────────
  s = cleanKashida(s);
  s = normalizePunctuation(s);
  for (const p of TEXT_CRUD_PATTERNS) s = s.replace(p, '');

  // ── Duplicate paragraph removal ──────────────────────────────────────────
  s = removeDuplicateParagraphs(s);

  // ── Final whitespace normalization ───────────────────────────────────────
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

/**
 * Deep-clean a plain-text field (title, summary, author, category).
 *
 * Strips all HTML tags, decodes all entities, removes invisible characters,
 * and normalizes typography.
 */
export function deepCleanText(text: string): string {
  if (!text) return '';
  let s = String(text);

  // Normalize line endings → single space for single-line fields
  s = s.replace(/\r\n?/g, ' ');

  // Strip HTML tags (shouldn't be here but often are in feed descriptions)
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode all entities (including &amp; &lt; etc. — no tags left to confuse)
  s = decodeEntities(s);

  // Replace NBSP and other Unicode spaces with regular space
  s = s.replace(/[   -   　]/g, ' ');

  // Remove invisible Unicode
  s = s.replace(INVISIBLE_UNICODE, '');
  s = s.replace(CTRL_CHARS, '');

  // Remove CMS shortcode residue
  s = s.replace(WP_SHORTCODES, '');
  s = s.replace(/\[[^\]]{0,80}\]/g, '');  // any remaining [tag] shortcodes

  // Arabic-specific
  s = cleanKashida(s);

  // Punctuation normalization
  s = normalizePunctuation(s);

  // Strip trailing site name patterns from titles: "عنوان المقال | اسم الموقع"
  s = s.replace(/\s*[|｜–—\-]\s*[^\s|｜–—\-].{2,60}$/, '').trim() || s.trim();

  // Normalize whitespace
  s = s.replace(/\s{2,}/g, ' ');

  return s.trim();
}

/** Quick check: does text contain invisible/garbage characters worth cleaning? */
export function needsCleaning(text: string): boolean {
  return (
    INVISIBLE_UNICODE.test(text) ||
    /ـ{2,}/.test(text) ||
    /&(?:[a-z]{2,8}|#\d+|#x[0-9a-f]+);/i.test(text) ||
    ARABIC_BLOCK.test(text) && /[\x00-\x08\x0E-\x1F]/.test(text)
  );
}
