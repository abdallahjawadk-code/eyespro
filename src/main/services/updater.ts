import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createLogger } from '../logger';
import { getSetting } from './settings';

const log = createLogger('updater');

export interface UpdaterStatus {
  currentVersion: string;
  available: boolean;
  version?: string;
  downloaded: boolean;
  checking: boolean;
  error?: string;
}

let status: UpdaterStatus = {
  currentVersion: '0.0.0',
  available: false,
  downloaded: false,
  checking: false,
};
let emit: ((channel: string, data: unknown) => void) | undefined;

function pushStatus(): void {
  emit?.('updater:status', getUpdaterStatus());
}

export async function initUpdater(onEvent?: (channel: string, data: unknown) => void): Promise<void> {
  emit = onEvent;
  status.currentVersion = app.getVersion();
  // In dev there is no installer to update; expose the version but skip the feed.
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    // The GitHub feed is baked into app-update.yml by electron-builder's publish config.
    // An optional generic mirror can override it via settings (for self-hosted servers).
    const feed = getSetting('updater_feed_url');
    if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });

    autoUpdater.on('checking-for-update', () => { status.checking = true; pushStatus(); });
    autoUpdater.on('update-available', (info) => {
      status = { ...status, checking: false, available: true, version: info.version, downloaded: false };
      pushStatus();
    });
    autoUpdater.on('update-not-available', () => {
      status = { ...status, checking: false, available: false };
      pushStatus();
    });
    autoUpdater.on('download-progress', (p) => {
      emit?.('updater:progress', {
        percent: Math.round(p.percent),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      status = { ...status, downloaded: true, version: info.version };
      pushStatus();
    });
    autoUpdater.on('error', (err) => {
      status = { ...status, checking: false, error: err.message };
      log.warn('updater error', { error: err.message });
      pushStatus();
    });

    if (getSetting('updater_auto_check') !== '0') {
      setTimeout(() => void checkForUpdates(), 12_000);
    }
  } catch (e) {
    log.warn('electron-updater not available', { error: (e as Error).message });
  }
}

export function getUpdaterStatus(): UpdaterStatus {
  return { ...status };
}

export async function checkForUpdates(): Promise<UpdaterStatus> {
  if (!app.isPackaged) return getUpdaterStatus();
  status.checking = true;
  status.error = undefined;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    status.checking = false;
    status.error = (e as Error).message;
    pushStatus();
  }
  return getUpdaterStatus();
}

export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return;
  await autoUpdater.downloadUpdate();
}

export function installUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
}
