/* ── app-guard.ts ──────────────────────────────────────────────────────────
   Application Entry Protection & Anti-Tampering System
   Masar - EyesPro v1.0.0
   
   Features:
   - Anti-debugging protection
   - Trial verification on startup
   - License validation
   - Tampering detection
──────────────────────────────────────────────────────────────────────────── */

import { app, dialog, BrowserWindow, net } from 'electron';
import type { TrialStatus } from '../licensing/trial-manager';
import { getTrialStatus } from '../licensing/trial-manager';
import type { LicenseStatus } from '../licensing/license-guard';
import { checkLicenseOnStartup } from '../licensing/license-guard';
import { createLogger } from '../logger';
import {
  performSecurityCheck,
  getHardwareFingerprint
} from '../security/security-utils';

const log = createLogger('app-guard');

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  trialStatus?: TrialStatus;
  licenseStatus?: LicenseStatus;
  shouldShowTrialReminder: boolean;
}

/**
 * Enhanced Anti-debugging checks with all security features
 */
function antiDebugChecks(): boolean {
  // Run anti-RE checks only in packaged builds. NODE_ENV is unset in a packaged
  // Electron app, so app.isPackaged is the reliable production signal — gating on
  // NODE_ENV meant these checks never ran in shipped builds.
  if (app.isPackaged) {
    // Run comprehensive security check for telemetry only.
    //
    // These JS-level self-checks (VM heuristics, debugger timing, file
    // existence) are inherently fragile and produce false positives on
    // legitimate machines — Win11 has no `wmic`, customers run inside VMs,
    // a busy CPU trips the timing check. Blocking startup on them locks out
    // paying users. The real anti-tamper / anti-RE protection is the binary
    // layer (Electron Fuses, V8 bytecode, signed asar) plus the server-side
    // Keygen license, none of which depend on these heuristics. So we log the
    // signals and always allow startup.
    try {
      const security = performSecurityCheck();
      if (security.vmDetected) log.warn('VM/Sandbox indicators present', { indicators: security.indicators });
      if (security.debuggerDetected) log.warn('Debugger indicators present');
      if (!security.integrityValid) log.warn('Integrity heuristic flagged (non-blocking)');

      const hwid = getHardwareFingerprint();
      log.info(`Hardware ID: ${hwid.combined.substring(0, 16)}...`);
    } catch (e) {
      log.warn('Security self-check errored (non-blocking)', { error: (e as Error).message });
    }
  }

  return true;
}

/**
 * Check internet connectivity by pinging Keygen API.
 * Returns true if reachable, false otherwise.
 */
async function checkInternetConnectivity(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      try { req.abort(); } catch { /* already finished */ }
      resolve(result);
    };
    // net.request ignores a `timeout` constructor option, so guard with a manual
    // timer — otherwise a hung server would leave the app stuck at startup.
    const timer = setTimeout(() => done(false), 5000);
    const req = net.request({ method: 'HEAD', url: 'https://api.keygen.sh' });
    req.on('response', () => { clearTimeout(timer); done(true); });
    req.on('error', () => { clearTimeout(timer); done(false); });
    req.end();
  });
}

/**
 * Main guard function - called on app startup
 */
export async function runAppGuard(): Promise<GuardResult> {
  log.info('Running application guard checks...');

  // Internet connectivity check
  const isOnline = await checkInternetConnectivity();
  if (!isOnline) {
    log.warn('No internet connection detected');
    await dialog.showMessageBox({
      type: 'warning',
      title: 'تنبيه — لا يوجد اتصال بالإنترنت',
      message: 'تنبيه — لا يوجد اتصال بالإنترنت',
      detail: 'يتطلب EyesPro اتصالاً بالإنترنت للتحقق من الترخيص.\n\nيرجى الاتصال بالإنترنت ثم إعادة تشغيل البرنامج.',
      buttons: ['حسناً'],
      defaultId: 0,
    });
    app.quit();
    return { allowed: false, reason: 'no_internet', shouldShowTrialReminder: false };
  }

  // Anti-debugging
  if (!antiDebugChecks()) {
    return {
      allowed: false,
      reason: 'Debugging environment detected',
      shouldShowTrialReminder: false,
    };
  }
  
  // Check trial status
  const trialStatus = getTrialStatus();
  
  // Check license
  const licenseStatus = await checkLicenseOnStartup();
  
  // The app ALWAYS opens — even when the trial has expired or the license is
  // required. Enforcement happens inside the renderer (App.tsx): it calls
  // license.status() and renders the LicenseScreen (serial entry) instead of the
  // app whenever the status is not ok. During an active trial the welcome screen
  // shows an interactive countdown. If the main process quit here, that
  // activation screen could never be shown and the user could never enter a serial.
  if (!licenseStatus.ok) {
    log.info(`Activation required (${licenseStatus.reason}) — opening license screen`);
  } else if (licenseStatus.trial && trialStatus.daysRemaining <= 1) {
    log.warn(`Trial expiring soon: ${trialStatus.hoursRemaining} hours remaining`);
  }

  return {
    allowed: true,
    trialStatus,
    licenseStatus,
    shouldShowTrialReminder: false,
  };
}

/**
 * Periodic license re-validation. Returns the interval ID so the caller can cancel it.
 */
export function startPeriodicValidation(intervalMinutes = 60): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    log.info('Running periodic license validation...');

    const licenseStatus = await checkLicenseOnStartup();
    if (!licenseStatus.ok) {
      const trialStatus = getTrialStatus();

      if (!trialStatus.isValid) {
        log.error('License invalid and trial expired - blocking app');

        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send('license-expired');
        }
      }
    }
  }, intervalMinutes * 60 * 1000);
}
