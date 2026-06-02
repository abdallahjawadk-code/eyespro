import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Btn } from '../../ui';
import { useTabParam } from '../../core/hooks/useTabParam';
import { Workspace } from '../../shell/Workspace';
import type { WorkspaceTabGroup } from '../../shell/Workspace';
import { parseEditorialTab, type EditorialTab } from './types';
import { ProductionScreen } from './screens/ProductionScreen';
import { KanbanScreen } from './screens/KanbanScreen';
import { StudioScreen } from './screens/StudioScreen';
import { PublishNowScreen } from './screens/PublishNowScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { SchedulerScreen } from './screens/SchedulerScreen';
import { AutopilotScreen } from './screens/AutopilotScreen';

export function EditorialDomain() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(parseEditorialTab);

  const tabGroups: WorkspaceTabGroup[] = [
    {
      id: 'produce',
      label: t('editorialPublishHub.groups.produce'),
      tabs: [
        { id: 'production', label: t('editorialPublishHub.tabs.production'), icon: '✦' },
        { id: 'kanban', label: t('editorialPublishHub.tabs.kanban'), icon: '📋' },
        { id: 'studio', label: t('editorialPublishHub.tabs.studio'), icon: '✨' },
        { id: 'autopilot', label: t('editorialPublishHub.tabs.autopilot'), icon: '🤖' },
      ],
    },
    {
      id: 'distribute',
      label: t('editorialPublishHub.groups.distribute'),
      tabs: [
        { id: 'now', label: t('editorialPublishHub.tabs.now'), icon: '🚀' },
      ],
    },
    {
      id: 'plan',
      label: t('editorialPublishHub.groups.plan'),
      tabs: [
        { id: 'calendar', label: t('editorialPublishHub.tabs.calendar'), icon: '📅' },
        { id: 'scheduler', label: t('editorialPublishHub.tabs.scheduler'), icon: '⏰' },
      ],
    },
  ];

  const screens: Record<EditorialTab, ReactNode> = {
    production: <ProductionScreen />,
    kanban: <KanbanScreen />,
    studio: <StudioScreen />,
    now: <PublishNowScreen />,
    calendar: <CalendarScreen />,
    scheduler: <SchedulerScreen />,
    autopilot: <AutopilotScreen />,
  };

  return (
    <Workspace
      eyebrow={t('nav.groupEditorialPublish')}
      title={t('editorialPublishHub.title')}
      description={t('editorialPublishHub.description')}
      tabGroups={tabGroups}
      activeTab={tab}
      onTabChange={(id) => setTab(id as EditorialTab)}
      actions={
        <Link to="/articles/new">
          <Btn variant="primary">+ {t('articles.new')}</Btn>
        </Link>
      }
    >
      {screens[tab]}
    </Workspace>
  );
}
