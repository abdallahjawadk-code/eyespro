import type { usePipeline } from '../usePipeline';

type Props = {
  store: ReturnType<typeof usePipeline>;
  onClose: () => void;
  t: (key: string) => string;
};

export function PipelineJobsPanel({ store, onClose, t }: Props) {
  const runningJobs = store.jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const failedJobs = store.jobs.filter(j => j.status === 'failed');

  return (
    <div className="pipeline-jobs-panel">
      <div className="pipeline-jobs-header">
        <div className="pipeline-jobs-title">{t('pipeline.jobs')}</div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '1.2rem',
            cursor: 'pointer',
            color: 'var(--t2)',
          }}
        >
          ✕
        </button>
      </div>
      
      <div className="pipeline-jobs-body">
        {runningJobs.length === 0 && failedJobs.length === 0 ? (
          <div className="pipeline-empty">
            <div className="pipeline-empty-icon">📋</div>
            <div className="pipeline-empty-text">{t('pipeline.noJobs')}</div>
          </div>
        ) : (
          <>
            {runningJobs.map(job => (
              <div key={job.id} className="pipeline-job-card running">
                <div className="pipeline-job-header">
                  <div className="pipeline-job-title">#{job.article_id}</div>
                  <div className="pipeline-job-status running">{t('pipeline.running')}</div>
                </div>
                <div className="pipeline-job-progress">
                  <div
                    className="pipeline-job-progress-bar"
                    style={{
                      width: `${(job.progress_done / Math.max(job.progress_total, 1)) * 100}%`,
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--t2)' }}>
                  {job.progress_done} / {job.progress_total}
                </div>
              </div>
            ))}
            
            {failedJobs.map(job => (
              <div key={job.id} className="pipeline-job-card">
                <div className="pipeline-job-header">
                  <div className="pipeline-job-title">#{job.article_id}</div>
                  <div className="pipeline-job-status failed">{t('pipeline.failed')}</div>
                </div>
                {job.error && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--err)' }}>
                    {job.error}
                  </div>
                )}
                <div className="pipeline-card-actions" style={{ marginTop: '10px' }}>
                  <button
                    className="pipeline-card-btn pipeline-card-btn-primary"
                    onClick={() => store.retryJob(job.id)}
                  >
                    {t('pipeline.retry')}
                  </button>
                  <button
                    className="pipeline-card-btn pipeline-card-btn-secondary"
                    onClick={() => store.cancelJob(job.id)}
                  >
                    {t('pipeline.cancel')}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
