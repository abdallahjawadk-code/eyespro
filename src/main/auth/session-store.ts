import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage, app } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { getDb } from '../db/database';
import type { UserPublic } from '../../shared/api-types';

// ─── Persisted token (survives app restarts) ──────────────────────────────────
// Uses electron safeStorage (Windows DPAPI / macOS Keychain) so the token file
// is unreadable outside this Electron app's user context.

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), '.ep_session');
}

export function savePersistedToken(token: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const enc = safeStorage.encryptString(token);
    fs.writeFileSync(tokenFilePath(), enc);
  } catch { /* non-fatal — falls back to session re-login */ }
}

export function loadPersistedToken(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(tokenFilePath());
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function clearPersistedToken(): void {
  try { fs.unlinkSync(tokenFilePath()); } catch { /* already gone */ }
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface SessionRow {
  token: string;
  user_id: number;
  expires_at: string;
  username: string;
  email: string | null;
  role: string;
}

/** Maps Electron webContents id → session token (survives across IPC calls). */
const tokensByWebContents = new Map<number, string>();

export function bindSession(event: IpcMainInvokeEvent, token: string): void {
  tokensByWebContents.set(event.sender.id, token);
}

export function bindSessionForWebContents(wc: WebContents, token: string): void {
  tokensByWebContents.set(wc.id, token);
}

export function clearSessionForWebContents(wc: WebContents): void {
  tokensByWebContents.delete(wc.id);
}

export function getSessionToken(event: IpcMainInvokeEvent): string | null {
  return tokensByWebContents.get(event.sender.id) ?? null;
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionByToken(token: string): UserPublic | null {
  const row = getDb()
    .prepare(
      `SELECT s.token, s.user_id, s.expires_at, u.username, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.is_active = 1`
    )
    .get(token) as SessionRow | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.user_id, username: row.username, email: row.email, role: row.role as UserPublic['role'] };
}

export function getSessionFromEvent(event: IpcMainInvokeEvent): UserPublic | null {
  const token = getSessionToken(event);
  if (!token) return null;
  return getSessionByToken(token);
}

export function pruneExpiredSessions(): void {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
}
