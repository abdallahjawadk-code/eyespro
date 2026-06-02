import type { usePipeline } from '../usePipeline';

type Props = {
  store: ReturnType<typeof usePipeline>;
  t: (key: string) => string;
};

export function PipelineHeader({ store, t }: Props) {
  return (
    <div className="pipeline-header">
      <div className="pipeline-header-content">
        <h1 className="pipeline-title">{t('nav.pipeline')}</h1>
        <p className="pipeline-subtitle">{t('pipeline.description')}</p>
        
        <div className="pipeline-stats-bar">
          <div className="pipeline-stat-card">
            <div className="pipeline-stat-icon">📊</div>
            <div>
              <div className="pipeline-stat-value">{store.stats.total}</div>
              <div className="pipeline-stat-label">{t('pipeline.totalArticles')}</div>
            </div>
          </div>
          
          <div className="pipeline-stat-card">
            <div className="pipeline-stat-icon">🚀</div>
            <div>
              <div className="pipeline-stat-value">{store.stats.ready}</div>
              <div className="pipeline-stat-label">{t('pipeline.ready')}</div>
            </div>
          </div>
          
          <div className="pipeline-stat-card">
            <div className="pipeline-stat-icon">⚡</div>
            <div>
              <div className="pipeline-stat-value">{store.stats.activeJobs}</div>
              <div className="pipeline-stat-label">{t('pipeline.activeJobs')}</div>
            </div>
          </div>
          
          <div className="pipeline-stat-card">
            <div className="pipeline-stat-icon">❌</div>
            <div>
              <div className="pipeline-stat-value">{store.stats.failedJobs}</div>
              <div className="pipeline-stat-label">{t('pipeline.failedJobs')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
