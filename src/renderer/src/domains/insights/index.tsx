import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabParam } from '../../core/hooks/useTabParam';
import { Workspace } from '../../shell/Workspace';
import type { WorkspaceTabGroup } from '../../shell/Workspace';
import { parseInsightsTab, type InsightsTab } from './types';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { QualityScreen } from './screens/QualityScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { HealthScreen } from './screens/HealthScreen';
import { TrackerScreen } from './screens/TrackerScreen';
import { LinksScreen } from './screens/LinksScreen';
import { KeywordsScreen } from './screens/KeywordsScreen';

export function InsightsDomain() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(parseInsightsTab);

  const tabGroups: WorkspaceTabGroup[] = [
    {
      id: 'analysis',
      label: t('insightsHub.groups.analysis'),
      tabs: [
        { id: 'analytics', label: t('nav.analytics'), icon: '📊' },
        { id: 'quality', label: t('nav.quality'), icon: '✨' },
        { id: 'reports', label: t('nav.reports'), icon: '📈' },
      ],
    },
    {
      id: 'monitoring',
      label: t('insightsHub.groups.monitoring'),
      tabs: [
        { id: 'health', label: t('health.title'), icon: '🛰️' },
        { id: 'tracker', label: t('publish.tracker.title'), icon: '📤' },
        { id: 'links', label: t('nav.linkScan'), icon: '🔗' },
        { id: 'keywords', label: t('nav.keywords'), icon: '🔔' },
      ],
    },
  ];

  const screens: Record<InsightsTab, ReactNode> = {
    analytics: <AnalyticsScreen />,
    quality: <QualityScreen />,
    reports: <ReportsScreen />,
    health: <HealthScreen />,
    tracker: <TrackerScreen />,
    links: <LinksScreen />,
    keywords: <KeywordsScreen />,
  };

  return (
    <Workspace
      eyebrow={t('nav.groupInsights')}
      title={t('insightsHub.title')}
      description={t('insightsHub.description')}
      tabGroups={tabGroups}
      activeTab={tab}
      onTabChange={(id) => setTab(id as InsightsTab)}
    >
      {screens[tab]}
    </Workspace>
  );
}
