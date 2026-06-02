import { getDb } from '../db/database';

export interface QuickLoginUser {
  id: number;
  username: string;
  has_pin: number;
  has_bio: number;
}

export function listQuickLoginUsers(): QuickLoginUser[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.username,
        CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_pin,
        CASE WHEN b.user_id IS NOT NULL AND b.enabled=1 THEN 1 ELSE 0 END AS has_bio
      FROM users u
      LEFT JOIN user_pins p ON p.user_id = u.id
      LEFT JOIN user_biometric b ON b.user_id = u.id
      WHERE u.is_active=1 AND (p.user_id IS NOT NULL OR (b.user_id IS NOT NULL AND b.enabled=1))
      ORDER BY u.username`
    )
    .all() as QuickLoginUser[];
}
