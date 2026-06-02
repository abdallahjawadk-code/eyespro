/**
 * Feature 6 — Outgoing Webhooks
 *
 * Allows external systems to subscribe to EyesPro events via HTTP POST.
 * Events: article.created | article.published | publish.success | publish.failed | source.fetched
 * | pipeline.batch.complete | pipeline.batch.failed
 *
 * Security: every delivery includes an HMAC-SHA256 signature in the
 * X-EyesPro-Signature header so the receiver can verify authenticity.
 *
 * Delivery is async, with exponential-backoff retries (up to 3 attempts).
 * DB tables: webhook_endpoints, webhook_deliveries  (added in migration v21)
 */

import { createHmac, randomBytes } from 'crypto';
import { getDb } from '../db/database';
import { postJson } from '../net/http';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'article.created'
  | 'article.published'
  | 'publish.success'
  | 'publish.failed'
  | 'source.fetched'
  | 'pipeline.batch.complete'
  | 'pipeline.batch.failed';

export interface WebhookEndpoint {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: number;
  endpointId: number;
  event: string;
  payloadJson: string;
  status: 'pending' | 'delivered' | 'failed';
  httpStatus: number | null;
  attempts: number;
  nextTry: string;
  createdAt: string;
}

// ─── Endpoint management ─────────────────────────────────────────────────────

export function listEndpoints(): WebhookEndpoint[] {
  type Row = { id: number; name: string; url: string; secret: string; events_json: string; enabled: number; created_at: string };
  return (getDb().prepare(`SELECT * FROM webhook_endpoints ORDER BY id DESC`).all() as Row[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      secret: r.secret,
      events: JSON.parse(r.events_json) as WebhookEvent[],
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    }));
}

export function createEndpoint(data: {
  name: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
}): number {
  const secret = data.secret || randomBytes(24).toString('hex');
  const result = getDb()
    .prepare(
      `INSERT INTO webhook_endpoints (name, url, secret, events_json, enabled)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(data.name, data.url, secret, JSON.stringify(data.events));
  return Number(result.lastInsertRowid);
}

export function updateEndpoint(
  id: number,
  data: Partial<{ name: string; url: string; events: WebhookEvent[]; enabled: boolean }>
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined)    { sets.push('name=?');         vals.push(data.name); }
  if (data.url !== undefined)     { sets.push('url=?');          vals.push(data.url); }
  if (data.events !== undefined)  { sets.push('events_json=?');  vals.push(JSON.stringify(data.events)); }
  if (data.enabled !== undefined) { sets.push('enabled=?');      vals.push(data.enabled ? 1 : 0); }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE webhook_endpoints SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
}

export function deleteEndpoint(id: number): void {
  getDb().prepare(`DELETE FROM webhook_endpoints WHERE id=?`).run(id);
  getDb().prepare(`DELETE FROM webhook_deliveries WHERE endpoint_id=?`).run(id);
}

export function listDeliveries(endpointId?: number, limit = 50): WebhookDelivery[] {
  const where = endpointId ? 'WHERE endpoint_id=?' : '';
  const params = endpointId ? [endpointId, limit] : [limit];
  type Row = { id: number; endpoint_id: number; event: string; payload_json: string; status: string; http_status: number | null; attempts: number; next_try: string; created_at: string };
  return (getDb()
    .prepare(`SELECT * FROM webhook_deliveries ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params) as Row[])
    .map((r) => ({
      id: r.id,
      endpointId: r.endpoint_id,
      event: r.event,
      payloadJson: r.payload_json,
      status: r.status as WebhookDelivery['status'],
      httpStatus: r.http_status,
      attempts: r.attempts,
      nextTry: r.next_try,
      createdAt: r.created_at,
    }));
}

// ─── Signature ────────────────────────────────────────────────────────────────

function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Delivery ────────────────────────────────────────────────────────────────

const BACKOFF_MINUTES = [1, 5, 30];

async function deliver(deliveryId: number): Promise<void> {
  type Row = { endpoint_id: number; payload_json: string; attempts: number };
  const delivery = getDb()
    .prepare(`SELECT endpoint_id, payload_json, attempts FROM webhook_deliveries WHERE id=?`)
    .get(deliveryId) as Row | undefined;
  if (!delivery) return;

  type Ep = { url: string; secret: string; enabled: number };
  const endpoint = getDb()
    .prepare(`SELECT url, secret, enabled FROM webhook_endpoints WHERE id=?`)
    .get(delivery.endpoint_id) as Ep | undefined;
  if (!endpoint || !endpoint.enabled) return;

  const signature = sign(endpoint.secret, delivery.payload_json);
  const res = await postJson(
    endpoint.url,
    JSON.parse(delivery.payload_json),
    { 'X-EyesPro-Signature': signature, 'X-EyesPro-Event': '' }
  );

  const newAttempts = delivery.attempts + 1;
  if (res.ok) {
    getDb()
      .prepare(`UPDATE webhook_deliveries SET status='delivered', http_status=?, attempts=? WHERE id=?`)
      .run(res.status, newAttempts, deliveryId);
  } else {
    const backoffMins = BACKOFF_MINUTES[Math.min(newAttempts - 1, BACKOFF_MINUTES.length - 1)]!;
    const finalFail = newAttempts >= 3;
    getDb()
      .prepare(
        `UPDATE webhook_deliveries
         SET status=?, http_status=?, attempts=?,
             next_try=datetime('now', ?)
         WHERE id=?`
      )
      .run(
        finalFail ? 'failed' : 'pending',
        res.status,
        newAttempts,
        `+${backoffMins} minutes`,
        deliveryId
      );
  }
}

// ─── Event firing ─────────────────────────────────────────────────────────────

/**
 * Fire a webhook event. Creates delivery records for all matching enabled endpoints
 * and attempts immediate delivery (non-blocking — failures are retried by the queue).
 */
export async function fireEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  type Ep = { id: number; url: string; secret: string; events_json: string };
  const endpoints = getDb()
    .prepare(`SELECT id, url, secret, events_json FROM webhook_endpoints WHERE enabled=1`)
    .all() as Ep[];

  const timestamp = new Date().toISOString();
  const fullPayload = { event, timestamp, data: payload };
  const payloadJson = JSON.stringify(fullPayload);

  const insertStmt = getDb().prepare(
    `INSERT INTO webhook_deliveries (endpoint_id, event, payload_json, status, attempts, next_try)
     VALUES (?, ?, ?, 'pending', 0, datetime('now'))`
  );

  const deliveryIds: number[] = [];
  for (const ep of endpoints) {
    const subscribedEvents = JSON.parse(ep.events_json) as string[];
    if (!subscribedEvents.includes(event)) continue;
    const r = insertStmt.run(ep.id, event, payloadJson);
    deliveryIds.push(Number(r.lastInsertRowid));
  }

  // Attempt immediate delivery (don't await — fire and forget)
  Promise.allSettled(deliveryIds.map((id) => deliver(id))).catch(() => undefined);
}

/** Process pending/retryable deliveries (called by the scheduler tick). */
export async function processDeliveryQueue(): Promise<void> {
  type Row = { id: number };
  const pending = getDb()
    .prepare(
      `SELECT id FROM webhook_deliveries
       WHERE status='pending' AND next_try <= datetime('now')
       LIMIT 20`
    )
    .all() as Row[];

  await Promise.allSettled(pending.map((r) => deliver(r.id)));
}

/** Send a test ping to an endpoint (does not create a delivery record). */
export async function testEndpoint(id: number): Promise<{ ok: boolean; httpStatus?: number; error?: string }> {
  type Ep = { url: string; secret: string };
  const ep = getDb()
    .prepare(`SELECT url, secret FROM webhook_endpoints WHERE id=?`)
    .get(id) as Ep | undefined;
  if (!ep) return { ok: false, error: 'Endpoint not found' };

  const payload = { event: 'ping', timestamp: new Date().toISOString(), data: { message: 'EyesPro webhook test' } };
  const body = JSON.stringify(payload);
  const signature = sign(ep.secret, body);

  const res = await postJson(ep.url, payload, { 'X-EyesPro-Signature': signature });
  return { ok: res.ok, httpStatus: res.status };
}
