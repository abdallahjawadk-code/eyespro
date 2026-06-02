import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabParam } from '../../core/hooks/useTabParam';
import { Workspace } from '../../shell/Workspace';
import { CalendarScreen } from '../editorial/screens/CalendarScreen';
import { SchedulerScreen } from '../editorial/screens/SchedulerScreen';

type ScheduleTab = 'calendar' | 'scheduler';

function parseScheduleTab(raw: string | null): ScheduleTab {
  return raw === 'scheduler' ? 'scheduler' : 'calendar';
}

export function ScheduleDomain() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(parseScheduleTab);

  const tabs = [
    { id: 'calendar', label: t('schedulePage.tabs.calendar'), icon: '📅' },
    { id: 'scheduler', label: t('schedulePage.tabs.scheduler'), icon: '⏰' },
  ];

  const screens: Record<ScheduleTab, ReactNode> = {
    calendar: <CalendarScreen />,
    scheduler: <SchedulerScreen />,
  };

  return (
    <Workspace
      eyebrow={t('nav.groupWorkflow')}
      title={t('nav.scheduledTasks')}
      description={t('schedulePage.description')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as ScheduleTab)}
    >
      {screens[tab]}
    </Workspace>
  );
}
