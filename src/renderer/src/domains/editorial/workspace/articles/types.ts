import type { ArticleFull, SourceRow } from '../../../../../../shared/api-types';

export type { ArticleFull, SourceRow };

export type ViewMode = 'grid' | 'list';

export type ArticleFilters = {
  search: string;
  status: string;
  category: string;
  source: string;
  sortField: string;
  sortOrder: 'ASC' | 'DESC';
  page: number;
  pageSize: number;
};

export type ArticleStats = {
  total: number;
  draft: number;
  pending: number;
  published: number;
};

export type Toast = { id: number; ok: boolean; text: string };

export type IngestMsg = { ok: boolean; text: string } | null;
