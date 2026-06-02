import type { PipelineConfig } from './pipeline-types';
import type { PipelineStep } from './pipeline-workflow';

/** AI-powered stages inside the production pipeline. */
export const PIPELINE_AI_STEPS = ['rewrite', 'tldr', 'seo_meta', 'tag_sentiment'] as const;

export type PipelineAiStep = (typeof PIPELINE_AI_STEPS)[number];

export const PIPELINE_AI_STEP_MODES: Record<PipelineAiStep, string> = {
  rewrite: 'rewrite',
  tldr: 'tldr',
  seo_meta: 'seo_meta',
  tag_sentiment: 'tag_sentiment',
};

export function isPipelineAiStep(step: string): step is PipelineAiStep {
  return (PIPELINE_AI_STEPS as readonly string[]).includes(step);
}

export function isPipelineAiStepType(step: PipelineStep): step is PipelineAiStep {
  return isPipelineAiStep(step);
}

export function pipelineAiStepsEnabled(
  cfg: Pick<PipelineConfig, 'enableRewrite' | 'enableTldr' | 'enableSeoMeta' | 'enableTagSentiment'>
): boolean {
  return cfg.enableRewrite || cfg.enableTldr || cfg.enableSeoMeta || cfg.enableTagSentiment;
}
