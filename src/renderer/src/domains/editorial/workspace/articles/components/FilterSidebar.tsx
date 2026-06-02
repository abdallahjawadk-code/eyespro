import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

const STATUSES = ['all', 'draft', 'pending', 'published'] as const;

const IconFilter = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

export function FilterSidebar({ store }: { store: Store }) {
  const { t } = useTranslation();
  const { filters, patchFilters, resetFilters, categories, sources } = store;

  return (
    <aside className="ax-filters">
      <div className="ax-filters-head">
        <h2>
          <IconFilter />
          {t('articles.filtersTitle')}
        </h2>
        <button type="button" className="ax-link" onClick={resetFilters}>
          {t('articles.resetFilters')}
        </button>
      </div>

      <div className="ax-filters-body">
        <div className="ax-filters-block">
          <span className="ax-filters-label">{t('articles.filterStatus')}</span>
          <div className="ax-pills">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`ax-pill${filters.status === s ? ' is-on' : ''}`}
                onClick={() => patchFilters({ status: s, page: 1 })}
              >
                {s === 'all'
                  ? t('common.all')
                  : s === 'draft'
                    ? t('articles.statusDraft')
                    : s === 'pending'
                      ? t('articles.statusPending')
                      : t('articles.statusPublished')}
              </button>
            ))}
          </div>
        </div>

        <div className="ax-filters-block">
          <label className="ax-field">
            <span>{t('articles.filterCategory')}</span>
            <select
              value={filters.category}
              onChange={(e) => patchFilters({ category: e.target.value, page: 1 })}
            >
              <option value="all">{t('common.all')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="ax-filters-block">
          <label className="ax-field">
            <span>{t('articles.filterSource')}</span>
            <select
              value={filters.source}
              onChange={(e) => patchFilters({ source: e.target.value, page: 1 })}
            >
              <option value="all">{t('common.all')}</option>
              {sources.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="ax-filters-block">
          <label className="ax-field">
            <span>{t('articles.sortBy')}</span>
            <select
              value={filters.sortField}
              onChange={(e) => patchFilters({ sortField: e.target.value, page: 1 })}
            >
              <option value="updated_at">{t('articles.sortUpdated')}</option>
              <option value="created_at">{t('articles.sortCreated')}</option>
              <option value="published_at">{t('articles.sortPublished')}</option>
              <option value="word_count">{t('articles.sortWords')}</option>
            </select>
          </label>

          <label className="ax-field">
            <span>{t('articles.sortDir')}</span>
            <select
              value={filters.sortOrder}
              onChange={(e) => patchFilters({ sortOrder: e.target.value as 'ASC' | 'DESC', page: 1 })}
            >
              <option value="DESC">{t('articles.sortDesc')}</option>
              <option value="ASC">{t('articles.sortAsc')}</option>
            </select>
          </label>
        </div>
      </div>
    </aside>
  );
}
