import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

export function EmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="ax-empty">
      <div className="ax-empty-glyph" aria-hidden>
        {filtered ? '🔍' : '📄'}
      </div>
      <h2>{filtered ? t('articles.emptyFilter') : t('dashboard.empty')}</h2>
      {!filtered && (
        <p>{t('articles.workspaceDesc')}</p>
      )}
      {!filtered && (
        <Link to="/articles/new" className="ax-btn ax-btn--accent" style={{ marginTop: '20px' }}>
          <IconPlus />
          {t('articles.new')}
        </Link>
      )}
    </div>
  );
}
