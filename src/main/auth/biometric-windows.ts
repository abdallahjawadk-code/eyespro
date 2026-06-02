import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/database';

const execFileAsync = promisify(execFile);

export async function checkBiometricAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$avail = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync().GetAwaiter().GetResult()
Write-Output $avail.ToString()
`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 15_000
    });
    return stdout.includes('Available');
  } catch {
    return false;
  }
}

export async function requestBiometric(message: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const safeMsg = message.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$r = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${safeMsg}').GetAwaiter().GetResult()
Write-Output $r.ToString()
`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 60_000
    });
    return stdout.trim() === 'Verified';
  } catch {
    return false;
  }
}

export function setBiometricEnabled(userId: number, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO user_biometric (user_id, enabled) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled`
    )
    .run(userId, enabled ? 1 : 0);
}

export function isBiometricEnabled(userId: number): boolean {
  const row = getDb().prepare(`SELECT enabled FROM user_biometric WHERE user_id=?`).get(userId) as
    | { enabled: number }
    | undefined;
  return !!row?.enabled;
}
