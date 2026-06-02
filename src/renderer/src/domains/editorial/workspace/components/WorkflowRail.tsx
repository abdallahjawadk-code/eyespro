import { useTranslation } from 'react-i18next';
import type { EditorialPhase } from '../types';
import type { useArticles } from '../articles/useArticles';
import type { usePipeline } from '../pipeline/usePipeline';

type ArticlesStore = ReturnType<typeof useArticles>;
type PipelineStore = ReturnType<typeof usePipeline>;

const STEPS: { phase: EditorialPhase; icon: string; countKey: 'library' | 'pipeline' | 'download' }[] = [
  { phase: 'collect',  icon: '📥', countKey: 'library' },
  { phase: 'process',  icon: '⚙️', countKey: 'pipeline' },
  { phase: 'download', icon: '⬇', countKey: 'download' },
];

type Props = {
  phase: EditorialPhase;
  onPhase: (p: EditorialPhase) => void;
  articles: ArticlesStore;
  pipeline: PipelineStore;
  hiddenPhases?: EditorialPhase[];
};

export function WorkflowRail({ phase, onPhase, articles, pipeline, hiddenPhases = [] }: Props) {
  const { t } = useTranslation();

  const counts = {
    library:  articles.stats.total,
    pipeline: pipeline.stats.total,
    download: articles.stats.total,
  };

  const steps = STEPS.filter((s) => !hiddenPhases.includes(s.phase));
  return (
    <nav className="ed-rail" aria-label={t('editorial.workflowLabel')}>
      <div className="ed-rail-brand">
        <span className="ed-rail-logo" aria-hidden>
          ✦
        </span>
        <div>
          <strong>{t('editorial.title')}</strong>
          <span>{t('editorial.subtitle')}</span>
        </div>
      </div>

      <ol className="ed-rail-steps">
        {steps.map((step, index) => {
          const active = phase === step.phase;
          const done =
            (step.phase === 'collect'  && phase !== 'collect') ||
            (step.phase === 'process'  && phase === 'download');
          return (
            <li key={step.phase}>
              <button
                type="button"
                className={`ed-rail-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                onClick={() => onPhase(step.phase)}
                aria-current={active ? 'step' : undefined}
              >
                <span className="ed-rail-step-num">{index + 1}</span>
                <span className="ed-rail-step-icon" aria-hidden>
                  {step.icon}
                </span>
                <span className="ed-rail-step-text">
                  <span className="ed-rail-step-title">{t(`editorial.phases.${step.phase}`)}</span>
                  <span className="ed-rail-step-desc">{t(`editorial.phases.${step.phase}Desc`)}</span>
                </span>
                <span className="ed-rail-step-count">{counts[step.countKey]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="ed-rail-foot">
        <div className="ed-rail-stat">
          <span>{t('pipeline.statsJobs')}</span>
          <strong>{pipeline.stats.activeJobs}</strong>
        </div>
        <div className="ed-rail-stat">
          <span>{t('pipeline.statsReady')}</span>
          <strong>{pipeline.stats.ready}</strong>
        </div>
      </div>
    </nav>
  );
}
