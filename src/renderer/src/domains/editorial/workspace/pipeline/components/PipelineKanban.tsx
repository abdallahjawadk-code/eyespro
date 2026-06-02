import { PIPELINE_STEPS, STEP_META, type PipelineStep, type KanbanArticle } from '../types';
import type { usePipeline } from '../usePipeline';

type Props = {
  store: ReturnType<typeof usePipeline>;
  activeStep: PipelineStep | 'all';
  onArticleOpen: (id: number) => void;
  t: (key: string) => string;
};

export function PipelineKanban({ store, activeStep, onArticleOpen, t }: Props) {
  const stepsToShow = activeStep === 'all' ? PIPELINE_STEPS : [activeStep];
  const kanban = store.kanban;

  const getScoreClass = (score: number | null) => {
    if (!score) return '';
    if (score >= 80) return 'high';
    if (score >= 50) return 'mid';
    return 'low';
  };

  return (
    <div className="pipeline-kanban-grid">
      {stepsToShow.map((step) => {
        const meta = STEP_META[step];
        const articles = kanban[step] || [];

        return (
          <div key={step} className="pipeline-column" style={{ '--lane': meta.color } as React.CSSProperties}>
            <div className="pipeline-column-header">
              <div className="pipeline-column-title">
                <span>{meta.icon}</span>
                <span>{t(`pipeline.steps.${step}`)}</span>
              </div>
              <div className="pipeline-column-count">{articles.length}</div>
            </div>
            
            <div className="pipeline-column-body">
              {articles.length === 0 ? (
                <div className="pipeline-empty">
                  <div className="pipeline-empty-icon">📭</div>
                  <div className="pipeline-empty-text">{t('pipeline.noArticles')}</div>
                  <div className="pipeline-empty-subtext">{t('pipeline.noArticlesSubtext')}</div>
                </div>
              ) : (
                articles.map((article: KanbanArticle) => (
                  <div
                    key={article.id}
                    className="pipeline-card"
                    onClick={() => onArticleOpen(article.id)}
                    style={{ '--accent': meta.color } as React.CSSProperties}
                  >
                    <div className="pipeline-card-header">
                      <div className="pipeline-card-id">#{article.id}</div>
                      {article.pipeline_quality_score && (
                        <div className={`pipeline-card-score ${getScoreClass(article.pipeline_quality_score)}`}>
                          {article.pipeline_quality_score}%
                        </div>
                      )}
                    </div>
                    
                    <div className="pipeline-card-title">{article.title}</div>
                    
                    <div className="pipeline-card-footer">
                      <div className="pipeline-card-actions">
                    <button
                      className="pipeline-card-btn pipeline-card-btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.runStep(article.id, step);
                      }}
                      disabled={store.runningId === article.id}
                    >
                      {store.runningId === article.id ? '...' : t('pipeline.runStep')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  })}
</div>
  );
}
