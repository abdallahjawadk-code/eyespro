export type InsightsTab = 'analytics' | 'quality' | 'reports' | 'health' | 'tracker' | 'links' | 'keywords';

const TABS: InsightsTab[] = ['analytics', 'quality', 'reports', 'health', 'tracker', 'links', 'keywords'];

export function parseInsightsTab(raw: string | null): InsightsTab {
  if (raw && TABS.includes(raw as InsightsTab)) return raw as InsightsTab;
  return 'analytics';
}
