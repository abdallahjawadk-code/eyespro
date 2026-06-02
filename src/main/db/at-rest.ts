import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { getMachinePepper } from '../security/machine-pepper';

export const DB_MAGIC = Buffer.from('EYESDB1');

export function deriveDbKey(userDataPath: string, passphrase = ''): Buffer {
  const machine = os.hostname() + userDataPath + getMachinePepper();
  const extra = passphrase ? `:${passphrase}` : '';
  return createHash('sha256').update(`BEP-db-at-rest-v2-${machine}${extra}`).digest();
}

export function isEncryptedFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const head = fs.readFileSync(filePath).subarray(0, DB_MAGIC.length);
    return head.equals(DB_MAGIC);
  } catch {
    return false;
  }
}

function decryptBuffer(buf: Buffer, userDataPath: string, passphrase = ''): Buffer {
  if (!buf.subarray(0, DB_MAGIC.length).equals(DB_MAGIC)) return buf;
  const payload = buf.subarray(DB_MAGIC.length);
  if (payload.length < 28) throw new Error('Corrupted encrypted database');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const enc = payload.subarray(28);
  const key = deriveDbKey(userDataPath, passphrase);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function encryptBuffer(plain: Buffer, userDataPath: string, passphrase = ''): Buffer {
  const key = deriveDbKey(userDataPath, passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([DB_MAGIC, iv, tag, enc]);
}

export function loadDatabaseFile(filePath: string, userDataPath: string, passphrase = ''): Buffer {
  return decryptBuffer(fs.readFileSync(filePath), userDataPath, passphrase);
}

export function saveDatabaseFile(
  filePath: string,
  plainBuffer: Buffer,
  userDataPath: string,
  encrypt: boolean,
  passphrase = ''
): void {
  const out = encrypt ? encryptBuffer(plainBuffer, userDataPath, passphrase) : plainBuffer;
  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}
