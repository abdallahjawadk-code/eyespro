/**
 * Expands Arabic/English topic queries so discovery works beyond hard-coded news keywords.
 */

const ALIAS_GROUPS: string[][] = [
  ['افلام', 'أفلام', 'فيلم', 'سينما', 'movies', 'movie', 'film', 'cinema', 'hollywood'],
  ['مسلسلات', 'مسلسل', 'دراما', 'مسلسلة', 'series', 'tv show', 'television', 'streaming'],
  ['فن', 'فنون', 'ثقافة', 'arts', 'art', 'culture', 'entertainment', 'منوعات'],
  ['علوم', 'علم', 'تكنولوجيا', 'science', 'scientific', 'research', 'physics', 'biology'],
  ['رياضة', 'رياضي', 'كرة', 'sports', 'sport', 'football', 'soccer'],
  ['تقنية', 'تكنولوجيا', 'tech', 'technology', 'gadget', 'startup'],
  ['موسيقى', 'music', 'songs', 'مغني'],
  ['ألعاب', 'العاب', 'gaming', 'games', 'videogame', 'gamer'],
  ['طبخ', 'طعام', 'food', 'cooking', 'recipe'],
  ['سفر', 'سياحة', 'travel', 'tourism'],
  ['أزياء', 'موضة', 'fashion', 'style'],
  ['صحة', 'طب', 'health', 'medical', 'wellness'],
  ['اقتصاد', 'مال', 'business', 'finance', 'economy'],
  ['أخبار', 'خبر', 'news', 'breaking', 'عاجل'],
];

const NON_NEWS_HINTS = new Set(
  [
    'افلام',
    'أفلام',
    'فيلم',
    'سينما',
    'movies',
    'movie',
    'film',
    'cinema',
    'مسلسل',
    'مسلسلات',
    'series',
    'فن',
    'فنون',
    'ثقافة',
    'arts',
    'art',
    'علوم',
    'science',
    'رياضة',
    'sports',
    'موسيقى',
    'music',
    'ألعاب',
    'gaming',
    'games',
    'طبخ',
    'food',
    'سفر',
    'travel',
    'أزياء',
    'fashion',
    'منوعات',
    'entertainment',
  ].map((s) => s.toLowerCase())
);

export function normalizeTopicText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Up to 8 search variants (original + related terms). */
export function expandSearchTerms(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const qn = normalizeTopicText(raw);
  const out = new Set<string>([raw, qn]);
  for (const group of ALIAS_GROUPS) {
    const hit = group.some((term) => {
      const tn = normalizeTopicText(term);
      return qn.includes(tn) || tn.includes(qn) || raw.toLowerCase().includes(term.toLowerCase());
    });
    if (hit) {
      for (const t of group) {
        out.add(t);
        out.add(normalizeTopicText(t));
      }
    }
  }
  return [...out].filter((t) => t.length >= 2).slice(0, 8);
}

export function isNewsHeavyQuery(query: string, terms: string[]): boolean {
  const blob = normalizeTopicText([query, ...terms].join(' '));
  if ([...NON_NEWS_HINTS].some((h) => blob.includes(h))) return false;
  const newsHints = ['أخبار', 'خبر', 'news', 'عاجل', 'صحيف', 'وكالة', 'سياس'];
  return newsHints.some((h) => blob.includes(h)) || terms.length === 0;
}

export function itemMatchesTopicTerms(
  haystack: string,
  tags: string[] | undefined,
  terms: string[]
): boolean {
  if (terms.length === 0) return true;
  const hay = normalizeTopicText(haystack);
  const tagNorm = (tags ?? []).map((t) => normalizeTopicText(t));
  return terms.some((term) => {
    const tl = normalizeTopicText(term);
    if (tl.length < 2) return false;
    if (hay.includes(tl)) return true;
    return tagNorm.some((tag) => tag.includes(tl) || tl.includes(tag));
  });
}
