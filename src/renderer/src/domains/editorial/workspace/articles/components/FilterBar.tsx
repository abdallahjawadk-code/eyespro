import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

const STATUSES = ['all', 'draft', 'pending', 'published'] as const;

/* ── Icons ──────────────────────────────── */
const IcoChevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IcoX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6"  y1="6" x2="18" y2="18" />
  </svg>
);

const IcoSort = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6"  x2="21" y2="6" />
    <line x1="3" y1="12" x2="15" y2="12" />
    <line x1="3" y1="18" x2="9"  y2="18" />
  </svg>
);

const IcoAsc = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const IcoDesc = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

/* ── Status dot colors ───────────────────── */
const STATUS_DOT: Record<string, string> = {
  all:       'var(--acc)',
  draft:     '#64748b',
  pending:   '#f59e0b',
  published: '#10b981',
};

/* ── Sort labels ─────────────────────────── */
const SORT_FIELDS = [
  { value: 'updated_at',   key: 'articles.sortUpdated'   },
  { value: 'created_at',   key: 'articles.sortCreated'   },
  { value: 'published_at', key: 'articles.sortPublished' },
  { value: 'word_count',   key: 'articles.sortWords'     },
] as const;

/* ── Component ───────────────────────────── */
export function FilterBar({ store }: { store: Store }) {
  const { t } = useTranslation();
  const {
    filters, patchFilters, resetFilters,
    categories, sources, total,
  } = store;

  const isFiltered =
    filters.status   !== 'all' ||
    filters.category !== 'all' ||
    filters.source   !== 'all';

  const activeCount = [
    filters.status   !== 'all',
    filters.category !== 'all',
    filters.source   !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="ax-filterbar" role="toolbar" aria-label={t('articles.filtersTitle')}>

      {/* ── Status tabs ─────────────────── */}
      <div className="ax-filterbar-group ax-filterbar-status" role="tablist">
        {STATUSES.map((s) => {
          const active = filters.status === s;
          const dot = STATUS_DOT[s];
          const label = s === 'all'
            ? t('common.all')
            : s === 'draft'     ? t('articles.statusDraft')
            : s === 'pending'   ? t('articles.statusPending')
            :                     t('articles.statusPublished');

          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ax-fbtab${active ? ' is-on' : ''}`}
              onClick={() => patchFilters({ status: s, page: 1 })}
              style={{ '--ax-fbtab-dot': dot } as React.CSSProperties}
            >
              <span className="ax-fbtab-dot" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <span className="ax-filterbar-sep" aria-hidden />

      {/* ── Dropdowns ────────────────────── */}
      <div className="ax-filterbar-group">

        {/* Category */}
        {categories.length > 0 && (
          <label className="ax-fbselect-wrap">
            <span className="ax-fbselect-label">{t('articles.filterCategory')}</span>
            <div className={`ax-fbselect${filters.category !== 'all' ? ' is-active' : ''}`}>
              <select
                value={filters.category}
                onChange={(e) => patchFilters({ category: e.target.value, page: 1 })}
                aria-label={t('articles.filterCategory')}
              >
                <option value="all">{t('common.all')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <IcoChevron />
            </div>
          </label>
        )}

        {/* Source */}
        {sources.length > 0 && (
          <label className="ax-fbselect-wrap">
            <span className="ax-fbselect-label">{t('articles.filterSource')}</span>
            <div className={`ax-fbselect${filters.source !== 'all' ? ' is-active' : ''}`}>
              <select
                value={filters.source}
                onChange={(e) => patchFilters({ source: e.target.value, page: 1 })}
                aria-label={t('articles.filterSource')}
              >
                <option value="all">{t('common.all')}</option>
                {sources.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
              <IcoChevron />
            </div>
          </label>
        )}
      </div>

      <span className="ax-filterbar-sep" aria-hidden />

      {/* ── Sort ─────────────────────────── */}
      <div className="ax-filterbar-group">
        <label className="ax-fbselect-wrap">
          <span className="ax-fbselect-label">
            <IcoSort />
            {t('articles.sortBy')}
          </span>
          <div className="ax-fbselect">
            <select
              value={filters.sortField}
              onChange={(e) => patchFilters({ sortField: e.target.value, page: 1 })}
              aria-label={t('articles.sortBy')}
            >
              {SORT_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{t(f.key)}</option>
              ))}
            </select>
            <IcoChevron />
          </div>
        </label>

        {/* Direction toggle */}
        <button
          type="button"
          className="ax-fbdir"
          title={filters.sortOrder === 'DESC' ? t('articles.sortDesc') : t('articles.sortAsc')}
          onClick={() =>
            patchFilters({ sortOrder: filters.sortOrder === 'DESC' ? 'ASC' : 'DESC', page: 1 })
          }
        >
          {filters.sortOrder === 'DESC' ? <IcoDesc /> : <IcoAsc />}
        </button>
      </div>

      {/* ── Spacer + right meta ───────────── */}
      <div className="ax-filterbar-right">

        {/* Active filters badge */}
        {activeCount > 0 && (
          <span className="ax-fb-badge">{activeCount}</span>
        )}

        {/* Results count */}
        <span className="ax-fb-count">
          {t('articles.resultsCount', { count: total })}
        </span>

        {/* Reset */}
        {isFiltered && (
          <button
            type="button"
            className="ax-fb-reset"
            onClick={resetFilters}
            title={t('articles.resetFilters')}
          >
            <IcoX />
            {t('articles.resetFilters')}
          </button>
        )}
      </div>
    </div>
  );
}
