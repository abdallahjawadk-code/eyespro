import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import './layout.css';

type Props = { currentPage?: string };

export function Titlebar({ currentPage }: Props) {
  const { t } = useTranslation();
  const { toggle, theme } = useTheme();

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-brand">{t('app.name')}</span>
        {currentPage && (
          <>
            <span className="titlebar-sep">›</span>
            <span className="titlebar-page">{currentPage}</span>
          </>
        )}
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-right">
        <div className="titlebar-status">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
          {t('tb.connected')}
        </div>
        <div className="titlebar-sep-v" />
        <button type="button" className="tb-btn" title={theme === 'dark' ? t('tb.theme') : t('tb.theme')} onClick={toggle}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className="titlebar-sep-v" />
        <button type="button" className="tb-btn" title={t('tb.minimize')} onClick={() => window.eyespro.window.minimize()}>—</button>
        <button type="button" className="tb-btn" title={t('tb.maximize')} onClick={() => window.eyespro.window.maximize()}>□</button>
        <button type="button" className="tb-btn tb-btn-close" title={t('tb.close')} onClick={() => window.eyespro.window.close()}>✕</button>
      </div>
    </header>
  );
}
