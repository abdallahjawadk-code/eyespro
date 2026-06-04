import type Database from 'better-sqlite3';
import { createLogger } from '../logger';

const log = createLogger('migrations');

const KNOWN_TABLES = new Set([
  'articles', 'users', 'sources', 'settings', 'schema_meta',
  'publish_logs', 'scheduled_tasks', 'media_files', 'pipeline_log',
  'quality_reports', 'article_templates', 'publish_templates',
  'tenants', 'api_keys', 'live_sessions', 'system_alerts',
  'password_reset_tokens', 'link_scan_history', 'http_cookies',
  'keyword_alerts', 'keyword_matches', 'role_permissions',
  'webhook_endpoints', 'webhook_deliveries',
  'glossary_terms', 'drip_schedules', 'recycle_rules', 'article_recycle_log',
  'pipeline_jobs', 'pipeline_ai_runs', 'fetch_audit_log', 'domain_policies',
  'source_discovery_runs', 'source_discovery_cache',
  'catalog_suggestions', 'discovery_provider_stats', 'trends', 'trend_sources',
  // v36-v39: new features
  'video_jobs',
  'broadcast_lists', 'broadcast_contacts', 'broadcast_sends',
  'competitor_monitors', 'competitor_snapshots',
  'newsletter_lists', 'newsletter_subscribers', 'newsletter_sends',
  // v47: pipeline performance tracking
  'article_processing_log',
  // v49: crawler tracking
  'crawler_visited_urls',
]);

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/i;

function guardIdent(value: string, label: string): void {
  if (!SAFE_IDENT.test(value) || (!KNOWN_TABLES.has(value) && label === 'table')) {
    throw new Error(`Migration: unsafe ${label} identifier: "${value}"`);
  }
}

function colExists(db: Database.Database, table: string, col: string): boolean {
  guardIdent(table, 'table');
  guardIdent(col, 'column');
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === col);
}

function ensureCol(db: Database.Database, table: string, col: string, ddl: string): void {
  guardIdent(table, 'table');
  guardIdent(col, 'column');
  if (!colExists(db, table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}

function migrateTo(db: Database.Database, version: number, fn: () => void): void {
  const ver = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  const current = Number(ver?.value ?? 0);
  if (current >= version) return;
  fn();
  db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(version));
  log.info(`schema migrated to v${version}`);
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      category TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS publish_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      post_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS totp_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_publish_logs_article ON publish_logs(article_id);
  `);

  ensureCol(db, 'articles', 'summary', 'TEXT');
  ensureCol(db, 'articles', 'link', 'TEXT');
  ensureCol(db, 'articles', 'image_url', 'TEXT');
  ensureCol(db, 'articles', 'source', 'TEXT');
  ensureCol(db, 'articles', 'word_count', 'INTEGER DEFAULT 0');
  ensureCol(db, 'articles', 'published_at', 'TEXT');
  ensureCol(db, 'users', 'totp_secret', 'TEXT');
  ensureCol(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'sources', 'source_type', "TEXT DEFAULT 'rss'");
  ensureCol(db, 'sources', 'category', 'TEXT');

  migrateTo(db, 2, () => {});

  migrateTo(db, 3, () => {
    ensureCol(db, 'sources', 'last_fetched_at', 'TEXT');
    ensureCol(db, 'sources', 'last_error', 'TEXT');
    ensureCol(db, 'articles', 'workflow_status', "TEXT DEFAULT 'draft'");
    ensureCol(db, 'articles', 'processing_status', "TEXT DEFAULT 'new'");
    ensureCol(db, 'articles', 'assignee_id', 'INTEGER');
    ensureCol(db, 'articles', 'meta_title', 'TEXT');
    ensureCol(db, 'articles', 'meta_description', 'TEXT');
    ensureCol(db, 'articles', 'tldr', 'TEXT');
  });

  migrateTo(db, 4, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'publish',
        article_id INTEGER,
        platforms TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        repeat_rule TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status, scheduled_at);
    `);
  });

  migrateTo(db, 5, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER DEFAULT 0,
        alt_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS article_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        title_template TEXT,
        content_template TEXT,
        category TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS publish_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        platforms TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  migrateTo(db, 6, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quality_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        check_type TEXT NOT NULL,
        score REAL,
        result_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER,
        platform TEXT,
        metric_key TEXT NOT NULL,
        metric_value REAL NOT NULL DEFAULT 0,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS system_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  migrateTo(db, 7, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS article_processing_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  migrateTo(db, 8, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        label TEXT,
        config_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  migrateTo(db, 9, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS link_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        url_hash TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'low',
        risk_score INTEGER NOT NULL DEFAULT 0,
        sanitized_url TEXT,
        report_json TEXT,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_link_scans_hash ON link_scans(url_hash);
      CREATE TABLE IF NOT EXISTS publish_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        article_id INTEGER,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_try TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS fetch_domain_budget (
        host TEXT PRIMARY KEY,
        hour_key TEXT NOT NULL,
        fetch_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL DEFAULT '[]',
        rate_limit INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS user_pins (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        pin_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        failed_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS user_biometric (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureCol(db, 'articles', 'tenant_id', 'INTEGER');
    ensureCol(db, 'users', 'tenant_id', 'INTEGER');
    ensureCol(db, 'sources', 'tenant_id', 'INTEGER');
    ensureCol(db, 'articles', 'ingest_status', 'TEXT');
  });

  migrateTo(db, 10, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
    `);
    ensureCol(db, 'users', 'password_changed_at', 'TEXT');
  });

  migrateTo(db, 11, () => {
    ensureCol(db, 'articles', 'video_url', 'TEXT');
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('db_encryption_at_rest', '1')`);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('stealth_fetch_enabled', '0')`);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('stealth_browser_enabled', '0')`);
  });

  migrateTo(db, 12, () => {
    ensureCol(db, 'sources', 'css_selector', 'TEXT');
  });

  migrateTo(db, 13, () => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_tenant ON articles(tenant_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sources_tenant ON sources(tenant_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);`);
    ensureCol(db, 'media_files', 'thumbnail_path', 'TEXT');
  });

  migrateTo(db, 14, () => {
    // Link extension filter for RSS/scraper sources (e.g. ".html,.htm,.php")
    ensureCol(db, 'sources', 'link_extensions', 'TEXT');

    // Live streaming sessions (YouTube, Facebook)
    db.exec(`
      CREATE TABLE IF NOT EXISTS live_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT,
        rtmp_url TEXT,
        stream_key TEXT,
        playback_url TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        article_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_live_sessions_platform ON live_sessions(platform, status);
    `);

    // New settings defaults for live streaming and video
    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('youtube_live_privacy', 'public');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('tiktok_privacy', 'PUBLIC_TO_EVERYONE');
    `);
  });

  migrateTo(db, 15, () => {
    // Ensure analytics tables exist (for older databases)
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER,
        platform TEXT,
        metric_key TEXT NOT NULL,
        metric_value REAL NOT NULL DEFAULT 0,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS system_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_system_alerts_dismissed ON system_alerts(dismissed, created_at);
    `);
    // Add tenant_id to publish_logs if missing (for proper analytics filtering)
    ensureCol(db, 'publish_logs', 'tenant_id', 'INTEGER');
    // Add created_at to publish_logs if missing
    ensureCol(db, 'publish_logs', 'created_at', 'TEXT DEFAULT (datetime(\'now\'))');
  });

  migrateTo(db, 16, () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_usr ON login_attempts(username, created_at);
    `);
  });

  migrateTo(db, 17, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS http_cookies (
        host    TEXT NOT NULL,
        name    TEXT NOT NULL,
        value   TEXT NOT NULL,
        expires INTEGER NOT NULL DEFAULT 0,
        path    TEXT NOT NULL DEFAULT '/',
        secure  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (host, name)
      );
    `);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_auto_browser_fallback', '1')`);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_article_delay_min_ms', '300')`);
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_article_delay_max_ms', '1500')`);
  });

  migrateTo(db, 18, () => {
    // Sources: per-source fetch interval
    ensureCol(db, 'sources', 'fetch_interval_min', 'INTEGER DEFAULT 0');
    ensureCol(db, 'sources', 'next_fetch_at', 'TEXT');
    // Articles: tags
    ensureCol(db, 'articles', 'tags', 'TEXT');
    // Publish logs: external post id + metrics timestamp
    ensureCol(db, 'publish_logs', 'external_post_id', 'TEXT');
    ensureCol(db, 'publish_logs', 'metrics_fetched_at', 'TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_alerts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword    TEXT NOT NULL,
        user_id    INTEGER,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS keyword_matches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id   INTEGER NOT NULL REFERENCES keyword_alerts(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL,
        dismissed  INTEGER NOT NULL DEFAULT 0,
        matched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        role     TEXT NOT NULL,
        resource TEXT NOT NULL,
        allowed  INTEGER NOT NULL DEFAULT 1,
        UNIQUE(role, resource)
      );
      CREATE INDEX IF NOT EXISTS idx_keyword_matches_alert ON keyword_matches(alert_id, dismissed);
      CREATE INDEX IF NOT EXISTS idx_keyword_matches_article ON keyword_matches(article_id);
    `);

    // Default permission settings
    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_failure', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_email_on_failure', '0');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('translation_backend', 'google');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('translation_default_lang', 'ar');
    `);

    // Seed default role permissions (all platforms allowed for super_admin/editor)
    const roles = ['super_admin', 'editor', 'reporter', 'viewer'];
    const platforms = ['telegram', 'twitter', 'facebook', 'wordpress', 'discord', 'instagram', 'linkedin', 'whatsapp', 'email'];
    const perm = db.prepare(`INSERT OR IGNORE INTO role_permissions (role, resource, allowed) VALUES (?, ?, ?)`);
    for (const role of roles) {
      for (const platform of platforms) {
        const allowed = (role === 'super_admin' || role === 'editor') ? 1 : 0;
        perm.run(role, `publish:${platform}`, allowed);
      }
    }
  });

  migrateTo(db, 19, () => {
    ensureCol(db, 'sources', 'use_ai_extractor', 'INTEGER NOT NULL DEFAULT 0');
    ensureCol(db, 'sources', 'include_keywords', 'TEXT');
    ensureCol(db, 'sources', 'exclude_keywords', 'TEXT');
  });

  migrateTo(db, 20, () => {
    ensureCol(db, 'articles', 'sentiment', 'TEXT');
    ensureCol(db, 'articles', 'sentiment_score', 'REAL');
  });

  // v21 — Feature pack: semantic dedup + webhooks
  migrateTo(db, 21, () => {
    // Semantic deduplication SimHash column
    ensureCol(db, 'articles', 'simhash', 'INTEGER');

    // Outgoing webhooks
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        url         TEXT NOT NULL,
        secret      TEXT NOT NULL,
        events_json TEXT NOT NULL DEFAULT '[]',
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id INTEGER NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        event       TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        http_status INTEGER,
        attempts    INTEGER NOT NULL DEFAULT 0,
        next_try    TEXT NOT NULL DEFAULT (datetime('now')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
        ON webhook_deliveries(status, next_try)
        WHERE status='pending';
      CREATE INDEX IF NOT EXISTS idx_articles_simhash
        ON articles(simhash)
        WHERE simhash IS NOT NULL;
    `);
  });

  // v22 — Feature pack: glossary, drip publishing, content recycling
  migrateTo(db, 22, () => {
    db.exec(`
      -- Terminology glossary
      CREATE TABLE IF NOT EXISTS glossary_terms (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        term           TEXT NOT NULL UNIQUE,
        replacement    TEXT NOT NULL,
        enabled        INTEGER NOT NULL DEFAULT 1,
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Drip publish schedules
      CREATE TABLE IF NOT EXISTS drip_schedules (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL,
        article_ids_json  TEXT NOT NULL,
        platforms_json    TEXT NOT NULL,
        interval_minutes  INTEGER NOT NULL DEFAULT 60,
        start_at          TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'active',
        task_ids_json     TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Content recycling rules
      CREATE TABLE IF NOT EXISTS recycle_rules (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT NOT NULL,
        platforms_json      TEXT NOT NULL,
        min_age_days        INTEGER NOT NULL DEFAULT 180,
        max_republish_count INTEGER NOT NULL DEFAULT 2,
        min_word_count      INTEGER NOT NULL DEFAULT 200,
        enabled             INTEGER NOT NULL DEFAULT 1,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Article recycle log (tracks how many times each article was recycled)
      CREATE TABLE IF NOT EXISTS article_recycle_log (
        article_id    INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        recycle_count INTEGER NOT NULL DEFAULT 1,
        last_recycled TEXT NOT NULL DEFAULT (datetime('now')),
        platforms_json TEXT NOT NULL DEFAULT '[]'
      );
    `);
  });

  // v23 — Fetch pipeline: audit, domain policies, FTS, article/source fetch metadata
  migrateTo(db, 23, () => {
    ensureCol(db, 'articles', 'original_url', 'TEXT');
    ensureCol(db, 'articles', 'final_url', 'TEXT');
    ensureCol(db, 'articles', 'redirect_chain_json', 'TEXT');
    ensureCol(db, 'articles', 'fetch_method', 'TEXT');
    ensureCol(db, 'articles', 'purity_score', 'INTEGER');
    ensureCol(db, 'articles', 'fetch_warnings_json', 'TEXT');

    ensureCol(db, 'sources', 'fetch_mode', "TEXT DEFAULT 'smart'");
    ensureCol(db, 'sources', 'last_item_guid', 'TEXT');
    ensureCol(db, 'sources', 'last_pub_date', 'TEXT');
    ensureCol(db, 'sources', 'clean_rules_json', 'TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS fetch_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER,
        article_id INTEGER,
        url TEXT NOT NULL,
        final_url TEXT,
        method TEXT NOT NULL DEFAULT 'http',
        status_code INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        bytes_read INTEGER DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        warnings_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fetch_audit_source ON fetch_audit_log(source_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_fetch_audit_created ON fetch_audit_log(created_at);

      CREATE TABLE IF NOT EXISTS domain_policies (
        host TEXT PRIMARY KEY,
        use_browser INTEGER NOT NULL DEFAULT 0,
        respect_robots INTEGER NOT NULL DEFAULT 1,
        max_per_hour INTEGER DEFAULT 0,
        fetch_mode TEXT DEFAULT 'smart',
        clean_rules_json TEXT,
        paywall_mode TEXT DEFAULT 'none',
        notes TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS source_discovery_cache (
        query_hash TEXT PRIMARY KEY,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
        title, summary, content, tokenize='unicode61'
      );
    `);

    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_respect_robots', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_max_response_mb', '6');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('link_scan_before_source_fetch', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_quality_min_chars', '120');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_quality_min_purity', '35');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_expand_shorteners', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_auto_detect_on_create', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_full_content', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('fetch_full_content_min_chars', '500');
    `);

    // Backfill FTS from existing articles
    const rows = db.prepare(`SELECT id, title, summary, content FROM articles`).all() as {
      id: number; title: string; summary: string | null; content: string | null;
    }[];
    const ins = db.prepare(`INSERT INTO articles_fts(rowid, title, summary, content) VALUES (?,?,?,?)`);
    const run = db.transaction(() => {
      for (const r of rows) {
        ins.run(r.id, r.title ?? '', r.summary ?? '', r.content ?? '');
      }
    });
    run();
  });

  // v24 — Advanced source discovery (multi-candidate, ETag, discovery runs)
  migrateTo(db, 24, () => {
    ensureCol(db, 'sources', 'feed_etag', 'TEXT');
    ensureCol(db, 'sources', 'feed_last_modified', 'TEXT');
    ensureCol(db, 'sources', 'discovery_confidence', 'INTEGER');

    db.exec(`
      CREATE TABLE IF NOT EXISTS source_discovery_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_url TEXT NOT NULL,
        input_hash TEXT,
        candidates_json TEXT NOT NULL,
        chosen_json TEXT,
        best_score INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_runs_hash ON source_discovery_runs(input_hash);
    `);

    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('discovery_mode', 'thorough');
    `);
  });

  // v25 — Pipeline jobs queue, AI audit, configurable workflow
  migrateTo(db, 25, () => {
    ensureCol(db, 'articles', 'content_hash', 'TEXT');
    ensureCol(db, 'articles', 'pipeline_quality_score', 'INTEGER');
    ensureCol(db, 'articles', 'pipeline_profile', "TEXT DEFAULT 'full'");

    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        steps_json TEXT NOT NULL,
        current_step TEXT,
        error TEXT,
        progress_done INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER NOT NULL DEFAULT 0,
        tenant_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_article ON pipeline_jobs(article_id);

      CREATE TABLE IF NOT EXISTS pipeline_ai_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        step TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        input_hash TEXT,
        ok INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_ai_article ON pipeline_ai_runs(article_id, created_at);
    `);

    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_proofread', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_rewrite', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_tldr', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_seo_meta', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_tag_sentiment', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_enable_validate', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_auto_submit_review', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_skip_ai_if_unchanged', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_skip_ai_if_quality_gte', '85');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_min_proofread_score', '50');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_min_validate_score', '60');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_strict_quality', '0');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_default_profile', 'full');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_max_concurrent', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_ai_retries', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_use_job_queue', '1');
    `);
  });

  migrateTo(db, 26, () => {
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_continue_on_ai_error', '1');`);
  });

  migrateTo(db, 27, () => {
    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_provider', 'eyespro');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('eyespro_ai_base_url', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('eyespro_ai_api_key', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('eyespro_ai_default_model', 'eyespro-arabic');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_allow_local_ollama', '0');
    `);
  });

  migrateTo(db, 28, () => {
    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ollama_builtin_enabled', '0');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ollama_manage_process', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ollama_host', '127.0.0.1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ollama_port', '11434');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('ollama_binary_path', '');
    `);
  });

  migrateTo(db, 29, () => {
    db.exec(`
      UPDATE settings SET value = 'gemini' WHERE key = 'ai_provider' AND value = 'eyespro'
        AND EXISTS (SELECT 1 FROM settings s2 WHERE s2.key = 'gemini_api_key' AND trim(s2.value) != '');
      UPDATE settings SET value = 'ollama' WHERE key = 'ai_provider' AND value = 'eyespro'
        AND EXISTS (SELECT 1 FROM settings s3 WHERE s3.key = 'ollama_builtin_enabled' AND s3.value = '1');
      UPDATE settings SET value = '' WHERE key = 'ai_provider' AND value = 'eyespro';
    `);
  });

  migrateTo(db, 30, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        feed_url TEXT NOT NULL,
        website TEXT,
        sector TEXT,
        language TEXT,
        status TEXT NOT NULL DEFAULT 'approved',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_status ON catalog_suggestions(status);
      CREATE TABLE IF NOT EXISTS discovery_provider_stats (
        provider TEXT PRIMARY KEY,
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        last_ok_at TEXT,
        last_fail_at TEXT,
        last_err TEXT
      );
      INSERT OR IGNORE INTO settings (key, value) VALUES ('rsshub_base_url', 'https://rsshub.app');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('podcastindex_api_key', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('podcastindex_api_secret', '');
    `);
  });

  migrateTo(db, 31, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        region TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'google_trends',
        traffic TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_trends_unique ON trends(title, region, source);
    `);
  });

  migrateTo(db, 32, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trend_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'rss',
        url TEXT NOT NULL,
        region_tag TEXT NOT NULL DEFAULT 'GLOBAL',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        last_fetched_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_trend_sources_url ON trend_sources(url);

      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('Google Trends — السعودية',          'google_trends_geo', 'https://trends.google.com/trending/rss?geo=SA', 'SA',     1, 1),
        ('Google Trends — مصر',               'google_trends_geo', 'https://trends.google.com/trending/rss?geo=EG', 'EG',     1, 1),
        ('Google Trends — الإمارات',           'google_trends_geo', 'https://trends.google.com/trending/rss?geo=AE', 'AE',     1, 1),
        ('Google Trends — الكويت',             'google_trends_geo', 'https://trends.google.com/trending/rss?geo=KW', 'KW',     1, 1),
        ('Google Trends — قطر',               'google_trends_geo', 'https://trends.google.com/trending/rss?geo=QA', 'QA',     1, 1),
        ('Google Trends — الولايات المتحدة',   'google_trends_geo', 'https://trends.google.com/trending/rss?geo=US', 'US',     1, 1),
        ('Google Trends — المملكة المتحدة',    'google_trends_geo', 'https://trends.google.com/trending/rss?geo=GB', 'GB',     1, 1),
        ('Google News — العالم العربي',        'rss',               'https://news.google.com/rss?gl=SA&hl=ar&ceid=SA:ar', 'NEWS', 1, 1),
        ('يوتيوب تريندينج — السعودية',         'youtube',           'https://www.youtube.com/feeds/videos.xml?chart=most_popular&regionCode=SA', 'YT-SA', 1, 1);
    `);
  });

  migrateTo(db, 33, () => {
    db.exec(`
      -- Performance indexes missing from initial schema
      CREATE INDEX IF NOT EXISTS idx_articles_category   ON articles(category);
      CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
      CREATE INDEX IF NOT EXISTS idx_articles_source     ON articles(source);
      CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at);
      CREATE INDEX IF NOT EXISTS idx_publish_logs_created_at ON publish_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_scheduled_at ON scheduled_tasks(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_trends_status  ON trends(status);
      CREATE INDEX IF NOT EXISTS idx_trends_created ON trends(created_at);
    `);
  });

  migrateTo(db, 34, () => {
    db.exec(`
      -- LSH bands for SimHash near-duplicate lookup.
      -- Each column stores one byte (8 bits) of the 32-bit simhash.
      -- Indexed so findNearDuplicates can pre-filter candidates with a single
      -- OR query instead of a full table scan.
      ALTER TABLE articles ADD COLUMN simhash_b0 INTEGER;
      ALTER TABLE articles ADD COLUMN simhash_b1 INTEGER;
      ALTER TABLE articles ADD COLUMN simhash_b2 INTEGER;
      ALTER TABLE articles ADD COLUMN simhash_b3 INTEGER;
      CREATE INDEX IF NOT EXISTS idx_articles_simhash_b0 ON articles(simhash_b0) WHERE simhash_b0 IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_articles_simhash_b1 ON articles(simhash_b1) WHERE simhash_b1 IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_articles_simhash_b2 ON articles(simhash_b2) WHERE simhash_b2 IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_articles_simhash_b3 ON articles(simhash_b3) WHERE simhash_b3 IS NOT NULL;
    `);
  });

  migrateTo(db, 35, () => {
    ensureCol(db, 'articles', 'original_content', 'TEXT');
    db.exec(`
      UPDATE articles SET original_content = content
      WHERE (original_content IS NULL OR TRIM(original_content) = '')
        AND content IS NOT NULL AND TRIM(content) != ''
        AND id NOT IN (
          SELECT DISTINCT article_id FROM article_processing_log
          WHERE step = 'rewrite' AND status = 'ok'
        );
    `);
  });

  // v36 — Video Factory
  migrateTo(db, 36, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        script TEXT,
        audio_path TEXT,
        output_path TEXT,
        template TEXT DEFAULT 'news',
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_video_jobs_article ON video_jobs(article_id);
    `);
  });

  // v37 — WhatsApp Broadcast
  migrateTo(db, 37, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS broadcast_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS broadcast_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL REFERENCES broadcast_lists(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(list_id, phone)
      );
      CREATE TABLE IF NOT EXISTS broadcast_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER REFERENCES broadcast_lists(id) ON DELETE SET NULL,
        article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
        message TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_broadcast_contacts_list ON broadcast_contacts(list_id);
      CREATE INDEX IF NOT EXISTS idx_broadcast_sends_list ON broadcast_sends(list_id);
    `);
  });

  // v38 — Competitor Monitor
  migrateTo(db, 38, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS competitor_monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        feed_url TEXT NOT NULL,
        website_url TEXT,
        last_checked_at TEXT,
        last_item_guid TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS competitor_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL REFERENCES competitor_monitors(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        link TEXT,
        summary TEXT,
        published_at TEXT,
        seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_read INTEGER NOT NULL DEFAULT 0,
        rewritten_article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_monitor ON competitor_snapshots(monitor_id);
      CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_read ON competitor_snapshots(is_read);
    `);
  });

  // v39 — Newsletter
  migrateTo(db, 39, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        from_email TEXT,
        from_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL REFERENCES newsletter_lists(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(list_id, email)
      );
      CREATE TABLE IF NOT EXISTS newsletter_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL REFERENCES newsletter_lists(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        article_ids TEXT,
        total INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_list ON newsletter_subscribers(list_id);
      CREATE INDEX IF NOT EXISTS idx_newsletter_sends_list ON newsletter_sends(list_id);
    `);
  });

  // v40 — Facebook scraper support for competitor_monitors
  migrateTo(db, 40, () => {
    db.exec(`
      ALTER TABLE competitor_monitors ADD COLUMN source_type TEXT NOT NULL DEFAULT 'rss';
      ALTER TABLE competitor_monitors ADD COLUMN fb_page_url TEXT;
    `);
  });

  // v41 — Social OAuth tokens + publish log
  migrateTo(db, 41, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_tokens (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        platform      TEXT NOT NULL,
        account_id    TEXT NOT NULL,
        account_name  TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(platform, account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_social_tokens_platform ON social_tokens(platform);

      CREATE TABLE IF NOT EXISTS social_publish_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        platform    TEXT NOT NULL,
        account_id  TEXT,
        ok          INTEGER NOT NULL DEFAULT 0,
        post_url    TEXT,
        error       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_social_log_article ON social_publish_log(article_id);
      CREATE INDEX IF NOT EXISTS idx_social_log_created ON social_publish_log(created_at DESC);
    `);
  });

  // v42 — Autopilot run history
  migrateTo(db, 42, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS autopilot_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at   TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at  TEXT,
        status       TEXT NOT NULL DEFAULT 'running',
        config_json  TEXT,
        result_json  TEXT,
        user_id      INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_autopilot_runs_started ON autopilot_runs(started_at DESC);
    `);
  });

  migrateTo(db, 43, () => {
    // ── Expanded built-in trend sources ──────────────────────────────────
    // Google Trends: remaining Arab countries
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('Google Trends — الأردن',      'google_trends_geo', 'https://trends.google.com/trending/rss?geo=JO', 'JO', 1, 1),
        ('Google Trends — المغرب',      'google_trends_geo', 'https://trends.google.com/trending/rss?geo=MA', 'MA', 1, 1),
        ('Google Trends — لبنان',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=LB', 'LB', 1, 1),
        ('Google Trends — العراق',      'google_trends_geo', 'https://trends.google.com/trending/rss?geo=IQ', 'IQ', 1, 1),
        ('Google Trends — عُمان',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=OM', 'OM', 1, 1),
        ('Google Trends — البحرين',     'google_trends_geo', 'https://trends.google.com/trending/rss?geo=BH', 'BH', 1, 1),
        ('Google Trends — تونس',        'google_trends_geo', 'https://trends.google.com/trending/rss?geo=TN', 'TN', 1, 1),
        ('Google Trends — الجزائر',     'google_trends_geo', 'https://trends.google.com/trending/rss?geo=DZ', 'DZ', 1, 1),
        ('Google Trends — ليبيا',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=LY', 'LY', 1, 1),
        ('Google Trends — تركيا',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=TR', 'TR', 1, 1),
        ('Google Trends — ألمانيا',     'google_trends_geo', 'https://trends.google.com/trending/rss?geo=DE', 'DE', 1, 1),
        ('Google Trends — فرنسا',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=FR', 'FR', 1, 1),
        ('Google Trends — الهند',       'google_trends_geo', 'https://trends.google.com/trending/rss?geo=IN', 'IN', 1, 1);
    `);

    // YouTube Trending: more Arab regions + global
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('يوتيوب تريندينج — مصر',      'youtube', 'https://www.youtube.com/feeds/videos.xml?chart=most_popular&regionCode=EG', 'YT-EG', 1, 1),
        ('يوتيوب تريندينج — الإمارات', 'youtube', 'https://www.youtube.com/feeds/videos.xml?chart=most_popular&regionCode=AE', 'YT-AE', 1, 1),
        ('يوتيوب تريندينج — الأردن',   'youtube', 'https://www.youtube.com/feeds/videos.xml?chart=most_popular&regionCode=JO', 'YT-JO', 1, 0),
        ('يوتيوب تريندينج — العالم',   'youtube', 'https://www.youtube.com/feeds/videos.xml?chart=most_popular',               'YT-WW', 1, 1);
    `);

    // Google News: regional Arabic feeds
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('Google News — مصر',          'rss', 'https://news.google.com/rss?gl=EG&hl=ar&ceid=EG:ar',             'NEWS-EG', 1, 1),
        ('Google News — الإمارات',     'rss', 'https://news.google.com/rss?gl=AE&hl=ar&ceid=AE:ar',             'NEWS-AE', 1, 1),
        ('Google News — دولي (إنجليزي)','rss', 'https://news.google.com/rss?gl=US&hl=en&ceid=US:en',            'NEWS-EN', 1, 1);
    `);

    // Major Arabic news agencies RSS
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('الجزيرة — آخر الأخبار',      'rss', 'https://www.aljazeera.net/xml/rss/all.xml',                      'AJ',      1, 1),
        ('BBC عربي',                   'rss', 'https://feeds.bbci.co.uk/arabic/rss.xml',                        'BBC-AR',  1, 1),
        ('DW عربي',                    'rss', 'https://rss.dw.com/rdf/rss-ar-all',                              'DW-AR',   1, 1),
        ('سكاي نيوز عربية',            'rss', 'https://www.skynewsarabia.com/rss.xml',                          'SKY-AR',  1, 0),
        ('روسيا اليوم — عربي',         'rss', 'https://arabic.rt.com/rss/',                                     'RT-AR',   1, 0);
    `);

    // Reddit: international trending subreddits (Atom feeds)
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('Reddit — أخبار العالم',       'reddit', 'https://www.reddit.com/r/worldnews/top.rss?t=day',           'RD-NEWS', 1, 1),
        ('Reddit — الشرق الأوسط',      'reddit', 'https://www.reddit.com/r/MiddleEast/top.rss?t=day',           'RD-ME',   1, 1),
        ('Reddit — التكنولوجيا',        'reddit', 'https://www.reddit.com/r/technology/top.rss?t=day',           'RD-TECH', 1, 1),
        ('Reddit — السياسة الدولية',   'reddit', 'https://www.reddit.com/r/geopolitics/top.rss?t=day',          'RD-GEO',  1, 0);
    `);

    // Wikipedia Trending (Wikimedia REST API — date appended dynamically at fetch time)
    db.exec(`
      INSERT OR IGNORE INTO trend_sources (name, type, url, region_tag, is_builtin, is_enabled) VALUES
        ('ويكيبيديا — أكثر مقالات عربية قراءةً', 'wikipedia',
          'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ar.wikipedia.org/all-access',
          'WIKI-AR', 1, 1),
        ('ويكيبيديا — أكثر مقالات إنجليزية قراءةً', 'wikipedia',
          'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access',
          'WIKI-EN', 1, 0);
    `);
  });

  // v44 — Multi-platform scrapers (YouTube, Google News, Twitter, Instagram, Website change detection)
  migrateTo(db, 44, () => {
    ensureCol(db, 'competitor_monitors', 'extra_config', 'TEXT');
    ensureCol(db, 'competitor_monitors', 'last_content_hash', 'TEXT');
    ensureCol(db, 'competitor_snapshots', 'diff_text', 'TEXT');
  });

  // v45 — TikTok scraper + video thumbnails in snapshots
  migrateTo(db, 45, () => {
    ensureCol(db, 'competitor_snapshots', 'thumbnail_url', 'TEXT');
  });

  // v46 — Safe fetch shield: circuit breaker, link health, trust scores, quality tiers
  migrateTo(db, 46, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS domain_circuit_state (
        host TEXT PRIMARY KEY,
        failure_count INTEGER NOT NULL DEFAULT 0,
        open_until TEXT,
        last_status INTEGER,
        shield_score INTEGER NOT NULL DEFAULT 100,
        mode TEXT DEFAULT 'normal',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS link_health_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER,
        url TEXT NOT NULL,
        status_code INTEGER DEFAULT 0,
        health_state TEXT,
        checked_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_link_health_article ON link_health_log(article_id, checked_at);
    `);

    ensureCol(db, 'sources', 'trust_score', 'INTEGER DEFAULT 50');
    ensureCol(db, 'articles', 'link_fingerprint', 'TEXT');
    ensureCol(db, 'articles', 'quality_tier', 'TEXT');
    ensureCol(db, 'articles', 'link_health_state', 'TEXT');
    ensureCol(db, 'articles', 'link_checked_at', 'TEXT');
  });

  // v47 — Pipeline performance tracking + Trend Radar v2.0
  migrateTo(db, 47, () => {
    // v2.0: Pipeline step duration tracking
    ensureCol(db, 'article_processing_log', 'duration_ms', 'INTEGER');

    // v2.0: Trend Radar quality scores and global detection
    ensureCol(db, 'trends', 'quality_score', 'INTEGER');
    ensureCol(db, 'trends', 'velocity_score', 'INTEGER');
    ensureCol(db, 'trends', 'is_global', 'INTEGER DEFAULT 0');
    ensureCol(db, 'trends', 'cluster_id', 'TEXT');
  });

  // v48 — Link articles to the trend that spawned them.
  // pipeline.ts (kanban / getHighPriorityArticles / calculateArticlePriority)
  // already SELECTs and reads articles.trend_id for priority scoring, but the
  // column was never added — every `pipeline:kanban` call threw
  // "SqliteError: no such column: trend_id".
  migrateTo(db, 48, () => {
    ensureCol(db, 'articles', 'trend_id', 'INTEGER');
  });

  // v49 — Advanced Crawler Visited URLs table for link tracking
  migrateTo(db, 49, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crawler_visited_urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER,
        url TEXT NOT NULL,
        visited_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(monitor_id, url)
      );
      CREATE INDEX IF NOT EXISTS idx_crawler_visited ON crawler_visited_urls(monitor_id, url);
    `);
  });

  // v50 — keyword_alerts schema fix. The table was created with `active` and no
  // tenant column, but keyword-alerts.ts inserts/updates/filters on `enabled` and
  // `tenant_id`, so create/toggle/scan threw "no column named enabled" at runtime.
  // Add the columns the service expects (the legacy `active` column stays, unused).
  migrateTo(db, 50, () => {
    ensureCol(db, 'keyword_alerts', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
    ensureCol(db, 'keyword_alerts', 'tenant_id', 'INTEGER');
  });

  // v51 — role_permissions schema fix. The table was created with a single `resource`
  // column (seeded as 'publish:<platform>'), but permissions.ts and the UI use separate
  // `platform` + `action` columns with ON CONFLICT(role,platform,action) — so list/set/
  // hasPermission all threw "no such column: platform". The resource rows were dead (the
  // RBAC guard uses a separate hardcoded table). Rebuild to the platform+action model the
  // service uses and re-seed the defaults in that shape.
  migrateTo(db, 51, () => {
    db.exec(`DROP TABLE IF EXISTS role_permissions;`);
    db.exec(`
      CREATE TABLE role_permissions (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        role     TEXT NOT NULL,
        platform TEXT NOT NULL,
        action   TEXT NOT NULL,
        allowed  INTEGER NOT NULL DEFAULT 1,
        UNIQUE(role, platform, action)
      );
    `);
    const roles = ['super_admin', 'editor', 'reporter', 'viewer'];
    const platforms = ['telegram', 'twitter', 'facebook', 'wordpress', 'discord', 'instagram', 'linkedin', 'whatsapp', 'email'];
    const ins = db.prepare(`INSERT OR IGNORE INTO role_permissions (role, platform, action, allowed) VALUES (?, ?, 'publish', ?)`);
    for (const role of roles) {
      for (const platform of platforms) {
        ins.run(role, platform, (role === 'super_admin' || role === 'editor') ? 1 : 0);
      }
    }
  });

  // v52 — AI Assistant local memory. Stores the user's past commands and which
  // tool ran, used purely on-device to (a) give the model few-shot examples of
  // THIS user's phrasing (cumulative learning) and (b) power proactive
  // suggestions. Never leaves the machine.
  migrateTo(db, 52, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_memory (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        command    TEXT NOT NULL,
        tool       TEXT NOT NULL,
        success    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_assistant_memory_tool ON assistant_memory(tool, success);`);
  });

  // v53 — Learning core: explicit facts/preferences the user teaches the assistant
  // ("remember that I prefer short headlines"). Injected into the AI prompt so the
  // robot personalises over time. Local-only, never sent anywhere but the user's
  // own chosen AI provider as prompt context.
  migrateTo(db, 53, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL DEFAULT 'fact',
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  // v54 — Website change visual side-by-side diff text column
  migrateTo(db, 54, () => {
    ensureCol(db, 'competitor_monitors', 'last_content_text', 'TEXT');
  });
}
