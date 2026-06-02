import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Btn } from '../../ui';
import { useTabParam } from '../../core/hooks/useTabParam';
import { Workspace } from '../../shell/Workspace';
import { parseContentTab, type ContentTab } from './types';
import { SourcesScreen } from './screens/SourcesScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { TrendsScreen } from './screens/TrendsScreen';
import { MediaScreen } from './screens/MediaScreen';

export function ContentDomain() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(parseContentTab);

  const tabs = [
    { id: 'sources', label: t('nav.sources'), icon: '📡' },
    { id: 'templates', label: t('nav.templates'), icon: '📋' },
    { id: 'trends', label: t('nav.trendRadar'), icon: '⚡' },
    { id: 'media', label: t('nav.media'), icon: '🖼️' },
  ];

  const screens: Record<ContentTab, ReactNode> = {
    sources: <SourcesScreen />,
    templates: <TemplatesScreen />,
    trends: <TrendsScreen />,
    media: <MediaScreen />,
  };

  return (
    <Workspace
      eyebrow={t('nav.groupContent')}
      title={t('contentHub.title')}
      description={t('contentHub.description')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as ContentTab)}
      actions={
        <Link to="/articles">
          <Btn variant="ghost">📝 {t('nav.articlesContent')}</Btn>
        </Link>
      }
    >
      {screens[tab]}
    </Workspace>
  );
}
