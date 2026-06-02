/**
 * Feature 14 — Mobile Companion API
 *
 * Extends the existing HTTP API server with mobile-optimised endpoints:
 *   GET  /mobile/v1/feed          — paginated article feed (compact)
 *   GET  /mobile/v1/article/:id   — full article (mobile-friendly)
 *   POST /mobile/v1/approve/:id   — quick approve/publish action
 *   GET  /mobile/v1/stats         — dashboard stats (lightweight)
 *   POST /mobile/v1/publish/:id   — publish to selected platforms
 *   GET  /mobile/v1/monitor       — live monitor snapshot
 *
 * Also generates a PWA web-app manifest so the existing renderer
 * can be installed as a home-screen app on mobile devices.
 *
 * Authentication: same Bearer / X-API-Key as the main API server.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../db/database';
import { sanitizeInt } from '../security/sanitize';

// ─── Types (reuse from api-server pattern) ────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ─── Endpoint handlers ────────────────────────────────────────────────────────

const feedHandler: Handler = async (_req, res, _p) => {
  const url = new URL(`http://x${_req.url ?? '/'}`);
  const page  = Math.max(1, sanitizeInt(url.searchParams.get('page')  ?? '1', 1, 1000));
  const limit = Math.min(50, sanitizeInt(url.searchParams.get('limit') ?? '20', 1, 50));
  const offset = (page - 1) * limit;

  type Row = { id: number; title: string; summary: string | null; status: string; source: string | null; published_at: string | null; image_url: string | null; created_at: string };
  const rows = getDb()
    .prepare(
      `SELECT id, title, summary, status, source, published_at, image_url, created_at
       FROM articles
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Row[];

  const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM articles`).get() as { n: number }).n;

  json(res, { ok: true, data: rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
};

const articleHandler: Handler = async (_req, res, p) => {
  const id = sanitizeInt(p['id'] ?? '0', 1);
  const row = getDb().prepare(`SELECT * FROM articles WHERE id=?`).get(id);
  if (!row) return json(res, { ok: false, error: 'Not found' }, 404);
  json(res, { ok: true, data: row });
};

const approveHandler: Handler = async (_req, res, p) => {
  const id = sanitizeInt(p['id'] ?? '0', 1);
  const changes = getDb()
    .prepare(`UPDATE articles SET status='pending', updated_at=datetime('now') WHERE id=? AND status='draft'`)
    .run(id).changes;
  json(res, { ok: changes > 0, message: changes > 0 ? 'تمت الموافقة' : 'لم يتم التحديث' });
};

const statsHandler: Handler = async (_req, res, _p) => {
  const db = getDb();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n ?? 0;
  json(res, {
    ok: true,
    data: {
      pending:   n(`SELECT COUNT(*) AS n FROM articles WHERE status='pending'`),
      published: n(`SELECT COUNT(*) AS n FROM articles WHERE status='published'`),
      today:     n(`SELECT COUNT(*) AS n FROM articles WHERE date(created_at)=date('now')`),
      sources:   n(`SELECT COUNT(*) AS n FROM sources WHERE enabled=1`),
      queuedRetries: n(`SELECT COUNT(*) AS n FROM publish_queue WHERE status='pending'`),
    },
  });
};

const publishHandler: Handler = async (_req, res, _p) => {
  json(res, { ok: false, error: 'النشر غير متاح — استخدم تحميل DOCX' }, 410);
};

// ─── Route table ──────────────────────────────────────────────────────────────

interface MobileRoute {
  method:  string;
  pattern: RegExp;
  keys:    string[];
  handler: Handler;
}

const ROUTES: MobileRoute[] = [
  { method: 'GET',  pattern: /^\/mobile\/v1\/feed$/,              keys: [],     handler: feedHandler },
  { method: 'GET',  pattern: /^\/mobile\/v1\/article\/(\d+)$/,    keys: ['id'], handler: articleHandler },
  { method: 'POST', pattern: /^\/mobile\/v1\/approve\/(\d+)$/,    keys: ['id'], handler: approveHandler },
  { method: 'GET',  pattern: /^\/mobile\/v1\/stats$/,             keys: [],     handler: statsHandler },
  { method: 'POST', pattern: /^\/mobile\/v1\/publish\/(\d+)$/,    keys: ['id'], handler: publishHandler },
];

/** Route a request; returns true if handled. */
export async function handleMobileRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;

  for (const route of ROUTES) {
    if (req.method !== route.method) continue;
    const m = pathname.match(route.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => { params[k] = m[i + 1] ?? ''; });
    await route.handler(req, res, params);
    return true;
  }
  return false;
}

// ─── PWA manifest ─────────────────────────────────────────────────────────────

export function getPwaManifest(): Record<string, unknown> {
  return {
    name:             'EyesPro',
    short_name:       'EyesPro',
    description:      'نظام إدارة ونشر المحتوى الإخباري',
    start_url:        '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#0f172a',
    theme_color:      '#3b82f6',
    lang:             'ar',
    dir:              'rtl',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
    shortcuts: [
      { name: 'مقالات معلّقة', url: '/articles?status=pending', description: 'عرض المقالات المعلقة' },
      { name: 'نشر سريع',      url: '/publish',                  description: 'نشر مقال' },
    ],
  };
}
