import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/database';
import { createLogger } from '../logger';
import { sanitizeInt, sanitizeString } from '../security/sanitize';
import { getSetting } from './settings';
import * as articles from './articles';
import { listSources } from './sources';
import { buildOpenApiSpec } from './openapi-spec';
import { handleMobileRequest, getPwaManifest } from './mobile-api';

const log = createLogger('api-server');
export const API_SCOPES = [
  'articles.read',
  'articles.write',
  'sources.read',
  'rss.read',
  'webhook.receive'
] as const;

let server: http.Server | null = null;
const rateBuckets = new Map<number, { windowStart: number; count: number }>();
const anonBuckets = new Map<string, { windowStart: number; count: number }>();

// Prevent unbounded memory growth — prune stale buckets every 5 minutes
const BUCKET_TTL = 2 * 60_000; // 2 min (2× the rate window)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) { if (now - v.windowStart > BUCKET_TTL) rateBuckets.delete(k); }
  for (const [k, v] of anonBuckets)  { if (now - v.windowStart > BUCKET_TTL) anonBuckets.delete(k);  }
}, 5 * 60_000).unref(); // .unref() so it doesn't keep the process alive

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function parseScopes(json: string): string[] {
  try {
    const arr = JSON.parse(json || '[]') as string[];
    return arr.filter((s) => (API_SCOPES as readonly string[]).includes(s));
  } catch {
    return ['articles.read'];
  }
}

function authenticate(req: http.IncomingMessage): { id: number; name: string; scopes: string[] } | null {
  const auth = req.headers.authorization ?? '';
  const headerKey = req.headers['x-api-key'] ?? '';
  let token = '';
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  else if (typeof headerKey === 'string') token = headerKey.trim();
  if (!token.startsWith('epk_')) return null;
  const row = getDb()
    .prepare(`SELECT * FROM api_keys WHERE key_hash=? AND enabled=1`)
    .get(hashKey(token)) as { id: number; name: string; scopes: string } | undefined;
  if (!row) return null;
  getDb().prepare(`UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?`).run(row.id);
  return { id: row.id, name: row.name, scopes: parseScopes(row.scopes) };
}

function corsOrigin(req: http.IncomingMessage): string {
  const origin = req.headers.origin || '';
  if (!origin) return 'null';
  // eslint-disable-next-line security/detect-unsafe-regex -- ^ and $ anchors prevent ReDoS; localhost-only CORS check
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return origin;
  return 'null';
}

function send(res: http.ServerResponse, status: number, body: unknown, req?: http.IncomingMessage, extra: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': extra['Content-Type'] || 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': req ? corsOrigin(req) : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(payload);
}

function clientIp(req: http.IncomingMessage): string {
  return String(req.socket?.remoteAddress || '127.0.0.1').replace('::ffff:', '');
}

function checkAnonRate(ip: string): boolean {
  const now = Date.now();
  let bucket = anonBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { windowStart: now, count: 0 };
    anonBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= 30;
}

function checkKeyRate(keyId: number): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(keyId, bucket);
  }
  bucket.count += 1;
  return bucket.count <= 120;
}

function hasScope(key: { scopes: string[] }, scope: string): boolean {
  return key.scopes.includes(scope);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 512_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRss(): string {
  const rows = getDb()
    .prepare(
      `SELECT title, summary, link, published_at, created_at FROM articles WHERE status='published' ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50`
    )
    .all() as { title: string; summary: string | null; link: string | null; published_at: string | null; created_at: string }[];
  const site = getSetting('site_url') || 'https://eyespro.local';
  const items = rows
    .map(
      (a) => `
    <item>
      <title>${escapeXml(a.title)}</title>
      <description>${escapeXml(a.summary || '')}</description>
      <link>${escapeXml(a.link || site)}</link>
      <pubDate>${new Date(a.published_at || a.created_at).toUTCString()}</pubDate>
    </item>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>EyesPro Feed</title>
  <link>${escapeXml(site)}</link>
  <description>Masar Network RSS — © Masar Network</description>
  <language>ar</language>${items}
</channel></rss>`;
}

function requireKeyAlways(): boolean {
  return getSetting('api_require_key') === '1';
}

function rssPublic(): boolean {
  if (requireKeyAlways()) return false;
  return getSetting('api_rss_public') === '1';
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = clientIp(req);
  if (!checkAnonRate(ip)) {
    send(res, 429, { ok: false, error: 'Rate limit exceeded' }, req);
    return;
  }

  if (req.method === 'OPTIONS') {
    send(res, 204, '', req);
    return;
  }

  const port = Number(getSetting('api_server_port') || '3847') || 3847;
  const host = req.headers.host || `127.0.0.1:${port}`;
  let pathname = '/';
  let searchParams = new URLSearchParams();
  try {
    const u = new URL(req.url ?? '/', `http://${host}`);
    pathname = u.pathname.replace(/\/+$/, '') || '/';
    searchParams = u.searchParams;
  } catch {
    send(res, 400, { ok: false, error: 'Invalid URL' }, req);
    return;
  }

  const base = `http://127.0.0.1:${port}`;

  if (pathname === '/health' || pathname === '/api/v1/health') {
    if (req.method === 'GET') {
      send(res, 200, { ok: true, service: 'EyesPro API', version: '1.0.0' }, req);
      return;
    }
  }

  if (pathname === '/api/v1/openapi.json' && req.method === 'GET') {
    if (requireKeyAlways()) {
      const key = authenticate(req);
      if (!key) {
        send(res, 401, { ok: false, error: 'API key required' }, req);
        return;
      }
    }
    send(res, 200, buildOpenApiSpec(base), req);
    return;
  }

  if (pathname === '/api/v1/rss.xml' && req.method === 'GET') {
    const key = authenticate(req);
    const needsKey = requireKeyAlways() || !rssPublic();
    if (needsKey && (!key || !hasScope(key, 'rss.read'))) {
      send(res, 401, { ok: false, error: 'API key required' }, req);
      return;
    }
    if (key && !checkKeyRate(key.id)) {
      send(res, 429, { ok: false, error: 'Rate limit' }, req);
      return;
    }
    send(res, 200, buildRss(), req, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    return;
  }

  const key = authenticate(req);
  if (!key && getSetting('api_require_key') === '1') {
    send(res, 401, { ok: false, error: 'Invalid or missing API key' }, req);
    return;
  }
  if (key && !checkKeyRate(key.id)) {
    send(res, 429, { ok: false, error: 'Rate limit' }, req);
    return;
  }

  if (pathname === '/api/v1/articles' && req.method === 'GET') {
    if (key && !hasScope(key, 'articles.read')) {
      send(res, 403, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const status = searchParams.get('status') || undefined;
    const page = sanitizeInt(Number(searchParams.get('page')) || 1, 1);
    const pageSize = Math.min(sanitizeInt(Number(searchParams.get('pageSize')) || 50, 1), 100);
    send(res, 200, { ok: true, data: articles.listArticles({ status, page, pageSize }) }, req);
    return;
  }

  const artMatch = pathname.match(/^\/api\/v1\/articles\/(\d+)$/);
  if (artMatch && req.method === 'GET') {
    if (key && !hasScope(key, 'articles.read')) {
      send(res, 403, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const id = sanitizeInt(artMatch[1], 1);
    const row = articles.getArticle(id);
    if (!row) {
      send(res, 404, { ok: false, error: 'Not found' }, req);
      return;
    }
    send(res, 200, { ok: true, data: row }, req);
    return;
  }

  if (artMatch && req.method === 'PATCH') {
    if (!key || !hasScope(key, 'articles.write')) {
      send(res, key ? 403 : 401, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const id = sanitizeInt(artMatch[1], 1);
    const body = await readBody(req);
    const okUp = articles.updateArticle(id, {
      title: body.title != null ? String(body.title) : undefined,
      summary: body.summary != null ? String(body.summary) : undefined,
      content: body.content != null ? String(body.content) : undefined,
      link: body.link != null ? String(body.link) : undefined,
      source: body.source != null ? String(body.source) : undefined,
      category: body.category != null ? String(body.category) : undefined,
      status: body.status != null ? String(body.status) : undefined
    });
    send(res, okUp ? 200 : 404, { ok: okUp }, req);
    return;
  }

  if (artMatch && req.method === 'DELETE') {
    if (!key || !hasScope(key, 'articles.write')) {
      send(res, key ? 403 : 401, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const id = sanitizeInt(artMatch[1], 1);
    articles.deleteArticle(id);
    send(res, 200, { ok: true }, req);
    return;
  }

  if (pathname === '/api/v1/articles' && req.method === 'POST') {
    if (!key || !hasScope(key, 'articles.write')) {
      send(res, key ? 403 : 401, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const body = await readBody(req);
    const title = sanitizeString(String(body.title || ''), 500);
    if (!title) {
      send(res, 400, { ok: false, error: 'title required' }, req);
      return;
    }
    const id = articles.createArticle({
      title,
      summary: body.summary != null ? String(body.summary) : undefined,
      content: body.content != null ? String(body.content) : undefined,
      link: body.link != null ? String(body.link) : undefined,
      source: body.source != null ? String(body.source) : undefined,
      category: body.category != null ? String(body.category) : undefined,
      status: body.status != null ? String(body.status) : 'pending'
    });
    send(res, 201, { ok: true, id, data: articles.getArticle(id) }, req);
    return;
  }

  if (pathname === '/api/v1/sources' && req.method === 'GET') {
    if (!key || !hasScope(key, 'sources.read')) {
      send(res, key ? 403 : 401, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    send(res, 200, { ok: true, data: listSources() }, req);
    return;
  }

  if (pathname === '/api/v1/hooks/article' && req.method === 'POST') {
    if (!key || !hasScope(key, 'webhook.receive')) {
      send(res, key ? 403 : 401, { ok: false, error: 'Forbidden' }, req);
      return;
    }
    const body = await readBody(req);
    const title = sanitizeString(String(body.title || ''), 500);
    if (!title) {
      send(res, 400, { ok: false, error: 'title required' }, req);
      return;
    }
    const id = articles.createArticle({
      title,
      summary: body.summary != null ? String(body.summary) : undefined,
      content: (body.content ?? body.text) != null ? String(body.content ?? body.text) : undefined,
      link: body.link != null ? String(body.link) : undefined,
      source: body.source != null ? String(body.source) : 'webhook',
      category: body.category != null ? String(body.category) : undefined,
      status: 'pending'
    });
    send(res, 201, { ok: true, id }, req);
    return;
  }

  // Mobile API routes
  if (pathname.startsWith('/mobile/')) {
    const handled = await handleMobileRequest(req, res);
    if (handled) return;
  }

  // PWA manifest
  if (pathname === '/manifest.webmanifest' && req.method === 'GET') {
    send(res, 200, getPwaManifest(), req);
    return;
  }

  send(res, 404, { ok: false, error: 'Not found' }, req);
}

export function apiStatus(): { running: boolean; port: number; baseUrl: string; rssPublic: boolean } {
  const port = Number(getSetting('api_server_port') || '3847') || 3847;
  return {
    running: !!server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    rssPublic: rssPublic()
  };
}

export function startApiServer(): { ok: boolean; error?: string } {
  if (server) return { ok: true };
  const port = Number(getSetting('api_server_port') || '3847') || 3847;
  try {
    server = http.createServer((req, res) => {
      void handle(req, res).catch((e) => {
        log.error('api request failed', { error: (e as Error).message });
        send(res, 500, { error: 'Internal error' });
      });
    });
    server.listen(port, '127.0.0.1', () => log.info('API listening', { port }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function stopApiServer(): void {
  server?.close();
  server = null;
}

export function createApiKey(name: string, scopes: string[]): { key: string; id: number } {
  const raw = `epk_${randomBytes(24).toString('hex')}`;
  const filtered = scopes.filter((s) => (API_SCOPES as readonly string[]).includes(s as (typeof API_SCOPES)[number]));
  const r = getDb()
    .prepare(`INSERT INTO api_keys (name, key_hash, scopes) VALUES (?, ?, ?)`)
    .run(name, hashKey(raw), JSON.stringify(filtered.length ? filtered : ['articles.read']));
  return { key: raw, id: Number(r.lastInsertRowid) };
}

export function listApiKeys() {
  return getDb().prepare(`SELECT id, name, scopes, enabled, last_used_at, created_at FROM api_keys`).all();
}

export function revokeApiKey(id: number): void {
  getDb().prepare(`UPDATE api_keys SET enabled=0 WHERE id=?`).run(id);
}
