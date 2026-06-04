/**
 * Autopilot Loop — Trend discovery → dedup → AI draft → pipeline → review queue
 */

import { getDb } from '../db/database';
import { auditEmitter } from '../events/audit-emitter';
import { createLogger } from '../logger';
import { isDuplicate } from './dedup';
import { runFullPipeline } from './pipeline';
import { getSetting, setSetting } from './settings';
import {
  dismissTrend,
  fetchAllSources,
  fetchTrendsForGeo,
  generateCoverage,
  listTrends,
  type TrendRow,
} from './trend-radar';
import { fireEvent } from './webhooks';

const log = createLogger('autopilot');

export interface AutopilotConfig {
  enabled: boolean;
  crisisMode: boolean;
  geo: string;
  maxPerRun: number;
  autoPipeline: boolean;
  dedupEnabled: boolean;
  fetchGoogle: boolean;
  intervalMin: number;
}

export interface AutopilotProgress {
  phase: 'fetch' | 'select' | 'dedup' | 'generate' | 'pipeline' | 'done' | 'error';
  message: string;
  current?: number;
  total?: number;
}

export interface AutopilotRunResult {
  ok: boolean;
  runId?: number;
  trendsInserted: number;
  processed: number;
  duplicatesSkipped: number;
  generated: number;
  pipelineOk: number;
  pipelineFailed: number;
  errors: string[];      // Critical errors that prevent generation
  warnings: string[];   // Non-critical issues (e.g., some pipeline steps failed but article exists)
  articleIds: number[];
}

const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: false,
  crisisMode: false,
  geo: 'SA',
  maxPerRun: 3,
  autoPipeline: true,
  dedupEnabled: true,
  fetchGoogle: true,
  intervalMin: 0,
};

let running = false;
let stopRequested = false;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
}

function parseIntSetting(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getAutopilotConfig(): AutopilotConfig {
  return {
    enabled: parseBool(getSetting('autopilot_enabled'), DEFAULT_CONFIG.enabled),
    crisisMode: parseBool(getSetting('autopilot_crisis_mode'), DEFAULT_CONFIG.crisisMode),
    geo: (getSetting('autopilot_geo') || DEFAULT_CONFIG.geo).toUpperCase().slice(0, 8),
    maxPerRun: parseIntSetting(getSetting('autopilot_max_per_run'), DEFAULT_CONFIG.maxPerRun, 1, 20),
    autoPipeline: parseBool(getSetting('autopilot_auto_pipeline'), DEFAULT_CONFIG.autoPipeline),
    dedupEnabled: parseBool(getSetting('autopilot_dedup'), DEFAULT_CONFIG.dedupEnabled),
    fetchGoogle: parseBool(getSetting('autopilot_fetch_google'), DEFAULT_CONFIG.fetchGoogle),
    intervalMin: parseIntSetting(getSetting('autopilot_interval_min'), DEFAULT_CONFIG.intervalMin, 0, 1440),
  };
}

export function setAutopilotConfig(partial: Partial<AutopilotConfig>): AutopilotConfig {
  if (partial.enabled !== undefined) setSetting('autopilot_enabled', partial.enabled ? '1' : '0');
  if (partial.crisisMode !== undefined) setSetting('autopilot_crisis_mode', partial.crisisMode ? '1' : '0');
  if (partial.geo !== undefined) setSetting('autopilot_geo', partial.geo.toUpperCase().slice(0, 8));
  if (partial.maxPerRun !== undefined) setSetting('autopilot_max_per_run', String(Math.min(20, Math.max(1, partial.maxPerRun))));
  if (partial.autoPipeline !== undefined) setSetting('autopilot_auto_pipeline', partial.autoPipeline ? '1' : '0');
  if (partial.dedupEnabled !== undefined) setSetting('autopilot_dedup', partial.dedupEnabled ? '1' : '0');
  if (partial.fetchGoogle !== undefined) setSetting('autopilot_fetch_google', partial.fetchGoogle ? '1' : '0');
  if (partial.intervalMin !== undefined) setSetting('autopilot_interval_min', String(Math.min(1440, Math.max(0, partial.intervalMin))));
  return getAutopilotConfig();
}

export function getAutopilotStatus(): {
  running: boolean;
  config: AutopilotConfig;
  lastRun: AutopilotRunRow | null;
  pendingTrends: number;
} {
  const cfg = getAutopilotConfig();
  const pending = listTrends(cfg.geo || undefined).filter(t => t.status === 'pending').length;
  return {
    running,
    config: cfg,
    lastRun: getLastRun(),
    pendingTrends: pending,
  };
}

export interface AutopilotRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  config_json: string;
  result_json: string | null;
  user_id: number | null;
}

export function listAutopilotRuns(limit = 20): AutopilotRunRow[] {
  return getDb()
    .prepare(`SELECT * FROM autopilot_runs ORDER BY id DESC LIMIT ?`)
    .all(limit) as AutopilotRunRow[];
}

function getLastRun(): AutopilotRunRow | null {
  return (getDb().prepare(`SELECT * FROM autopilot_runs ORDER BY id DESC LIMIT 1`).get() as AutopilotRunRow) ?? null;
}

export function requestAutopilotStop(): void {
  stopRequested = true;
}

function emit(onProgress: ((p: AutopilotProgress) => void) | undefined, p: AutopilotProgress): void {
  onProgress?.(p);
}

function effectiveMaxPerRun(cfg: AutopilotConfig): number {
  return cfg.crisisMode ? Math.min(20, cfg.maxPerRun * 2) : cfg.maxPerRun;
}

function pickPendingTrends(cfg: AutopilotConfig): TrendRow[] {
  const geo = cfg.geo.trim() || undefined;
  const pending = listTrends(geo).filter(t => t.status === 'pending');
  pending.sort((a, b) => b.id - a.id);
  return pending.slice(0, effectiveMaxPerRun(cfg));
}

export async function runAutopilotOnce(
  userId?: number,
  onProgress?: (p: AutopilotProgress) => void,
): Promise<AutopilotRunResult> {
  if (running) {
    return { ok: false, trendsInserted: 0, processed: 0, duplicatesSkipped: 0, generated: 0, pipelineOk: 0, pipelineFailed: 0, errors: ['الحلقة قيد التشغيل بالفعل'], warnings: [], articleIds: [] };
  }

  running = true;
  stopRequested = false;
  const cfg = getAutopilotConfig();
  const result: AutopilotRunResult = {
    ok: true,
    trendsInserted: 0,
    processed: 0,
    duplicatesSkipped: 0,
    generated: 0,
    pipelineOk: 0,
    pipelineFailed: 0,
    errors: [],
    warnings: [],
    articleIds: [],
  };

  const runInsert = getDb().prepare(
    `INSERT INTO autopilot_runs (started_at, status, config_json, user_id) VALUES (datetime('now'), 'running', ?, ?)`,
  );
  const runId = Number(runInsert.run(JSON.stringify(cfg), userId ?? null).lastInsertRowid);
  result.runId = runId;

  try {
    emit(onProgress, { phase: 'fetch', message: 'جاري جلب التريندات…' });

    const sourceRes = await fetchAllSources();
    result.trendsInserted += sourceRes.inserted;
    if (sourceRes.failed > 0) {
      result.errors.push(`فشل جلب ${sourceRes.failed} مصدر تريند`);
    }

    if (cfg.fetchGoogle && cfg.geo.trim()) {
      const googleRes = await fetchTrendsForGeo(cfg.geo);
      if (googleRes.ok) result.trendsInserted += googleRes.count;
      else if (googleRes.error) result.errors.push(googleRes.error);
    }

    if (stopRequested) throw new Error('تم إيقاف الحلقة');

    // Perception loop: let the freshly fetched trends feed the assistant's adaptive
    // memory so the user's interests strengthen from real, recurring signal. Deferred
    // import avoids a static cycle (assistant imports runAutopilotOnce from here).
    try {
      const { perceive } = await import('./assistant');
      perceive(listTrends(cfg.geo || undefined).slice(0, 40).map((t) => ({ title: t.title })), { source: 'autopilot' });
      // Co-pilot: surface discoveries as proposals, then let guarded autonomy
      // auto-approve the low-risk, reversible ones within the user's limits.
      const { generateSourceProposals, autoApprovePending } = await import('./copilot');
      generateSourceProposals();
      autoApprovePending(); // logs what it auto-approved; all reversible via the ledger
    } catch { /* non-fatal — perception/autonomy is best-effort */ }

    const trends = pickPendingTrends(cfg);
    result.processed = trends.length;

    emit(onProgress, {
      phase: 'select',
      message: `معالجة ${trends.length} تريند…`,
      total: trends.length,
      current: 0,
    });

    for (let i = 0; i < trends.length; i++) {
      if (stopRequested) break;
      const trend = trends[i]!;

      emit(onProgress, {
        phase: 'generate',
        message: `«${trend.title.slice(0, 48)}…»`,
        current: i + 1,
        total: trends.length,
      });

      if (cfg.dedupEnabled) {
        const dup = isDuplicate(trend.title, trend.description ?? '', cfg.crisisMode ? 3 : 4);
        if (dup.duplicate) {
          dismissTrend(trend.id);
          result.duplicatesSkipped++;
          continue;
        }
      }

      const gen = await generateCoverage(trend.id, userId);
      if (!gen.ok || !gen.articleId) {
        result.errors.push(gen.error ?? `فشل توليد تريند #${trend.id}`);
        continue;
      }

      result.generated++;
      result.articleIds.push(gen.articleId);

      if (cfg.autoPipeline) {
        emit(onProgress, {
          phase: 'pipeline',
          message: `معالجة المقال #${gen.articleId}…`,
          current: i + 1,
          total: trends.length,
        });
        const pipe = await runFullPipeline(gen.articleId);
        if (pipe.ok) result.pipelineOk++;
        else {
          result.pipelineFailed++;
          // v2.0: Use warnings for non-critical pipeline failures (article still generated)
          result.warnings.push(pipe.error ?? `فشل pipeline للمقال #${gen.articleId} (تم إنشاء المقال)`);
        }
      }
    }

    // v2.0: ok = true if at least one article was generated (warnings don't affect this)
    result.ok = result.generated > 0;
    setSetting('autopilot_last_tick', new Date().toISOString());

    emit(onProgress, {
      phase: 'done',
      message: `اكتمل: ${result.generated} مقال · ${result.duplicatesSkipped} مكرر`,
    });

    auditEmitter.emitLog({
      userId: userId ?? null,
      action: 'autopilot.run',
      targetType: 'autopilot_run',
      targetId: runId,
      details: { generated: result.generated, pipelineOk: result.pipelineOk, errors: result.errors.length, warnings: result.warnings.length },
    });

    void fireEvent('pipeline.batch.complete', {
      mode: 'autopilot',
      processed: result.pipelineOk,
      failed: result.pipelineFailed,
      generated: result.generated,
      articleIds: result.articleIds,
    }).catch(() => undefined);

    getDb().prepare(
      `UPDATE autopilot_runs SET finished_at=datetime('now'), status=?, result_json=? WHERE id=?`,
    ).run(result.ok ? 'done' : 'partial', JSON.stringify(result), runId);

    log.info('autopilot run complete', { runId, generated: result.generated });
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    result.ok = false;
    result.errors.push(msg);
    emit(onProgress, { phase: 'error', message: msg });
    getDb().prepare(
      `UPDATE autopilot_runs SET finished_at=datetime('now'), status='failed', result_json=? WHERE id=?`,
    ).run(JSON.stringify(result), runId);
    return result;
  } finally {
    running = false;
    stopRequested = false;
  }
}

let lastIntervalCheck = 0;

/** Called from scheduler tick — at most once per minute. */
export async function maybeRunScheduledAutopilot(): Promise<void> {
  const cfg = getAutopilotConfig();
  if (!cfg.enabled || cfg.intervalMin <= 0 || running) return;

  const now = Date.now();
  if (now - lastIntervalCheck < 60_000) return;
  lastIntervalCheck = now;

  const last = getSetting('autopilot_last_tick');
  const intervalMs = cfg.intervalMin * 60_000;
  if (last) {
    const elapsed = now - new Date(last).getTime();
    if (elapsed < intervalMs) return;
  }

  log.info('scheduled autopilot starting');
  await runAutopilotOnce(undefined);
}
