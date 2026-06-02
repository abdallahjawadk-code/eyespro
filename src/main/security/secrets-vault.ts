import { safeStorage } from 'electron';

const VAULT_PREFIX = 'vault:';

export function vaultAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function prepareSecretForStorage(plain: string): string {
  if (!plain || !vaultAvailable()) return plain;
  if (plain.startsWith(VAULT_PREFIX)) return plain;
  try {
    return VAULT_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

export function resolveSettingValue(stored: string): string {
  if (!stored?.startsWith(VAULT_PREFIX) || !vaultAvailable()) return stored ?? '';
  try {
    const buf = Buffer.from(stored.slice(VAULT_PREFIX.length), 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return '';
  }
}

export function isSecretKey(key: string): boolean {
  // Comprehensive pattern for sensitive keys
  const sensitivePatterns = [
    'token',
    'password',
    'secret',
    'api_key',
    'apikey',
    'webhook',
    'bearer',
    'auth',
    'credential',
    'key',
    'smtp_pass',
    'pass',
    'pin',
    'totp'
  ];
  const pattern = new RegExp(`(${sensitivePatterns.join('|')})`, 'i');
  return pattern.test(key);
}
