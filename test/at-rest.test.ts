import { describe, it, expect } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import os from 'node:os';

const DB_MAGIC = Buffer.from('EYESDB1');

describe('db at-rest', () => {
  it('encrypted buffer starts with EYESDB1 magic', () => {
    const userData = '/tmp/eyespro-test';
    const key = createHash('sha256')
      .update(`BEP-db-at-rest-v2-${os.hostname()}${userData}test-pepper`)
      .digest();
    const plain = Buffer.from('SQLite format 3\0');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([DB_MAGIC, iv, tag, enc]);
    expect(out.subarray(0, 7).equals(DB_MAGIC)).toBe(true);
  });
});
