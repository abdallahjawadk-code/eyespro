/**
 * EyesPro License Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone Node.js + SQLite license activation server.
 *
 * Setup:
 *   1. npm install better-sqlite3 express
 *   2. Set environment variables (see below)
 *   3. node server.cjs
 *
 * Environment variables:
 *   PORT              (default: 3456)
 *   LICENSE_SECRET    REQUIRED — secret used to sign/verify license keys
 *   ADMIN_KEY         REQUIRED — HTTP header key for admin endpoints
 *   DB_PATH           (default: ./licenses.db)
 *   MAX_SEATS         (default: 5) — max machines per license
 *
 * API endpoints:
 *   POST /api/activate    { serial, machine_id, product }
 *   POST /api/verify      { serial, machine_id, token }
 *   POST /api/deactivate  { serial, machine_id, token }
 *   GET  /api/health
 *   GET  /api/admin/licenses          (requires X-Admin-Key header)
 *   POST /api/admin/create-license    (requires X-Admin-Key header)
 *   POST /api/admin/revoke-license    (requires X-Admin-Key header)
 */

'use strict';

const http          = require('node:http');
const crypto        = require('node:crypto');
const Database      = require('better-sqlite3');
const path          = require('node:path');

const PORT          = parseInt(process.env.PORT  ?? '3456', 10);
const SECRET        = process.env.LICENSE_SECRET ?? '';
const ADMIN_KEY     = process.env.ADMIN_KEY      ?? '';
const DB_PATH       = process.env.DB_PATH        ?? path.join(__dirname, 'licenses.db');
const MAX_SEATS     = parseInt(process.env.MAX_SEATS ?? '5', 10);

if (!SECRET)    { console.error('ERROR: LICENSE_SECRET not set'); process.exit(1); }
if (!ADMIN_KEY) { console.error('ERROR: ADMIN_KEY not set');      process.exit(1); }

// ─── Database ──────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    serial      TEXT    NOT NULL UNIQUE,
    product     TEXT    NOT NULL DEFAULT 'eyespro',
    max_seats   INTEGER NOT NULL DEFAULT ${MAX_SEATS},
    revoked     INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    serial      TEXT    NOT NULL,
    machine_id  TEXT    NOT NULL,
    token       TEXT    NOT NULL UNIQUE,
    activated_at TEXT   NOT NULL DEFAULT (datetime('now')),
    last_seen    TEXT   NOT NULL DEFAULT (datetime('now')),
    UNIQUE(serial, machine_id)
  );
`);

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeToken(serial, machineId) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${serial}::${machineId}::${Date.now()}`)
    .digest('hex');
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 4096) reject(new Error('Too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function requireAdminKey(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    send(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─── Route handlers ────────────────────────────────────────────────────────

function handleActivate(body, res) {
  const { serial, machine_id, product = 'eyespro' } = body;
  if (!serial || !machine_id) return send(res, 400, { ok: false, error: 'Missing fields' });

  const lic = db.prepare('SELECT * FROM licenses WHERE serial = ? AND product = ?').get(serial, product);
  if (!lic)           return send(res, 404, { ok: false, error: 'Serial not found' });
  if (lic.revoked)    return send(res, 403, { ok: false, error: 'License revoked' });

  // Already activated on this machine?
  const existing = db.prepare('SELECT * FROM activations WHERE serial = ? AND machine_id = ?').get(serial, machine_id);
  if (existing) {
    db.prepare("UPDATE activations SET last_seen = datetime('now') WHERE id = ?").run(existing.id);
    return send(res, 200, { ok: true, token: existing.token, seats_used: countSeats(serial), seats_total: lic.max_seats });
  }

  // Check seat limit
  const seats = countSeats(serial);
  if (seats >= lic.max_seats) {
    return send(res, 403, { ok: false, error: `وصلت للحد الأقصى من الأجهزة (${lic.max_seats}). يُرجى إلغاء تفعيل جهاز آخر أولاً.` });
  }

  const token = makeToken(serial, machine_id);
  db.prepare('INSERT INTO activations (serial, machine_id, token) VALUES (?, ?, ?)').run(serial, machine_id, token);
  return send(res, 200, { ok: true, token, seats_used: seats + 1, seats_total: lic.max_seats });
}

function handleVerify(body, res) {
  const { serial, machine_id, token } = body;
  if (!serial || !machine_id || !token) return send(res, 400, { ok: false, error: 'Missing fields' });

  const lic = db.prepare('SELECT revoked FROM licenses WHERE serial = ?').get(serial);
  if (!lic)        return send(res, 404, { ok: false, error: 'Serial not found' });
  if (lic.revoked) return send(res, 403, { ok: false, error: 'License revoked' });

  const act = db.prepare('SELECT id FROM activations WHERE serial = ? AND machine_id = ? AND token = ?').get(serial, machine_id, token);
  if (!act) return send(res, 403, { ok: false, error: 'Activation not found' });

  db.prepare("UPDATE activations SET last_seen = datetime('now') WHERE id = ?").run(act.id);
  return send(res, 200, { ok: true });
}

function handleDeactivate(body, res) {
  const { serial, machine_id, token } = body;
  if (!serial || !machine_id) return send(res, 400, { ok: false, error: 'Missing fields' });

  db.prepare('DELETE FROM activations WHERE serial = ? AND machine_id = ? AND token = ?').run(serial, machine_id, token ?? '');
  return send(res, 200, { ok: true });
}

function countSeats(serial) {
  return (db.prepare('SELECT COUNT(*) AS c FROM activations WHERE serial = ?').get(serial))?.c ?? 0;
}

// ─── Admin endpoints ───────────────────────────────────────────────────────

function handleAdminList(res) {
  const rows = db.prepare(`
    SELECT l.serial, l.product, l.max_seats, l.revoked, l.note, l.created_at,
           COUNT(a.id) AS seats_used
    FROM licenses l
    LEFT JOIN activations a ON a.serial = l.serial
    GROUP BY l.id ORDER BY l.created_at DESC
  `).all();
  send(res, 200, { ok: true, licenses: rows });
}

function handleAdminCreate(body, res) {
  const { serial, product = 'eyespro', max_seats = MAX_SEATS, note = '' } = body;
  if (!serial) return send(res, 400, { ok: false, error: 'serial required' });
  try {
    db.prepare('INSERT INTO licenses (serial, product, max_seats, note) VALUES (?, ?, ?, ?)').run(serial, product, max_seats, note);
    send(res, 200, { ok: true, serial });
  } catch {
    send(res, 409, { ok: false, error: 'Serial already exists' });
  }
}

function handleAdminRevoke(body, res) {
  const { serial } = body;
  if (!serial) return send(res, 400, { ok: false, error: 'serial required' });
  db.prepare('UPDATE licenses SET revoked = 1 WHERE serial = ?').run(serial);
  db.prepare('DELETE FROM activations WHERE serial = ?').run(serial);
  send(res, 200, { ok: true });
}

// ─── HTTP server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url    = req.url?.split('?')[0] ?? '/';
  const method = req.method ?? 'GET';

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'GET' && url === '/api/health') {
    return send(res, 200, { ok: true, product: 'eyespro-license-server' });
  }

  if (method === 'GET' && url === '/api/admin/licenses') {
    if (!requireAdminKey(req, res)) return;
    return handleAdminList(res);
  }

  if (method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { ok: false, error: 'Bad request' }); }

    if (url === '/api/activate')   return handleActivate(body, res);
    if (url === '/api/verify')     return handleVerify(body, res);
    if (url === '/api/deactivate') return handleDeactivate(body, res);

    if (url === '/api/admin/create-license') {
      if (!requireAdminKey(req, res)) return;
      return handleAdminCreate(body, res);
    }
    if (url === '/api/admin/revoke-license') {
      if (!requireAdminKey(req, res)) return;
      return handleAdminRevoke(body, res);
    }
  }

  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`EyesPro License Server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
