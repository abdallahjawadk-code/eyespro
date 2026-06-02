import { describe, it, expect } from 'vitest';
import {
  computeRetrySteps,
  stepsFromStatus,
  statusAfterStep,
  getActivePipelineSteps,
  PIPELINE_STEPS,
} from '../src/shared/pipeline-workflow';
import type { PipelineConfig } from '../src/shared/pipeline-types';

const fullCfg: PipelineConfig = {
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

describe('pipeline stepsFromStatus', () => {
  it('returns empty when article is ready', () => {
    expect(stepsFromStatus('ready', fullCfg, 'full')).toEqual([]);
  });

  it('returns full active path from new', () => {
    const steps = stepsFromStatus('new', fullCfg, 'full');
    expect(steps).toContain('sanitize');
    expect(steps).toContain('ready');
    expect(steps[0]).toBe('sanitize');
  });

  it('resumes from current status', () => {
    const steps = stepsFromStatus('rewrite', fullCfg, 'full');
    expect(steps[0]).toBe('rewrite');
    expect(steps).not.toContain('sanitize');
  });
});

describe('pipeline statusAfterStep', () => {
  it('advances to next step in profile', () => {
    const active = getActivePipelineSteps(fullCfg, 'full');
    expect(statusAfterStep('sanitize', active)).toBe('proofread');
  });

  it('ends at ready after last step', () => {
    const active = getActivePipelineSteps(fullCfg, 'sanitize_only');
    const last = active[active.length - 2];
    expect(statusAfterStep(last, active)).toBe('ready');
  });
});

describe('pipeline light profile', () => {
  it('excludes rewrite', () => {
    const steps = getActivePipelineSteps(fullCfg, 'light');
    expect(steps).not.toContain('rewrite');
    expect(steps).toContain('tldr');
  });
});

describe('computeRetrySteps', () => {
  const steps = [...PIPELINE_STEPS];

  it('retries from failed current_step', () => {
    const remaining = computeRetrySteps(steps, 'rewrite', 3);
    expect(remaining[0]).toBe('rewrite');
    expect(remaining).toContain('ready');
  });

  it('retries from progress_done when no current_step', () => {
    const remaining = computeRetrySteps(steps, null, 4);
    expect(remaining[0]).toBe(steps[4]);
  });

  it('retries all when at start', () => {
    const remaining = computeRetrySteps(steps, null, 0);
    expect(remaining.length).toBe(steps.length);
  });
});
