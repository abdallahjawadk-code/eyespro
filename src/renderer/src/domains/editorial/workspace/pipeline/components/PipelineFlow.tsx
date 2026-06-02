import { PIPELINE_STEPS, STEP_META, type PipelineStep } from '../types';

type Props = {
  byStep: Record<string, number>;
  activeStep: PipelineStep | 'all';
  onSelect: (step: PipelineStep | 'all') => void;
  total: number;
  t: (key: string) => string;
};

export function PipelineFlow({ byStep, activeStep, onSelect, total: _total, t }: Props) {
  return (
    <div className="pipeline-flow-container">
      <h2 className="pipeline-flow-title">{t('pipeline.processFlow')}</h2>
      <div className="pipeline-flow">
        {PIPELINE_STEPS.map((step, index) => {
          const meta = STEP_META[step];
          const count = byStep[step] || 0;
          const isActive = activeStep === step;
          const isEmpty = count === 0;

          return (
            <div key={step} className="pipeline-flow-segment">
              <div
                className={`pipeline-step-node ${isActive ? 'active' : ''} ${isEmpty ? 'empty' : ''}`}
                onClick={() => onSelect(step)}
                style={{ '--step-color': meta.color } as React.CSSProperties}
              >
                <div className="pipeline-step-icon">{meta.icon}</div>
                <div className="pipeline-step-name">{t(`pipeline.steps.${step}`)}</div>
                <div className="pipeline-step-count">{count}</div>
                {meta.ai && (
                  <div className="pipeline-step-ai">AI</div>
                )}
              </div>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className="pipeline-step-connector" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
