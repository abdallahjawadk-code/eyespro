export const PIPELINE_STEPS = [
  'sanitize',
  'proofread',
  'rewrite',
  'tldr',
  'seo_meta',
  'tag_sentiment',
  'validate',
  'ready',
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export type PipelineProfileId = 'full' | 'light' | 'sanitize_only';

export const PIPELINE_PROFILES: PipelineProfileId[] = ['full', 'light', 'sanitize_only'];

export const STEP_META: Record<
  PipelineStep,
  { icon: string; color: string; label: string; ai?: boolean }
> = {
  sanitize: { icon: '🧹', color: '#38bdf8', label: 'Sanitize' },
  proofread: { icon: '🔎', color: '#0ea5e9', label: 'Proofread' },
  rewrite: { icon: '✍️', color: '#6366f1', label: 'Rewrite', ai: true },
  tldr: { icon: '📝', color: '#8b5cf6', label: 'Summary', ai: true },
  seo_meta: { icon: '🔍', color: '#f59e0b', label: 'SEO', ai: true },
  tag_sentiment: { icon: '🏷️', color: '#a855f7', label: 'Sentiment', ai: true },
  validate: { icon: '✅', color: '#10b981', label: 'Validate' },
  ready: { icon: '🚀', color: '#22c55e', label: 'Ready' },
};

export type KanbanArticle = {
  id: number;
  title: string;
  processing_status?: string | null;
  pipeline_quality_score?: number | null;
  pipeline_profile?: string | null;
  updated_at?: string;
};

export type PipelineJob = {
  id: number;
  article_id: number;
  status: string;
  current_step: string | null;
  error: string | null;
  progress_done: number;
  progress_total: number;
};

export type BulkProgress = {
  articleId: number;
  step: PipelineStep;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  error?: string;
  done: number;
  total: number;
  jobId?: number;
  stepIndex?: number;
  stepTotal?: number;
};

export type AiStatus = {
  ok: boolean;
  provider: string;
  configuredProvider?: string | null;
  effectiveProvider?: string;
  providerLabel?: string;
  model?: string | null;
  providerReady?: boolean;
  error?: string;
  continueOnAiError?: boolean;
  sessionDisableAi?: boolean;
  aiSkippedThisSession?: boolean;
  aiStepsEnabled?: boolean;
};

export type PipelineConfig = {
  enableProofread: boolean;
  enableRewrite: boolean;
  enableTldr: boolean;
  enableSeoMeta: boolean;
  enableTagSentiment: boolean;
  enableValidate: boolean;
  autoSubmitReview: boolean;
  useJobQueue: boolean;
  continueOnAiError: boolean;
  defaultProfile: string;
  maxConcurrent?: number;
  sessionDisableAi?: boolean;
};

export type PipelinePreviewItem = {
  articleId: number;
  title: string;
  status: string;
  profile: PipelineProfileId;
  steps: PipelineStep[];
  ready: boolean;
};

export type PipelineArticleDetail = {
  article: {
    id: number;
    title: string;
    processing_status: string | null;
    pipeline_profile: string | null;
    pipeline_quality_score: number | null;
  };
  remainingSteps: PipelineStep[];
  log: Array<{ step?: string; status?: string; message?: string; created_at?: string }>;
  aiRuns: Array<{
    step?: string;
    ok?: number;
    skipped?: number;
    error?: string;
    provider?: string;
    duration_ms?: number;
    created_at?: string;
  }>;
};

export type PipelineQueueStats = {
  pending: number;
  running: number;
  failed: number;
  stuckPending: number;
};

export type Toast = { id: number; ok: boolean; text: string };
