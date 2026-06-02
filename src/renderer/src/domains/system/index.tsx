import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Btn } from '../../ui';
import { useTabParam } from '../../core/hooks/useTabParam';
import { Workspace } from '../../shell/Workspace';
import { parseSystemTab, type SystemTab } from './types';
import { MonitorScreen } from './screens/MonitorScreen';
import { AuditScreen } from './screens/AuditScreen';

export function SystemDomain() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(parseSystemTab);

  const tabs = [
    { id: 'monitor', label: t('systemHub.tabs.monitor'), icon: '⚡' },
    { id: 'audit', label: t('systemHub.tabs.audit'), icon: '📋' },
  ];

  const screens: Record<SystemTab, ReactNode> = {
    monitor: <MonitorScreen />,
    audit: <AuditScreen />,
  };

  return (
    <Workspace
      eyebrow={t('nav.groupSystem')}
      title={t('systemHub.title')}
      description={t('systemHub.description')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as SystemTab)}
      actions={
        <Link to="/settings">
          <Btn variant="ghost">⚙️ {t('nav.settings')}</Btn>
        </Link>
      }
    >
      {screens[tab]}
    </Workspace>
  );
}
