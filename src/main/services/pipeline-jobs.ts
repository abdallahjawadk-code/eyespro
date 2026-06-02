import { getDb } from '../db/database';
import { getActiveTenantId, tenantSqlClause } from './tenant';
import { computeRetrySteps } from '../../shared/pipeline-workflow';
import type { PipelineProgress, PipelineStep } from './pipeline';
import { runStep, stepsForArticle } from './pipeline';

export { computeRetrySteps };

export type PipelineJobRow = {
  id: number;
  article_id: number;
  status: string;
  steps_json: string;
  current_step: string | null;
  error: string | null;
  progress_done: number;
  progress_total: number;
  created_at: string;
  updated_at: string;
};

export type PipelineQueueStats = {
  pending: number;
  running: number;
  failed: number;
  stuckPending: number;
};

let runningCount = 0;

function emitProgress(
  job: PipelineJobRow,
  step: PipelineStep,
  status: PipelineProgress['status'],
  done: number,
  total: number,
  onProgress?: (p: PipelineProgress) => void,
  extra?: Partial<PipelineProgress>
): void {
  onProgress?.({
    articleId: job.article_id,
    step,
    status,
    done,
    total,
    jobId: job.id,
    stepIndex: done + (status === 'running' ? 1 : 0),
    stepTotal: total,
    ...extra,
  });
}

export function listPipelineJobs(limit = 30): PipelineJobRow[] {
  const tenantId = getActiveTenantId();
  if (tenantId != null) {
    return getDb()
      .prepare(
        `SELECT * FROM pipeline_jobs WHERE tenant_id IS NULL OR tenant_id=? ORDER BY id DESC LIMIT ?`
      )
      .all(tenantId, limit) as PipelineJobRow[];
  }
  return getDb()
    .prepare(`SELECT * FROM pipeline_jobs ORDER BY id DESC LIMIT ?`)
    .all(limit) as PipelineJobRow[];
}

/** Cancel duplicate pending jobs for the same article before enqueueing. */
export function cancelPendingForArticle(articleId: number): number {
  return getDb()
    .prepare(
      `UPDATE pipeline_jobs SET status='cancelled', updated_at=datetime('now')
       WHERE article_id=? AND status='pending'`
    )
    .run(articleId).changes;
}

export function enqueuePipelineJob(articleId: number, steps: PipelineStep[]): number {
  cancelPendingForArticle(articleId);
  const tenantId = getActiveTenantId();
  const r = getDb()
    .prepare(
      `INSERT INTO pipeline_jobs (article_id, status, steps_json, progress_total, tenant_id)
       VALUES (?, 'pending', ?, ?, ?)`
    )
    .run(articleId, JSON.stringify(steps), steps.length, tenantId ?? null);
  return Number(r.lastInsertRowid);
}

export function cancelAllPendingPipelineJobs(): number {
  return getDb()
    .prepare(
      `UPDATE pipeline_jobs SET status='cancelled', updated_at=datetime('now') WHERE status='pending'`
    )
    .run().changes;
}

export function getPipelineQueueStats(): PipelineQueueStats {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status='pending' AND updated_at < datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS stuckPending
       FROM pipeline_jobs`
    )
    .get() as {
    pending: number | null;
    running: number | null;
    failed: number | null;
    stuckPending: number | null;
  };
  return {
    pending: row.pending ?? 0,
    running: row.running ?? 0,
    failed: row.failed ?? 0,
    stuckPending: row.stuckPending ?? 0,
  };
}

function remainingStepsFromFailedJob(job: PipelineJobRow): PipelineStep[] {
  const steps = JSON.parse(job.steps_json) as PipelineStep[];
  return computeRetrySteps(steps, job.current_step, job.progress_done);
}

/** Re-queue failed jobs from the failed step only (not from the beginning). */
export function retryFailedPipelineJobsSmart(): number {
  const failed = getDb()
    .prepare(`SELECT * FROM pipeline_jobs WHERE status='failed' ORDER BY id ASC`)
    .all() as PipelineJobRow[];

  let retried = 0;
  for (const job of failed) {
    const remaining = remainingStepsFromFailedJob(job);
    if (!remaining.length) continue;
    getDb().prepare(`DELETE FROM pipeline_jobs WHERE id=?`).run(job.id);
    cancelPendingForArticle(job.article_id);
    enqueuePipelineJob(job.article_id, remaining);
    retried++;
  }
  return retried;
}

/** @deprecated Use retryFailedPipelineJobsSmart — kept for compatibility */
export function retryFailedPipelineJobs(): number {
  return retryFailedPipelineJobsSmart();
}

export function retryPipelineJob(jobId: number): boolean {
  const job = getDb()
    .prepare(`SELECT * FROM pipeline_jobs WHERE id=? AND status='failed'`)
    .get(jobId) as PipelineJobRow | undefined;
  if (!job) return false;
  const remaining = remainingStepsFromFailedJob(job);
  if (!remaining.length) return false;
  getDb().prepare(`DELETE FROM pipeline_jobs WHERE id=?`).run(jobId);
  cancelPendingForArticle(job.article_id);
  enqueuePipelineJob(job.article_id, remaining);
  return true;
}

export function dismissFailedPipelineJobs(): number {
  return getDb()
    .prepare(`DELETE FROM pipeline_jobs WHERE status='failed'`)
    .run().changes;
}

export function cancelPipelineJob(jobId: number): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE pipeline_jobs SET status='cancelled', updated_at=datetime('now')
         WHERE id=? AND status IN ('pending','running')`
      )
      .run(jobId).changes > 0
  );
}

async function runJob(
  job: PipelineJobRow,
  onProgress?: (p: PipelineProgress) => void
): Promise<void> {
  const steps = JSON.parse(job.steps_json) as PipelineStep[];
  getDb()
    .prepare(`UPDATE pipeline_jobs SET status='running', updated_at=datetime('now') WHERE id=?`)
    .run(job.id);

  let done = 0;
  for (const step of steps) {
    getDb()
      .prepare(
        `UPDATE pipeline_jobs SET current_step=?, progress_done=?, updated_at=datetime('now') WHERE id=?`
      )
      .run(step, done, job.id);

    emitProgress(job, step, 'running', done, steps.length, onProgress);

    const r = await runStep(job.article_id, step);
    done++;

    emitProgress(job, step, r.ok ? 'ok' : 'failed', done, steps.length, onProgress, {
      error: r.error,
    });

    if (!r.ok) {
      getDb()
        .prepare(
          `UPDATE pipeline_jobs SET status='failed', error=?, progress_done=?, updated_at=datetime('now') WHERE id=?`
        )
        .run(r.error ?? 'failed', done, job.id);
      return;
    }
  }

  getDb()
    .prepare(
      `UPDATE pipeline_jobs SET status='done', current_step=NULL, progress_done=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(steps.length, job.id);
}

/** Run pending jobs until the queue has no pending/running rows. */
export async function drainUntilIdle(
  onProgress?: (p: PipelineProgress) => void,
  maxRounds = 500
): Promise<void> {
  let rounds = 0;
  while (rounds < maxRounds) {
    const pending = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM pipeline_jobs WHERE status IN ('pending','running')`)
      .get() as { c: number };
    if (pending.c === 0) break;
    await processPipelineJobs(onProgress);
    rounds++;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Process pending jobs up to concurrency limit. */
export async function processPipelineJobs(
  onProgress?: (p: PipelineProgress) => void
): Promise<{ processed: number }> {
  const hasPending = (getDb()
    .prepare(`SELECT 1 FROM pipeline_jobs WHERE status='pending' LIMIT 1`)
    .get()) != null;
  if (!hasPending) return { processed: 0 };

  const { loadPipelineConfig } = await import('./pipeline-config');
  const max = loadPipelineConfig().maxConcurrent;
  if (runningCount >= max) return { processed: 0 };

  const slots = max - runningCount;
  const pending = getDb()
    .prepare(`SELECT * FROM pipeline_jobs WHERE status='pending' ORDER BY id ASC LIMIT ?`)
    .all(slots) as PipelineJobRow[];

  if (!pending.length) return { processed: 0 };

  runningCount += pending.length;
  let processed = 0;

  await Promise.all(
    pending.map(async (job) => {
      try {
        await runJob(job, onProgress);
        processed++;
      } finally {
        runningCount = Math.max(0, runningCount - 1);
      }
    })
  );

  return { processed };
}

export function enqueueArticles(
  articleIds: number[],
  stepsResolver: (articleId: number) => PipelineStep[]
): number[] {
  const ids: number[] = [];
  for (const articleId of articleIds) {
    const steps = stepsResolver(articleId);
    if (steps.length) ids.push(enqueuePipelineJob(articleId, steps));
  }
  return ids;
}

export function enqueueBulkFromDb(limit: number): { jobIds: number[]; articleCount: number } {
  const tenant = tenantSqlClause();
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
    .all(...tenant.params, limit) as { id: number }[];

  const jobIds = enqueueArticles(
    rows.map((r) => r.id),
    (id) => stepsForArticle(id)
  );
  return { jobIds, articleCount: rows.length };
}
