import { getDb } from '../db/database';
import { getArticle, snapshotOriginalBeforeRewrite } from './articles';
import { tenantSqlClause } from './tenant';
import { deepCleanHtml, deepCleanText } from '../../shared/content-cleaner';
import { applyGlossary } from './glossary';
import { proofreadArticle } from './proofreader';
import { runQualityCheck, submitReview } from './quality';
import { assessFetchedArticle } from './post-fetch-quality';
import { loadPipelineConfig, type PipelineProfile } from './pipeline-config';
import { isSessionAiDisabled } from './pipeline-session';
import { getSetting } from './settings';
import { fireEvent } from './webhooks';
import {
  getPipelineAiStatus,
  runPipelineAi,
  skipAiStepAndAdvance,
} from './pipeline-ai';
import { articleContentHash, hasMeaningfulContent } from './pipeline-content';
import {
  PIPELINE_STEPS,
  statusAfterStep,
  getActivePipelineSteps,
  stepsFromStatus,
  type PipelineStep,
} from '../../shared/pipeline-workflow';
import { isPipelineAiStep } from '../../shared/pipeline-ai';

export { getPipelineAiStatus };
export { PIPELINE_STEPS, statusAfterStep, getActivePipelineSteps, stepsFromStatus };
export type { PipelineStep };
export { articleContentHash };

// v2.0: Pipeline Analytics for performance tracking
export interface PipelineStepPerformance {
  step: PipelineStep;
  avgDurationMs: number;
  successRate: number; // 0-100
  totalRuns: number;
  lastRunAt: string | null;
}

// v2.0: Article priority score for intelligent queue ordering
export interface ArticlePriority {
  articleId: number;
  score: number; // 0-100
  factors: {
    freshness: number;    // newer = higher
    quality: number;      // better source quality = higher
    trendPotential: number; // linked to trend = higher
    contentCompleteness: number; // has content/summary = higher
  };
}

const STEP_SET = new Set<string>(PIPELINE_STEPS as unknown as string[]);

export type PipelineProgress = {
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

export type PipelinePreviewItem = {
  articleId: number;
  title: string;
  status: string;
  profile: PipelineProfile;
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
  log: unknown[];
  aiRuns: unknown[];
};

/**
 * v2.0: Enhanced step logging with performance tracking
 */
const stepTimings = new Map<number, number>(); // articleId -> startTime

function logStepStart(articleId: number): void {
  stepTimings.set(articleId, Date.now());
}

function logStep(articleId: number, step: string, status: string, message?: string): void {
  const startedAt = stepTimings.get(articleId);
  const durationMs = startedAt ? Date.now() - startedAt : undefined;
  
  getDb()
    .prepare(`INSERT INTO article_processing_log (article_id, step, status, message, duration_ms) VALUES (?, ?, ?, ?, ?)`)
    .run(articleId, step, status, message ?? null, durationMs ?? null);
  
  // Clear timing after logging
  if (status === 'ok' || status === 'failed') {
    stepTimings.delete(articleId);
  }
}

/**
 * v2.0: Get pipeline performance analytics
 */
export function getPipelinePerformance(): PipelineStepPerformance[] {
  const db = getDb();
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const rows = db.prepare(`
    SELECT 
      step,
      COUNT(*) as total,
      AVG(CASE WHEN status = 'ok' THEN duration_ms END) as avg_duration,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as success_count,
      MAX(created_at) as last_run
    FROM article_processing_log
    WHERE created_at > ? AND duration_ms IS NOT NULL
    GROUP BY step
  `).all(last24h) as Array<{
    step: string;
    total: number;
    avg_duration: number | null;
    success_count: number;
    last_run: string;
  }>;
  
  return rows.map(r => ({
    step: r.step as PipelineStep,
    avgDurationMs: Math.round(r.avg_duration || 0),
    successRate: Math.round((r.success_count / r.total) * 100),
    totalRuns: r.total,
    lastRunAt: r.last_run,
  }));
}

function setProcessingStatus(articleId: number, status: string): void {
  getDb()
    .prepare(`UPDATE articles SET processing_status=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, articleId);
}

function profileForArticle(article: { pipeline_profile?: string | null }): PipelineProfile {
  const p = (article.pipeline_profile || getSetting('pipeline_default_profile') || 'full') as PipelineProfile;
  return p === 'light' || p === 'sanitize_only' ? p : 'full';
}

export function stepsForArticle(articleId: number): PipelineStep[] {
  const article = getArticle(articleId);
  if (!article) return [];
  const profile = profileForArticle(article);
  return stepsFromStatus(article.processing_status ?? 'new', loadPipelineConfig(), profile);
}

function previewItem(articleId: number): PipelinePreviewItem | null {
  const article = getArticle(articleId);
  if (!article) return null;
  const profile = profileForArticle(article);
  const steps = stepsForArticle(articleId);
  return {
    articleId,
    title: article.title || `#${articleId}`,
    status: article.processing_status ?? 'new',
    profile,
    steps,
    ready: steps.length === 0,
  };
}

export function previewPipelineArticles(articleIds: number[]): PipelinePreviewItem[] {
  const out: PipelinePreviewItem[] = [];
  for (const id of [...new Set(articleIds)]) {
    const item = previewItem(id);
    if (item) out.push(item);
  }
  return out;
}

export function previewPipelineAuto(limit: number): {
  items: PipelinePreviewItem[];
  totalCandidates: number;
} {
  const tenant = tenantSqlClause();
  const capped = Math.min(Math.max(1, limit), 100);
  const countRow = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM articles
       WHERE COALESCE(processing_status, 'new') != 'ready'${tenant.sql}`
    )
    .get(...tenant.params) as { c: number };

  const rows = getDb()
    .prepare(
      `SELECT id FROM articles
       WHERE COALESCE(processing_status, 'new') != 'ready'${tenant.sql}
       ORDER BY
         CASE COALESCE(processing_status, 'new')
           WHEN 'new' THEN 0 WHEN 'sanitize' THEN 1 WHEN 'proofread' THEN 2
           WHEN 'rewrite' THEN 3 WHEN 'tldr' THEN 4 WHEN 'seo_meta' THEN 5
           WHEN 'tag_sentiment' THEN 6 WHEN 'validate' THEN 7 ELSE 8
         END, id ASC
       LIMIT ?`
    )
    .all(...tenant.params, capped) as { id: number }[];

  return {
    items: rows.map((r) => previewItem(r.id)).filter((x): x is PipelinePreviewItem => x != null),
    totalCandidates: countRow.c ?? 0,
  };
}

export function articlePipelineDetail(articleId: number): PipelineArticleDetail | null {
  const article = getArticle(articleId);
  if (!article) return null;
  const log = processingLog(articleId);
  const aiRuns = getDb()
    .prepare(`SELECT * FROM pipeline_ai_runs WHERE article_id=? ORDER BY created_at DESC LIMIT 50`)
    .all(articleId);
  return {
    article: {
      id: article.id,
      title: article.title,
      processing_status: article.processing_status ?? null,
      pipeline_profile: article.pipeline_profile ?? null,
      pipeline_quality_score: article.pipeline_quality_score ?? null,
    },
    remainingSteps: stepsForArticle(articleId),
    log,
    aiRuns,
  };
}

export function setArticlePipelineProfile(articleId: number, profile: PipelineProfile): boolean {
  if (profile !== 'full' && profile !== 'light' && profile !== 'sanitize_only') return false;
  const art = getArticle(articleId);
  if (!art) return false;
  getDb()
    .prepare(`UPDATE articles SET pipeline_profile=?, updated_at=datetime('now') WHERE id=?`)
    .run(profile, articleId);
  return true;
}

export function setArticlesPipelineProfile(articleIds: number[], profile: PipelineProfile): number {
  let n = 0;
  for (const id of articleIds) {
    if (setArticlePipelineProfile(id, profile)) n++;
  }
  return n;
}

function notifyPipelineBatch(payload: {
  mode: 'bulk' | 'articles';
  processed: number;
  failed: number;
  skipped: number;
  articleCount?: number;
}): void {
  const event =
    payload.failed > 0 && payload.processed === 0 ? 'pipeline.batch.failed' : 'pipeline.batch.complete';
  fireEvent(event, payload).catch(() => undefined);
}

export type PipelineRunOptions = {
  profile?: PipelineProfile;
};

/**
 * v2.0: Calculate article priority score (0-100) for intelligent queue ordering
 */
export function calculateArticlePriority(article: {
  id: number;
  title: string;
  content: string | null;
  summary: string | null;
  source: string | null;
  trend_id?: number | null;
  created_at: string;
  quality_tier?: string | null;
  pipeline_quality_score?: number | null;
}): ArticlePriority {
  const factors = {
    freshness: 0,
    quality: 0,
    trendPotential: 0,
    contentCompleteness: 0,
  };
  
  // Freshness: newer articles get higher priority (decays over 24 hours)
  const ageHours = (Date.now() - new Date(article.created_at).getTime()) / (1000 * 60 * 60);
  factors.freshness = Math.max(0, Math.min(100, 100 - (ageHours * 4))); // -4 points per hour
  
  // Quality: based on fetch quality tier and pipeline score
  const qualityBonus: Record<string, number> = { ready: 30, draft: 15, review: 5, reject: 0 };
  factors.quality = (article.quality_tier ? qualityBonus[article.quality_tier] : 10) 
    + (article.pipeline_quality_score ? article.pipeline_quality_score * 0.3 : 0);
  
  // Trend potential: articles linked to trends get bonus
  if (article.trend_id) {
    factors.trendPotential = 25;
  } else if (article.source?.includes('تريند') || article.source?.includes('trend')) {
    factors.trendPotential = 15;
  }
  
  // Content completeness
  const contentLength = (article.content?.length || 0) + (article.summary?.length || 0);
  factors.contentCompleteness = Math.min(100, contentLength / 50); // 1 point per 50 chars
  
  // Calculate weighted total
  const score = Math.min(100, Math.round(
    factors.freshness * 0.35 +
    factors.quality * 0.25 +
    factors.trendPotential * 0.25 +
    factors.contentCompleteness * 0.15
  ));
  
  return {
    articleId: article.id,
    score,
    factors: {
      freshness: Math.round(factors.freshness),
      quality: Math.round(factors.quality),
      trendPotential: Math.round(factors.trendPotential),
      contentCompleteness: Math.round(factors.contentCompleteness),
    }
  };
}

/**
 * v2.0: Get kanban with priority scoring for smart sorting
 */
export function kanban(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tenant = tenantSqlClause();
  const active = getActivePipelineSteps(loadPipelineConfig());

  for (const step of active) {
    const statuses = step === 'sanitize' ? ['new', 'sanitize'] : [step];
    const placeholders = statuses.map(() => '?').join(',');
    
    // v2.0: Fetch with additional fields for priority calculation
    const articles = getDb()
      .prepare(
        `SELECT id, title, content, summary, source, trend_id, created_at, 
                quality_tier, pipeline_quality_score, processing_status, pipeline_profile, updated_at
         FROM articles
         WHERE processing_status IN (${placeholders})${tenant.sql}
         ORDER BY created_at DESC LIMIT 100`
      )
      .all(...statuses, ...tenant.params) as Array<{
        id: number; title: string; content: string | null; summary: string | null;
        source: string | null; trend_id: number | null; created_at: string;
        quality_tier: string | null; pipeline_quality_score: number | null;
        processing_status: string; pipeline_profile: string | null; updated_at: string;
      }>;
    
    // v2.0: Calculate priority and sort
    const withPriority = articles.map(article => {
      const priority = calculateArticlePriority(article);
      return {
        ...article,
        priority_score: priority.score,
        priority_factors: priority.factors,
      };
    }).sort((a, b) => b.priority_score - a.priority_score);
    
    // Limit to top 50 after sorting by priority
    out[step] = withPriority.slice(0, 50);
  }
  return out;
}

/**
 * v2.0: Get high-priority articles for quick processing
 */
export function getHighPriorityArticles(limit = 10): Array<ReturnType<typeof calculateArticlePriority>> {
  const tenant = tenantSqlClause();
  const pending = getDb()
    .prepare(
      `SELECT id, title, content, summary, source, trend_id, created_at, 
              quality_tier, pipeline_quality_score
       FROM articles
       WHERE processing_status IN ('new', 'sanitize', 'proofread')${tenant.sql}
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(...tenant.params) as Array<{
      id: number; title: string; content: string | null; summary: string | null;
      source: string | null; trend_id: number | null; created_at: string;
      quality_tier: string | null; pipeline_quality_score: number | null;
    }>;
  
  return pending
    .map(calculateArticlePriority)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function processingLog(articleId: number) {
  const art = getArticle(articleId);
  if (!art) return [];
  return getDb()
    .prepare(`SELECT * FROM article_processing_log WHERE article_id=? ORDER BY created_at DESC LIMIT 100`)
    .all(articleId);
}

export function getPipelineConfig() {
  return {
    ...loadPipelineConfig(),
    sessionDisableAi: isSessionAiDisabled(),
  };
}

export async function runStep(
  articleId: number,
  step: PipelineStep
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (!STEP_SET.has(step)) return { ok: false, error: 'Invalid pipeline step' };

  const article = getArticle(articleId);
  if (!article) return { ok: false, error: 'Not found' };

  const cfg = loadPipelineConfig();
  const profile = profileForArticle(article);
  const active = getActivePipelineSteps(cfg, profile);

  if (!active.includes(step)) {
    logStep(articleId, step, 'ok', 'skipped: disabled in settings');
    return { ok: true, skipped: true };
  }

  // v2.0: Start timing for performance analytics
  logStepStart(articleId);
  const started = Date.now();

  try {
    if (isPipelineAiStep(step) && !hasMeaningfulContent(article)) {
      if (cfg.continueOnAiError) {
        return skipAiStepAndAdvance(
          articleId,
          step,
          active,
          'محتوى غير كافٍ لمراحل الذكاء الاصطناعي'
        );
      }
      throw new Error('Article has insufficient content for AI processing');
    }

    if (step === 'sanitize') {
      snapshotOriginalBeforeRewrite(articleId);
      let rawContent = article.content || '';
      const plainContent = rawContent.replace(/<[^>]+>/g, '').trim();
      if (!plainContent && article.summary?.trim()) {
        rawContent = `<p>${deepCleanText(article.summary)}</p>`;
      }
      const cleanContent = applyGlossary(deepCleanHtml(rawContent));
      const cleanTitle = applyGlossary(deepCleanText(article.title || ''));
      const cleanSummary = applyGlossary(deepCleanText(article.summary || ''));
      const hash = articleContentHash(cleanTitle, cleanContent);
      getDb()
        .prepare(`UPDATE articles SET content=?, title=?, summary=?, content_hash=? WHERE id=?`)
        .run(cleanContent, cleanTitle, cleanSummary, hash, articleId);
    } else if (step === 'proofread') {
      const result = proofreadArticle(articleId);
      if (!result) throw new Error('Proofread failed');
      getDb()
        .prepare(`UPDATE articles SET pipeline_quality_score=? WHERE id=?`)
        .run(result.score, articleId);
      if (cfg.strictQuality && result.score < cfg.minProofreadScore) {
        throw new Error(`Proofread score too low (${result.score} < ${cfg.minProofreadScore})`);
      }
      const errCount = result.issues.filter((i) => i.level === 'error').length;
      if (errCount > 0 && cfg.strictQuality) {
        throw new Error(`Proofread found ${errCount} critical issue(s)`);
      }
    } else if (isPipelineAiStep(step)) {
      if (step === 'rewrite') snapshotOriginalBeforeRewrite(articleId);
      const r = await runPipelineAi(articleId, step, cfg);
      if (!r.ok) throw new Error(r.error);
      if (r.skipped) {
        const next = statusAfterStep(step, active);
        setProcessingStatus(articleId, next);
        return { ok: true, skipped: true };
      }
    } else if (step === 'validate') {
      const fresh = getArticle(articleId);
      if (!fresh) throw new Error('Not found');
      const qc = runQualityCheck(articleId, 'pipeline_validate');
      const purity = assessFetchedArticle({
        title: fresh.title ?? '',
        summary: fresh.summary ?? '',
        content: fresh.content ?? '',
      });
      const combined = Math.round((qc.score + purity.score) / 2);
      getDb()
        .prepare(`UPDATE articles SET pipeline_quality_score=? WHERE id=?`)
        .run(combined, articleId);
      if (cfg.strictQuality && combined < cfg.minValidateScore) {
        throw new Error(`Validation score too low (${combined} < ${cfg.minValidateScore})`);
      }
      if (!purity.ok && cfg.strictQuality) {
        throw new Error(purity.rejectReason ?? 'Content failed quality assessment');
      }
    } else if (step === 'ready') {
      if (cfg.autoSubmitReview) {
        submitReview(articleId);
      }
    }

    const nextStatus = statusAfterStep(step, active);
    setProcessingStatus(articleId, nextStatus);
    logStep(articleId, step, 'ok', `completed in ${Date.now() - started}ms → ${nextStatus}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    logStep(articleId, step, 'failed', msg);
    return { ok: false, error: msg };
  }
}

export async function runFullPipeline(
  articleId: number
): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadPipelineConfig();
  const steps = stepsForArticle(articleId);
  if (!steps.length) return { ok: true };

  if (cfg.useJobQueue) {
    const { enqueuePipelineJob } = await import('./pipeline-jobs');
    const jobId = enqueuePipelineJob(articleId, steps);
    await drainPipelineJobQueue([jobId], 1);
    const job = getDb()
      .prepare(`SELECT status, error FROM pipeline_jobs WHERE id=?`)
      .get(jobId) as { status: string; error: string | null } | undefined;
    if (job?.status === 'failed') return { ok: false, error: job.error ?? 'Pipeline failed' };
    if (job?.status !== 'done') {
      return { ok: false, error: 'Pipeline did not complete (job still pending or cancelled)' };
    }
    return { ok: true };
  }

  for (const step of steps) {
    const r = await runStep(articleId, step);
    if (!r.ok) return r;
  }
  return { ok: true };
}

async function drainPipelineJobQueue(
  jobIds: number[],
  articleCount: number,
  onProgress?: (p: PipelineProgress) => void
): Promise<{ processed: number; failed: number; skipped: number }> {
  const { processPipelineJobs } = await import('./pipeline-jobs');
  if (!jobIds.length) return { processed: 0, failed: 0, skipped: 0 };

  let rounds = 0;
  const maxRounds = articleCount * 12;
  while (rounds < maxRounds) {
    const pending = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM pipeline_jobs WHERE status IN ('pending','running')`)
      .get() as { c: number };
    if (pending.c === 0) break;
    await processPipelineJobs(onProgress);
    rounds++;
    await new Promise((r) => setTimeout(r, 50));
  }

  const stats = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS fail
       FROM pipeline_jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`
    )
    .get(...jobIds) as { ok: number | null; fail: number | null };

  return {
    processed: stats.ok ?? 0,
    failed: stats.fail ?? 0,
    skipped: Math.max(0, articleCount - (stats.ok ?? 0) - (stats.fail ?? 0)),
  };
}

/** Run full pipeline for explicit article IDs (one or many). */
export async function runPipelineArticles(
  articleIds: number[],
  onProgress?: (p: PipelineProgress) => void,
  opts?: PipelineRunOptions
): Promise<{ processed: number; failed: number; skipped: number }> {
  const unique = [...new Set(articleIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) return { processed: 0, failed: 0, skipped: 0 };

  if (opts?.profile) setArticlesPipelineProfile(unique, opts.profile);

  const cfg = loadPipelineConfig();

  if (cfg.useJobQueue) {
    const { enqueueArticles } = await import('./pipeline-jobs');
    const jobIds = enqueueArticles(unique, (id) => stepsForArticle(id));
    if (!jobIds.length) {
      const skipped = unique.length;
      notifyPipelineBatch({ mode: 'articles', processed: 0, failed: 0, skipped, articleCount: unique.length });
      return { processed: 0, failed: 0, skipped };
    }
    const result = await drainPipelineJobQueue(jobIds, unique.length, onProgress);
    notifyPipelineBatch({
      mode: 'articles',
      ...result,
      articleCount: unique.length,
    });
    return result;
  }

  let processed = 0;
  let failed = 0;
  for (let i = 0; i < unique.length; i++) {
    const id = unique[i];
    const r = await runFullPipeline(id);
    onProgress?.({
      articleId: id,
      step: 'sanitize',
      status: r.ok ? 'ok' : 'failed',
      error: r.error,
      done: i,
      total: unique.length,
    });
    if (r.ok) processed++;
    else failed++;
  }
  const syncResult = { processed, failed, skipped: 0 };
  notifyPipelineBatch({ mode: 'articles', ...syncResult, articleCount: unique.length });
  return syncResult;
}

export async function runBulkPipeline(
  limit = 20,
  onProgress?: (p: PipelineProgress) => void,
  opts?: PipelineRunOptions
): Promise<{ processed: number; failed: number; skipped: number }> {
  const cfg = loadPipelineConfig();

  if (cfg.useJobQueue) {
    const { enqueueBulkFromDb } = await import('./pipeline-jobs');
    if (opts?.profile) {
      const tenant = tenantSqlClause();
      const rows = getDb()
        .prepare(
          `SELECT id FROM articles
           WHERE COALESCE(processing_status, 'new') != 'ready'${tenant.sql}
           ORDER BY id ASC LIMIT ?`
        )
        .all(...tenant.params, Math.min(Math.max(1, limit), 100)) as { id: number }[];
      setArticlesPipelineProfile(
        rows.map((r) => r.id),
        opts.profile
      );
    }
    const { articleCount, jobIds } = enqueueBulkFromDb(limit);
    if (!jobIds.length) {
      notifyPipelineBatch({ mode: 'bulk', processed: 0, failed: 0, skipped: 0, articleCount: 0 });
      return { processed: 0, failed: 0, skipped: 0 };
    }
    const result = await drainPipelineJobQueue(jobIds, articleCount, onProgress);
    notifyPipelineBatch({ mode: 'bulk', ...result, articleCount });
    return result;
  }

  const tenant = tenantSqlClause();
  const articles = getDb()
    .prepare(
      `SELECT id, processing_status FROM articles
       WHERE COALESCE(processing_status, 'new') != 'ready'${tenant.sql}
       ORDER BY
         CASE COALESCE(processing_status, 'new')
           WHEN 'new' THEN 0 WHEN 'sanitize' THEN 1 WHEN 'proofread' THEN 2
           WHEN 'rewrite' THEN 3 WHEN 'tldr' THEN 4 WHEN 'seo_meta' THEN 5
           WHEN 'tag_sentiment' THEN 6 WHEN 'validate' THEN 7 ELSE 8
         END, id ASC
       LIMIT ?`
    )
    .all(...tenant.params, limit) as { id: number; processing_status: string | null }[];

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < articles.length; i++) {
    const { id: articleId, processing_status } = articles[i];
    const artRow = getArticle(articleId);
    const steps = stepsFromStatus(
      processing_status,
      cfg,
      artRow ? profileForArticle(artRow) : cfg.defaultProfile
    );

    if (!steps.length) {
      skipped++;
      continue;
    }

    let articleOk = true;
    for (const step of steps) {
      onProgress?.({ articleId, step, status: 'running', done: i, total: articles.length });
      const r = await runStep(articleId, step);
      onProgress?.({
        articleId,
        step,
        status: r.skipped ? 'skipped' : r.ok ? 'ok' : 'failed',
        error: r.error,
        done: i,
        total: articles.length,
      });
      if (!r.ok) {
        articleOk = false;
        break;
      }
    }
    if (articleOk) processed++;
    else failed++;
  }

  const bulkResult = { processed, failed, skipped };
  notifyPipelineBatch({ mode: 'bulk', ...bulkResult, articleCount: articles.length });
  return bulkResult;
}
