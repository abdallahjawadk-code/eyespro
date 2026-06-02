import Database from 'better-sqlite3';
import fs from 'node:fs';
import { getDb } from '../db/database';
import { createLogger } from '../logger';

const log = createLogger('legacy-import');

export interface ImportReport {
  users: number;
  articles: number;
  settings: number;
  sources: number;
  publishLogs: number;
  skipped: string[];
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

export function importFromLegacyDb(legacyPath: string): ImportReport {
  if (!fs.existsSync(legacyPath)) throw new Error('Legacy database file not found');

  const legacy = new Database(legacyPath, { readonly: true });
  const target = getDb();
  const report: ImportReport = {
    users: 0,
    articles: 0,
    settings: 0,
    sources: 0,
    publishLogs: 0,
    skipped: []
  };

  const tx = target.transaction(() => {
    if (tableExists(legacy, 'settings')) {
      const rows = legacy.prepare('SELECT key, value FROM settings').all() as {
        key: string;
        value: string;
      }[];
      const ins = target.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      for (const r of rows) {
        if (r.key && r.value != null) {
          ins.run(r.key, String(r.value));
          report.settings++;
        }
      }
    }

    if (tableExists(legacy, 'news_sources')) {
      const rows = legacy.prepare('SELECT name, url, enabled, category, source_type FROM news_sources').all() as {
        name: string;
        url: string | null;
        enabled: number;
        category: string | null;
        source_type: string | null;
      }[];
      const ins = target.prepare(
        `INSERT INTO sources (name, url, enabled, category, source_type) VALUES (?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        try {
          ins.run(r.name, r.url, r.enabled ?? 1, r.category, r.source_type ?? 'rss');
          report.sources++;
        } catch {
          report.skipped.push(`source:${r.name}`);
        }
      }
    }

    if (tableExists(legacy, 'articles')) {
      const rows = legacy.prepare(
        `SELECT title, summary, content, link, image_url, source, category, status,
                word_count, published_at, created_at, updated_at FROM articles`
      ).all() as Record<string, unknown>[];
      const ins = target.prepare(
        `INSERT INTO articles (title, summary, content, link, image_url, source, category, status, word_count, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        try {
          ins.run(
            r.title,
            r.summary ?? null,
            r.content ?? null,
            r.link ?? null,
            r.image_url ?? null,
            r.source ?? null,
            r.category ?? null,
            r.status ?? 'draft',
            r.word_count ?? 0,
            r.published_at ?? null,
            r.created_at ?? new Date().toISOString(),
            r.updated_at ?? new Date().toISOString()
          );
          report.articles++;
        } catch {
          report.skipped.push(`article:${String(r.title).slice(0, 40)}`);
        }
      }
    }

    if (tableExists(legacy, 'publish_logs')) {
      const rows = legacy
        .prepare('SELECT article_id, platform, success, post_url, error, created_at FROM publish_logs')
        .all() as Record<string, unknown>[];
      const ins = target.prepare(
        `INSERT INTO publish_logs (article_id, platform, success, post_url, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        try {
          ins.run(r.article_id, r.platform, r.success ?? 0, r.post_url, r.error, r.created_at);
          report.publishLogs++;
        } catch {
          report.skipped.push(`publish_log:${r.article_id}`);
        }
      }
    }

    if (tableExists(legacy, 'users')) {
      const rows = legacy
        .prepare(
          `SELECT username, password_hash, salt, role, email, is_active, totp_secret, totp_enabled
           FROM users WHERE is_active=1`
        )
        .all() as {
          username: string;
          password_hash: string;
          salt: string | null;
          role: string;
          email: string | null;
          is_active: number;
          totp_secret: string | null;
          totp_enabled: number | null;
        }[];
      const ins = target.prepare(
        `INSERT INTO users (username, password_hash, salt, role, email, is_active, totp_secret, totp_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        const exists = target.prepare(`SELECT id FROM users WHERE username=?`).get(r.username);
        if (exists) {
          report.skipped.push(`user:${r.username}`);
          continue;
        }
        try {
          ins.run(
            r.username,
            r.password_hash,
            r.salt || '',
            r.role || 'reporter',
            r.email,
            r.is_active ?? 1,
            r.totp_secret,
            r.totp_enabled ?? 0
          );
          report.users++;
        } catch {
          report.skipped.push(`user:${r.username}`);
        }
      }
    }
  });

  tx();
  legacy.close();
  log.info('legacy import complete', report as unknown as Record<string, unknown>);
  return report;
}

/** Default legacy paths on Windows */
export function guessLegacyPaths(): string[] {
  const appData = process.env.APPDATA;
  if (!appData) return [];
  const base = `${appData}\\Eyes Pro`;
  return [`${base}\\eyes_pro.db.working`, `${base}\\eyes_pro.db`].filter((p) => fs.existsSync(p));
}
