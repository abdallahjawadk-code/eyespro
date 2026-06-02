import type { IpcMainInvokeEvent } from 'electron';
import { getMachineId } from './machine-id';
import {
  loadLicense, saveLicense, clearLicense,
  isWithinGrace, needsReverify,
  isInTrial, getTrialRemainingMs, getOrCreateTrialStart
} from './license-store';
import { activateLicense, verifyLicense, deactivateLicense } from './license-client';

export type LicenseStatus =
  | { ok: true;  serial: string; trial?: boolean; trialRemainingMs?: number }
  | { ok: false; reason: 'not_activated' | 'expired' | 'revoked' | 'network_error' | 'trial_expired'; error?: string; trialRemainingMs?: number };

/** Called at startup — returns whether the app should proceed. */
export async function checkLicenseOnStartup(): Promise<LicenseStatus> {
  // Developer/owner bypass — set EYESPRO_BYPASS_LICENSE=1 before launching
  if (process.env.EYESPRO_BYPASS_LICENSE === '1') {
    return { ok: true, serial: 'bypass' };
  }

  const rec = loadLicense();

  // No license — check trial period
  if (!rec) {
    // Ensure trial start is recorded on first call
    getOrCreateTrialStart();
    if (isInTrial()) {
      return { ok: true, serial: 'trial', trial: true, trialRemainingMs: getTrialRemainingMs() };
    }
    return { ok: false, reason: 'trial_expired', trialRemainingMs: 0 };
  }

  // Within 30-day cache — no server call needed
  if (!needsReverify(rec)) {
    return { ok: true, serial: rec.serial };
  }

  // Re-verify with Keygen
  try {
    const res = await verifyLicense(rec.serial, rec.machine_id);
    if (res.ok) {
      saveLicense({ ...rec, verified_at: Date.now() });
      return { ok: true, serial: rec.serial };
    }
    if (res.error === 'network_error') {
      // Server unreachable — use 7-day grace period
      if (isWithinGrace(rec)) return { ok: true, serial: rec.serial };
      return { ok: false, reason: 'network_error', error: 'تعذّر الاتصال بخادم التراخيص' };
    }
    clearLicense();
    return { ok: false, reason: 'revoked', error: res.error };
  } catch {
    if (isWithinGrace(rec)) return { ok: true, serial: rec.serial };
    return { ok: false, reason: 'network_error', error: 'تعذّر الاتصال بخادم التراخيص' };
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

export async function handleLicenseStatus(_e: IpcMainInvokeEvent): Promise<LicenseStatus> {
  return checkLicenseOnStartup();
}

export async function handleLicenseActivate(
  _e: IpcMainInvokeEvent,
  licenseKey: string
): Promise<{ ok: boolean; error?: string }> {
  const key = String(licenseKey).trim();
  if (!key) return { ok: false, error: 'أدخل رمز التفعيل' };

  const machineId = getMachineId();
  const res = await activateLicense(key, machineId);

  if (res.ok) {
    saveLicense({
      serial: key,
      machine_id: machineId,
      machine_token: res.token ?? res.licenseId ?? '',
      verified_at: Date.now(),
      expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
  }

  return { ok: res.ok, error: res.error };
}

export async function handleLicenseDeactivate(_e: IpcMainInvokeEvent): Promise<{ ok: boolean; error?: string }> {
  const rec = loadLicense();
  if (!rec) return { ok: true };
  if (rec.machine_token) {
    await deactivateLicense(rec.serial, rec.machine_token).catch(() => {});
  }
  clearLicense();
  return { ok: true };
}

export function handleLicenseInfo(_e: IpcMainInvokeEvent): { machine_id: string } {
  return { machine_id: getMachineId() };
}
