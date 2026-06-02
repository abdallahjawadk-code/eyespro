export type EditorialTab =
  | 'production' | 'kanban' | 'studio' | 'now' | 'calendar' | 'scheduler' | 'autopilot';

const TABS: EditorialTab[] = [
  'production', 'kanban', 'studio', 'now', 'calendar', 'scheduler', 'autopilot',
];

export function parseEditorialTab(raw: string | null): EditorialTab {
  if (raw && TABS.includes(raw as EditorialTab)) return raw as EditorialTab;
  return 'production';
}
