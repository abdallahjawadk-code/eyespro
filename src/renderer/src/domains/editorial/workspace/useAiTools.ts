import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiResult } from '../../../../../shared/api-types';

export type AiJobRow = {
  id: number;
  job_type?: string;
  payload_json?: string;
  status?: string;
  progress?: number;
  error?: string;
  created_at?: string;
  article_id?: number;
  mode?: string;
};

export type AiProviderStatus = {
  ok: boolean;
  provider: string;
  error?: string;
};

function parseJob(row: Record<string, unknown>): AiJobRow {
  const base: AiJobRow = {
    id: Number(row.id),
    job_type: row.job_type as string | undefined,
    payload_json: row.payload_json as string | undefined,
    status: row.status as string | undefined,
    progress: row.progress as number | undefined,
    error: row.error as string | undefined,
    created_at: row.created_at as string | undefined,
  };
  if (base.payload_json) {
    try {
      const p = JSON.parse(base.payload_json) as { articleIds?: number[]; mode?: string };
      if (p.articleIds?.length) base.article_id = p.articleIds[0];
      if (p.mode) base.mode = p.mode;
    } catch {
      /* ignore */
    }
  }
  return base;
}

export function useAiTools(t: (key: string, opts?: Record<string, unknown>) => string) {
  const [modes, setModes] = useState<string[]>([]);
  const [jobs, setJobs] = useState<AiJobRow[]>([]);
  const [mode, setMode] = useState('summarize');
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);

  const load = useCallback(async () => {
    const [m, j, st] = await Promise.all([
      window.eyespro.ai.modes().catch(() => ({ ok: false, data: [] as string[] })),
      window.eyespro.ai.jobs().catch(() => ({ ok: false, data: [] as unknown[] })),
      window.eyespro.ai.status().catch(() => ({ ok: false, error: t('ai.failed') })) as Promise<ApiResult<{ ok: boolean; provider: string; error?: string }>>,
    ]);
    if (m.ok && m.data) setModes(m.data as string[]);
    if (j.ok && j.data) {
      const rows = (j.data as Record<string, unknown>[])
        .map(parseJob)
        .filter((row) => row.job_type === 'ai_batch' || row.mode);
      setJobs(rows);
    }
    if (st.ok && st.data) {
      setProviderStatus(st.data as AiProviderStatus);
    } else {
      setProviderStatus({ ok: false, provider: 'unconfigured', error: st.error ?? t('ai.failed') });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const pending = jobs.filter((j) => j.status === 'pending').length;
    const runningCount = jobs.filter((j) => j.status === 'running').length;
    const done = jobs.filter((j) => j.status === 'done' || j.status === 'completed').length;
    return { pending, running: runningCount, done };
  }, [jobs]);

  const runOnArticle = useCallback(
    async (articleId: number) => {
      if (!providerStatus?.ok) {
        setMsg({ ok: false, text: providerStatus?.error ?? t('ai.notConfigured') });
        return false;
      }
      setRunning(true);
      setMsg(null);
      const res = await window.eyespro.ai.run(articleId, mode);
      setRunning(false);
      if (res.ok) {
        setMsg({ ok: true, text: res.data?.result?.slice(0, 120) ?? t('ai.done') });
        void load();
        return true;
      }
      setMsg({ ok: false, text: res.error ?? t('ai.failed') });
      return false;
    },
    [load, mode, providerStatus, t]
  );

  const generateFromTopic = useCallback(
    async (topic: string) => {
      const trimmed = topic.trim();
      if (!trimmed) {
        setMsg({ ok: false, text: t('ai.topicRequired') });
        return null;
      }
      if (!providerStatus?.ok) {
        setMsg({ ok: false, text: providerStatus?.error ?? t('ai.notConfigured') });
        return null;
      }
      setRunning(true);
      setMsg(null);
      const res = await window.eyespro.ai.generateArticle(trimmed, { style: 'news', language: 'ar' });
      setRunning(false);
      if (res.ok && res.data?.articleId) {
        setMsg({ ok: true, text: t('ai.articleGenerated', { title: res.data.title ?? `#${res.data.articleId}` }) });
        return res.data.articleId;
      }
      setMsg({ ok: false, text: res.error ?? t('ai.failed') });
      return null;
    },
    [providerStatus, t]
  );

  const queueArticles = useCallback(
    async (articleIds: number[]) => {
      if (!articleIds.length) return false;
      if (!providerStatus?.ok) {
        setMsg({ ok: false, text: providerStatus?.error ?? t('ai.notConfigured') });
        return false;
      }
      setRunning(true);
      setMsg(null);
      const created = await window.eyespro.ai.createBatch(articleIds, mode);
      if (!created.ok) {
        setRunning(false);
        setMsg({ ok: false, text: created.error ?? t('ai.failed') });
        return false;
      }
      const processed = await window.eyespro.ai.processJobs();
      setRunning(false);
      if (processed.ok) {
        const n = (processed.data as { processed?: number })?.processed ?? 0;
        setMsg({ ok: true, text: t('aiBatch.batchDone') + (n ? ` (${n})` : '') });
        void load();
        return true;
      }
      setMsg({ ok: false, text: processed.error ?? t('ai.failed') });
      void load();
      return false;
    },
    [load, mode, providerStatus, t]
  );

  const processPendingQueue = useCallback(async () => {
    setRunning(true);
    setMsg(null);
    const res = await window.eyespro.ai.processJobs();
    setRunning(false);
    setMsg({
      ok: !!res.ok,
      text: res.ok ? t('aiBatch.batchDone') : (res.error ?? t('ai.failed')),
    });
    void load();
    return !!res.ok;
  }, [load, t]);

  return {
    modes,
    mode,
    setMode,
    jobs,
    stats,
    running,
    msg,
    providerStatus,
    load,
    runOnArticle,
    generateFromTopic,
    queueArticles,
    processPendingQueue,
  };
}
