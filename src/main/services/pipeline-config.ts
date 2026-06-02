import type { PipelineConfig, PipelineProfile } from '../../shared/pipeline-types';
import { getSetting } from './settings';

export type { PipelineConfig, PipelineProfile };

function flag(key: string, defaultOn = true): boolean {
  const v = getSetting(key);
  if (v === undefined || v === '') return defaultOn;
  return v === '1' || v === 'true';
}

function num(key: string, fallback: number): number {
  const n = Number(getSetting(key));
  return Number.isFinite(n) ? n : fallback;
}

export function loadPipelineConfig(): PipelineConfig {
  const profile = (getSetting('pipeline_default_profile') || 'full') as PipelineProfile;
  const validProfile: PipelineProfile =
    profile === 'light' || profile === 'sanitize_only' ? profile : 'full';

  return {
    enableProofread: flag('pipeline_enable_proofread'),
    enableRewrite: flag('pipeline_enable_rewrite'),
    enableTldr: flag('pipeline_enable_tldr'),
    enableSeoMeta: flag('pipeline_enable_seo_meta'),
    enableTagSentiment: flag('pipeline_enable_tag_sentiment'),
    enableValidate: flag('pipeline_enable_validate'),
    autoSubmitReview: flag('pipeline_auto_submit_review'),
    skipAiIfUnchanged: flag('pipeline_skip_ai_if_unchanged'),
    skipAiIfQualityGte: num('pipeline_skip_ai_if_quality_gte', 85),
    minProofreadScore: num('pipeline_min_proofread_score', 50),
    minValidateScore: num('pipeline_min_validate_score', 60),
    strictQuality: flag('pipeline_strict_quality', false),
    defaultProfile: validProfile,
    maxConcurrent: Math.min(3, Math.max(1, num('pipeline_max_concurrent', 1))),
    aiRetries: Math.min(3, Math.max(0, num('pipeline_ai_retries', 1))),
    useJobQueue: flag('pipeline_use_job_queue'),
    continueOnAiError: flag('pipeline_continue_on_ai_error', true),
  };
}
