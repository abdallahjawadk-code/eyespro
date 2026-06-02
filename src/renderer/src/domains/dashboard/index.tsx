import { useTranslation } from 'react-i18next';
import { Workspace } from '../../shell/Workspace';
import { DashboardScreen } from './screens/DashboardScreen';

export function DashboardDomain() {
  const { t } = useTranslation();
  return (
    <Workspace eyebrow={t('nav.groupMain')} title={t('dashboard.hubTitle')} description={t('dashboard.hubDesc')}>
      <DashboardScreen />
    </Workspace>
  );
}
