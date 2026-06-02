import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { useAiTools } from '../useAiTools';

type Store = ReturnType<typeof useAiTools>;

type Props = {
  ai: Store;
  focusId: number | null;
  selectedIds: number[];
};

export function AiToolsPanel({ ai, focusId, selectedIds }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const targetId = focusId ?? (selectedIds.length === 1 ? selectedIds[0] : null);
  const batchIds = selectedIds.length > 0 ? selectedIds : targetId != null ? [targetId] : [];
  const aiReady = ai.providerStatus?.ok === true;

  async function handleGenerate() {
    const id = await ai.generateFromTopic(topic);
    if (id) {
      setTopic('');
      navigate(`/articles/${id}`);
    }
  }

  return (
    <section className="ed-ai-panel" aria-labelledby="ed-ai-title">
      <div className="ed-ai-head">
        <div>
          <h2 id="ed-ai-title">{t('editorial.ai.title')}</h2>
          <p>{t('editorial.ai.hint')}</p>
        </div>
        <div className="ed-ai-stats">
          <span className={`ed-ai-stat${aiReady ? ' ed-ai-stat--ok' : ' ed-ai-stat--warn'}`}>
            {aiReady
              ? `● ${t('ai.providerReady', { provider: ai.providerStatus?.provider ?? '' })}`
              : `○ ${t('ai.notConfigured')}`}
          </span>
          <span className="ed-ai-stat ed-ai-stat--warn">
            <strong>{ai.stats.pending}</strong> {t('aiBatch.statPending')}
          </span>
          <span className="ed-ai-stat ed-ai-stat--acc">
            <strong>{ai.stats.running}</strong> {t('aiBatch.statRunning')}
          </span>
          <span className="ed-ai-stat ed-ai-stat--ok">
            <strong>{ai.stats.done}</strong> {t('aiBatch.statDone')}
          </span>
        </div>
      </div>

      {!aiReady && ai.providerStatus?.error && (
        <p className="ed-ai-flash is-err" style={{ marginBottom: 12 }}>
          {ai.providerStatus.error}{' '}
          <button type="button" className="ed-btn ed-btn--ghost" onClick={() => navigate('/settings')}>
            {t('ai.openSettings')}
          </button>
        </p>
      )}

      <div className="ed-ai-form" style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <label className="ed-field">
          <span>{t('ai.generateTopic')}</span>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('ai.generateTopicPlaceholder')}
            disabled={ai.running}
          />
        </label>
        <div className="ed-ai-actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="ed-btn ed-btn--accent"
            disabled={ai.running || !topic.trim() || !aiReady}
            onClick={() => void handleGenerate()}
          >
            {ai.running ? t('common.loading') : t('ai.generateArticle')}
          </button>
        </div>
      </div>

      <div className="ed-ai-form">
        <label className="ed-field">
          <span>{t('aiBatch.mode')}</span>
          <select value={ai.mode} onChange={(e) => ai.setMode(e.target.value)} disabled={ai.running}>
            {(ai.modes.length ? ai.modes : ['summarize', 'rewrite', 'tldr', 'translate', 'grammar']).map((m) => (
              <option key={m} value={m}>
                {t(`ai.modes.${m}`, { defaultValue: m })}
              </option>
            ))}
          </select>
        </label>

        <div className="ed-ai-actions">
          <button
            type="button"
            className="ed-btn ed-btn--primary"
            disabled={ai.running || targetId == null || !aiReady}
            onClick={() => targetId != null && void ai.runOnArticle(targetId)}
          >
            {ai.running ? t('common.loading') : t('editorial.ai.runOne', { id: targetId ?? '—' })}
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--accent"
            disabled={ai.running || batchIds.length === 0 || !aiReady}
            onClick={() => void ai.queueArticles(batchIds)}
          >
            {t('editorial.ai.runSelected', { n: batchIds.length })}
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            disabled={ai.running}
            onClick={() => void ai.processPendingQueue()}
          >
            {t('aiBatch.startBatch')}
          </button>
          <button type="button" className="ed-btn ed-btn--ghost" disabled={ai.running} onClick={() => void ai.load()}>
            ↻ {t('common.refresh')}
          </button>
        </div>

        {ai.msg && <p className={`ed-ai-flash${ai.msg.ok ? ' is-ok' : ' is-err'}`}>{ai.msg.text}</p>}
      </div>

      <div className="ed-ai-jobs">
        <h3>{t('ai.jobs')}</h3>
        <div className="ed-ai-jobs-table-wrap">
          <table className="ed-ai-jobs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('pipeline.articleId')}</th>
                <th>{t('aiBatch.mode')}</th>
                <th>{t('articles.colStatus')}</th>
                <th>{t('articles.colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {ai.jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ed-muted">
                    —
                  </td>
                </tr>
              ) : (
                ai.jobs.slice(0, 20).map((j) => (
                  <tr key={j.id}>
                    <td>{j.id}</td>
                    <td>{j.article_id ?? '—'}</td>
                    <td>{j.mode ?? '—'}</td>
                    <td>
                      <span className={`ed-job-badge ed-job-badge--${j.status ?? 'pending'}`}>{j.status ?? '—'}</span>
                    </td>
                    <td className="ed-muted">
                      {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
