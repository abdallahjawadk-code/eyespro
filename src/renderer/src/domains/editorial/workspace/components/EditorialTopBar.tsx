import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { EditorialPhase } from '../types';
import type { useArticles } from '../articles/useArticles';
import type { usePipeline } from '../pipeline/usePipeline';

type Props = {
  phase: EditorialPhase;
  articles: ReturnType<typeof useArticles>;
  pipeline: ReturnType<typeof usePipeline>;
  onRefresh: () => void;
};

export function EditorialTopBar({
  phase,
  articles,
  pipeline,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const loading = articles.loading || pipeline.loading;

  return (
    <header className="ed-topbar">
      <div className="ed-topbar-copy">
        <h1>{t(`editorial.headings.${phase}`)}</h1>
        <p>{t(`editorial.headings.${phase}Hint`)}</p>
      </div>

      <div className="ed-topbar-pills">
        <span className="ed-pill">
          <strong>{articles.stats.total}</strong> {t('articles.statTotal')}
        </span>
        <span className="ed-pill ed-pill--warn">
          <strong>{articles.stats.pending}</strong> {t('articles.statusPending')}
        </span>
        <span className="ed-pill ed-pill--ok">
          <strong>{pipeline.stats.ready}</strong> {t('pipeline.statsReady')}
        </span>
        {pipeline.stats.activeJobs > 0 && (
          <span className="ed-pill ed-pill--accent">
            <strong>{pipeline.stats.activeJobs}</strong> {t('pipeline.statsJobs')}
          </span>
        )}
      </div>

      <div className="ed-topbar-actions">
        <button type="button" className="ed-btn ed-btn--ghost" onClick={onRefresh} disabled={loading}>
          ↻ {t('common.refresh')}
        </button>
        <Link to="/settings" className="ed-btn ed-btn--ghost" state={{ tab: 'pipeline' }}>
          ⚙ {t('pipeline.viewSettings')}
        </Link>
        <Link to="/articles/new" className="ed-btn ed-btn--primary">
          + {t('articles.new')}
        </Link>
      </div>
    </header>
  );
}
