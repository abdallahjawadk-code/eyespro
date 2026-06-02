export type SystemTab = 'monitor' | 'audit';

const TABS: SystemTab[] = ['monitor', 'audit'];

export function parseSystemTab(raw: string | null): SystemTab {
  if (raw && TABS.includes(raw as SystemTab)) return raw as SystemTab;
  return 'monitor';
}
