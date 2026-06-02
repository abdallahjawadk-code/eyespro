import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

/* ── Icons ────────────────────────────────── */
const IcoSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IcoLink = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const IcoRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const IcoGrid = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3"  y="3"  width="7" height="7" />
    <rect x="14" y="3"  width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3"  y="14" width="7" height="7" />
  </svg>
);

const IcoList = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8"    y1="6"  x2="21"   y2="6"  />
    <line x1="8"    y1="12" x2="21"   y2="12" />
    <line x1="8"    y1="18" x2="21"   y2="18" />
    <line x1="3"    y1="6"  x2="3.01" y2="6"  />
    <line x1="3"    y1="12" x2="3.01" y2="12" />
    <line x1="3"    y1="18" x2="3.01" y2="18" />
  </svg>
);

const IcoPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5"  x2="12" y2="19" />
    <line x1="5"  y1="12" x2="19" y2="12" />
  </svg>
);

const IcoTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);

/* ── Component ───────────────────────────── */
export function CommandBar({ store }: { store: Store }) {
  const { t } = useTranslation();
  const {
    filters, patchFilters,
    ingestUrl, setIngestUrl, ingest, ingestMsg,
    viewMode, setViewMode,
    refresh, loading,
    selected, toggleAllOnPage, rows,
    deleteAll, total,
  } = store;

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="ax-command">

      {/* Search */}
      <div className="ax-command-search">
        <span className="ax-command-ico" aria-hidden><IcoSearch /></span>
        <input
          type="search"
          value={filters.search}
          onChange={(e) => patchFilters({ search: e.target.value })}
          placeholder={t('articles.search')}
          aria-label={t('articles.filterText')}
        />
      </div>

      <div className="ax-command-divider" aria-hidden />

      {/* URL ingest */}
      <div className="ax-command-ingest">
        <span className="ax-command-ico" aria-hidden><IcoLink /></span>
        <input
          type="url"
          value={ingestUrl}
          onChange={(e) => setIngestUrl(e.target.value)}
          placeholder={t('articles.ingestUrl')}
          onKeyDown={(e) => e.key === 'Enter' && void ingest()}
        />
        <button
          type="button"
          className="ax-btn ax-btn--primary"
          onClick={() => void ingest()}
          style={{ flexShrink: 0 }}
        >
          {t('articles.ingest')}
        </button>
      </div>

      {ingestMsg && (
        <p className={`ax-command-flash${ingestMsg.ok ? ' is-ok' : ' is-err'}`}>
          {ingestMsg.text}
        </p>
      )}

      {/* Right actions */}
      <div className="ax-command-actions">
        <label className="ax-check-label ax-check-label--compact" title={t('common.selectAll')}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAllOnPage}
            disabled={!rows.length}
          />
          <span className="ax-check-label-text">{t('common.selectAll')}</span>
        </label>

        <button
          type="button"
          className="ax-btn ax-btn--ghost ax-btn--icon"
          onClick={refresh}
          disabled={loading}
          title={t('common.refresh')}
        >
          <IcoRefresh />
          <span className="ax-btn-text">{t('common.refresh')}</span>
        </button>

        {(total ?? 0) > 0 && (
          <button
            type="button"
            className="ax-btn ax-btn--ghost ax-btn--icon"
            onClick={() => void deleteAll()}
            title={t('articles.deleteAll')}
            style={{ color: 'var(--err, #ef4444)' }}
          >
            <IcoTrash />
            <span className="ax-btn-text">{t('articles.deleteAll')}</span>
          </button>
        )}

        <div className="ax-segment" role="group" aria-label={t('articles.viewMode')}>
          <button
            type="button"
            className={viewMode === 'grid' ? 'is-active' : ''}
            onClick={() => setViewMode('grid')}
            title={t('articles.viewGrid')}
          >
            <IcoGrid />
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'is-active' : ''}
            onClick={() => setViewMode('list')}
            title={t('articles.viewList')}
          >
            <IcoList />
          </button>
        </div>

        <Link to="/articles/new" className="ax-btn ax-btn--accent ax-btn--compact-new" title={t('articles.new')}>
          <IcoPlus />
          <span className="ax-btn-text">{t('articles.new')}</span>
        </Link>
      </div>
    </div>
  );
}
