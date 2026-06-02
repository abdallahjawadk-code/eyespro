import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';
import { fetchAllEnabled, fetchSource } from './sources';
import { createLogger } from '../logger';
import { tenantSqlClause } from './tenant';
import { processDeliveryQueue } from './webhooks';
import { processRecycleQueue } from './recycle';
import { maybeRunScheduledAutopilot } from './autopilot-loop';
import { runPeriodicLinkHealth } from './link-health';

const log = createLogger('scheduler');
let lastLinkHealthRun = 0;

export interface ScheduledTask {
  id: number;
  name: string;
  task_type: string;
  article_id: number | null;
  platforms: string | null;
  scheduled_at: string;
  status: string;
  repeat_rule: string | null;
  created_at: string;
}

export function listTasks(status?: string): ScheduledTask[] {
  const tenant = tenantSqlClause('a');
  let sql = 'SELECT st.* FROM scheduled_tasks st LEFT JOIN articles a ON a.id = st.article_id WHERE 1=1';
  const params: unknown[] = [];
  sql += tenant.sql;
  params.push(...tenant.params);
  if (status) {
    sql += ' AND st.status = ?';
    params.push(sanitizeString(status, 32));
  }
  sql += ' ORDER BY st.scheduled_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params) as ScheduledTask[];
}

export function createTask(data: Partial<ScheduledTask>): number {
  const r = getDb()
    .prepare(
      `INSERT INTO scheduled_tasks (name, task_type, article_id, platforms, scheduled_at, status, repeat_rule) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sanitizeString(data.name, 200) || 'Task',
      data.task_type ?? 'publish',
      data.article_id ?? null,
      data.platforms ?? null,
      data.scheduled_at ?? new Date().toISOString(),
      data.status ?? 'pending',
      data.repeat_rule ?? null
    );
  return Number(r.lastInsertRowid);
}

export function updateTask(id: number, data: Partial<ScheduledTask>): boolean {
  const cur = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as ScheduledTask | undefined;
  if (!cur) return false;
  getDb()
    .prepare(
      `UPDATE scheduled_tasks SET name=?, task_type=?, article_id=?, platforms=?, scheduled_at=?, status=?, repeat_rule=? WHERE id=?`
    )
    .run(
      data.name ?? cur.name,
      data.task_type ?? cur.task_type,
      data.article_id ?? cur.article_id,
      data.platforms ?? cur.platforms,
      data.scheduled_at ?? cur.scheduled_at,
      data.status ?? cur.status,
      data.repeat_rule ?? cur.repeat_rule,
      id
    );
  return true;
}

export function deleteTask(id: number): boolean {
  return getDb().prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id).changes > 0;
}

async function executeTask(task: ScheduledTask): Promise<void> {
  if (task.task_type === 'fetch') {
    await fetchAllEnabled();
  } else if (task.task_type === 'autopilot') {
    const { runAutopilotOnce } = await import('./autopilot-loop');
    await runAutopilotOnce(undefined);
  }
  getDb().prepare(`UPDATE scheduled_tasks SET status='done' WHERE id=?`).run(task.id);
}

let interval: ReturnType<typeof setInterval> | null = null;
let lastAutoFetch = 0;

export function startScheduler(): void {
  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    void tick();
  }, 60_000);
  log.info('scheduler started');
}

export function stopScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
}

async function tick(): Promise<void> {
  try {
    const nowStr = new Date().toISOString().slice(0, 16);
    const due = getDb()
      .prepare(`SELECT * FROM scheduled_tasks WHERE status='pending' AND scheduled_at<=?`)
      .all(`${nowStr}:59`) as ScheduledTask[];
    for (const task of due) {
      try {
        await executeTask(task);
      } catch (e) {
        log.warn('task failed', { id: task.id, error: (e as Error).message });
        getDb().prepare(`UPDATE scheduled_tasks SET status='failed' WHERE id=?`).run(task.id);
      }
    }
    // Per-source interval fetching
    const now = new Date().toISOString();
    const dueSources = getDb()
      .prepare(
        `SELECT id FROM sources
         WHERE enabled=1 AND fetch_interval_min > 0
         AND (next_fetch_at IS NULL OR next_fetch_at <= ?)`
      )
      .all(now) as { id: number }[];
    for (const { id } of dueSources) {
      try {
        await fetchSource(id);
      } catch { /* ignore */ }
    }

    // Global fallback auto-fetch (sources with no interval set) — parallel with concurrency cap
    if (Date.now() - lastAutoFetch > 30 * 60 * 1000) {
      lastAutoFetch = Date.now();
      const sources = getDb()
        .prepare(`SELECT id FROM sources WHERE enabled=1 AND (fetch_interval_min IS NULL OR fetch_interval_min=0) LIMIT 15`)
        .all() as { id: number }[];
      const CONCURRENCY = 6;
      for (let i = 0; i < sources.length; i += CONCURRENCY) {
        const batch = sources.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map(({ id }) => fetchSource(id)));
      }
    }

    // Process webhook delivery retry queue
    await processDeliveryQueue();

    // Process content recycling queue
    await processRecycleQueue();

    // Autopilot interval (if enabled in settings)
    await maybeRunScheduledAutopilot();

    // Periodic link health checks (every 6 hours, soft observe-only)
    if (Date.now() - lastLinkHealthRun > 6 * 3600_000) {
      lastLinkHealthRun = Date.now();
      void runPeriodicLinkHealth(10).catch(() => undefined);
    }
  } catch (e) {
    log.error('scheduler tick', { error: (e as Error).message });
  }
}

export async function runTaskNow(id: number): Promise<boolean> {
  const task = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as ScheduledTask | undefined;
  if (!task) return false;
  await executeTask(task);
  return true;
}
