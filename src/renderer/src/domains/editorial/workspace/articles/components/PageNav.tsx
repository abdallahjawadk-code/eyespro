import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

export function PageNav({ store }: { store: Store }) {
  const { t } = useTranslation();
  const { filters, patchFilters, total, totalPages } = store;

  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(filters.page * filters.pageSize, total);

  return (
    <nav className="ax-pager" aria-label={t('articles.pageOf', { page: filters.page, total: totalPages })}>
      <span className="ax-pager-info">{t('articles.pageInfo', { from, to, total })}</span>
      <div className="ax-pager-controls">
        <button
          type="button"
          className="ax-btn ax-btn--ghost"
          disabled={filters.page <= 1}
          onClick={() => patchFilters({ page: filters.page - 1 })}
        >
          {t('articles.prevPage')}
        </button>
        <span className="ax-pager-page">{t('articles.pageOf', { page: filters.page, total: totalPages })}</span>
        <button
          type="button"
          className="ax-btn ax-btn--ghost"
          disabled={filters.page >= totalPages}
          onClick={() => patchFilters({ page: filters.page + 1 })}
        >
          {t('articles.nextPage')}
        </button>
      </div>
    </nav>
  );
}
