import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

const METRICS = [
  {
    field:    'total'     as const,
    status:   'all',
    mod:      'total',
    labelKey: 'articles.statTotal',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9"  x2="8" y2="9"/>
      </svg>
    ),
  },
  {
    field:    'draft'     as const,
    status:   'draft',
    mod:      'draft',
    labelKey: 'articles.statusDraft',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    ),
  },
  {
    field:    'pending'   as const,
    status:   'pending',
    mod:      'pending',
    labelKey: 'articles.statusPending',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    field:    'published' as const,
    status:   'published',
    mod:      'published',
    labelKey: 'articles.statusPublished',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
  },
];

export function InsightsBar({ store }: { store: Store }) {
  const { t } = useTranslation();
  const { stats, filters, patchFilters } = store;

  return (
    <div className="ax-insights" role="tablist" aria-label={t('articles.filtersTitle')}>
      {METRICS.map((m) => {
        const value = stats[m.field];
        const active = filters.status === m.status;
        const pct = stats.total > 0 ? Math.round((value / stats.total) * 100) : 0;

        return (
          <button
            key={m.status}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ax-insight ax-insight--${m.mod}${active ? ' is-active' : ''}`}
            onClick={() => patchFilters({ status: m.status, page: 1 })}
          >
            <span className="ax-insight-icon" aria-hidden>{m.icon}</span>

            <span className="ax-insight-text">
              <span className="ax-insight-value">{value.toLocaleString()}</span>
              <span className="ax-insight-label">{t(m.labelKey)}</span>
            </span>

            <span className="ax-insight-bar" aria-hidden>
              <span className="ax-insight-fill" style={{ width: `${pct}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
