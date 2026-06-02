import { createHash, createHmac, randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BACKUP_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Decode(secret: string): Buffer {
  const s = String(secret || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of s) {
    const v = BASE32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c >>= 8;
  }
  const hmac = createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

export function generateSecret(bytes = 20): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, 'X')
    .replace(/\//g, 'Y')
    .replace(/=/g, '')
    .slice(0, 32)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, 'A');
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const code = String(token || '').replace(/\D/g, '');
  if (code.length !== 6) return false;
  const key = base32Decode(secret);
  if (!key.length) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (hotp(key, step + w) === code) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = 'EyesPro'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let raw = '';
    for (const b of bytes) raw += BACKUP_CHARS[b! % BACKUP_CHARS.length]!;
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const norm = String(code || '')
    .replace(/[-\s]/g, '')
    .toUpperCase();
  return createHash('sha256').update('eyespro-bkup-v1:' + norm).digest('hex');
}

export function isBackupCode(code: string): boolean {
  return /^[23456789A-HJ-NP-TV-Z]{5}-[23456789A-HJ-NP-TV-Z]{5}$/i.test(String(code || '').trim());
}
