/** Navigation contract — sidebar, titles, command palette */

export type NavItem = {
  to: string;
  key: string;
  ico: string;
  end?: boolean;
};

export type NavGroup = {
  labelKey: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.groupMain',
    items: [{ to: '/dashboard', key: 'nav.dashboard', ico: '📊', end: true }],
  },
  {
    labelKey: 'nav.groupWorkflow',
    items: [
      { to: '/content', key: 'nav.contentHub', ico: '📦' },
      { to: '/articles', key: 'nav.articlesContent', ico: '📝' },
      { to: '/autopilot', key: 'nav.autopilot', ico: '🤖' },
      { to: '/schedule', key: 'nav.scheduledTasks', ico: '⏰' },
    ],
  },
  {
    labelKey: 'nav.groupInsights',
    items: [
      { to: '/insights',      key: 'nav.insightsHub',  ico: '📈' },
      { to: '/monitor',       key: 'nav.monitor',      ico: '🕵️' },
      { to: '/social-video',  key: 'nav.socialVideo',  ico: '🎬' },
    ],
  },
  {
    labelKey: 'nav.groupSystem',
    items: [
      { to: '/system', key: 'nav.system', ico: '⚡' },
      { to: '/settings', key: 'nav.settings', ico: '⚙️' },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/content': 'nav.contentHub',
  '/sources': 'nav.contentHub',
  '/templates': 'nav.contentHub',
  '/media': 'nav.contentHub',
  '/trends': 'nav.trendRadar',
  '/articles': 'nav.articlesContent',
  '/autopilot': 'nav.autopilot',
  '/schedule': 'nav.scheduledTasks',
  '/production': 'nav.articlesContent',
  '/pipeline': 'nav.articlesContent',
  '/editorial-publish': 'nav.articlesContent',
  '/publish': 'nav.articlesContent',
  '/kanban': 'nav.articlesContent',
  '/insights': 'nav.insightsHub',
  '/analytics': 'nav.insightsHub',
  '/quality': 'nav.insightsHub',
  '/reports': 'nav.insightsHub',
  '/link-scan': 'nav.insightsHub',
  '/keywords': 'nav.insightsHub',
  '/health': 'nav.insightsHub',
  '/publish-tracker': 'nav.insightsHub',
  '/ai-batch': 'nav.articlesContent',
  '/system': 'nav.system',
  '/settings': 'nav.settings',
  '/publish-articles': 'nav.articlesContent',
  '/monitor':      'nav.monitor',
  '/social-video': 'nav.socialVideo',
};

export type CommandEntry = {
  icon: string;
  labelKey: string;
  groupKey: string;
  to?: string;
  action?: 'theme' | 'welcome';
  settingsTab?: string;
};

export const COMMAND_ENTRIES: CommandEntry[] = [
  { icon: '🏠', labelKey: 'nav.dashboard', to: '/dashboard', groupKey: 'nav.groupMain' },
  { icon: '📦', labelKey: 'nav.contentHub', to: '/content', groupKey: 'nav.groupWorkflow' },
  { icon: '📡', labelKey: 'nav.sources', to: '/content?tab=sources', groupKey: 'nav.groupWorkflow' },
  { icon: '📋', labelKey: 'nav.templates', to: '/content?tab=templates', groupKey: 'nav.groupWorkflow' },
  { icon: '⚡', labelKey: 'nav.trendRadar', to: '/content?tab=trends', groupKey: 'nav.groupWorkflow' },
  { icon: '🖼️', labelKey: 'nav.media', to: '/content?tab=media', groupKey: 'nav.groupWorkflow' },
  { icon: '📝', labelKey: 'nav.articlesContent', to: '/articles', groupKey: 'nav.groupWorkflow' },
  { icon: '🤖', labelKey: 'nav.autopilot', to: '/autopilot', groupKey: 'nav.groupWorkflow' },
  { icon: '⏰', labelKey: 'nav.scheduledTasks', to: '/schedule', groupKey: 'nav.groupWorkflow' },
  { icon: '✏️', labelKey: 'articles.new', to: '/articles/new', groupKey: 'nav.groupWorkflow' },
  { icon: '📊', labelKey: 'nav.insightsHub', to: '/insights', groupKey: 'nav.groupInsights' },
  { icon: '✨', labelKey: 'nav.quality', to: '/insights?tab=quality', groupKey: 'nav.groupInsights' },
  { icon: '🛰️', labelKey: 'health.title', to: '/insights?tab=health', groupKey: 'nav.groupInsights' },
  { icon: '📤', labelKey: 'publish.tracker.title', to: '/insights?tab=tracker', groupKey: 'nav.groupInsights' },
  { icon: '🔗', labelKey: 'nav.linkScan', to: '/insights?tab=links', groupKey: 'nav.groupInsights' },
  { icon: '🕵️', labelKey: 'nav.monitor', to: '/monitor', groupKey: 'nav.groupInsights' },
  { icon: '🎬', labelKey: 'nav.socialVideo', to: '/social-video', groupKey: 'nav.groupInsights' },
  { icon: '⚡', labelKey: 'nav.system', to: '/system', groupKey: 'nav.groupSystem' },
  { icon: '⚙️', labelKey: 'nav.settings', to: '/settings', groupKey: 'nav.groupSystem' },
  { icon: '📱', labelKey: 'settings.groupSocial', to: '/settings', groupKey: 'nav.groupSystem', settingsTab: 'social' },
  { icon: '🌗', labelKey: 'theme.toggle', groupKey: 'nav.groupAdmin', action: 'theme' },
  { icon: '🏠', labelKey: 'nav.backToWelcome', groupKey: 'nav.groupAdmin', action: 'welcome' },
];
