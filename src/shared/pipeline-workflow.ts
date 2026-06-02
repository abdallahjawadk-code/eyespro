import type { PipelineConfig, PipelineProfile } from './pipeline-types';

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

const STEP_SET = new Set<string>(PIPELINE_STEPS);

function normalizeStatus(raw: string | null | undefined): PipelineStep | 'new' {
  const s = (raw || 'new').trim();
  if (s === 'new') return 'new';
  if (STEP_SET.has(s)) return s as PipelineStep;
  return 'new';
}

export function statusAfterStep(step: PipelineStep, activeSteps: PipelineStep[]): PipelineStep {
  const idx = activeSteps.indexOf(step);
  if (idx < 0) return activeSteps[0] ?? 'sanitize';
  const next = activeSteps[idx + 1];
  return next ?? 'ready';
}

export function getActivePipelineSteps(cfg: PipelineConfig, profile?: PipelineProfile): PipelineStep[] {
  const prof = profile ?? cfg.defaultProfile;

  let steps: PipelineStep[] = PIPELINE_STEPS.filter((s) => {
    if (s === 'sanitize' || s === 'ready') return true;
    if (s === 'proofread') return cfg.enableProofread;
    if (s === 'validate') return cfg.enableValidate;
    if (s === 'rewrite') return cfg.enableRewrite;
    if (s === 'tldr') return cfg.enableTldr;
    if (s === 'seo_meta') return cfg.enableSeoMeta;
    if (s === 'tag_sentiment') return cfg.enableTagSentiment;
    return false;
  });

  if (prof === 'sanitize_only') {
    steps = steps.filter((s) => ['sanitize', 'proofread', 'validate', 'ready'].includes(s));
  } else if (prof === 'light') {
    steps = steps.filter((s) => s !== 'rewrite');
  }

  return steps;
}

export function stepsFromStatus(
  raw: string | null | undefined,
  cfg: PipelineConfig,
  profile?: PipelineProfile
): PipelineStep[] {
  const active = getActivePipelineSteps(cfg, profile);
  const status = normalizeStatus(raw);
  if (status === 'new') return active;
  if (status === 'ready') return [];
  const idx = active.indexOf(status);
  if (idx < 0) return active;
  return active.slice(idx);
}

export function computeRetrySteps(
  steps: PipelineStep[],
  currentStep: string | null,
  progressDone: number
): PipelineStep[] {
  if (!steps.length) return [];
  if (currentStep) {
    const idx = steps.indexOf(currentStep as PipelineStep);
    if (idx >= 0) return steps.slice(idx);
  }
  const done = Math.max(0, progressDone);
  if (done > 0 && done < steps.length) return steps.slice(done);
  return steps;
}
