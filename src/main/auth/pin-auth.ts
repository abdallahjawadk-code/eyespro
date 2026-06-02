import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { getDb } from '../db/database';
import { getMachinePepper } from '../security/machine-pepper';

const PIN_ITERATIONS = 100_000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function hashPin(pin: string, salt: string): string {
  return pbkdf2Sync(pin + getMachinePepper(), salt, PIN_ITERATIONS, 32, 'sha512').toString('hex');
}

export function setPin(userId: number, pin: string): { ok: boolean; code?: string } {
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, code: 'PIN_INVALID_FORMAT' };
  const salt = randomBytes(24).toString('hex');
  const hash = hashPin(pin, salt);
  getDb()
    .prepare(
      `INSERT INTO user_pins (user_id, pin_hash, salt, failed_count, locked_until) VALUES (?,?,?,0,NULL)
       ON CONFLICT(user_id) DO UPDATE SET pin_hash=excluded.pin_hash, salt=excluded.salt, failed_count=0, locked_until=NULL`
    )
    .run(userId, hash, salt);
  return { ok: true };
}

export function verifyPin(userId: number, pin: string): { ok: boolean; code?: string; locked?: boolean } {
  if (!/^\d{4,6}$/.test(String(pin))) return { ok: false, code: 'PIN_INVALID_FORMAT' };
  const row = getDb().prepare(`SELECT * FROM user_pins WHERE user_id=?`).get(userId) as
    | { pin_hash: string; salt: string; failed_count: number; locked_until: string | null }
    | undefined;
  if (!row) return { ok: false, code: 'PIN_NOT_SET' };
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { ok: false, locked: true, code: 'PIN_LOCKED' };
  }
  if (hashPin(pin, row.salt) !== row.pin_hash) {
    const failed = (row.failed_count || 0) + 1;
    if (failed >= MAX_ATTEMPTS) {
      const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      getDb()
        .prepare(`UPDATE user_pins SET failed_count=?, locked_until=? WHERE user_id=?`)
        .run(failed, until, userId);
      return { ok: false, locked: true, code: 'PIN_TOO_MANY' };
    }
    getDb().prepare(`UPDATE user_pins SET failed_count=? WHERE user_id=?`).run(failed, userId);
    return { ok: false, code: 'PIN_WRONG' };
  }
  getDb().prepare(`UPDATE user_pins SET failed_count=0, locked_until=NULL WHERE user_id=?`).run(userId);
  return { ok: true };
}

export function removePin(userId: number): void {
  getDb().prepare(`DELETE FROM user_pins WHERE user_id=?`).run(userId);
}

export function pinStatus(userId: number): boolean {
  return !!getDb().prepare(`SELECT 1 FROM user_pins WHERE user_id=?`).get(userId);
}
