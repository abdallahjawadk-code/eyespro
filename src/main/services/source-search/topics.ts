import topicsData from './data/topics.json';
import { expandSearchTerms, normalizeTopicText } from './topic-expansion';
import type { SearchProviderId } from './types';

export type SectorId =
  | 'all'
  | 'news'
  | 'entertainment'
  | 'science'
  | 'arts'
  | 'sports'
  | 'tech'
  | 'gaming'
  | 'lifestyle';

export type SectorMeta = {
  id: SectorId;
  icon: string;
  labelAr: string;
  labelEn: string;
};

const SECTOR_KEYWORDS = topicsData.sectorKeywords as Record<string, string[]>;
const SECTOR_PROVIDERS = topicsData.sectorProviders as Record<
  string,
  Partial<Record<SearchProviderId, boolean>>
>;

export function listSectors(): SectorMeta[] {
  return topicsData.sectors as SectorMeta[];
}

export function detectSector(query: string, forced?: string): SectorId {
  if (forced && forced !== 'all' && topicsData.sectors.some((s) => s.id === forced)) {
    return forced as SectorId;
  }
  const blob = normalizeTopicText(expandSearchTerms(query).join(' '));
  let best: SectorId = 'all';
  let bestScore = 0;
  for (const [sector, keys] of Object.entries(SECTOR_KEYWORDS)) {
    let score = 0;
    for (const k of keys) {
      const kn = normalizeTopicText(k);
      if (kn.length >= 2 && blob.includes(kn)) score += kn.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sector as SectorId;
    }
  }
  return bestScore > 0 ? best : 'all';
}

/** Sector defaults, then user toggles from UI win. */
export function applySectorProviders(
  base: Record<SearchProviderId, boolean>,
  sector: SectorId,
  userOverrides?: Partial<Record<SearchProviderId, boolean>>
): Record<SearchProviderId, boolean> {
  const out = { ...base };
  if (sector !== 'all' && SECTOR_PROVIDERS[sector]) {
    for (const [k, v] of Object.entries(SECTOR_PROVIDERS[sector]!)) {
      out[k as SearchProviderId] = v;
    }
  }
  if (userOverrides) {
    Object.assign(out, userOverrides);
  }
  return out;
}
