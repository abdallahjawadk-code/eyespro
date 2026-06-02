export type ContentTab = 'sources' | 'templates' | 'trends' | 'media';

const TABS: ContentTab[] = ['sources', 'templates', 'trends', 'media'];

export function parseContentTab(raw: string | null): ContentTab {
  if (raw && TABS.includes(raw as ContentTab)) return raw as ContentTab;
  return 'sources';
}
