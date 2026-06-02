import { app } from 'electron';
import { createLogger } from '../logger';
import { getSetting } from './settings';

const log = createLogger('updater');

export interface UpdaterStatus {
  available: boolean;
  version?: string;
  downloaded: boolean;
  error?: string;
}

let status: UpdaterStatus = { available: false, downloaded: false };
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null;

export async function initUpdater(onEvent?: (channel: string, data: unknown) => void): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const mod = await import('electron-updater');
    autoUpdater = mod.autoUpdater;
    autoUpdater.autoDownload = false;
    const feed = getSetting('updater_feed_url');
    if (feed) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    }
    autoUpdater.on('update-available', (info) => {
      status = { available: true, version: info.version, downloaded: false };
      onEvent?.('updater:available', info);
    });
    autoUpdater.on('update-downloaded', (info) => {
      status = { ...status, downloaded: true, version: info.version };
      onEvent?.('updater:downloaded', info);
    });
    autoUpdater.on('error', (err) => {
      status = { ...status, error: err.message };
      log.warn('updater error', { error: err.message });
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
  if (!autoUpdater) return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    status.error = (e as Error).message;
  }
  return getUpdaterStatus();
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater?.downloadUpdate();
}

export function installUpdate(): void {
  autoUpdater?.quitAndInstall();
}
