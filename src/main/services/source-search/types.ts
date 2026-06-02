/** Source discovery search — shared types */

export type SearchProviderId =
  | 'feedly'
  | 'google_news'
  | 'ai'
  | 'catalog'
  | 'official'
  | 'telegram'
  | 'rsshub'
  | 'reddit'
  | 'podcast'
  | 'openalex'
  | 'youtube';

export type FeedSearchResult = {
  title: string;
  feedUrl: string;
  website?: string;
  description?: string;
  subscribers?: number;
  type?: string;
  score?: number;
  provider?: SearchProviderId;
  category?: string;
  language?: string;
};

export type RegionPresetId =
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

export type SourceSearchOptions = {
  query: string;
  region?: RegionPresetId;
  sector?: string;
  language?: 'ar' | 'en' | 'any';
  providers?: Partial<Record<SearchProviderId, boolean>>;
  catalogId?: string;
  limit?: number;
};

export type SearchStageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export type SearchStage = {
  id: SearchProviderId | 'rank' | 'resolve';
  label: string;
  status: SearchStageStatus;
  count: number;
  ms: number;
  error?: string;
};

export type SourceSearchResponse = {
  ok: boolean;
  results?: FeedSearchResult[];
  stages?: SearchStage[];
  cached?: boolean;
  error?: string;
  sector?: string;
};

export type CatalogEntry = {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  descEn?: string;
  language: string;
  items: Array<{
    name: string;
    website: string;
    feedUrl?: string;
    type?: string;
    tags?: string[];
  }>;
};
