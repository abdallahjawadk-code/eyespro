import { dialog, shell, type BrowserWindow, type IpcMain, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loginByUserId } from '../auth/auth-service';
import { createArticle, updateArticle } from '../services/articles';
import { sanitizeInt } from '../security/sanitize';
import { getSessionFromEvent } from '../auth/session-store';
import { pinStatus, removePin, setPin, verifyPin } from '../auth/pin-auth';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  requestBiometric,
  setBiometricEnabled
} from '../auth/biometric-windows';
import {
  apiStatus,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  startApiServer,
  stopApiServer
} from '../services/api-server';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterStatus,
  installUpdate
} from '../services/updater';
import {
  createTenant,
  currentTenant,
  listTenants,
  switchTenant
} from '../services/tenant';
import { checkVideoTools, importVideoToArticle, transcodeForPlatform, validateVideoFile, probeVideo, PLATFORM_SPECS } from '../services/video';
import { prepareForPlayback } from '../services/video-playback';
import { getMediaToolsInfo, updateMediaTools } from '../services/media-tools';
import { getMediaPath, importMediaFile } from '../services/media';
import { fetchUrlGuarded } from '../net/guarded-fetch';
import { getPoolStats } from '../net/proxy-pool';
import { isPlaywrightAvailable } from '../net/browser-fetch';
import { getSetting, setSetting } from '../services/settings';
import { getTorStatus, rotateTorIp, startTor, stopTor } from '../services/tor-manager';
import { crawlWebsite, type CrawlOptions } from '../services/deep-crawler';
import type { DownloadQuality } from '../services/media-downloader';
import { vaultAvailable } from '../security/secrets-vault';
import { generateReport, generateReportHtml } from '../services/report-generator';
import type { ApiResult } from '../../shared/api-types';
import { isDuplicate, findNearDuplicates, backfillSimhashes, storeSimhash } from '../services/dedup';
import { transcribeUrl, transcribeArticleVideo } from '../services/transcribe';
import { advancedDashboard, topicTrends, platformPerformance, contentTypeStats, sourcePerformance, readinessFunnel, topPublishedArticles } from '../services/analytics-advanced';
import { listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint, listDeliveries, testEndpoint, type WebhookEvent } from '../services/webhooks';
import { processImageFromUrl, processWithSiteWatermark } from '../services/image-processor';
import { generateArticle, generateVariants } from '../services/ai-generator';
import { clusterArticles, getClusterByArticleId } from '../services/story-cluster';
import { proofreadArticle, aiProofread } from '../services/proofreader';
import { listTerms, createTerm, updateTerm, deleteTerm, applyGlossary, applyGlossaryToArticle, bulkApplyGlossary } from '../services/glossary';
import { listRecycleRules, createRecycleRule, updateRecycleRule, deleteRecycleRule, findRecycleCandidates, recycleArticle } from '../services/recycle';
import { editorStats, teamReport } from '../services/editor-reports';
import { getPwaManifest } from '../services/mobile-api';
import {
  createVideoJob,
  generateVideoScript,
  generateVideo,
  listVideoJobs,
  getVideoJob
} from '../services/video-factory';
import {
  listMonitors,
  addMonitor,
  deleteMonitor,
  checkMonitor,
  checkAllMonitors,
  listSnapshots,
  markRead,
  rewriteSnapshot,
  getUnreadCount,
  type MonitorSourceType,
  type ExtraConfig,
} from '../services/competitor-monitor';
import { openInstagramAuthWindow, isInstagramConnected, disconnectInstagram, testInstagramConnection } from '../services/instagram-auth';
function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function registerAdvancedHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null): void {
  ipcMain.handle('stealth:status', async () =>
    ok({
      enabled: getSetting('stealth_fetch_enabled') === '1',
      browser: getSetting('stealth_browser_enabled') === '1',
      playwright: await isPlaywrightAvailable(),
      vault: vaultAvailable()
    })
  );
  ipcMain.handle('stealth:testFetch', async (_e, url: string, forceBrowser?: boolean, selector?: string) =>
    ok(await fetchUrlGuarded(String(url), { forceBrowser: !!forceBrowser, selector: selector ? String(selector) : undefined }))
  );

  ipcMain.handle('video:tools', () => ok(checkVideoTools()));
  ipcMain.handle('video:probe', async (_e, filePath: string) => ok(await probeVideo(String(filePath))));
  ipcMain.handle('video:specs', () => ok(PLATFORM_SPECS));

  // Universal in-app playback: probe → native / remux / transcode to a playable URL.
  ipcMain.handle('video:prepareForPlayback', async (_e, filePath: string, force?: boolean) => {
    const win = getWin();
    const result = await prepareForPlayback(String(filePath), (pct, mode) =>
      win?.webContents.send('video:prepareProgress', { pct, mode }), !!force,
    );
    return result.ok ? ok(result) : { ok: false, error: result.error };
  });

  // Bundled-vs-updated ffmpeg info + best-effort auto-update of the full media build.
  ipcMain.handle('video:mediaToolsStatus', () => ok(getMediaToolsInfo()));
  ipcMain.handle('video:updateMediaTools', async () => ok(await updateMediaTools()));
  ipcMain.handle('video:pickAndLink', async () => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      title: 'اختر ملف فيديو',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'] }]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return ok(null);
    const filePath = r.filePaths[0];
    const check = validateVideoFile(filePath);
    if (!check.ok) return { ok: false, error: check.error };
    try {
      const mediaId = importMediaFile(filePath);
      const storedPath = getMediaPath(mediaId);
      const videoUrl = storedPath
        ? `eyesmedia://local/${encodeURIComponent(storedPath)}`
        : `eyesmedia://local/${encodeURIComponent(filePath)}`;
      const title = path.basename(filePath, path.extname(filePath));
      const articleId = createArticle({ title, content: '', summary: '', video_url: videoUrl, status: 'draft', ingest_status: 'video_linked' });
      return ok({ articleId, videoUrl, mediaId });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('video:pickAndImport', async () => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov'] }]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return ok(null);
    const p = r.filePaths[0];
    const check = validateVideoFile(p);
    if (!check.ok) return { ok: false, error: check.error };
    const result = await importVideoToArticle(p, (msg) => { win?.webContents.send('video:progress', { msg }); });
    if (!result.ok) return { ok: false, error: result.error };
    return ok(result);
  });

  ipcMain.handle('video:attachToArticle', async (_e, articleId: number) => {
    const win = getWin();
    const opts: OpenDialogOptions = {
      title: 'اختر ملف فيديو لربطه بالمقال',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'] }]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return ok(null);
    const filePath = r.filePaths[0];
    const check = validateVideoFile(filePath);
    if (!check.ok) return { ok: false, error: check.error };
    try {
      const mediaId = importMediaFile(filePath);
      const storedPath = getMediaPath(mediaId);
      const videoUrl = storedPath
        ? `eyesmedia://local/${encodeURIComponent(storedPath)}`
        : `eyesmedia://local/${encodeURIComponent(filePath)}`;
      const updated = updateArticle(Number(articleId), { video_url: videoUrl });
      if (!updated) return { ok: false, error: 'Article not found or update failed' };
      return ok({ videoUrl, mediaId, articleId: Number(articleId) });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('video:importPath', async (_e, filePath: string) =>
    ok(await importVideoToArticle(String(filePath)))
  );
  ipcMain.handle('video:transcode', async (_e, filePath: string, platform: string) => {
    const win = getWin();
    const check = validateVideoFile(String(filePath));
    if (!check.ok) return { ok: false, error: check.error };
    const result = await transcodeForPlatform(String(filePath), String(platform),
      (pct, msg) => win?.webContents.send('video:transcodeProgress', { pct, msg, platform })
    );
    return result.ok ? ok(result) : { ok: false, error: result.error };
  });
  ipcMain.handle('video:transcodeMedia', async (_e, mediaId: number, platforms: string[]) => {
    const win = getWin();
    const filePath = getMediaPath(sanitizeInt(mediaId, 1));
    if (!filePath) return { ok: false, error: 'Media file not found' };
    const check = validateVideoFile(filePath);
    if (!check.ok) return { ok: false, error: check.error };
    const results: Record<string, { ok: boolean; outputPath?: string; error?: string }> = {};
    for (const p of (platforms as string[])) {
      win?.webContents.send('video:transcodeProgress', { pct: 0, msg: `بدء معالجة ${p}…`, platform: p });
      const rr = await transcodeForPlatform(filePath, p, (pct, msg) => win?.webContents.send('video:transcodeProgress', { pct, msg, platform: p }));
      results[p] = rr;
      win?.webContents.send('video:transcodeProgress', { pct: 100, msg: rr.ok ? `✓ ${p}` : `✕ ${p}: ${rr.error}`, platform: p });
    }
    return ok(results);
  });
  ipcMain.handle('video:transcodeMany', async (_e, filePath: string, platforms: string[]) => {
    const win = getWin();
    const check = validateVideoFile(String(filePath));
    if (!check.ok) return { ok: false, error: check.error };
    const results: Record<string, { ok: boolean; outputPath?: string; error?: string }> = {};
    for (const p of (platforms as string[])) {
      win?.webContents.send('video:transcodeProgress', { pct: 0, msg: `معالجة ${p}…`, platform: p });
      const rr = await transcodeForPlatform(String(filePath), p, (pct, msg) => win?.webContents.send('video:transcodeProgress', { pct, msg, platform: p }));
      results[p] = rr;
    }
    return ok(results);
  });

  ipcMain.handle('api:status', () => ok(apiStatus()));
  ipcMain.handle('api:start', () => ok(startApiServer()));
  ipcMain.handle('api:stop', () => { stopApiServer(); return ok(undefined); });
  ipcMain.handle('api:keysList', () => ok(listApiKeys()));
  ipcMain.handle('api:keyCreate', (_e, name: string, scopes: string[]) =>
    ok(createApiKey(String(name), scopes || ['articles.read']))
  );
  ipcMain.handle('api:keyRevoke', (_e, id: number) => { revokeApiKey(sanitizeInt(id, 1)); return ok(undefined); });

  ipcMain.handle('pin:set', (event, pin: string) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, code: 'UNAUTH' };
    return setPin(u.id, String(pin));
  });
  ipcMain.handle('pin:remove', (event) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, code: 'UNAUTH' };
    removePin(u.id);
    return ok(undefined);
  });
  ipcMain.handle('pin:status', (event) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, code: 'UNAUTH' };
    return ok({ enabled: pinStatus(u.id) });
  });
  ipcMain.handle('pin:login', (event, userId: number, pin: string) => {
    const v = verifyPin(sanitizeInt(userId, 1), String(pin));
    if (!v.ok) return { ok: false, code: v.code, error: v.code };
    return loginByUserId(event, sanitizeInt(userId, 1));
  });

  ipcMain.handle('biometric:check', async () => ok({ available: await checkBiometricAvailable() }));
  ipcMain.handle('biometric:enable', async (event, enable: boolean) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, code: 'UNAUTH' };
    if (enable) {
      const okBio = await requestBiometric('Enable Windows Hello for EyesPro');
      if (!okBio) return { ok: false, error: 'Verification failed' };
    }
    setBiometricEnabled(u.id, !!enable);
    return ok(undefined);
  });
  ipcMain.handle('biometric:status', (event) => {
    const u = getSessionFromEvent(event);
    if (!u) return { ok: false, code: 'UNAUTH' };
    return ok({ enabled: isBiometricEnabled(u.id) });
  });
  ipcMain.handle('biometric:login', async (event, userId: number) => {
    const id = sanitizeInt(userId, 1);
    if (!isBiometricEnabled(id)) return { ok: false, code: 'BIO_NOT_ENABLED' };
    const verified = await requestBiometric('Sign in to EyesPro');
    if (!verified) return { ok: false, code: 'BIO_FAILED' };
    return loginByUserId(event, id);
  });

  ipcMain.handle('tenants:list', () => ok(listTenants()));
  ipcMain.handle('tenants:create', (_e, name: string, slug?: string) =>
    ok({ id: createTenant(String(name), slug) })
  );
  ipcMain.handle('tenants:switch', (_e, id: number | null) => {
    switchTenant(id == null ? null : sanitizeInt(id, 1));
    return ok(currentTenant());
  });
  ipcMain.handle('tenants:current', () => ok(currentTenant()));

  ipcMain.handle('updater:status', () => ok(getUpdaterStatus()));
  ipcMain.handle('updater:check', async () => ok(await checkForUpdates()));
  ipcMain.handle('updater:download', async () => { await downloadUpdate(); return ok(undefined); });
  ipcMain.handle('updater:install', () => { installUpdate(); return ok(undefined); });

  // ── Reports ───────────────────────────────────────────────────────────────
  ipcMain.handle('reports:generate', (_e, period: 'weekly' | 'monthly') => ok(generateReport(period)));
  ipcMain.handle('reports:html', (_e, period: 'weekly' | 'monthly', lang?: string) =>
    ok({ html: generateReportHtml(period, lang === 'en' ? 'en' : 'ar') }));

  // ── Feature 3: Semantic deduplication ────────────────────────────────────
  ipcMain.handle('dedup:check', (_e, title: string, summary: string) =>
    ok(isDuplicate(String(title), String(summary)))
  );
  ipcMain.handle('dedup:findSimilar', (_e, title: string, summary: string, threshold?: number) =>
    ok(findNearDuplicates(String(title), String(summary), threshold ? sanitizeInt(threshold, 0, 16) : 4))
  );
  ipcMain.handle('dedup:backfill', () => ok({ updated: backfillSimhashes() }));
  ipcMain.handle('dedup:store', (_e, articleId: number, title: string, summary: string) => {
    storeSimhash(sanitizeInt(articleId, 1), String(title), String(summary));
    return ok(undefined);
  });

  // ── Feature 4: Video/audio transcription ─────────────────────────────────
  ipcMain.handle('transcribe:url', async (_e, url: string) => ok(await transcribeUrl(String(url))));
  ipcMain.handle('transcribe:article', async (_e, articleId: number) =>
    ok(await transcribeArticleVideo(sanitizeInt(articleId, 1)))
  );

  // ── Feature 5: Advanced analytics ────────────────────────────────────────
  ipcMain.handle('analytics:advanced', () => ok(advancedDashboard()));
  ipcMain.handle('analytics:topics', (_e, days?: number) =>
    ok(topicTrends(days ? sanitizeInt(days, 1, 365) : 30))
  );
  ipcMain.handle('analytics:platformPerf', () => ok(platformPerformance()));
  ipcMain.handle('analytics:contentTypes', () => ok(contentTypeStats()));
  ipcMain.handle('analytics:sources', (_e, limit?: number) =>
    ok(sourcePerformance(limit ? sanitizeInt(limit, 1, 100) : 20))
  );
  ipcMain.handle('analytics:funnel', () => ok(readinessFunnel()));
  ipcMain.handle('analytics:topArticles', (_e, limit?: number) =>
    ok(topPublishedArticles(limit ? sanitizeInt(limit, 1, 50) : 10))
  );

  // ── Feature 6: Webhooks ───────────────────────────────────────────────────
  ipcMain.handle('webhooks:list', () => ok(listEndpoints()));
  ipcMain.handle('webhooks:create', (_e, data: { name: string; url: string; events: WebhookEvent[]; secret?: string }) =>
    ok({ id: createEndpoint({ name: String(data?.name), url: String(data?.url), events: data?.events || [], secret: data?.secret }) })
  );
  ipcMain.handle('webhooks:update', (_e, id: number, data: Parameters<typeof updateEndpoint>[1]) => {
    updateEndpoint(sanitizeInt(id, 1), data || {});
    return ok(undefined);
  });
  ipcMain.handle('webhooks:delete', (_e, id: number) => { deleteEndpoint(sanitizeInt(id, 1)); return ok(undefined); });
  ipcMain.handle('webhooks:deliveries', (_e, endpointId?: number) =>
    ok(listDeliveries(endpointId ? sanitizeInt(endpointId, 1) : undefined))
  );
  ipcMain.handle('webhooks:test', async (_e, id: number) => ok(await testEndpoint(sanitizeInt(id, 1))));

  // ── Feature 7: Image processing ───────────────────────────────────────────
  ipcMain.handle('image:process', async (_e, url: string, opts?: Parameters<typeof processImageFromUrl>[1]) =>
    ok(await processImageFromUrl(String(url), opts || {}))
  );
  ipcMain.handle('image:watermark', async (_e, url: string) => ok(await processWithSiteWatermark(String(url))));

  // ── Feature 9: AI article generator ──────────────────────────────────────
  ipcMain.handle('ai:generate', async (_e, topic: string, opts?: Parameters<typeof generateArticle>[1]) => {
    const r = await generateArticle(String(topic), opts);
    if (!r.ok) return { ok: false, error: r.error ?? 'Generate failed', code: 'AI_FAILED' };
    return ok({ articleId: r.articleId, title: r.title });
  });
  ipcMain.handle('ai:generateVariants', async (_e, topic: string, count?: number, opts?: Parameters<typeof generateArticle>[1]) => {
    const rows = await generateVariants(String(topic), count ? sanitizeInt(count, 1, 10) : 2, opts);
    return ok(rows.filter((r) => r.ok).map((r) => ({ articleId: r.articleId, title: r.title })));
  });

  // ── Feature 10: Story clustering ─────────────────────────────────────────
  ipcMain.handle('cluster:articles', (_e, days?: number, minSources?: number) =>
    ok(clusterArticles(days ? sanitizeInt(days, 1, 90) : 7, minSources ? sanitizeInt(minSources, 1, 20) : 2))
  );
  ipcMain.handle('cluster:byArticle', (_e, articleId: number, days?: number) =>
    ok(getClusterByArticleId(sanitizeInt(articleId, 1), days ? sanitizeInt(days, 1, 90) : 7))
  );

  // ── Feature 11: AI proofreader ────────────────────────────────────────────
  ipcMain.handle('proofread:article', (_e, articleId: number) =>
    ok(proofreadArticle(sanitizeInt(articleId, 1)))
  );
  ipcMain.handle('proofread:ai', async (_e, articleId: number) =>
    ok(await aiProofread(sanitizeInt(articleId, 1)))
  );

  // ── Feature 12: Glossary ──────────────────────────────────────────────────
  ipcMain.handle('glossary:list', () => ok(listTerms()));
  ipcMain.handle('glossary:create', (_e, term: string, replacement: string, caseSensitive?: boolean) =>
    ok({ id: createTerm(String(term), String(replacement), !!caseSensitive) })
  );
  ipcMain.handle('glossary:update', (_e, id: number, data: Parameters<typeof updateTerm>[1]) => {
    updateTerm(sanitizeInt(id, 1), data || {}); return ok(undefined);
  });
  ipcMain.handle('glossary:delete', (_e, id: number) => { deleteTerm(sanitizeInt(id, 1)); return ok(undefined); });
  ipcMain.handle('glossary:apply', (_e, text: string) => ok({ text: applyGlossary(String(text)) }));
  ipcMain.handle('glossary:applyArticle', (_e, articleId: number) =>
    ok(applyGlossaryToArticle(sanitizeInt(articleId, 1)))
  );
  ipcMain.handle('glossary:applyAll', (_e, limit?: number) =>
    ok(bulkApplyGlossary(limit ? sanitizeInt(limit, 1, 5000) : 500))
  );

  // ── Feature 14: Content recycling ────────────────────────────────────────
  ipcMain.handle('recycle:rules:list', () => ok(listRecycleRules()));
  ipcMain.handle('recycle:rules:create', (_e, data: Parameters<typeof createRecycleRule>[0]) =>
    ok({ id: createRecycleRule(data) })
  );
  ipcMain.handle('recycle:rules:update', (_e, id: number, data: Parameters<typeof updateRecycleRule>[1]) => {
    updateRecycleRule(sanitizeInt(id, 1), data || {}); return ok(undefined);
  });
  ipcMain.handle('recycle:rules:delete', (_e, id: number) => { deleteRecycleRule(sanitizeInt(id, 1)); return ok(undefined); });
  ipcMain.handle('recycle:candidates', (_e, rule: Parameters<typeof findRecycleCandidates>[0]) =>
    ok(findRecycleCandidates(rule))
  );
  ipcMain.handle('recycle:article', async (_e, articleId: number) =>
    ok(await recycleArticle(sanitizeInt(articleId, 1), []))
  );

  // ── Feature 18: Editor reports ────────────────────────────────────────────
  ipcMain.handle('reports:editor', (_e, userId?: number, days?: number) =>
    ok(editorStats(userId ? sanitizeInt(userId, 1) : undefined, days ? sanitizeInt(days, 1, 365) : 30))
  );
  ipcMain.handle('reports:team', (_e, days?: number) =>
    ok(teamReport(days ? sanitizeInt(days, 1, 365) : 30))
  );

  // ── Feature 20: Mobile API / PWA ──────────────────────────────────────────
  ipcMain.handle('mobile:manifest', () => ok(getPwaManifest()));

  // ── Video Factory (studio:*) ───────────────────────────────────────────────
  ipcMain.handle('studio:createJob', (_e, articleId: number, template?: string) => {
    try { return ok(createVideoJob(sanitizeInt(articleId, 1), template ? String(template) : 'news')); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('studio:generateScript', async (_e, articleId: number) => {
    try { return ok(await generateVideoScript(sanitizeInt(articleId, 1))); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('studio:runJob', async (_e, jobId: number) => {
    try { return ok(await generateVideo(sanitizeInt(jobId, 1))); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('studio:jobs', () => {
    try { return ok(listVideoJobs()); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('studio:job', (_e, id: number) => {
    try { return ok(getVideoJob(sanitizeInt(id, 1))); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Competitor Monitor (monitor:*) ────────────────────────────────────────
  ipcMain.handle('monitor:list', () => {
    try { return ok(listMonitors()); } catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:add', (_e, name: string, feedUrl: string, websiteUrl?: string, sourceType?: string, fbPageUrl?: string, extraConfigJson?: string) => {
    try {
      // Instagram & TikTok competitor monitoring was removed (unreliable scrapers).
      if (sourceType === 'instagram' || sourceType === 'tiktok') {
        return { ok: false, error: 'رصد المنافسين على Instagram و TikTok متوقّف حالياً' };
      }
      const VALID_TYPES: MonitorSourceType[] = ['rss', 'facebook', 'youtube', 'google_news', 'twitter', 'website'];
      const type: MonitorSourceType = VALID_TYPES.includes(sourceType as MonitorSourceType)
        ? (sourceType as MonitorSourceType)
        : 'rss';
      let extraConfig: ExtraConfig | undefined;
      if (extraConfigJson) {
        try { extraConfig = JSON.parse(String(extraConfigJson)) as ExtraConfig; }
        catch { /* ignore malformed */ }
      }
      return ok(addMonitor(
        String(name),
        feedUrl ? String(feedUrl) : '',
        websiteUrl ? String(websiteUrl) : undefined,
        type,
        fbPageUrl ? String(fbPageUrl) : undefined,
        extraConfig,
      ));
    }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Proxy pool stats ──────────────────────────────────────────────────────
  ipcMain.handle('proxy:stats', () => {
    try {
      return ok(getPoolStats());
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Google News search (on-demand) ────────────────────────────────────────
  ipcMain.handle('scraper:googleNews', async (_e, query: string, language?: string, country?: string, maxResults?: number) => {
    try {
      const { scrapeGoogleNews } = await import('../services/scrapers/google-news-scraper');
      const articles = await scrapeGoogleNews({
        query: String(query),
        language: language ? String(language) : 'ar',
        country: country ? String(country) : 'SA',
        maxResults: maxResults ? Math.min(sanitizeInt(maxResults, 1, 100), 100) : 30,
      });
      return ok(articles);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── YouTube channel scrape (on-demand) ───────────────────────────────────
  ipcMain.handle('scraper:youtube', async (_e, channelInput: string, maxVideos?: number) => {
    try {
      const { scrapeYoutubeChannel } = await import('../services/scrapers/youtube-scraper');
      const videos = await scrapeYoutubeChannel(
        String(channelInput),
        maxVideos ? Math.min(sanitizeInt(maxVideos, 1, 50), 50) : 30,
      );
      return ok(videos);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Twitter scrape (on-demand) ────────────────────────────────────────────
  ipcMain.handle('scraper:twitter', async (_e, handle: string) => {
    try {
      const { scrapeTwitterProfile } = await import('../services/scrapers/twitter-scraper');
      return ok(await scrapeTwitterProfile(String(handle)));
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Instagram scrape (on-demand) ─────────────────────────────────────────
  ipcMain.handle('scraper:instagram', async (_e, username: string) => {
    try {
      const { scrapeInstagramProfile } = await import('../services/scrapers/instagram-scraper');
      return ok(await scrapeInstagramProfile(String(username)));
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── TikTok scrape (on-demand) ─────────────────────────────────────────────
  ipcMain.handle('scraper:tiktok', async (_e, handle: string) => {
    try {
      const { scrapeTikTokProfile } = await import('../services/scrapers/tiktok-scraper');
      return ok(await scrapeTikTokProfile(String(handle)));
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('instagram:login', async () => {
    try { await openInstagramAuthWindow(); return ok(undefined); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('instagram:loggedIn', () => {
    try { return ok(isInstagramConnected()); } catch { return ok(false); }
  });
  ipcMain.handle('instagram:disconnect', async () => {
    try { await disconnectInstagram(); return ok(undefined); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('instagram:test', async () => {
    try { return ok(await testInstagramConnection()); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:delete', (_e, id: number) => {
    try { deleteMonitor(sanitizeInt(id, 1)); return ok(undefined); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:check', async (_e, id: number) => {
    try { return ok(await checkMonitor(sanitizeInt(id, 1))); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:checkAll', async () => {
    try { return ok(await checkAllMonitors()); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:snapshots', (_e, monitorId?: number, limit?: number) => {
    try { return ok(listSnapshots(monitorId != null ? sanitizeInt(monitorId, 1) : undefined, limit ? sanitizeInt(limit, 1, 500) : 100)); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:markRead', (_e, snapshotId: number) => {
    try { markRead(sanitizeInt(snapshotId, 1)); return ok(undefined); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:rewrite', async (_e, snapshotId: number) => {
    try { return ok(await rewriteSnapshot(sanitizeInt(snapshotId, 1))); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('monitor:unreadCount', () => {
    try { return ok(getUnreadCount()); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ── Media Downloader (yt-dlp) ─────────────────────────────────────────────
  ipcMain.handle('downloader:status', async () => {
    try {
      const mod = await import('../services/media-downloader');
      const installed = mod.isYtDlpInstalled();
      const version = installed ? await mod.getYtDlpVersion() : 'not installed';
      return ok({ installed, version });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:update', async () => {
    try {
      const { updateYtDlp } = await import('../services/media-downloader');
      return ok(await updateYtDlp());
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:install', async () => {
    try {
      const { ensureYtDlp } = await import('../services/media-downloader');
      const path = await ensureYtDlp();
      return ok({ path });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:start', async (_event, url: string, quality: string, jobId: string) => {
    try {
      const mod = await import('../services/media-downloader');
      const win = getWin();
      // Push progress events to renderer
      mod.setProgressCallback((job) => {
        win?.webContents.send('downloader:progress', job);
      });
      // Start download in background — don't await
      void mod.downloadMedia(String(url), (quality || 'best') as DownloadQuality, String(jobId));
      return ok({ jobId });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:list', async () => {
    try {
      const { listDownloads } = await import('../services/media-downloader');
      return ok(listDownloads());
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:openFolder', async () => {
    try {
      const { getDownloadsDir_ } = await import('../services/media-downloader');
      await shell.openPath(getDownloadsDir_());
      return ok(undefined);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:openFile', async (_e, filePath: string) => {
    try {
      const p = String(filePath).trim();
      const err = await shell.openPath(p);
      if (err) {
        // Fallback: open containing folder and highlight file
        shell.showItemInFolder(p);
      }
      return ok(undefined);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Reveal the file selected in the OS file manager so the user can share it via the
  // system share menu / drag it into a chat app (works for any local/edited file).
  ipcMain.handle('downloader:revealFile', (_e, filePath: string) => {
    try {
      shell.showItemInFolder(String(filePath).trim());
      return ok(undefined);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Copy the actual video FILE to the clipboard (Windows file-drop / CF_HDROP) so the user
  // can paste it straight into WhatsApp / Telegram / any chat app — no public link needed.
  // Electron's clipboard can't write a file-drop, so we use the .NET clipboard via PowerShell.
  // The path is passed through an env var (not the command string) to avoid any quoting/injection.
  ipcMain.handle('downloader:copyFile', (_e, filePath: string) => {
    const p = String(filePath ?? '').trim();
    if (!p) return Promise.resolve({ ok: false, error: 'no file path' });
    if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'only supported on Windows' });
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      "if (-not (Test-Path -LiteralPath $env:EYESPRO_SHARE_FILE)) { exit 2 };",
      '$c = New-Object System.Collections.Specialized.StringCollection;',
      '$c.Add($env:EYESPRO_SHARE_FILE) | Out-Null;',
      '[System.Windows.Forms.Clipboard]::SetFileDropList($c);',
    ].join(' ');
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
        { env: { ...process.env, EYESPRO_SHARE_FILE: p }, timeout: 15000, windowsHide: true },
        (err) => {
          if (err) resolve({ ok: false, error: (err as Error).message });
          else resolve(ok(undefined));
        },
      );
    });
  });

  ipcMain.handle('downloader:clear', async () => {
    try {
      const { clearCompletedDownloads } = await import('../services/media-downloader');
      clearCompletedDownloads();
      return ok(undefined);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:info', async (_e, url: string) => {
    try {
      const { getVideoInfo } = await import('../services/media-downloader');
      return ok(await getVideoInfo(String(url)));
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:scan', async () => {
    try {
      const { scanDownloads } = await import('../services/media-downloader');
      return ok(scanDownloads());
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:trim', async (_e, inputPath: string, startSec: number, endSec: number) => {
    try {
      const { trimVideo } = await import('../services/media-downloader');
      const out = await trimVideo(String(inputPath), Number(startSec), Number(endSec));
      return ok({ outputPath: out });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:watermark', async (_e, inputPath: string, text: string, position: string) => {
    try {
      const { addWatermark } = await import('../services/media-downloader');
      const out = await addWatermark(String(inputPath), String(text), position as 'bottom_right');
      return ok({ outputPath: out });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:resize', async (_e, inputPath: string, platform: string) => {
    try {
      const { resizeForPlatform } = await import('../services/media-downloader');
      const out = await resizeForPlatform(String(inputPath), platform as 'tiktok');
      return ok({ outputPath: out });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:extractAudio', async (_e, inputPath: string) => {
    try {
      const { extractAudio } = await import('../services/media-downloader');
      const out = await extractAudio(String(inputPath));
      return ok({ outputPath: out });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:delete', async (_e, filePath: string) => {
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(String(filePath));
      return ok(undefined);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('downloader:mediaUrl', (_e, filePath: string) => {
    try {
      const p = String(filePath);
      // On Windows: C:\path\file.mp4 → eyesmedia://local/C%3A%5Cpath%5Cfile.mp4
      // Use encodeURIComponent on the full path so the protocol handler can decode it
      const encoded = encodeURIComponent(p.replace(/\\/g, '/'));
      return ok(`eyesmedia://local/${encoded}`);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // ─── Tor & Deep Crawler IPC Handlers ────────────────────────────────────────

  ipcMain.handle('tor:status', () => {
    return ok(getTorStatus());
  });

  ipcMain.handle('tor:rotate', async () => {
    try {
      const success = await rotateTorIp();
      return ok({ success });
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('tor:toggle', async (_e, enabled: boolean) => {
    try {
      setSetting('tor_enabled', enabled ? 'true' : 'false');
      if (enabled) {
        await startTor();
      } else {
        stopTor();
      }
      return ok(getTorStatus());
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  ipcMain.handle('crawler:crawl', async (_e, monitorId: number, startUrl: string, opts?: CrawlOptions) => {
    try {
      const result = await crawlWebsite(sanitizeInt(monitorId, 1), String(startUrl), opts || {});
      return ok(result);
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // NOTE: `social:openShare` is registered in register-handlers.ts (with mailto
  // support + a wider allow-list). Registering it again here threw
  // "second handler for 'social:openShare'", which aborted registration of every
  // advanced handler below it (e.g. templates:publish:list). Keep it in one place.

}
