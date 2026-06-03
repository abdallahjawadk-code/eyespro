import { safeStorage, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface LicenseRecord {
  serial: string;       // the license key entered by user
  machine_id: string;
  machine_token: string; // Keygen machine ID (for deactivation)
  verified_at: number;   // unix ms — last successful server check
  expires_at: number;    // unix ms — local cache expiry
}

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;   // 7-day offline grace period
const RENEW_MS = 30 * 24 * 60 * 60 * 1000;  // re-verify every 30 days
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;   // 3-day trial period

function storePath(): string {
  return path.join(app.getPath('userData'), 'EyesPro', '.license');
}

function trialPath(): string {
  return path.join(app.getPath('userData'), 'EyesPro', '.trial');
}

// ─── Trial anchors ────────────────────────────────────────────────────────────
// The trial start is persisted in FOUR independent places, in THREE different
// persistence domains, so that uninstalling / reinstalling the app (or wiping
// AppData, or clearing one registry key) does NOT reset the free period:
//   1. an encrypted file under userData            (cleared by an AppData wipe)
//   2. an encrypted file under ProgramData         (survives a user-profile/AppData wipe)
//   3. the Windows registry HKCU\Software\EyesProRuntime  (survives uninstall + AppData wipe)
//   4. a second registry key HKCU\Software\MasarRuntime   (redundant, different path)
// On read we take the EARLIEST timestamp found across ALL anchors and re-seed
// every anchor, so a single surviving anchor restores the real first-run date.
// A user must find and clear ALL four (in three domains) to reset — impractical.

const REG_ANCHORS: { key: string; val: string }[] = [
  { key: 'HKCU\\Software\\EyesProRuntime', val: 'InstallTag' },
  { key: 'HKCU\\Software\\MasarRuntime', val: 'cfg' },
];

/** A machine-wide file outside the user profile — survives an AppData wipe. */
function programDataTrialPath(): string {
  const base = process.env.ProgramData || process.env.ALLUSERSPROFILE || 'C:\\ProgramData';
  return path.join(base, 'EyesPro', '.syscache');
}

/** Encrypt a timestamp to a shell-safe hex string (DPAPI when available). */
function encodeTs(ts: number): string {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(String(ts))
    : Buffer.from(String(ts), 'utf8');
  return buf.toString('hex');
}
function decodeTs(hex: string): number | null {
  try {
    const buf = Buffer.from(hex, 'hex');
    const plain = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
    const v = parseInt(plain, 10);
    return !isNaN(v) && v > 0 ? v : null;
  } catch { return null; }
}

function readFileAnchor(): number | null {
  try {
    const raw = fs.readFileSync(trialPath());
    const plain = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    const v = parseInt(plain, 10);
    return !isNaN(v) && v > 0 ? v : null;
  } catch { return null; }
}
function writeFileAnchor(ts: number): void {
  try {
    const dir = path.dirname(trialPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(ts))
      : Buffer.from(String(ts), 'utf8');
    fs.writeFileSync(trialPath(), buf);
  } catch { /* ignore */ }
}

function readProgramDataAnchor(): number | null {
  try {
    const raw = fs.readFileSync(programDataTrialPath());
    const plain = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    const v = parseInt(plain, 10);
    return !isNaN(v) && v > 0 ? v : null;
  } catch { return null; }
}
function writeProgramDataAnchor(ts: number): void {
  try {
    const dir = path.dirname(programDataTrialPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(ts))
      : Buffer.from(String(ts), 'utf8');
    fs.writeFileSync(programDataTrialPath(), buf);
  } catch { /* ignore */ }
}

function readRegAnchor(key: string, val: string): number | null {
  try {
    const out = execSync(`reg query "${key}" /v ${val}`, {
      encoding: 'utf8', windowsHide: true, timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(new RegExp(`${val}\\s+REG_SZ\\s+(\\S+)`));
    return m ? decodeTs(m[1]!) : null;
  } catch { return null; }
}
function writeRegAnchor(key: string, val: string, ts: number): void {
  try {
    execSync(`reg add "${key}" /v ${val} /t REG_SZ /d ${encodeTs(ts)} /f`, {
      windowsHide: true, timeout: 5_000, stdio: 'ignore',
    });
  } catch { /* ignore */ }
}

/** Re-seed every anchor with the canonical first-run timestamp. */
function seedAllAnchors(ts: number): void {
  writeFileAnchor(ts);
  writeProgramDataAnchor(ts);
  for (const a of REG_ANCHORS) writeRegAnchor(a.key, a.val, ts);
}

/**
 * Returns the timestamp (ms) of first launch, creating it if absent.
 * Resistant to reinstall: reads all anchors (2 files + 2 registry keys across
 * userData / ProgramData / HKCU), uses the EARLIEST, and re-seeds them all so
 * the trial cannot be reset unless every anchor in every domain is wiped.
 */
export function getOrCreateTrialStart(): number {
  const anchors = [
    readFileAnchor(),
    readProgramDataAnchor(),
    ...REG_ANCHORS.map((a) => readRegAnchor(a.key, a.val)),
  ].filter((x): x is number => typeof x === 'number' && x > 0);

  if (anchors.length > 0) {
    const earliest = Math.min(...anchors);
    seedAllAnchors(earliest); // restore any missing/tampered anchor
    return earliest;
  }

  const now = Date.now();
  seedAllAnchors(now);
  return now;
}

/** Returns remaining trial milliseconds (0 if expired). */
export function getTrialRemainingMs(): number {
  const start = getOrCreateTrialStart();
  const remaining = TRIAL_MS - (Date.now() - start);
  return Math.max(0, remaining);
}

/** Returns true if still within the 3-day trial. */
export function isInTrial(): boolean {
  return getTrialRemainingMs() > 0;
}

export function saveLicense(rec: LicenseRecord): void {
  const dir = path.dirname(storePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const plain = JSON.stringify(rec);
  const cipher = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain)
    : Buffer.from(plain, 'utf8');
  fs.writeFileSync(storePath(), cipher);
}

export function loadLicense(): LicenseRecord | null {
  try {
    const raw = fs.readFileSync(storePath());
    const plain = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    return JSON.parse(plain) as LicenseRecord;
  } catch { return null; }
}

export function clearLicense(): void {
  try { fs.unlinkSync(storePath()); } catch { /* already gone */ }
}

/** Returns true if the stored record is still within the grace period. */
export function isWithinGrace(rec: LicenseRecord): boolean {
  return Date.now() - rec.verified_at < GRACE_MS;
}

/** Returns true if the token needs a server re-check (30-day rolling). */
export function needsReverify(rec: LicenseRecord): boolean {
  return Date.now() - rec.verified_at > RENEW_MS;
}
