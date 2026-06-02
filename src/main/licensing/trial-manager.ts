/* â”€â”€ trial-manager.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Advanced Trial Management System with Anti-Tampering Protection
   Masar - EyesPro v1.0.0
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

import { getDb } from '../db/database';
import { getMachineId } from './machine-id';
import { app } from 'electron';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const TRIAL_DAYS = 3;
const ENCRYPTION_KEY = Buffer.from(process.env.TRIAL_KEY || 'a7982ac6fa0bcf137f5254209c5a25aac55a58841e409bc3f88c898421dae6fa', 'hex');
const ALGORITHM = 'aes-256-gcm';

export interface TrialStatus {
  isValid: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  isExpired: boolean;
  firstRunAt: string | null;
  expiresAt: string | null;
  trialType: 'fresh' | 'active' | 'expired' | 'tampered';
  warnings: string[];
}

interface TrialData {
  machineId: string;
  firstRunAt: string;
  expiresAt: string;
  installPath: string;
  version: string;
  checksum: string;
}

/**
 * Generate encrypted trial file path (hidden)
 */
function getTrialFilePath(): string {
  const appData = app.getPath('userData');
  // Multiple hidden locations for redundancy
  return join(appData, '.config', 'system.cache');
}

function getBackupTrialPath(): string {
  const tempPath = app.getPath('temp');
  return join(tempPath, '.msr', 'data.idx');
}

/**
 * Encrypt trial data with AES-256-GCM
 */
function encryptTrialData(data: TrialData): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY.slice(0, 32), iv);
  
  const jsonData = JSON.stringify(data);
  let encrypted = cipher.update(jsonData, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  const result = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  
  // Add checksum layer
  return Buffer.from(result).toString('base64');
}

function decryptTrialData(encryptedData: string): TrialData | null {
  try {
    const decoded = Buffer.from(encryptedData, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY.slice(0, 32), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted) as TrialData;
  } catch {
    return null;
  }
}

function tamperedStatus(warning: string, firstRunAt: string | null = null, expiresAt: string | null = null): TrialStatus {
  return { isValid: false, daysRemaining: 0, hoursRemaining: 0, isExpired: true, firstRunAt, expiresAt, trialType: 'tampered', warnings: [warning] };
}

/**
 * Calculate checksum for tamper detection
 */
function calculateChecksum(data: Omit<TrialData, 'checksum'>): string {
  const machineId = getMachineId();
  const str = machineId + data.firstRunAt + data.expiresAt + data.installPath;
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Check for system clock tampering
 */
function detectClockTampering(firstRunAt: string): boolean {
  const firstRun = new Date(firstRunAt).getTime();
  const now = Date.now();
  
  // Future date detection
  if (now < firstRun) {
    console.log('[TrialManager] Clock tampering detected: System time is before first run');
    return true;
  }
  
  // Registry checks for clock changes
  // This is simplified - in production you'd use native modules
  return false;
}

/**
 * Initialize trial on first run
 */
export function initializeTrial(): TrialStatus {
  const machineId = getMachineId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  
  const trialData: TrialData = {
    machineId,
    firstRunAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    installPath: app.getAppPath(),
    version: app.getVersion(),
    checksum: '', // Will be set after creation
  };
  
  trialData.checksum = calculateChecksum(trialData);
  
  // Save to primary location
  const encrypted = encryptTrialData(trialData);
  const primaryPath = getTrialFilePath();
  
  // Ensure directory exists
  mkdirSync(dirname(primaryPath), { recursive: true });
  
  writeFileSync(primaryPath, encrypted, { mode: 0o600 });
  
  // Save backup
  const backupPath = getBackupTrialPath();
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, encrypted, { mode: 0o600 });
  
  // Also store in database as tertiary backup
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO settings (key, value) 
      VALUES ('trial_data_backup', ?)
    `).run(encrypted);
  } catch (e) {
    // DB might not have settings table yet
  }
  
  return {
    isValid: true,
    daysRemaining: TRIAL_DAYS,
    hoursRemaining: TRIAL_DAYS * 24,
    isExpired: false,
    firstRunAt: trialData.firstRunAt,
    expiresAt: trialData.expiresAt,
    trialType: 'fresh',
    warnings: [],
  };
}

/**
 * Get current trial status with anti-tampering checks
 */
export function getTrialStatus(): TrialStatus {
  const primaryPath = getTrialFilePath();
  const backupPath = getBackupTrialPath();
  
  let encryptedData: string | null = null;

  // Try primary location first
  if (existsSync(primaryPath)) {
    try {
      encryptedData = readFileSync(primaryPath, 'utf8');
    } catch {
      // File exists but can't read - possible tampering
    }
  }
  
  // Try backup location
  if (!encryptedData && existsSync(backupPath)) {
    try {
      encryptedData = readFileSync(backupPath, 'utf8');

      // Restore primary from backup
      try {
        mkdirSync(dirname(primaryPath), { recursive: true });
        writeFileSync(primaryPath, encryptedData, { mode: 0o600 });
      } catch {}
    } catch {}
  }
  
  // Try database as last resort
  if (!encryptedData) {
    try {
      const row = getDb().prepare(`SELECT value FROM settings WHERE key = 'trial_data_backup'`).get() as { value: string } | undefined;
      if (row?.value) {
        encryptedData = row.value;

        // Restore both files
        try {
          mkdirSync(dirname(primaryPath), { recursive: true });
          mkdirSync(dirname(backupPath), { recursive: true });
          writeFileSync(primaryPath, encryptedData, { mode: 0o600 });
          writeFileSync(backupPath, encryptedData, { mode: 0o600 });
        } catch {}
      }
    } catch {}
  }
  
  // No trial data found - this is first run
  if (!encryptedData) {
    return initializeTrial();
  }
  
  // Decrypt and validate
  const trialData = decryptTrialData(encryptedData);
  
  if (!trialData) {
    return tamperedStatus('تم اكتشاف تلاعب في ملفات التجربة');
  }
  
  const warnings: string[] = [];
  
  // Verify machine ID (prevent copying trial to another machine)
  const currentMachineId = getMachineId();
  if (trialData.machineId !== currentMachineId) {
    return tamperedStatus('ملفات التجربة غير متوافقة مع هذا الجهاز', trialData.firstRunAt, trialData.expiresAt);
  }
  
  // Verify checksum (tamper detection)
  const expectedChecksum = calculateChecksum(trialData);
  if (trialData.checksum !== expectedChecksum) {
    return tamperedStatus('تم اكتشاف تلاعب في بيانات التجربة', trialData.firstRunAt, trialData.expiresAt);
  }
  
  // Check for clock tampering
  if (detectClockTampering(trialData.firstRunAt)) {
    return tamperedStatus('تم اكتشاف تغيير في تاريخ النظام', trialData.firstRunAt, trialData.expiresAt);
  }
  
  // Calculate remaining time
  const now = new Date();
  const expiresAt = new Date(trialData.expiresAt);

  const remainingMs = expiresAt.getTime() - now.getTime();
  
  if (remainingMs <= 0) {
    return {
      isValid: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      isExpired: true,
      firstRunAt: trialData.firstRunAt,
      expiresAt: trialData.expiresAt,
      trialType: 'expired',
      warnings: [],
    };
  }
  
  const daysRemaining = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.floor(remainingMs / (60 * 60 * 1000));
  
  // Add warnings for approaching expiration
  if (daysRemaining === 1) {
    warnings.push('ÙŠÙˆÙ… ÙˆØ§Ø­Ø¯ Ù…ØªØ¨Ù‚ÙŠ - Ù‚Ù… Ø¨ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ Ø§Ù„Ø¢Ù†');
  } else if (daysRemaining === 0 && hoursRemaining <= 12) {
    warnings.push(`${hoursRemaining} Ø³Ø§Ø¹Ø© Ù…ØªØ¨Ù‚ÙŠØ© ÙÙ‚Ø·!`);
  }
  
  return {
    isValid: true,
    daysRemaining,
    hoursRemaining,
    isExpired: false,
    firstRunAt: trialData.firstRunAt,
    expiresAt: trialData.expiresAt,
    trialType: 'active',
    warnings,
  };
}

/**
 * Get formatted trial message for UI
 */
export function getTrialMessage(status: TrialStatus): { title: string; message: string; severity: 'info' | 'warning' | 'error' } {
  if (status.isExpired) {
    return {
      title: 'Ø§Ù†ØªÙ‡Øª Ø§Ù„ÙØªØ±Ø© Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ©',
      message: 'Ù„Ù‚Ø¯ Ø§Ù†ØªÙ‡Øª ÙØªØ±Ø© Ø§Ù„ØªØ¬Ø±Ø¨Ø© Ø§Ù„Ù…Ø¬Ø§Ù†ÙŠØ© (3 Ø£ÙŠØ§Ù…). ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… Ù…ÙØªØ§Ø­ Ø§Ù„ØªØ±Ø®ÙŠØµ Ù„Ù„Ø§Ø³ØªÙ…Ø±Ø§Ø±.',
      severity: 'error',
    };
  }
  
  if (status.trialType === 'tampered') {
    return {
      title: 'ØªÙ… Ø§ÙƒØªØ´Ø§Ù ØªÙ„Ø§Ø¹Ø¨',
      message: status.warnings[0] || 'ØªÙ… Ø§ÙƒØªØ´Ø§Ù ØªÙ„Ø§Ø¹Ø¨ ÙÙŠ Ù…Ù„ÙØ§Øª Ø§Ù„Ù†Ø¸Ø§Ù…. ÙŠØ±Ø¬Ù‰ Ø¥Ø¹Ø§Ø¯Ø© ØªØ«Ø¨ÙŠØª Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬.',
      severity: 'error',
    };
  }
  
  if (status.daysRemaining === 1) {
    return {
      title: 'ÙŠÙˆÙ… ÙˆØ§Ø­Ø¯ Ù…ØªØ¨Ù‚ÙŠ',
      message: `Ù…ØªØ¨Ù‚ÙŠ ${status.hoursRemaining} Ø³Ø§Ø¹Ø© Ø¹Ù„Ù‰ Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„ÙØªØ±Ø© Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ©. Ù„Ø§ ØªÙÙˆØª Ø§Ù„ÙØ±ØµØ© - Ù‚Ù… Ø¨ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ Ø§Ù„Ø¢Ù†!`,
      severity: 'warning',
    };
  }
  
  if (status.daysRemaining === 2) {
    return {
      title: `ÙŠÙˆÙ…Ø§Ù† Ù…ØªØ¨Ù‚ÙŠØ§Ù†`,
      message: `Ù…ØªØ¨Ù‚ÙŠ ÙŠÙˆÙ…Ø§Ù† (${status.hoursRemaining} Ø³Ø§Ø¹Ø©) Ø¹Ù„Ù‰ Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„ÙØªØ±Ø© Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ© Ø§Ù„Ù…Ø¬Ø§Ù†ÙŠØ©.`,
      severity: 'warning',
    };
  }
  
  if (status.daysRemaining === 3) {
    return {
      title: '3 Ø£ÙŠØ§Ù… Ù…ØªØ¨Ù‚ÙŠØ©',
      message: `Ù…Ø±Ø­Ø¨Ø§Ù‹ Ø¨Ùƒ ÙÙŠ EyesPro! Ù„Ø¯ÙŠÙƒ 3 Ø£ÙŠØ§Ù… Ù„ØªØ¬Ø±Ø¨Ø© Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…ÙŠØ²Ø§Øª Ø§Ù„Ù…ØªÙ…ÙŠØ²Ø©.`,
      severity: 'info',
    };
  }
  
  return {
    title: 'ÙØªØ±Ø© ØªØ¬Ø±ÙŠØ¨ÙŠØ© Ù†Ø´Ø·Ø©',
    message: status.warnings[0] || `Ù…ØªØ¨Ù‚ÙŠ ${status.daysRemaining} Ø£ÙŠØ§Ù… Ù…Ù† Ø§Ù„ÙØªØ±Ø© Ø§Ù„ØªØ¬Ø±ÙŠØ¨ÙŠØ©`,
    severity: 'info',
  };
}

/**
 * Clear trial data (for testing or reset)
 */
export function clearTrial(): void {
  const primaryPath = getTrialFilePath();
  const backupPath = getBackupTrialPath();
  
  try {
    if (existsSync(primaryPath)) {
      unlinkSync(primaryPath);
    }
  } catch {}
  
  try {
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch {}
  
  try {
    getDb().prepare(`DELETE FROM settings WHERE key = 'trial_data_backup'`).run();
  } catch {}
}
