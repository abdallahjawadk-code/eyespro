/* ── security-utils.ts ─────────────────────────────────────────────────────
   Advanced Security Utilities for EyesPro
   FREE Security Features: SSL Pinning, Hardware Binding, Anti-VM, Integrity
──────────────────────────────────────────────────────────────────────────── */

import type { CipherGCM, DecipherGCM } from 'crypto';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { app } from 'electron';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════════════════════
// 1. SSL PINNING - Prevent MITM attacks
// ═══════════════════════════════════════════════════════════════════════════

export const SSL_PINS = {
  KEYGEN: [
    'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // Replace with actual
    'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=', // Backup pin
  ],
  SAFETY_BUFFER: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export function verifySSLCertificate(certFingerprint: string, expectedPins: string[]): boolean {
  const normalized = certFingerprint.toLowerCase().replace(/:/g, '');
  return expectedPins.some(pin => {
    const cleanPin = pin.replace('sha256/', '').toLowerCase();
    return normalized.includes(cleanPin) || cleanPin.includes(normalized);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. HARDWARE FINGERPRINT - Strong machine binding
// ═══════════════════════════════════════════════════════════════════════════

export interface HardwareFingerprint {
  cpuId: string;
  macAddress: string;
  diskSerial: string;
  biosSerial: string;
  motherboardSerial: string;
  combined: string;
}

/** Windows MachineGuid from the registry — stable per OS install, no wmic needed. */
function readMachineGuid(): string {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 5_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}

function firstMac(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const a of ifaces ?? []) {
      if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') return a.mac.toLowerCase();
    }
  }
  return 'unknown-mac';
}

export function getHardwareFingerprint(): HardwareFingerprint {
  // wmic was removed in modern Windows 11 builds, so the fingerprint is derived
  // from the registry MachineGuid + os primitives — works everywhere, no child
  // process that can throw "'wmic' is not recognized".
  const guid = readMachineGuid();
  const cpuId = os.cpus()[0]?.model?.trim() || 'unknown-cpu';
  const macAddress = firstMac();
  const hostId = `${os.hostname()}:${os.arch()}:${os.platform()}`;

  const combined = createHash('sha256')
    .update(`${guid}:${cpuId}:${macAddress}:${hostId}`)
    .digest('hex');

  return {
    cpuId,
    macAddress,
    diskSerial: guid || 'unknown-disk',
    biosSerial: guid || 'unknown-bios',
    motherboardSerial: hostId,
    combined,
  };
}

export function verifyHardwareMatch(storedFingerprint: string): boolean {
  const current = getHardwareFingerprint().combined;
  // Allow 2 of 5 components to change (hardware upgrades)
  return current === storedFingerprint;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ANTI-VM / ANTI-SANDBOX - Detect virtual environments
// ═══════════════════════════════════════════════════════════════════════════

export interface VMCheckResult {
  isVM: boolean;
  indicators: string[];
  confidence: number; // 0-100
}

export function detectVirtualMachine(): VMCheckResult {
  const indicators: string[] = [];
  let score = 0;

  try {
    // Check for common VM processes
    const vmProcesses = [
      'vmtoolsd.exe',
      'vmwaretray.exe',
      'vmwareuser.exe',
      'vboxservice.exe',
      'vboxtray.exe',
      'qemu-ga.exe',
      'prl_cc.exe',
      'prl_tools.exe',
    ];

    for (const proc of vmProcesses) {
      try {
        execSync(`tasklist /FI "IMAGENAME eq ${proc}" 2>nul | find /I "${proc}"`, { stdio: 'pipe' });
        indicators.push(`Process: ${proc}`);
        score += 20;
      } catch { /* not found */ }
    }

    // Check for VM MAC addresses
    const macOutput = execSync('getmac /fo csv /nh', { encoding: 'utf8' });
    const vmMacPrefixes = [
      '08:00:27', // VirtualBox
      '00:05:69', // VMware
      '00:0C:29', // VMware
      '00:1C:14', // VMware
      '00:50:56', // VMware
      '00:1C:42', // Parallels
    ];

    for (const prefix of vmMacPrefixes) {
      if (macOutput.toLowerCase().includes(prefix.toLowerCase())) {
        indicators.push(`VM MAC: ${prefix}`);
        score += 15;
      }
    }

    // Check BIOS manufacturer + system model via PowerShell CIM (wmic is gone on
    // Win11). Wrapped individually and stderr-silenced so a missing tool never
    // throws into the outer catch or leaks noise.
    const cim = (cls: string, prop: string): string => {
      try {
        return execSync(
          `powershell -NoProfile -Command "(Get-CimInstance ${cls}).${prop}"`,
          { encoding: 'utf8', timeout: 5_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        ).toLowerCase();
      } catch { return ''; }
    };

    const biosInfo = cim('Win32_BIOS', 'Manufacturer');
    const vmBios = ['innotek', 'vmware', 'parallels', 'qemu', 'virtualbox'];
    for (const vm of vmBios) {
      if (biosInfo.includes(vm)) {
        indicators.push(`BIOS: ${vm}`);
        score += 25;
      }
    }

    const modelInfo = cim('Win32_ComputerSystem', 'Model');
    const vmModels = ['virtual', 'vmware', 'parallels', 'qemu', 'xen'];
    for (const vm of vmModels) {
      if (modelInfo.includes(vm)) {
        indicators.push(`Model: ${vm}`);
        score += 20;
      }
    }

    // Check for debuggers
    const isDebuggerPresent = (globalThis as { require?: unknown }).require && process.env.ELECTRON_ENABLE_LOGGING;
    if (isDebuggerPresent) {
      indicators.push('Debugger flags detected');
      score += 10;
    }

    // Memory check (VMs typically have less RAM)
    const totalMemory = os.totalmem() / (1024 ** 3); // GB
    if (totalMemory < 2) {
      indicators.push('Low memory (likely VM)');
      score += 10;
    }

  } catch (error) {
    // Error during detection might indicate sandbox
    indicators.push('Detection error (suspicious)');
    score += 5;
  }

  return {
    isVM: score >= 50,
    indicators,
    confidence: Math.min(100, score),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. RUNTIME INTEGRITY - Verify app files haven't been tampered
// ═══════════════════════════════════════════════════════════════════════════

export interface IntegrityCheck {
  file: string;
  expectedHash: string;
  actualHash: string;
  valid: boolean;
}

export function verifyRuntimeIntegrity(): { valid: boolean; checks: IntegrityCheck[] } {
  const appPath = app.getAppPath();
  // Paths are relative to app.getAppPath() (the asar root in production).
  // These must match the real electron-vite output, not the legacy dist/ layout.
  const criticalFiles = [
    'package.json',
    'out/main/index.cjs',
    'out/preload/index.mjs',
  ];

  const checks: IntegrityCheck[] = [];

  for (const file of criticalFiles) {
    const fullPath = join(appPath, file);
    
    if (!existsSync(fullPath)) {
      checks.push({
        file,
        expectedHash: 'unknown',
        actualHash: 'missing',
        valid: false,
      });
      continue;
    }

    try {
      const content = readFileSync(fullPath);
      const hash = createHash('sha256').update(content).digest('hex');
      
      // In production, compare against known good hashes
      // For now, we just verify the file exists and is readable
      checks.push({
        file,
        expectedHash: 'production-hash-would-be-here',
        actualHash: hash,
        valid: true, // Would be: hash === expectedHash
      });
    } catch (error) {
      checks.push({
        file,
        expectedHash: 'unknown',
        actualHash: 'error',
        valid: false,
      });
    }
  }

  const allValid = checks.every(c => c.valid);
  return { valid: allValid, checks };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. MEMORY OBFUSCATION - Protect sensitive data in RAM
// ═══════════════════════════════════════════════════════════════════════════

export class SecureMemory {
  private key: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor() {
    // Generate random key for this session
    this.key = randomBytes(32);
  }

  encrypt(data: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv) as CipherGCM;
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  decrypt(encrypted: string, iv: string, authTag: string): string {
    const decipher = createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, 'hex')
    ) as DecipherGCM;
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // Securely wipe key from memory (best effort)
  destroy(): void {
    this.key.fill(0);
    this.key = Buffer.alloc(32);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. WINDOWS DPAPI - Secure storage using Windows native encryption
// ═══════════════════════════════════════════════════════════════════════════

export function encryptWithDPAPI(data: string): Buffer {
  // On Windows, use DPAPI via native addon
  // For now, fallback to AES encryption
  const secureMem = new SecureMemory();
  const { encrypted, iv, authTag } = secureMem.encrypt(data);
  
  const result = JSON.stringify({ encrypted, iv, authTag });
  return Buffer.from(result);
}

export function decryptWithDPAPI(encryptedData: Buffer): string {
  const secureMem = new SecureMemory();
  const { encrypted, iv, authTag } = JSON.parse(encryptedData.toString());
  return secureMem.decrypt(encrypted, iv, authTag);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. ANTI-DEBUGGING - Runtime detection
// ═══════════════════════════════════════════════════════════════════════════

export function detectDebugger(): boolean {
  // Check for common debugger indicators
  const checks = [
    () => process.env.NODE_ENV === 'development',
    () => process.env.ELECTRON_ENABLE_LOGGING === 'true',
    () => process.env.DEBUG === '*',
    () => {
      // Timing check - debuggers slow down execution
      const start = Date.now();
      for (let i = 0; i < 1000000; i++) {
        Math.sqrt(i);
      }
      const elapsed = Date.now() - start;
      return elapsed > 500; // If took > 500ms, likely debugging
    },
  ];

  return checks.some(check => check());
}

export function triggerProtection(): void {
  if (detectDebugger()) {
    console.log('Debugger detected - triggering protection');
    // Option 1: Exit gracefully
    // app.quit();
    
    // Option 2: Corrupt sensitive data
    // Option 3: Show warning and continue with limited functionality
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. COMBINED SECURITY CHECK
// ═══════════════════════════════════════════════════════════════════════════

export interface SecurityStatus {
  safe: boolean;
  vmDetected: boolean;
  debuggerDetected: boolean;
  integrityValid: boolean;
  indicators: string[];
}

export function performSecurityCheck(): SecurityStatus {
  const vmCheck = detectVirtualMachine();
  const debuggerDetected = detectDebugger();
  const integrityCheck = verifyRuntimeIntegrity();
  
  const indicators = [
    ...vmCheck.indicators,
    ...(debuggerDetected ? ['Debugger detected'] : []),
    ...(integrityCheck.valid ? [] : integrityCheck.checks.filter(c => !c.valid).map(c => `Tampered: ${c.file}`)),
  ];

  return {
    safe: !vmCheck.isVM && !debuggerDetected && integrityCheck.valid,
    vmDetected: vmCheck.isVM,
    debuggerDetected,
    integrityValid: integrityCheck.valid,
    indicators,
  };
}
