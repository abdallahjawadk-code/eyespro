export type DiscoveryMode = 'topic' | 'url' | 'catalog' | 'import' | 'community';

export type FeedResult = {
  title: string;
  feedUrl: string;
  website?: string;
  description?: string;
  subscribers?: number;
  type?: string;
  score?: number;
  provider?: string;
  category?: string;
  language?: string;
};

export type SearchStage = {
  id: string;
  label: string;
  status: string;
  count: number;
  ms: number;
  error?: string;
};

export type RegionId =
  | 'SA'
  | 'EG'
  | 'AE'
  | 'JO'
  | 'MA'
  | 'KW'
  | 'QA'
  | 'LB'
  | 'GLOBAL_AR'
  | 'GLOBAL_EN';

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

export type LanguageFilter = 'any' | 'ar' | 'en';

export type ProviderToggles = {
  feedly: boolean;
  google_news: boolean;
  ai: boolean;
  catalog: boolean;
  official: boolean;
  telegram: boolean;
  rsshub: boolean;
  reddit: boolean;
  podcast: boolean;
  openalex: boolean;
  youtube: boolean;
};

export const DEFAULT_PROVIDERS: ProviderToggles = {
  feedly: true,
  google_news: true,
  ai: true,
  catalog: true,
  official: true,
  telegram: false,
  rsshub: true,
  reddit: true,
  podcast: true,
  openalex: true,
  youtube: true,
};

export type CatalogMeta = {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  descEn?: string;
  language: string;
  items: unknown[];
};

export type SectorMeta = {
  id: SectorId;
  icon: string;
  labelAr: string;
  labelEn: string;
};

export type DetectPayload = {
  type?: string;
  feedUrl?: string;
  title?: string;
  error?: string;
  candidates?: Array<{
    feedUrl: string;
    type: string;
    method: string;
    confidence: number;
    score: number;
    label: string;
    itemCount?: number;
    hasWebSub?: boolean;
  }>;
  best?: { feedUrl: string; type: string; method: string; score: number; label: string };
};
