import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { initSentry, sentryCapture } from './monitoring/sentry';
import { createLogger } from './logger';
import { initDatabase, shutdownDatabase } from './db/database';
import { registerIpcHandlers } from './ipc/register-handlers';
import { createMainWindow } from './window';
import { scheduleDailyBackups, applyPendingRestoreIfAny } from './services/backup';
import { startScheduler } from './services/scheduler';
import { processPendingJobs } from './services/ai';
import { runAlertCheck } from './services/analytics';
import { loadActiveTenant } from './services/tenant';
import { initUpdater } from './services/updater';
import { startApiServer } from './services/api-server';
import { getSetting } from './services/settings';
import { autoBindAdminSession } from './auth/auth-service';
import { pruneExpiredSessions } from './auth/session-store';
import { getDb } from './db/database';
import { processPipelineJobs } from './services/pipeline-jobs';
import { initBuiltinOllamaOnStartup, shutdownBuiltinOllama } from './services/ollama-manager';
import { realpathSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { warmProxyPool } from './net/proxy-pool';
import { startTor, stopTor } from './services/tor-manager';

// Ensure dev and production share the same userData path
app.setName('EyesPro');

// Register eyesmedia:// protocol for serving local media files securely
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'eyesmedia', privileges: { stream: true, bypassCSP: false, supportFetchAPI: true, corsEnabled: false } }
]);

// Initialise error reporting before any async work so uncaught errors are captured
initSentry();

const log = createLogger('main');

let mainWindow: ReturnType<typeof createMainWindow> | null = null;

// Allowed directories for eyesmedia:// — computed after app.whenReady
let MEDIA_ROOTS: string[] = [];

app.whenReady().then(() => {
  // Allow media only from userData subdirs and app resources
  MEDIA_ROOTS = [
    normalize(join(app.getPath('userData'), 'media')),
    normalize(join(app.getPath('userData'), 'uploads')),
    normalize(join(app.getPath('userData'), 'downloads')),
  ];

  // Handle eyesmedia://local/<encoded-abs-path> → stream local file (media dir only)
  protocol.handle('eyesmedia', (request) => {
    try {
      const url = new URL(request.url);
      // Reconstruct the encoded path — pathname may be split across host+path for drive-letter URLs
      const rawEncoded = (url.hostname ? url.hostname + url.pathname : url.pathname)
        .replace(/^\/?(local\/)?/, '');
      const rawPath = decodeURIComponent(rawEncoded);
      const filePath = normalize(rawPath);

      // Security: resolve realpath and ensure file is under an allowed root
      const realFile = existsSync(filePath) ? realpathSync(filePath) : filePath;
      // Case-insensitive comparison on Windows
      const normalizedFile = process.platform === 'win32' ? realFile.toLowerCase() : realFile;
      const sep = process.platform === 'win32' ? '\\' : '/';
      const allowed = MEDIA_ROOTS.some((root) => {
        const r = process.platform === 'win32' ? root.toLowerCase() : root;
        return normalizedFile.startsWith(r + sep) || normalizedFile === r;
      });
      if (!allowed) {
        log.warn(`eyesmedia blocked: ${realFile} not under allowed roots`);
        return new Response('Forbidden', { status: 403 });
      }

      // Use pathToFileURL so special characters in the filename (e.g. '#', '·', '｜',
      // spaces) are properly percent-encoded. Building the file:// URL by hand left a
      // raw '#' that net.fetch treated as a fragment, truncating the path → "Not found".
      return net.fetch(pathToFileURL(realFile).href);
    } catch (e) {
      log.warn('eyesmedia error', { error: (e as Error).message });
      return new Response('Not found', { status: 404 });
    }
  });

  applyPendingRestoreIfAny();
  initDatabase();
  getDb().prepare("UPDATE pipeline_jobs SET status='pending' WHERE status='running'").run();
  getDb().prepare("UPDATE job_queue SET status='pending' WHERE status='running'").run();
  mainWindow = createMainWindow();
  if (getSetting('auto_login') !== '0') autoBindAdminSession(mainWindow.webContents);
  registerIpcHandlers(ipcMain, () => mainWindow);
  scheduleDailyBackups();
  startScheduler();
  setInterval(() => void processPendingJobs(3), 30_000);
  setInterval(() => void processPipelineJobs(), 30_000);
  setInterval(() => runAlertCheck(), 6 * 60 * 60 * 1000);
  loadActiveTenant();
  setInterval(() => pruneExpiredSessions(), 60 * 60 * 1000);
  setInterval(() => getDb().prepare(`DELETE FROM login_attempts WHERE created_at < datetime('now','-7 days')`).run(), 24 * 60 * 60 * 1000);
  if (getSetting('api_server_enabled') === '1') startApiServer();
  void initBuiltinOllamaOnStartup();
  void initUpdater((channel, data) => mainWindow?.webContents.send(channel, data));
  warmProxyPool(); // pre-load free proxy pool in background
  void startTor(); // Auto-start Tor if enabled in settings
  // Auto-update yt-dlp daily from GitHub releases (non-blocking)
  void import('./services/media-downloader').then((m) => m.scheduleYtDlpAutoUpdate()).catch(() => { /* ignore */ });
  // Auto-update the media engine (ffmpeg) from its server in the background, weekly at
  // most. Delayed so it never competes with startup; the bundled build works meanwhile.
  setTimeout(() => {
    void import('./services/media-tools').then((m) => m.maybeAutoUpdateMediaTools()).catch(() => { /* ignore */ });
  }, 20_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      if (getSetting('auto_login') !== '0') autoBindAdminSession(mainWindow.webContents);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopTor();
  shutdownBuiltinOllama();
  shutdownDatabase();
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { error: err.message });
  sentryCapture(err);
});
