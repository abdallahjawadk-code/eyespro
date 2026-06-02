import { describe, it, expect } from 'vitest';
import {
  PIPELINE_AI_STEPS,
  isPipelineAiStep,
  pipelineAiStepsEnabled,
} from '../src/shared/pipeline-ai';
import type { PipelineConfig } from '../src/shared/pipeline-types';

const cfg: PipelineConfig = {
  enableProofread: true,
  enableRewrite: true,
  enableTldr: true,
  enableSeoMeta: true,
  enableTagSentiment: true,
  enableValidate: true,
  autoSubmitReview: false,
  skipAiIfUnchanged: false,
  skipAiIfQualityGte: 0,
  minProofreadScore: 50,
  minValidateScore: 60,
  strictQuality: false,
  defaultProfile: 'full',
  maxConcurrent: 1,
  aiRetries: 0,
  useJobQueue: true,
  continueOnAiError: true,
};

describe('pipeline AI steps (shared)', () => {
  it('lists the four AI-powered pipeline stages', () => {
    expect(PIPELINE_AI_STEPS).toEqual(['rewrite', 'tldr', 'seo_meta', 'tag_sentiment']);
  });

  it('recognises AI steps only', () => {
    expect(isPipelineAiStep('rewrite')).toBe(true);
    expect(isPipelineAiStep('sanitize')).toBe(false);
  });

  it('detects when any AI stage is enabled in config', () => {
    expect(pipelineAiStepsEnabled(cfg)).toBe(true);
    expect(
      pipelineAiStepsEnabled({
        ...cfg,
        enableRewrite: false,
        enableTldr: false,
        enableSeoMeta: false,
        enableTagSentiment: false,
      })
    ).toBe(false);
  });
});
