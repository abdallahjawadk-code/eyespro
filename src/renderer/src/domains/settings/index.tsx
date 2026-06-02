import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Btn } from '../../ui';
import { Workspace } from '../../shell/Workspace';
import { SettingsScreen } from './screens/SettingsScreen';

export function SettingsDomain() {
  const { t } = useTranslation();
  return (
    <Workspace
      eyebrow={t('nav.groupSystem')}
      title={t('settings.title')}
      description={t('settingsHub.description')}
      className="ep-page--settings"
      actions={
        <Link to="/system">
          <Btn variant="ghost">⚡ {t('nav.system')}</Btn>
        </Link>
      }
    >
      <SettingsScreen />
    </Workspace>
  );
}
