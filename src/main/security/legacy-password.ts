import { createHash, timingSafeEqual } from 'node:crypto';

export const LEGACY_SALT_SUFFIX = 'babylon-salt-2024';

export function verifyLegacySha256(password: string, hash: string): boolean {
  const derived = createHash('sha256').update(password + LEGACY_SALT_SUFFIX).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
  } catch {
    return false;
  }
}
