/**
 * EyesPro License Key Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node keygen.cjs                    generate 1 key
 *   node keygen.cjs --count 10         generate 10 keys
 *   node keygen.cjs --push             generate + push to server
 *
 * Environment:
 *   LICENSE_SECRET   — must match server
 *   SERVER_URL       — e.g. http://localhost:3456
 *   ADMIN_KEY        — must match server
 *   MAX_SEATS        — seats per license (default: 5)
 */

'use strict';

const crypto = require('node:crypto');
const https  = require('node:https');
const http   = require('node:http');

const SECRET    = process.env.LICENSE_SECRET ?? '';
const SERVER    = (process.env.SERVER_URL ?? 'http://localhost:3456').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const MAX_SEATS = parseInt(process.env.MAX_SEATS ?? '5', 10);

if (!SECRET) { console.error('ERROR: LICENSE_SECRET not set'); process.exit(1); }

const args   = process.argv.slice(2);
const count  = parseInt(args[args.indexOf('--count') + 1] ?? '1', 10) || 1;
const doPush = args.includes('--push');

/** Generate a single license serial in EYES-XXXX-XXXX-XXXX-XXXX format */
function generateSerial() {
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  const p1   = rand.slice(0, 4);
  const p2   = rand.slice(4, 8);
  // Use HMAC of random part for last two groups (proves authenticity)
  const sig  = crypto.createHmac('sha256', SECRET).update(rand).digest('hex').toUpperCase();
  const p3   = sig.slice(0, 4);
  const p4   = sig.slice(4, 8);
  return `EYES-${p1}-${p2}-${p3}-${p4}`;
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const data    = JSON.stringify(body);
    const req     = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const serials = Array.from({ length: count }, generateSerial);

  for (const serial of serials) {
    if (doPush) {
      try {
        const res = await postJson(
          `${SERVER}/api/admin/create-license`,
          { serial, max_seats: MAX_SEATS },
          { 'X-Admin-Key': ADMIN_KEY }
        );
        const status = res.ok ? '✓ added' : `✗ ${res.error}`;
        console.log(`${serial}  ${status}`);
      } catch (err) {
        console.log(`${serial}  ✗ network error: ${err.message}`);
      }
    } else {
      console.log(serial);
    }
  }
}

main();
