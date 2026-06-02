import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

const SORT_LABELS: Record<string, string> = {
  updated_at: 'articles.sortUpdated',
  created_at: 'articles.sortCreated',
  published_at: 'articles.sortPublished',
  word_count: 'articles.sortWords',
};

const IconSort = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="21" y1="10" x2="7" y2="10"/>
    <line x1="21" y1="6" x2="3" y2="6"/>
    <line x1="21" y1="14" x2="3" y2="14"/>
    <line x1="21" y1="18" x2="7" y2="18"/>
  </svg>
);

export function ResultsMeta({ store }: { store: Store }) {
  const { t } = useTranslation();
  const { total, filters } = store;
  const sortKey = SORT_LABELS[filters.sortField] ?? 'articles.sortUpdated';

  return (
    <div className="ax-results-meta">
      <span className="ax-results-count">
        {t('articles.resultsCount', { count: total })}
        <span className="ax-results-count-badge">{total}</span>
      </span>
      <span className="ax-results-sort">
        <IconSort />
        {t('articles.sortedBy', {
          field: t(sortKey),
          dir: filters.sortOrder === 'DESC' ? t('articles.sortDesc') : t('articles.sortAsc'),
        })}
      </span>
    </div>
  );
}
