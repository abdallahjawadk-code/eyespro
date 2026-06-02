/** Shared pipeline types — safe for main process, renderer, and tests. */

export type PipelineProfile = 'full' | 'light' | 'sanitize_only';

export type PipelineConfig = {
  enableProofread: boolean;
  enableRewrite: boolean;
  enableTldr: boolean;
  enableSeoMeta: boolean;
  enableTagSentiment: boolean;
  enableValidate: boolean;
  autoSubmitReview: boolean;
  skipAiIfUnchanged: boolean;
  skipAiIfQualityGte: number;
  minProofreadScore: number;
  minValidateScore: number;
  strictQuality: boolean;
  defaultProfile: PipelineProfile;
  maxConcurrent: number;
  aiRetries: number;
  useJobQueue: boolean;
  continueOnAiError: boolean;
};

export type PipelineAiStatus = {
  /** Explicit `ai_provider` setting; null = auto-detect from keys / Ollama. */
  configuredProvider: string | null;
  /** Provider that will actually run requests. */
  effectiveProvider: string;
  /** Same as effectiveProvider (legacy UI field). */
  provider: string;
  providerLabel: string;
  model: string | null;
  providerReady: boolean;
  ok: boolean;
  error?: string;
  continueOnAiError: boolean;
  sessionDisableAi: boolean;
  aiSkippedThisSession: boolean;
  aiStepsEnabled: boolean;
};
