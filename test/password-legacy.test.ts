import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyLegacySha256, LEGACY_SALT_SUFFIX } from '../src/main/security/legacy-password';

describe('password legacy', () => {
  it('accepts legacy SHA256 without salt', () => {
    const password = 'TestPass1234';
    const hash = createHash('sha256').update(password + LEGACY_SALT_SUFFIX).digest('hex');
    expect(verifyLegacySha256(password, hash)).toBe(true);
  });

  it('rejects wrong password', () => {
    const hash = createHash('sha256').update('x' + LEGACY_SALT_SUFFIX).digest('hex');
    expect(verifyLegacySha256('wrong', hash)).toBe(false);
  });
});
