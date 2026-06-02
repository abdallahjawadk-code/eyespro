import { app } from 'electron';
import { createHash, pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyLegacySha256 } from './legacy-password';

const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const LEGACY_PEPPER = 'BEP-pepper-v2-2025';

let cached: string | null = null;

function pepperFilePath(): string {
  return path.join(app.getPath('userData'), 'EyesPro', '.machine-pepper');
}

/** Compatible with legacy Babylon file-based pepper when present */
export function getMachinePepper(): string {
  if (cached) return cached;
  const fp = pepperFilePath();
  try {
    if (fs.existsSync(fp)) {
      const p = fs.readFileSync(fp, 'utf8').trim();
      if (p.length >= 32) {
        cached = p;
        return p;
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const parent = path.dirname(fp);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    const generated = randomBytes(32).toString('hex');
    fs.writeFileSync(fp, generated, { encoding: 'utf8', mode: 0o600 });
    cached = generated;
    return generated;
  } catch {
    const material = os.hostname() + app.getPath('userData') + 'EyesPro-pepper-v1';
    cached = createHash('sha256').update(material).digest('hex');
    return cached;
  }
}

export function hashPassword(password: string): { hash: string; salt: string } {
  // argon2 v0.31+ removed sync API; use scrypt (Node.js built-in, FIPS-compliant)
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, SCRYPT_OPTS).toString('hex');
  return { hash, salt };
}

function verifyLegacyPbkdf2(password: string, hash: string, salt: string): boolean {
  const pepper = getMachinePepper();
  for (const p of [pepper, LEGACY_PEPPER]) {
    const derived = pbkdf2Sync(password, salt + p, 120_000, 64, 'sha512').toString('hex');
    if (derived.length === hash.length && timingSafeEqual(Buffer.from(derived), Buffer.from(hash))) return true;
  }
  return false;
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  return verifyPasswordDetailed(password, hash, salt).ok;
}

export function verifyPasswordDetailed(
  password: string,
  hash: string,
  salt: string
): { ok: boolean; legacy: boolean; needsUpgrade?: boolean } {
  // Legacy Argon2 hash — v0.31+ removed sync API; force re-hash on next login
  if (hash.startsWith('$argon2')) {
    return { ok: false, legacy: true, needsUpgrade: true };
  }

  if (!salt) {
    return { ok: verifyLegacySha256(password, hash), legacy: true };
  }
  try {
    const derived = scryptSync(password, salt, 64, SCRYPT_OPTS);
    const stored = Buffer.from(hash, 'hex');
    if (derived.length === stored.length && timingSafeEqual(derived, stored)) {
      return { ok: true, legacy: false };
    }
  } catch {
    /* try legacy */
  }
  const legacyOk = verifyLegacyPbkdf2(password, hash, salt);
  return { ok: legacyOk, legacy: legacyOk };
}

export function upgradePasswordHash(password: string): { hash: string; salt: string } {
  return hashPassword(password);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'PASSWORD_TOO_SHORT';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'PASSWORD_WEAK';
  return null;
}

