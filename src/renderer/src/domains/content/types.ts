export type ContentTab = 'sources' | 'templates' | 'trends';

const TABS: ContentTab[] = ['sources', 'templates', 'trends'];

export function parseContentTab(raw: string | null): ContentTab {
  if (raw && TABS.includes(raw as ContentTab)) return raw as ContentTab;
  return 'sources';
}
