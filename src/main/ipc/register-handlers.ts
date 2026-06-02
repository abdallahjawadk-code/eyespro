import { BrowserWindow, clipboard, dialog, shell, type IpcMain, type OpenDialogOptions } from 'electron';
import { login, logout, getSession } from '../auth/auth-service';
import { setup2fa, enable2fa, disable2fa, get2faStatus } from '../auth/totp-service';
import { bindSession, getSessionFromEvent, getSessionToken, pruneExpiredSessions, savePersistedToken, loadPersistedToken, clearPersistedToken } from '../auth/session-store';
// getSessionFromEvent kept for auth:changePassword, auth:setup2fa, auth:enable2fa, auth:disable2fa
import { sanitizeString, sanitizeInt } from '../security/sanitize';
import * as articles from '../services/articles';
import * as scheduler from '../services/scheduler';
import * as ai from '../services/ai';
import * as pipeline from '../services/pipeline';
import * as quality from '../services/quality';
import * as analytics from '../services/analytics';
import * as media from '../services/media';
import * as templates from '../services/templates';
import * as ingest from '../services/ingest';
import * as social from '../services/social';
import * as users from '../services/users';
import * as trendRadar from '../services/trend-radar';
import * as trendSources from '../services/trend-sources';
import * as autopilot from '../services/autopilot-loop';
import * as publish from '../services/publish';
import * as permissions from '../services/permissions';
import { listAudit } from '../services/audit';
import { getAllSettings, setSetting, getSetting } from '../services/settings';
import { importFromLegacyDb, guessLegacyPaths } from '../services/legacy-import';
import { createEncryptedBackup, listBackups, restoreFromBackup } from '../services/backup';
import { getBackupDir } from '../db/paths';
import path from 'node:path';
import { cacheStats, systemPerf } from '../services/system';
import { changePassword } from '../services/users';
import { listQuickLoginUsers } from '../auth/quick-login';
import { confirmPasswordReset, requestPasswordReset } from '../services/password-reset';
import type { ApiResult, DashboardStats, LoginPayload } from '../../shared/api-types';
import { registerAdvancedHandlers } from './register-advanced';
import {
  handleLicenseStatus, handleLicenseActivate,
  handleLicenseDeactivate, handleLicenseInfo
} from '../licensing/license-guard';
import { registerArticlesHandlers } from './handlers/articles-handlers';
import { registerSourcesHandlers } from './handlers/sources-handlers';
import { registerTranslationHandlers } from './handlers/translation-handlers';
import * as pipelineJobs from '../services/pipeline-jobs';
import * as pipelineSession from '../services/pipeline-session';
import type { PipelineProfile } from '../services/pipeline-config';
import * as ollamaMgr from '../services/ollama-manager';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function isAllowedShareHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const allowed = [
    'facebook.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'wa.me',
    'api.whatsapp.com',
    't.me',
    'telegram.me',
    'telegram.org',
    'threads.net',
    'instagram.com',
    'tiktok.com',
    'snapchat.com',
    'pinterest.com',
    'reddit.com',
    'youtube.com',
    'mailto',          // email intent
  ];
  return allowed.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`) || hostname.toLowerCase().endsWith(suffix),
  );
}

export function registerIpcHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null): void {
  pruneExpiredSessions();

  ipcMain.handle('auth:login', (event, payload: LoginPayload) => login(event, payload));
  ipcMain.handle('auth:logout', (event) => logout(event));
  ipcMain.handle('auth:session', (event, token?: string) => {
    // Priority: webContents-bound token → passed token (legacy localStorage) → safeStorage token
    const t = getSessionToken(event)
      ?? (typeof token === 'string' && token ? token : null)
      ?? loadPersistedToken();
    if (t && !getSessionToken(event)) bindSession(event, t);
    return getSession(t ?? null);
  });
  ipcMain.handle('auth:changePassword', (event, current: string, next: string) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
    const r = changePassword(u.id, String(current), String(next));
    return r.ok ? ok(undefined) : { ok: false, code: r.code, error: r.code };
  });
  ipcMain.handle('auth:setup2fa', (event) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
    return setup2fa(u.id);
  });
  ipcMain.handle('auth:enable2fa', (event, code: string) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
    return enable2fa(u.id, String(code));
  });
  ipcMain.handle('auth:disable2fa', (event, code: string) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
    return disable2fa(u.id, String(code));
  });
  ipcMain.handle('auth:status2fa', (event) => get2faStatus(event));
  ipcMain.handle('auth:requestPasswordReset', async (_e, payload: { username?: string; email?: string }) =>
    requestPasswordReset(payload || {})
  );
  ipcMain.handle(
    'auth:confirmPasswordReset',
    (_e, payload: { username?: string; email?: string; code: string; newPassword: string }) =>
      confirmPasswordReset(payload || { code: '', newPassword: '' })
  );
  ipcMain.handle('auth:quickLoginUsers', () => ok(listQuickLoginUsers()));

  // Secure token persistence via OS-level encryption (replaces localStorage)
  ipcMain.handle('auth:persistToken', (_e, token: string) => {
    if (typeof token === 'string' && token) savePersistedToken(token);
    return { ok: true };
  });
  ipcMain.handle('auth:loadPersistedToken', () => {
    return { ok: true, data: loadPersistedToken() };
  });
  ipcMain.handle('auth:clearPersistedToken', () => {
    clearPersistedToken();
    return { ok: true };
  });

  ipcMain.handle('dashboard:stats', (): ApiResult<DashboardStats> =>
    ok(articles.dashboardStats())
  );

  // ── Articles handlers (split into handlers/articles-handlers.ts) ──────────
  registerArticlesHandlers(ipcMain, getWin);

  ipcMain.handle('articles:ingest', async (_e, url: string, selector?: string) =>
    ok(await ingest.ingestUrl(String(url), selector ? String(selector) : undefined))
  );

  // ── Sources, OPML, links, keywords handlers (split into handlers/sources-handlers.ts) ──
  registerSourcesHandlers(ipcMain);
  registerTranslationHandlers(ipcMain);

  ipcMain.handle('tasks:list', (_e, status?: string) => ok(scheduler.listTasks(status)));
  ipcMain.handle('tasks:create', (_e, data) => ok({ id: scheduler.createTask(data || {}) }));
  ipcMain.handle('tasks:update', (_e, id: number, data) => {
    const r = scheduler.updateTask(sanitizeInt(id, 1), data || {});
    return r ? ok(undefined) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('tasks:delete', (_e, id: number) => ok({ ok: scheduler.deleteTask(sanitizeInt(id, 1)) }));
  ipcMain.handle('tasks:run', async (_e, id: number) => ok({ ok: await scheduler.runTaskNow(sanitizeInt(id, 1)) }));

  ipcMain.handle('pipeline:kanban', () => ok(pipeline.kanban()));
  ipcMain.handle('pipeline:log', (_e, articleId: number) => ok(pipeline.processingLog(sanitizeInt(articleId, 1))));
  ipcMain.handle('pipeline:runStep', async (_e, articleId: number, step: string) => {
    const r = await pipeline.runStep(
      sanitizeInt(articleId, 1),
      step as pipeline.PipelineStep
    );
    return r.ok ? ok(r) : { ok: false, error: r.error ?? 'Pipeline step failed', data: r };
  });
  ipcMain.handle('pipeline:runFull', async (_e, articleId: number) => {
    const r = await pipeline.runFullPipeline(sanitizeInt(articleId, 1));
    return r.ok ? ok(r) : { ok: false, error: r.error ?? 'Pipeline failed', data: r };
  });
  ipcMain.handle('pipeline:runBulk', async (_e, limit?: number, profile?: string) => {
    const win = getWin();
    const prof =
      profile === 'full' || profile === 'light' || profile === 'sanitize_only' ? profile : undefined;
    const result = await pipeline.runBulkPipeline(
      limit ? Math.min(sanitizeInt(limit, 1), 100) : 20,
      (progress) => win?.webContents.send('pipeline:progress', progress),
      prof ? { profile: prof } : undefined
    );
    return ok(result);
  });
  ipcMain.handle('pipeline:runArticles', async (event, articleIds: unknown, profile?: string) => {
    const win = getWin() ?? BrowserWindow.fromWebContents(event.sender);
    const ids = Array.isArray(articleIds)
      ? articleIds
          .map((id) => sanitizeInt(Number(id), 1))
          .filter((id) => id > 0)
          .slice(0, 100)
      : [];
    const prof =
      profile === 'full' || profile === 'light' || profile === 'sanitize_only' ? profile : undefined;
    const result = await pipeline.runPipelineArticles(
      ids,
      (progress) => {
        win?.webContents.send('pipeline:progress', progress);
      },
      prof ? { profile: prof } : undefined
    );
    return ok(result);
  });
  ipcMain.handle('pipeline:previewArticles', (_e, articleIds: unknown) => {
    const ids = Array.isArray(articleIds)
      ? articleIds
          .map((id) => sanitizeInt(Number(id), 1))
          .filter((id) => id > 0)
          .slice(0, 100)
      : [];
    return ok(pipeline.previewPipelineArticles(ids));
  });
  ipcMain.handle('pipeline:previewAuto', (_e, limit?: number) =>
    ok(pipeline.previewPipelineAuto(limit ? Math.min(sanitizeInt(limit, 1), 100) : 20))
  );
  ipcMain.handle('pipeline:articleDetail', (_e, articleId: number) => {
    const detail = pipeline.articlePipelineDetail(sanitizeInt(articleId, 1));
    return detail ? ok(detail) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('pipeline:setProfile', (_e, articleId: number, profile: string) => {
    const p = String(profile);
    const updated = pipeline.setArticlePipelineProfile(
      sanitizeInt(articleId, 1),
      p as PipelineProfile
    );
    return updated ? ok({ updated: true }) : { ok: false, error: 'Invalid profile or article' };
  });
  ipcMain.handle('pipeline:setProfiles', (_e, articleIds: unknown, profile: string) => {
    const ids = Array.isArray(articleIds)
      ? articleIds
          .map((id) => sanitizeInt(Number(id), 1))
          .filter((id) => id > 0)
          .slice(0, 100)
      : [];
    const p = String(profile);
    if (p !== 'full' && p !== 'light' && p !== 'sanitize_only') {
      return { ok: false, error: 'Invalid profile' };
    }
    return ok({
      updated: pipeline.setArticlesPipelineProfile(ids, p as PipelineProfile),
    });
  });
  ipcMain.handle('pipeline:session', () => ok(pipelineSession.getPipelineSession()));
  ipcMain.handle('pipeline:setSessionDisableAi', (_e, disable: unknown) => {
    pipelineSession.setPipelineSessionDisableAi(!!disable);
    return ok(pipelineSession.getPipelineSession());
  });
  ipcMain.handle('pipeline:cancelAllPending', () =>
    ok({ cancelled: pipelineJobs.cancelAllPendingPipelineJobs() })
  );
  ipcMain.handle('pipeline:queueStats', () => ok(pipelineJobs.getPipelineQueueStats()));
  ipcMain.handle('pipeline:retryJob', async (_e, jobId: number) => {
    const retried = pipelineJobs.retryPipelineJob(sanitizeInt(jobId, 1));
    if (retried) await pipelineJobs.drainUntilIdle();
    return ok({ retried });
  });
  ipcMain.handle('pipeline:config', () => ok(pipeline.getPipelineConfig()));
  ipcMain.handle('pipeline:jobs', (_e, limit?: number) =>
    ok(pipelineJobs.listPipelineJobs(limit ? Math.min(sanitizeInt(limit, 1), 100) : 30))
  );
  ipcMain.handle('pipeline:cancelJob', (_e, jobId: number) =>
    ok({ cancelled: pipelineJobs.cancelPipelineJob(sanitizeInt(jobId, 1)) })
  );
  ipcMain.handle('pipeline:aiStatus', async () => ok(await pipeline.getPipelineAiStatus()));
  ipcMain.handle('pipeline:retryFailed', async () => {
    const n = pipelineJobs.retryFailedPipelineJobs();
    if (n > 0) await pipelineJobs.drainUntilIdle();
    return ok({ retried: n });
  });
  ipcMain.handle('pipeline:dismissFailed', (_e) =>
    ok({ dismissed: pipelineJobs.dismissFailedPipelineJobs() })
  );

  ipcMain.handle('ollama:status', async () => ok(await ollamaMgr.getOllamaStatus()));
  ipcMain.handle('ollama:recommended', () => ok(ollamaMgr.RECOMMENDED_OLLAMA_MODELS));
  ipcMain.handle('ollama:localModels', async () => ok(await ollamaMgr.listLocalOllamaModels()));
  ipcMain.handle('ollama:setEnabled', async (_e, enabled: boolean) =>
    ok(await ollamaMgr.setBuiltinOllamaEnabled(Boolean(enabled)))
  );
  ipcMain.handle('ollama:start', async () => ok(await ollamaMgr.startManagedOllama()));
  ipcMain.handle('ollama:stop', () => {
    ollamaMgr.stopManagedOllama();
    return ok(undefined);
  });
  ipcMain.handle('ollama:openDownload', async () => {
    await ollamaMgr.openOllamaDownloadPage();
    return ok(undefined);
  });
  ipcMain.handle('ollama:installWinget', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const win = senderWin ?? getWin();
    const result = await ollamaMgr.installOllamaViaWinget((p) => {
      // Send only once — prefer the sender window, fallback to main window
      win?.webContents.send('ollama:installProgress', p);
    });
    return ok(result);
  });
  ipcMain.handle('ollama:deleteModel', async (_e, name: string) => {
    const safe = String(name || '').trim().slice(0, 120);
    if (!safe || !/^[a-zA-Z0-9_\-\.\:\/]+$/.test(safe)) {
      return { ok: false, error: 'Invalid model name' };
    }
    return ok(await ollamaMgr.deleteLocalModel(safe));
  });
  ipcMain.handle('ollama:pull', async (event, model: string) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const win = senderWin ?? getWin();
    const safe = String(model || '').trim().slice(0, 120);
    if (!safe || !/^[a-zA-Z0-9_\-\.\:\/]+$/.test(safe)) {
      return { ok: false, error: 'Invalid model name' };
    }
    const result = await ollamaMgr.pullOllamaModel(safe, (p) => {
      win?.webContents.send('ollama:pullProgress', p);
    });
    return ok(result);
  });

  ipcMain.handle('ai:modes', () => ok(ai.listAiModes()));
  ipcMain.handle('ai:listModels', async () => ok(await ai.listAvailableModels()));
  ipcMain.handle('ai:testProvider', async (_e, provider: string, fields?: Record<string, string>) => {
    const { testAiProvider } = await import('../services/ai-provider-test');
    const safeProvider = String(provider || '').trim().slice(0, 32);
    const safeFields =
      fields && typeof fields === 'object'
        ? Object.fromEntries(
            Object.entries(fields)
              .filter(([k]) => /^[a-z0-9_]+$/i.test(k))
              .map(([k, v]) => [k, sanitizeString(String(v), 512)])
          )
        : undefined;
    return ok(await testAiProvider(safeProvider, safeFields));
  });
  ipcMain.handle('ai:setModel', (_e, provider: string, modelId: string) => {
    const VALID_PROVIDERS = new Set(['gemini', 'openai', 'groq', 'anthropic', 'ollama', '']);
    const safeProvider = VALID_PROVIDERS.has(String(provider)) ? String(provider) : '';
    const safeModel = sanitizeString(modelId, 128);
    setSetting('ai_provider', safeProvider);
    setSetting('ai_model', safeModel);
    // Also persist per-provider so switching providers never poisons each other
    if (safeProvider && safeModel) setSetting(`${safeProvider}_model`, safeModel);
    return ok({ provider: safeProvider, modelId: safeModel });
  });
  ipcMain.handle('ai:status', async () => ok(await ai.checkAiProviderReady()));
  ipcMain.handle('ai:run', async (_e, articleId: number, mode: string) => {
    const r = await ai.runAi(sanitizeInt(articleId, 1), mode as ai.AiMode);
    if (!r.ok) return { ok: false, error: r.error ?? 'AI failed', code: 'AI_FAILED' };
    return ok({ result: r.result });
  });
  ipcMain.handle('ai:jobs', () => ok(ai.listJobs()));
  ipcMain.handle('ai:createBatch', (_e, articleIds: number[], mode: string) =>
    ok({ id: ai.createBatchJob(articleIds || [], mode as ai.AiMode) })
  );
  ipcMain.handle('ai:processJobs', async () => ok({ processed: await ai.processPendingJobs() }));

  ipcMain.handle('ai:chat', async (
    _e,
    articleId: number,
    history: { role: 'user' | 'assistant'; content: string }[],
    question: string
  ) => {
    try {
      const { getArticle } = await import('../services/articles');
      const { runAiRaw, resolveEffectiveAiProvider, resolveModelForProvider } = await import('../services/ai');
      const art = getArticle(sanitizeInt(articleId, 1));
      if (!art) return { ok: false, error: 'Article not found' };
      const provider = resolveEffectiveAiProvider();
      const model    = resolveModelForProvider(provider);
      const ctx = [
        'أنت مساعد ذكاء اصطناعي متخصص في تحليل ومناقشة المقالات الإخبارية.',
        'أجب دائماً بشكل مفصل ومحترف.',
        '',
        '=== المقال ===',
        `العنوان: ${art.title ?? ''}`,
        art.summary   ? `الملخص: ${art.summary}`   : '',
        art.category  ? `الفئة: ${art.category}`   : '',
        art.source    ? `المصدر: ${art.source}`    : '',
        art.sentiment ? `المشاعر: ${art.sentiment} (${art.sentiment_score ?? ''})` : '',
        art.tags      ? `الوسوم: ${art.tags}`      : '',
        art.content   ? `\nالمحتوى:\n${String(art.content).slice(0, 3000)}` : '',
      ].filter(Boolean).join('\n');
      const prev = (history ?? []).slice(-8)
        .map((h) => `${h.role === 'user' ? 'المستخدم' : 'المساعد'}: ${h.content}`)
        .join('\n');
      const prompt = [
        ctx,
        prev ? `\n=== سجل المحادثة ===\n${prev}` : '',
        `\n=== سؤال المستخدم ===\n${String(question).slice(0, 600)}`,
      ].join('');
      const response = await runAiRaw(prompt, '', provider, model);
      return ok({ response });
    } catch (err) {
      const { formatAiErrorMessage } = await import('../services/ai');
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: formatAiErrorMessage(msg) };
    }
  });

  ipcMain.handle('quality:queue', (_e, status?: string) => ok(quality.workflowQueue(status)));
  ipcMain.handle('quality:submit', (_e, articleId: number) => ok({ ok: quality.submitReview(sanitizeInt(articleId, 1)) }));
  ipcMain.handle('quality:approve', (event, articleId: number) => {
    const u = getSessionFromEvent(event);
    return ok({ ok: quality.approve(sanitizeInt(articleId, 1), u?.id) });
  });
  ipcMain.handle('quality:reject', (_e, articleId: number, reason?: string) =>
    ok({ ok: quality.reject(sanitizeInt(articleId, 1), reason) })
  );
  ipcMain.handle('quality:check', (_e, articleId: number, type?: string) =>
    ok(quality.runQualityCheck(sanitizeInt(articleId, 1), type || 'full'))
  );
  ipcMain.handle('quality:reports', (_e, articleId?: number) => ok(quality.listReports(articleId)));
  ipcMain.handle('quality:stats', () => ok(quality.qualityStats()));

  ipcMain.handle('analytics:publishLogs', () => ok(analytics.publishLogs()));
  ipcMain.handle('analytics:dashboard', () => ok(analytics.dashboardMetrics()));
  ipcMain.handle('analytics:exportCsv', () => ok({ csv: analytics.exportCsv() }));
  ipcMain.handle('analytics:alerts', () => ok(analytics.listAlerts()));
  ipcMain.handle('analytics:dismissAlert', (_e, id: number) => {
    analytics.dismissAlert(sanitizeInt(id, 1));
    return ok(undefined);
  });
  ipcMain.handle('analytics:dismissNotif', (_e, id: number, kind: string) => {
    analytics.dismissNotif(sanitizeInt(id, 1), kind === 'keyword' ? 'keyword' : 'system');
    return ok(undefined);
  });

  ipcMain.handle('media:list', () => ok(media.listMedia()));
  ipcMain.handle('media:stats', () => ok(media.mediaStats()));
  ipcMain.handle('media:pickUpload', async () => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      title: 'Select media file',
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv', 'ogv', '3gp'] },
        { name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'All Media', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv', 'ogv', '3gp', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'] }
      ]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return ok(null);
    return ok({ id: media.importMediaFile(r.filePaths[0]) });
  });
  ipcMain.handle('media:delete', (_e, id: number) => ok({ ok: media.deleteMedia(sanitizeInt(id, 1)) }));
  // Return an eyesmedia:// URL for local video playback (bypasses CSP file:// block)
  ipcMain.handle('media:getFileUrl', async (_e, id: number) => {
    const filepath = media.getMediaPath(sanitizeInt(id, 1));
    if (!filepath) return { ok: false, error: 'Not found' };
    const { statSync } = await import('fs');
    try {
      const stat = statSync(filepath);
      const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
      const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
        avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/mp4',
        flv: 'video/x-flv', wmv: 'video/x-ms-wmv', ogv: 'video/ogg',
        '3gp': 'video/3gpp',
      };
      // Build eyesmedia://local/<encoded-path> URL
      const encoded = encodeURIComponent(filepath);
      const mediaUrl = `eyesmedia://local/${encoded}`;
      return ok({ url: mediaUrl, filepath, size: stat.size, mime: mimeMap[ext] ?? 'video/mp4', ext });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('media:updateMeta', (_e, id: number, alt: string) =>
    ok({ ok: media.updateMediaMeta(sanitizeInt(id, 1), String(alt)) })
  );

  ipcMain.handle('templates:article:list', () => ok(templates.listArticleTemplates()));
  ipcMain.handle('templates:article:create', (_e, data) => ok({ id: templates.createArticleTemplate(data || {}) }));
  ipcMain.handle('templates:article:delete', (_e, id: number) =>
    ok({ ok: templates.deleteArticleTemplate(sanitizeInt(id, 1)) })
  );
  ipcMain.handle('templates:article:apply', (_e, id: number) =>
    ok({ id: templates.applyArticleTemplate(sanitizeInt(id, 1)) })
  );
  ipcMain.handle('templates:publish:list', () => ok(templates.listPublishTemplates()));
  ipcMain.handle('templates:publish:create', (_e, name: unknown, platforms: unknown) =>
    ok({
      id: templates.createPublishTemplate(
        sanitizeString(String(name ?? ''), 200),
        Array.isArray(platforms) ? platforms.map((p) => sanitizeString(String(p), 32)) : [],
      ),
    })
  );
  ipcMain.handle('templates:publish:delete', (_e, id: number) =>
    ok({ ok: templates.deletePublishTemplate(sanitizeInt(id, 1)) })
  );
  ipcMain.handle('social:platforms', () => ok([...social.SOCIAL_PLATFORMS]));
  ipcMain.handle('social:connections', () => ok(social.listEffectiveConnections()));
  ipcMain.handle('social:configuredPlatforms', () => ok(social.listConfiguredPlatformIds()));
  ipcMain.handle('social:save', (_e, platform: string, label: string, config: Record<string, string>) =>
    ok({ id: social.saveConnection(String(platform), String(label), config || {}) })
  );
  ipcMain.handle('social:delete', (_e, id: number) => ok({ ok: social.deleteConnection(sanitizeInt(id, 1)) }));
  ipcMain.handle('social:guide', (_e, platform: string) => ok({ text: social.platformGuide(String(platform)) }));
  ipcMain.handle('social:test', async (_e, id: number) => {
    const result = await social.testConnection(sanitizeInt(id, 1));
    return result.ok ? ok(result) : { ok: false, error: result.error };
  });
  ipcMain.handle('social:testPlatform', async (_e, platform: string) => {
    const result = await social.testConnectionByPlatform(String(platform));
    return result.ok ? ok(result) : { ok: false, error: result.error };
  });

  ipcMain.handle('youtube:connectOAuth', async () => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      title: 'اختر ملف اعتماد Google OAuth (JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: 'cancelled', code: 'CANCELLED' };
    }
    try {
      const { connectYoutubeFromCredentialsFile } = await import('../services/youtube-oauth');
      const result = await connectYoutubeFromCredentialsFile(picked.filePaths[0]);
      return ok(result);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('youtube:completeOAuthFromUrl', async (_e, callbackUrl: unknown) => {
    try {
      const { completeYoutubeOAuthFromCallbackUrl } = await import('../services/youtube-oauth');
      const result = await completeYoutubeOAuthFromCallbackUrl(String(callbackUrl ?? '').trim());
      return ok(result);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('twitter:probePublish', async () => {
    try {
      const { probeTwitterPublish } = await import('../services/twitter-credentials');
      const result = await probeTwitterPublish();
      return result.ok ? ok({ info: result.info }) : { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('permissions:list', () => ok(permissions.listPermissions()));
  ipcMain.handle('permissions:set', (_e, role: string, platform: string, action: Parameters<typeof permissions.setPermission>[2], allowed: boolean) => {
    permissions.setPermission(String(role), String(platform), action, !!allowed);
    return ok(undefined);
  });

  ipcMain.handle('users:list', () => ok(users.listUsers()));
  ipcMain.handle('users:create', (_e, data) => ok({ id: users.createUser(data || {}) }));
  ipcMain.handle('users:update', (_e, id: number, data) => {
    const okUpdate = users.updateUser(sanitizeInt(id, 1), data || {});
    return okUpdate ? ok(undefined) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('users:delete', (_e, id: number) => {
    users.deleteUser(sanitizeInt(id, 1));
    return ok(undefined);
  });
  ipcMain.handle('users:resetPassword', (_e, id: number, password?: string) => {
    if (!password || String(password).length < 8) {
      return { ok: false, error: 'Password required (min 8 chars)', code: 'INVALID_INPUT' };
    }
    const okReset = users.adminResetPassword(sanitizeInt(id, 1), String(password));
    return okReset ? ok(undefined) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('audit:list', () => ok(listAudit()));

  ipcMain.handle('system:perf', () => ok(systemPerf()));
  ipcMain.handle('system:cache', () => ok(cacheStats()));

  ipcMain.handle('migration:guessPaths', () => ok(guessLegacyPaths()));
  ipcMain.handle('migration:importLegacy', (_e, filePath: string) => {
    try {
      const safe = path.resolve(String(filePath));
      // Only allow .db / .sqlite / .working files — no path traversal
      const ext = path.extname(safe).toLowerCase();
      if (!['.db', '.sqlite', '.working'].includes(ext)) {
        return { ok: false, error: 'نوع الملف غير مدعوم', code: 'INVALID_FILE' };
      }
      return ok(importFromLegacyDb(safe));
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'IMPORT_FAILED' };
    }
  });
  ipcMain.handle('migration:pickLegacyFile', async () => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      title: 'Select legacy Eyes Pro database',
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'working'] }],
      properties: ['openFile']
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return ok(null);
    return ok(r.filePaths[0]);
  });

  ipcMain.handle('backup:create', async () => {
    try {
      const b = await createEncryptedBackup('manual');
      return ok({ name: b.name, path: b.path, size: b.size, createdAt: new Date().toISOString() });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('backup:list', () => ok(listBackups()));
  ipcMain.handle('backup:restore', (_e, filePath: string) => {
    try {
      const safe = path.resolve(String(filePath));
      const backupDir = path.resolve(getBackupDir());
      // Prevent path traversal — file must be inside the backup directory
      if (!safe.startsWith(backupDir + path.sep) && safe !== backupDir) {
        return { ok: false, error: 'مسار الملف غير مسموح به' };
      }
      restoreFromBackup(safe);
      return ok(undefined);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('settings:get', (_e, key: string) => {
    const k = sanitizeString(key, 64);
    return ok(getSetting(k));
  });
  ipcMain.handle('settings:getAll', () => ok(getAllSettings()));
  ipcMain.handle('settings:set', (event, key: string, value: string) => {
    const k = sanitizeString(key, 64);
    const v = sanitizeString(value, 8192);
    setSetting(k, v);
    const token = getSessionToken(event);
    if (token) bindSession(event, token);
    return ok(undefined);
  });

  ipcMain.on('window:minimize', () => getWin()?.minimize());
  ipcMain.on('window:maximize', () => {
    const w = getWin();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('window:close', () => getWin()?.close());

  ipcMain.handle('trendRadar:list', (_e, geo?: string) => ok(trendRadar.listTrends(geo)));
  ipcMain.handle('trendRadar:get', (_e, trendId: number) => ok(trendRadar.getTrend(sanitizeInt(trendId, 1))));
  ipcMain.handle('trendRadar:stats', () => ok(trendRadar.trendStats()));
  ipcMain.handle('trendRadar:update', (_e, trendId: number, data: { title?: string; description?: string }) =>
    ok({ ok: trendRadar.updateTrend(sanitizeInt(trendId, 1), data ?? {}) })
  );
  ipcMain.handle('trendRadar:reset', (_e, trendId: number) =>
    ok({ ok: trendRadar.resetTrend(sanitizeInt(trendId, 1)) })
  );
  ipcMain.handle('trendRadar:fetch', async (_e, geo: string) => ok(await trendRadar.fetchTrendsForGeo(geo)));
  ipcMain.handle('trendRadar:generate', async (event, trendId: number) => {
    const u = getSessionFromEvent(event);
    const r = await trendRadar.generateCoverage(sanitizeInt(trendId, 1), u?.id);
    if (!r.ok) return { ok: false, error: r.error ?? 'Generate failed', code: 'AI_FAILED' };
    return ok({ articleId: r.articleId });
  });
  ipcMain.handle('trendRadar:dismiss', (_e, trendId: number) =>
    ok({ ok: trendRadar.dismissTrend(sanitizeInt(trendId, 1)) })
  );

  ipcMain.handle('trendRadar:listSources', () => ok(trendSources.listSources()));
  ipcMain.handle('trendRadar:sourceTypeInfo', () => ok(trendSources.SOURCE_TYPE_INFO));
  ipcMain.handle('trendRadar:addSource', (_e, payload: { name: string; type: string; url: string; region_tag?: string }) =>
    trendSources.addSource(payload as Parameters<typeof trendSources.addSource>[0])
  );
  ipcMain.handle('trendRadar:deleteSource', (_e, id: number) =>
    trendSources.deleteSource(sanitizeInt(id, 1))
  );
  ipcMain.handle('trendRadar:toggleSource', (_e, id: number, enabled: boolean) =>
    ok(trendSources.toggleSource(sanitizeInt(id, 1), Boolean(enabled)))
  );
  ipcMain.handle('trendRadar:fetchSource', async (_e, id: number) =>
    ok(await trendRadar.fetchFromSource(sanitizeInt(id, 1)))
  );
  ipcMain.handle('trendRadar:fetchAll', async () => ok(await trendRadar.fetchAllSources()));

  ipcMain.handle('autopilot:status', () => ok(autopilot.getAutopilotStatus()));
  ipcMain.handle('autopilot:config', () => ok(autopilot.getAutopilotConfig()));
  ipcMain.handle('autopilot:setConfig', (_e, partial: Partial<autopilot.AutopilotConfig>) =>
    ok(autopilot.setAutopilotConfig(partial ?? {}))
  );
  ipcMain.handle('autopilot:runs', (_e, limit?: number) =>
    ok(autopilot.listAutopilotRuns(sanitizeInt(limit ?? 20, 1, 100)))
  );
  ipcMain.handle('autopilot:stop', () => {
    autopilot.requestAutopilotStop();
    return ok({ ok: true });
  });
  ipcMain.handle('autopilot:run', async (event) => {
    const u = getSessionFromEvent(event);
    const win = getWin();
    const result = await autopilot.runAutopilotOnce(u?.id, (progress) => {
      win?.webContents.send('autopilot:progress', progress);
    });
    if (!result.ok && result.generated === 0 && result.errors.length) {
      return { ok: false, error: result.errors[0], code: 'AUTOPILOT_FAILED', data: result };
    }
    return ok(result);
  });

  ipcMain.handle('publish:platforms', () => ok(publish.listPublishPlatforms()));
  ipcMain.handle('publish:one', async (_e, articleId: number, platform: string, text: string, link?: string) =>
    ok(await publish.publishOne({
      articleId: sanitizeInt(articleId, 1),
      platform: sanitizeString(String(platform), 32),
      text: String(text ?? ''),
      link: typeof link === 'string' ? link : undefined,
    }))
  );
  ipcMain.handle('publish:crossPost', async (_e, articleId: number, platforms: string[], text: string, link?: string) =>
    ok(await publish.publishCrossPost(
      sanitizeInt(articleId, 1),
      Array.isArray(platforms) ? platforms.map((p) => sanitizeString(String(p), 32)) : [],
      String(text ?? ''),
      typeof link === 'string' ? link : undefined,
    ))
  );

  ipcMain.handle('social:openShare', async (_e, url: unknown, clipboardText?: unknown) => {
    try {
      if (typeof url !== 'string' || !url.trim()) {
        return { ok: false, error: 'رابط المشاركة غير صالح', code: 'INVALID_URL' };
      }
      const parsed = new URL(url.trim());
      // Allow http/https share intents and mailto: for email sharing
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return { ok: false, error: 'بروتوكول الرابط غير مدعوم', code: 'INVALID_URL' };
      }
      // mailto: doesn't have a hostname — allow directly
      if (parsed.protocol === 'mailto:') {
        await shell.openExternal(parsed.toString());
        return ok({ opened: true });
      }
      if (!isAllowedShareHost(parsed.hostname)) {
        return { ok: false, error: `منصة غير مدعومة: ${parsed.hostname}`, code: 'INVALID_HOST' };
      }
      if (typeof clipboardText === 'string' && clipboardText.trim()) {
        clipboard.writeText(clipboardText);
      }
      await shell.openExternal(parsed.toString());
      return ok({ opened: true });
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'INVALID_URL' };
    }
  });

  try {
    registerAdvancedHandlers(ipcMain, getWin);
  } catch (err) {
    console.error('[ipc] registerAdvancedHandlers failed:', err);
  }

  // License
  ipcMain.handle('license:status',     handleLicenseStatus);
  ipcMain.handle('license:activate',   (e, serial: string) => handleLicenseActivate(e, serial));
  ipcMain.handle('license:deactivate', handleLicenseDeactivate);
  ipcMain.handle('license:info',       handleLicenseInfo);
}
