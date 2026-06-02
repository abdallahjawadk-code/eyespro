import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiStatus,
  BulkProgress,
  KanbanArticle,
  PipelineArticleDetail,
  PipelineConfig,
  PipelineJob,
  PipelinePreviewItem,
  PipelineProfileId,
  PipelineQueueStats,
  PipelineStep,
  Toast,
} from './types';
import { PIPELINE_STEPS } from './types';
import { PIPELINE_AI_STEPS, isPipelineAiStep as isSharedPipelineAiStep } from '../../../../../../shared/pipeline-ai';

export { PIPELINE_AI_STEPS };

export function usePipeline(t: (key: string, opts?: Record<string, unknown>) => string) {
  const [kanban, setKanban] = useState<Record<string, KanbanArticle[]>>({});
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [queueStats, setQueueStats] = useState<PipelineQueueStats | null>(null);
  const [sessionDisableAi, setSessionDisableAi] = useState(false);
  const [batchProfile, setBatchProfile] = useState<PipelineProfileId | ''>('');
  const [loading, setLoading] = useState(true);
  const [processInput, setProcessInput] = useState('');
  const [autoLimit, setAutoLimit] = useState('20');
  const [runningId, setRunningId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState<BulkProgress | null>(null);
  const [preview, _setPreview] = useState<PipelinePreviewItem[] | null>(null);
  const [previewTotal, _setPreviewTotal] = useState(0);
  const [previewLoading, _setPreviewLoading] = useState(false);
  const [drawerArticleId, setDrawerArticleId] = useState<number | null>(null);
  const [articleDetail, setArticleDetail] = useState<PipelineArticleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((text: string, ok: boolean) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, ok, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  const load = useCallback(async () => {
    const [k, j, ai, cfg, qs, sess] = await Promise.all([
      window.eyespro.pipeline.kanban().catch(() => ({ ok: false, data: {} })),
      window.eyespro.pipeline.jobs(40).catch(() => ({ ok: false, data: [] })),
      window.eyespro.pipeline.aiStatus().catch(() => ({ ok: false, data: null })),
      window.eyespro.pipeline.config().catch(() => ({ ok: false, data: null })),
      window.eyespro.pipeline.queueStats().catch(() => ({ ok: false, data: null })),
      window.eyespro.pipeline.session().catch(() => ({ ok: false, data: null })),
    ]);
    if (k.ok && k.data) setKanban(k.data as Record<string, KanbanArticle[]>);
    if (j.ok && j.data) setJobs(j.data as PipelineJob[]);
    if (ai.ok && ai.data) setAiStatus(ai.data as AiStatus);
    if (cfg.ok && cfg.data) setConfig(cfg.data as PipelineConfig);
    if (qs.ok && qs.data) setQueueStats(qs.data as PipelineQueueStats);
    if (sess.ok && sess.data) setSessionDisableAi(!!(sess.data as { disableAi: boolean }).disableAi);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsub = window.eyespro.on?.('pipeline:progress', (p: BulkProgress) => {
      setProcessProgress(p);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => void load(), 2500);
    return () => clearInterval(id);
  }, [processing, load]);

  const openArticleDrawer = useCallback(async (articleId: number) => {
    setDrawerArticleId(articleId);
    setDetailLoading(true);
    setArticleDetail(null);
    const res = await window.eyespro.pipeline.articleDetail(articleId);
    if (res.ok && res.data) setArticleDetail(res.data as PipelineArticleDetail);
    setDetailLoading(false);
  }, []);

  const closeArticleDrawer = useCallback(() => {
    setDrawerArticleId(null);
    setArticleDetail(null);
  }, []);

  const toggleSessionAi = useCallback(async () => {
    const next = !sessionDisableAi;
    const res = await window.eyespro.pipeline.setSessionDisableAi(next);
    if (res.ok && res.data) {
      setSessionDisableAi(!!(res.data as { disableAi: boolean }).disableAi);
      pushToast(t(next ? 'pipeline.sessionAiOff' : 'pipeline.sessionAiOn'), true);
      const ai = await window.eyespro.pipeline.aiStatus();
      if (ai.ok && ai.data) setAiStatus(ai.data as AiStatus);
    }
  }, [sessionDisableAi, pushToast, t]);

  const setArticleProfile = useCallback(
    async (articleId: number, profile: PipelineProfileId) => {
      const res = await window.eyespro.pipeline.setProfile(articleId, profile);
      if (res.ok) {
        pushToast(t('pipeline.profileUpdated'), true);
        void load();
        if (drawerArticleId === articleId) void openArticleDrawer(articleId);
      } else {
        pushToast(res.error ?? t('pipeline.failed'), false);
      }
    },
    [drawerArticleId, load, openArticleDrawer, pushToast, t]
  );

  const stats = useMemo(() => {
    const byStep: Record<string, number> = {};
    for (const s of PIPELINE_STEPS) byStep[s] = (kanban[s] ?? []).length;
    const total = Object.values(byStep).reduce((a, b) => a + b, 0);
    return {
      total,
      inbox: byStep.sanitize ?? 0,
      ready: byStep.ready ?? 0,
      activeJobs: jobs.filter((j) => j.status === 'pending' || j.status === 'running').length,
      failedJobs: jobs.filter((j) => j.status === 'failed').length,
      byStep,
    };
  }, [kanban, jobs]);

  const runStep = useCallback(
    async (articleIdNum: number, step: PipelineStep) => {
      setRunningId(articleIdNum);
      const res = await window.eyespro.pipeline.runStep(articleIdNum, step);
      setRunningId(null);
      pushToast(
        res.ok
          ? t('pipeline.stepDone', { step: t(`pipeline.steps.${step}`) })
          : (res.error ?? t('pipeline.failed')),
        !!res.ok
      );
      void load();
    },
    [load, pushToast, t]
  );

  const cancelJob = useCallback(
    async (jobId: number) => {
      await window.eyespro.pipeline.cancelJob(jobId);
      pushToast(t('pipeline.jobCancelled'), true);
      void load();
    },
    [load, pushToast, t]
  );

  const retryJob = useCallback(
    async (jobId: number) => {
      const res = await window.eyespro.pipeline.retryJob(jobId);
      if (res.ok && (res.data as { retried: boolean }).retried) {
        pushToast(t('pipeline.jobRetried'), true);
      } else {
        pushToast(t('pipeline.failed'), false);
      }
      void load();
    },
    [load, pushToast, t]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  const runBatchArticles = useCallback(
    async (opts: { articleIds?: number[]; limit?: number; profile?: PipelineProfileId | '' }) => {
      setProcessing(true);
      setProcessProgress(null);
      try {
        const aiRes = await window.eyespro.pipeline.aiStatus();
        const aiSt = (aiRes.ok ? aiRes.data : null) as AiStatus | null;
        if (
          aiSt &&
          !aiSt.providerReady &&
          !aiSt.sessionDisableAi &&
          (config?.enableRewrite || config?.enableTldr || config?.enableSeoMeta || config?.enableTagSentiment)
        ) {
          pushToast(
            aiSt.error ?? t('pipeline.aiWillSkipWarning'),
            false
          );
        }

        const profile = opts.profile || undefined;
        const res = opts.articleIds?.length
          ? await window.eyespro.pipeline.runArticles(opts.articleIds, profile)
          : await window.eyespro.pipeline.runBulk(
              opts.limit ?? Math.max(1, Number.parseInt(autoLimit, 10) || 20),
              profile
            );

        if (!res.ok) {
          pushToast(res.error ?? t('pipeline.failed'), false);
          return false;
        }

        const data = (res.data ?? {}) as { processed?: number; failed?: number; skipped?: number };
        const processed = data.processed ?? 0;
        const failed = data.failed ?? 0;
        const skipped = data.skipped ?? 0;
        const total = opts.articleIds?.length ?? processed + failed + skipped;

        if (processed > 0) {
          pushToast(
            t('pipeline.runDoneIds', { processed, failed, total: total || processed + failed }),
            failed === 0
          );
        } else if (failed > 0) {
          pushToast(t('pipeline.failed'), false);
        } else if (skipped > 0) {
          pushToast(t('pipeline.nothingToProcess'), false);
        } else {
          pushToast(t('pipeline.nothingToProcess'), false);
        }

        await load();
        return processed > 0;
      } catch {
        pushToast(t('common.connectionError'), false);
        return false;
      } finally {
        setProcessing(false);
        setProcessProgress(null);
      }
    },
    [autoLimit, config, load, pushToast, t]
  );

  const runFullArticle = useCallback(
    async (articleId: number) => {
      setRunningId(articleId);
      setProcessing(true);
      try {
        const res = await window.eyespro.pipeline.runFull(articleId);
        if (res.ok) {
          pushToast(t('pipeline.done'), true);
          await load();
          return true;
        }
        pushToast(res.error ?? t('pipeline.failed'), false);
        await load();
        return false;
      } catch {
        pushToast(t('common.connectionError'), false);
        return false;
      } finally {
        setRunningId(null);
        setProcessing(false);
      }
    },
    [load, pushToast, t]
  );

  const isPipelineAiStep = useCallback(
    (mode: string): mode is PipelineStep => isSharedPipelineAiStep(mode),
    []
  );

  const retryAllFailed = useCallback(async () => {
    const res = await window.eyespro.pipeline.retryFailed();
    if (res.ok && res.data) {
      const n = (res.data as { retried?: number }).retried ?? 0;
      pushToast(t('pipeline.retried', { count: n }), n > 0);
      void load();
    } else {
      pushToast(res.error ?? t('pipeline.failed'), false);
    }
  }, [load, pushToast, t]);

  const dismissAllFailed = useCallback(async () => {
    const res = await window.eyespro.pipeline.dismissFailed();
    if (res.ok) {
      pushToast(t('pipeline.dismissed'), true);
      void load();
    }
  }, [load, pushToast, t]);

  return {
    kanban,
    jobs,
    config,
    aiStatus,
    queueStats,
    sessionDisableAi,
    batchProfile,
    setBatchProfile,
    loading,
    stats,
    processInput,
    setProcessInput,
    autoLimit,
    setAutoLimit,
    runningId,
    processing,
    setProcessing,
    processProgress,
    preview,
    previewTotal,
    previewLoading,
    drawerArticleId,
    articleDetail,
    detailLoading,
    toasts,
    runStep,
    cancelJob,
    retryJob,
    retryAllFailed,
    dismissAllFailed,
    toggleSessionAi,
    setArticleProfile,
    openArticleDrawer,
    closeArticleDrawer,
    refresh,
    runBatchArticles,
    runFullArticle,
    isPipelineAiStep,
  };
}
