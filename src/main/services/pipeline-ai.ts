import { getDb } from '../db/database';
import type { PipelineAiStatus } from '../../shared/pipeline-types';
import { pipelineAiStepsEnabled, isPipelineAiStep, PIPELINE_AI_STEP_MODES } from '../../shared/pipeline-ai';
import { statusAfterStep, type PipelineStep } from '../../shared/pipeline-workflow';
import {
  checkAiProviderReady,
  formatAiErrorMessage,
  getAiProviderLabel,
  getConfiguredAiProvider,
  resolveEffectiveAiProvider,
  resolveModelForProvider,
  runAi,
  type AiMode,
} from './ai';
import { getArticle } from './articles';
import { loadPipelineConfig, type PipelineConfig } from './pipeline-config';
import { isSessionAiDisabled } from './pipeline-session';
import { getSetting } from './settings';
import { articleContentHash } from './pipeline-content';

function logAiRun(opts: {
  articleId: number;
  step: string;
  provider: string;
  model: string;
  inputHash: string;
  ok: boolean;
  skipped: boolean;
  error?: string;
  durationMs: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO pipeline_ai_runs (article_id, step, provider, model, input_hash, ok, skipped, error, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.articleId,
      opts.step,
      opts.provider,
      opts.model,
      opts.inputHash,
      opts.ok ? 1 : 0,
      opts.skipped ? 1 : 0,
      opts.error ?? null,
      opts.durationMs
    );
}

function logStep(articleId: number, step: string, status: string, message?: string): void {
  getDb()
    .prepare(`INSERT INTO article_processing_log (article_id, step, status, message) VALUES (?, ?, ?, ?)`)
    .run(articleId, step, status, message ?? null);
}

function setProcessingStatus(articleId: number, status: string): void {
  getDb()
    .prepare(`UPDATE articles SET processing_status=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, articleId);
}

function shouldSkipAiSteps(article: { pipeline_quality_score?: number | null }, cfg: PipelineConfig): boolean {
  const score = article.pipeline_quality_score ?? 0;
  return cfg.skipAiIfQualityGte > 0 && score >= cfg.skipAiIfQualityGte;
}

function aiStepAlreadyOk(articleId: number, step: PipelineStep, contentHash: string, cfg: PipelineConfig): boolean {
  if (!cfg.skipAiIfUnchanged) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 FROM article_processing_log
       WHERE article_id=? AND step=? AND status='ok' ORDER BY id DESC LIMIT 1`
    )
    .get(articleId, step);
  if (!row) return false;
  const art = getArticle(articleId);
  return (art?.content_hash ?? '') === contentHash && contentHash.length > 0;
}

function aiModeForStep(step: PipelineStep): AiMode | undefined {
  if (!isPipelineAiStep(step)) return undefined;
  return PIPELINE_AI_STEP_MODES[step] as AiMode;
}

export async function getPipelineAiStatus(): Promise<PipelineAiStatus> {
  const configured = getConfiguredAiProvider();
  const effective = resolveEffectiveAiProvider();
  const health = await checkAiProviderReady();
  const cfg = loadPipelineConfig();
  const sessionOff = isSessionAiDisabled();
  // Use the resolved model for the effective provider (respects per-provider setting)
  const model = effective !== 'unconfigured' ? resolveModelForProvider(effective) : ((getSetting('ai_model') ?? '').trim() || null);

  return {
    configuredProvider: configured,
    effectiveProvider: effective,
    provider: effective,
    providerLabel: getAiProviderLabel(effective),
    model,
    providerReady: health.ok,
    ok: health.ok && !sessionOff,
    error: sessionOff
      ? 'تم تعطيل الذكاء الاصطناعي لهذه الجلسة'
      : health.error,
    continueOnAiError: cfg.continueOnAiError,
    sessionDisableAi: sessionOff,
    aiSkippedThisSession: sessionOff,
    aiStepsEnabled: pipelineAiStepsEnabled(cfg),
  };
}

export async function runPipelineAi(
  articleId: number,
  step: PipelineStep,
  cfg: PipelineConfig
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const mode = aiModeForStep(step);
  if (!mode) return { ok: true };

  const article = getArticle(articleId);
  if (!article) return { ok: false, error: 'Not found' };

  const hash = articleContentHash(article.title ?? '', article.content || article.summary || '');
  const provider = resolveEffectiveAiProvider();
  const model = resolveModelForProvider(provider);

  if (isSessionAiDisabled()) {
    logAiRun({
      articleId,
      step,
      provider,
      model,
      inputHash: hash,
      ok: true,
      skipped: true,
      error: 'session: AI disabled from pipeline UI',
      durationMs: 0,
    });
    logStep(articleId, step, 'ok', 'skipped: AI disabled for this session');
    return { ok: true, skipped: true };
  }

  const health = await checkAiProviderReady();
  if (!health.ok) {
    if (cfg.continueOnAiError) {
      logAiRun({
        articleId,
        step,
        provider: health.provider,
        model,
        inputHash: hash,
        ok: true,
        skipped: true,
        error: health.error,
        durationMs: 0,
      });
      logStep(articleId, step, 'ok', `skipped: ${health.error}`);
      return { ok: true, skipped: true };
    }
    return { ok: false, error: health.error };
  }

  if (shouldSkipAiSteps(article, cfg)) {
    logAiRun({
      articleId,
      step,
      provider,
      model,
      inputHash: hash,
      ok: true,
      skipped: true,
      durationMs: 0,
    });
    logStep(articleId, step, 'ok', 'skipped: high quality score');
    return { ok: true, skipped: true };
  }

  if (aiStepAlreadyOk(articleId, step, hash, cfg)) {
    logAiRun({
      articleId,
      step,
      provider,
      model,
      inputHash: hash,
      ok: true,
      skipped: true,
      durationMs: 0,
    });
    logStep(articleId, step, 'ok', 'skipped: content unchanged');
    return { ok: true, skipped: true };
  }

  const started = Date.now();
  const r = await runAi(articleId, mode, cfg.aiRetries);
  const durationMs = Date.now() - started;

  logAiRun({
    articleId,
    step,
    provider: health.provider,
    model,
    inputHash: hash,
    ok: r.ok,
    skipped: false,
    error: r.error,
    durationMs,
  });

  if (r.ok && step === 'rewrite') {
    const updated = getArticle(articleId);
    if (updated) {
      const newHash = articleContentHash(updated.title ?? '', updated.content ?? '');
      getDb()
        .prepare(`UPDATE articles SET content_hash=? WHERE id=?`)
        .run(newHash, articleId);
    }
  }

  if (!r.ok && cfg.continueOnAiError) {
    const msg = formatAiErrorMessage(r.error);
    logStep(articleId, step, 'ok', `skipped: ${msg}`);
    return { ok: true, skipped: true };
  }

  if (!r.ok && r.error) {
    return { ok: false, error: formatAiErrorMessage(r.error) };
  }

  return r;
}

export function skipAiStepAndAdvance(
  articleId: number,
  step: PipelineStep,
  active: PipelineStep[],
  reason: string
): { ok: true; skipped: true } {
  logStep(articleId, step, 'ok', `skipped: ${reason}`);
  const next = statusAfterStep(step, active);
  setProcessingStatus(articleId, next);
  return { ok: true, skipped: true };
}
