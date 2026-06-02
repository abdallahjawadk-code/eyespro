import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../pipeline.css';
import type { PipelineStep } from '../types';
import type { usePipeline } from '../usePipeline';
import { PipelineHeader } from './PipelineHeader';
import { PipelineFlow } from './PipelineFlow';
import { PipelineKanban } from './PipelineKanban';
import { PipelineJobsPanel } from './PipelineJobsPanel';

type Store = ReturnType<typeof usePipeline>;

type Props = {
  store: Store;
  focusId: number | null;
  selectedIds: number[];
  onArticleOpen: (id: number) => void;
};

export function ProcessPane({ store, focusId: _focusId, selectedIds: _selectedIds, onArticleOpen }: Props) {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState<PipelineStep | 'all'>('all');
  const [jobsOpen, setJobsOpen] = useState(true);

  if (store.loading) {
    return (
      <div className="pipeline-loading">
        <div className="pipeline-loading-spinner" />
        <div className="pipeline-loading-text">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="pipeline-root">
      <PipelineHeader store={store} t={t} />
      
      <PipelineFlow
        byStep={store.stats.byStep}
        activeStep={activeStep}
        onSelect={setActiveStep}
        total={store.stats.total}
        t={t}
      />

      <div className="pipeline-kanban-section">
        <PipelineKanban
          store={store}
          activeStep={activeStep}
          onArticleOpen={onArticleOpen}
          t={t}
        />
      </div>

      {jobsOpen && (
        <PipelineJobsPanel
          store={store}
          onClose={() => setJobsOpen(false)}
          t={t}
        />
      )}
    </div>
  );
}
