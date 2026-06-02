import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { useArticles } from '../articles/useArticles';
import type { usePipeline } from '../pipeline/usePipeline';
import { articleExcerpt, formatArticleDate } from '../articles/lib/format';
import { StatusChip } from '../articles/components/ui/StatusChip';
import { SentimentChip } from '../articles/components/ui/SentimentChip';
import { TranslatePanel } from '../../../../components/translation/TranslatePanel';
import { PIPELINE_PROFILES, STEP_META, type PipelineProfileId, type PipelineStep } from '../pipeline/types';
import type { useAiTools } from '../useAiTools';

type ArticlesStore = ReturnType<typeof useArticles>;
type PipelineStore = ReturnType<typeof usePipeline>;
type AiStore = ReturnType<typeof useAiTools>;

type Tab = 'overview' | 'pipeline' | 'ai';

type Props = {
  focusId: number;
  articles: ArticlesStore;
  pipeline: PipelineStore;
  ai: AiStore;
  onClose: () => void;
  onGoProcess: () => void;
};

export function ContextDock({
  focusId,
  articles,
  pipeline,
  ai,
  onClose,
  onGoProcess,
}: Props) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');

  const article =
    articles.previewArticle?.id === focusId
      ? articles.previewArticle
      : articles.rows.find((r) => r.id === focusId) ?? null;

  const detail = pipeline.articleDetail;
  const profile = (detail?.article?.pipeline_profile || 'full') as PipelineProfileId;

  const runStep = (step: PipelineStep) => {
    void pipeline.runStep(focusId, step);
  };

  return (
    <>
      <button type="button" className="ed-context-backdrop" onClick={onClose} aria-label={t('common.cancel')} />
      <aside className="ed-context" role="dialog" aria-labelledby="ed-context-title">
        <header className="ed-context-hdr">
          <div>
            <p className="ed-context-kicker">#{focusId}</p>
            <h2 id="ed-context-title">{article?.title || detail?.article?.title || t('articles.untitled')}</h2>
          </div>
          <button type="button" className="ed-context-close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ed-context-tabs" role="tablist">
          {(['overview', 'pipeline', 'ai'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'is-active' : ''}
              onClick={() => setTab(id)}
            >
              {t(`editorial.context.${id}`)}
            </button>
          ))}
        </div>

        <div className="ed-context-body">
          {tab === 'overview' && (
            <>
              <div className="ed-context-chips">
                {article && <StatusChip status={article.status} />}
                {article && <SentimentChip sentiment={article.sentiment} />}
                {detail?.article?.processing_status && (
                  <span className="ed-tag">{detail.article.processing_status}</span>
                )}
              </div>
              {article && (
                <p className="ed-context-excerpt">{articleExcerpt(article, 280) || t('articles.emptyFilter')}</p>
              )}
              <dl className="ed-context-stats">
                <dt>{t('articles.colUpdated')}</dt>
                <dd>{formatArticleDate(article?.updated_at, i18n.language)}</dd>
                <dt>{t('articles.colWords')}</dt>
                <dd>{article?.word_count ?? 0}</dd>
              </dl>
              <TranslatePanel
                articleId={focusId}
                compact
                onSaved={() => {
                  void articles.refresh();
                  void pipeline.openArticleDrawer(focusId);
                }}
              />
            </>
          )}

          {tab === 'pipeline' && (
            <>
              {pipeline.detailLoading && <p className="ed-muted">{t('pipeline.previewLoading')}</p>}
              {!pipeline.detailLoading && detail && (
                <>
                  <label className="ed-field">
                    <span>{t('pipeline.profile')}</span>
                    <select
                      value={profile}
                      onChange={(e) =>
                        void pipeline.setArticleProfile(focusId, e.target.value as PipelineProfileId)
                      }
                    >
                      {PIPELINE_PROFILES.map((p) => (
                        <option key={p} value={p}>
                          {t(`pipeline.profiles.${p}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ed-step-actions">
                    {(Object.keys(STEP_META) as PipelineStep[]).map((step) => (
                      <button
                        key={step}
                        type="button"
                        className="ed-btn ed-btn--ghost"
                        disabled={pipeline.runningId === focusId}
                        onClick={() => runStep(step)}
                      >
                        {STEP_META[step].icon} {t(`pipeline.steps.${step}`)}
                      </button>
                    ))}
                  </div>
                  {detail.log?.length > 0 && (
                    <ul className="ed-log">
                      {detail.log.slice(-6).map((line, i) => (
                        <li key={i}>
                          {[line.step, line.status, line.message].filter(Boolean).join(' · ')}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <button type="button" className="ed-btn ed-btn--accent ed-btn--block" onClick={onGoProcess}>
                {t('editorial.openInPipeline')}
              </button>
            </>
          )}

          {tab === 'ai' && (
            <>
              <p className="ed-muted">{t('editorial.ai.contextHint')}</p>
              <label className="ed-field">
                <span>{t('aiBatch.mode')}</span>
                <select value={ai.mode} onChange={(e) => ai.setMode(e.target.value)} disabled={ai.running}>
                  {(ai.modes.length ? ai.modes : ['summarize', 'translate', 'grammar']).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ed-btn ed-btn--primary ed-btn--block"
                disabled={ai.running}
                onClick={() => void ai.runOnArticle(focusId)}
              >
                {ai.running ? t('common.loading') : t('ai.run')}
              </button>
              {ai.msg && <p className={`ed-ai-flash${ai.msg.ok ? ' is-ok' : ' is-err'}`}>{ai.msg.text}</p>}
            </>
          )}

        </div>

        <footer className="ed-context-foot">
          <Link to={`/articles/${focusId}`} className="ed-btn ed-btn--primary">
            {t('articles.openInEditor')}
          </Link>
          <button type="button" className="ed-btn ed-btn--danger" onClick={() => void articles.deleteArticle(focusId)}>
            {t('articles.delete')}
          </button>
        </footer>
      </aside>
    </>
  );
}
