/**
 * Co-pilot ledger — collaborative, auditable autonomy.
 *
 * The assistant learns continuously (see assistant.ts adaptive memory + perception
 * loop) but never acts on the program unilaterally. Instead it raises *proposals*
 * — "add this discovered source", "monitor this competitor" — which the user
 * approves or rejects. Every proposal and its outcome is recorded in
 * `assistant_proposals`, giving a transparent audit trail and an undo path:
 * approving stores what the action produced (e.g. the new source id) so it can be
 * reversed later.
 *
 * This is the substrate the guarded-autonomy phase builds on: the same ledger,
 * with a per-day cap and an allow-list, lets low-risk proposals auto-approve while
 * everything stays reviewable and reversible.
 */
import { getDb } from '../db/database';
import { createLogger } from '../logger';
import { createSource, deleteSource } from './sources';
import { addMonitor } from './competitor-monitor';
import { getSetting, setSetting } from './settings';

const log = createLogger('copilot');

export type ProposalKind = 'add_source' | 'monitor_competitor';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'undone';

export interface Proposal {
  id: number;
  kind: ProposalKind;
  title: string;
  payload: Record<string, unknown>;
  source: string;
  confidence: number;
  status: ProposalStatus;
  result: Record<string, unknown> | null;
  created_at: string;
  decided_at: string | null;
}

interface ProposalRow {
  id: number; kind: string; title: string; payload: string | null; source: string;
  confidence: number; status: string; result: string | null; created_at: string; decided_at: string | null;
}

function parse<T>(s: string | null): T | null { try { return s ? JSON.parse(s) as T : null; } catch { return null; } }

function hydrate(r: ProposalRow): Proposal {
  return {
    id: r.id, kind: r.kind as ProposalKind, title: r.title,
    payload: parse<Record<string, unknown>>(r.payload) ?? {},
    source: r.source, confidence: r.confidence, status: r.status as ProposalStatus,
    result: parse<Record<string, unknown>>(r.result), created_at: r.created_at, decided_at: r.decided_at,
  };
}

/** A stable signature so the same proposal isn't raised twice while still pending. */
function signature(kind: string, payload: Record<string, unknown>): string {
  return `${kind}:${(payload.url ?? payload.feedUrl ?? payload.name ?? JSON.stringify(payload))}`.toLowerCase().slice(0, 300);
}

/** Raise a proposal (deduped against existing pending ones). Returns its id. */
export function createProposal(p: {
  kind: ProposalKind; title: string; payload: Record<string, unknown>; source?: string; confidence?: number;
}): number {
  try {
    const sig = signature(p.kind, p.payload);
    const dupe = getDb().prepare(
      `SELECT id, kind, payload FROM assistant_proposals WHERE status = 'pending' AND kind = ?`
    ).all(p.kind) as { id: number; kind: string; payload: string | null }[];
    for (const d of dupe) {
      if (signature(d.kind, parse<Record<string, unknown>>(d.payload) ?? {}) === sig) return d.id;
    }
    const r = getDb().prepare(
      `INSERT INTO assistant_proposals (kind, title, payload, source, confidence)
       VALUES (?, ?, ?, ?, ?)`
    ).run(p.kind, p.title.slice(0, 300), JSON.stringify(p.payload), p.source ?? 'assistant', p.confidence ?? 0.5);
    return Number(r.lastInsertRowid);
  } catch (e) { log.warn(`createProposal failed: ${(e as Error).message}`); return 0; }
}

export function listProposals(status: ProposalStatus | 'all' = 'pending', limit = 50): Proposal[] {
  try {
    const rows = status === 'all'
      ? getDb().prepare(`SELECT * FROM assistant_proposals ORDER BY id DESC LIMIT ?`).all(limit)
      : getDb().prepare(`SELECT * FROM assistant_proposals WHERE status = ? ORDER BY id DESC LIMIT ?`).all(status, limit);
    return (rows as ProposalRow[]).map(hydrate);
  } catch { return []; }
}

export function countPending(): number {
  try { return (getDb().prepare(`SELECT COUNT(*) c FROM assistant_proposals WHERE status = 'pending'`).get() as { c: number }).c; }
  catch { return 0; }
}

function getProposal(id: number): Proposal | null {
  try {
    const r = getDb().prepare(`SELECT * FROM assistant_proposals WHERE id = ?`).get(id) as ProposalRow | undefined;
    return r ? hydrate(r) : null;
  } catch { return null; }
}

/** Execute an approved proposal's side effect, returning a reversible result. */
function execute(p: Proposal): Record<string, unknown> {
  if (p.kind === 'add_source') {
    const name = String(p.payload.name ?? 'مصدر مقترح');
    const url = p.payload.url ? String(p.payload.url) : undefined;
    const sourceId = createSource({ name, url });
    return { sourceId };
  }
  if (p.kind === 'monitor_competitor') {
    const name = String(p.payload.name ?? 'منافس');
    const feedUrl = String(p.payload.feedUrl ?? p.payload.url ?? '');
    const { id } = addMonitor(name, feedUrl, p.payload.websiteUrl ? String(p.payload.websiteUrl) : undefined);
    return { monitorId: id };
  }
  throw new Error(`Unknown proposal kind: ${p.kind}`);
}

/** Approve → execute the action, recording the result for a possible undo. */
export function approveProposal(id: number, opts: { auto?: boolean } = {}): { ok: boolean; result?: Record<string, unknown>; error?: string } {
  const p = getProposal(id);
  if (!p) return { ok: false, error: 'not_found' };
  if (p.status !== 'pending') return { ok: false, error: `already_${p.status}` };
  try {
    const result = execute(p);
    getDb().prepare(`UPDATE assistant_proposals SET status = 'approved', result = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(result), opts.auto ? 'auto' : 'user', id);
    log.info('proposal approved', { id, kind: p.kind, by: opts.auto ? 'auto' : 'user' });
    return { ok: true, result };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Reject a pending proposal (no side effect). */
export function rejectProposal(id: number): { ok: boolean; error?: string } {
  const p = getProposal(id);
  if (!p) return { ok: false, error: 'not_found' };
  if (p.status !== 'pending') return { ok: false, error: `already_${p.status}` };
  getDb().prepare(`UPDATE assistant_proposals SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`).run(id);
  log.info('proposal rejected', { id, kind: p.kind });
  return { ok: true };
}

/** Undo a previously approved proposal by reversing its recorded result. */
export function undoProposal(id: number): { ok: boolean; error?: string } {
  const p = getProposal(id);
  if (!p) return { ok: false, error: 'not_found' };
  if (p.status !== 'approved') return { ok: false, error: 'not_approved' };
  try {
    if (p.kind === 'add_source' && p.result?.sourceId) deleteSource(Number(p.result.sourceId));
    // monitor_competitor reversal intentionally omitted until a deleteMonitor exists.
    getDb().prepare(`UPDATE assistant_proposals SET status = 'undone', decided_at = datetime('now') WHERE id = ?`).run(id);
    log.info('proposal undone', { id, kind: p.kind });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Turn the assistant's discovered sources (stored as `recommended_source` facts)
 * into actionable proposals the user can approve. Idempotent via createProposal's
 * dedup. Returns how many new proposals were raised.
 */
export function generateSourceProposals(): number {
  let made = 0;
  try {
    const facts = getDb().prepare(
      `SELECT content FROM assistant_facts WHERE kind = 'recommended_source'`
    ).all() as { content: string }[];
    for (const f of facts) {
      // Format: "مصدر مقترح: {name} - يغطي اهتماماتك بـ ... (عينة مقال: {link})"
      const name = /مصدر مقترح:\s*([^\-–]+?)\s*[-–]/.exec(f.content)?.[1]?.trim();
      const link = /عينة مقال:\s*(\S+?)\)/.exec(f.content)?.[1]?.trim();
      if (!name) continue;
      const before = countPendingByName(name);
      const id = createProposal({
        kind: 'add_source',
        title: `إضافة مصدر مكتشَف: ${name}`,
        payload: { name, url: link },
        source: 'web:discovery',
        confidence: 0.7,
      });
      if (id && !before) made++;
    }
  } catch (e) { log.warn(`generateSourceProposals failed: ${(e as Error).message}`); }
  return made;
}

function countPendingByName(name: string): number {
  try {
    const rows = getDb().prepare(`SELECT payload FROM assistant_proposals WHERE status = 'pending' AND kind = 'add_source'`).all() as { payload: string | null }[];
    return rows.filter((r) => (parse<{ name?: string }>(r.payload)?.name ?? '') === name).length;
  } catch { return 0; }
}

// ── guarded autonomy ──────────────────────────────────────────────────────────
// Low-risk, reversible proposals may auto-approve within limits the user sets:
// a per-day cap, an allow-list of kinds, and a minimum confidence. Everything an
// auto-approval does lands in the same ledger (decided_by='auto') and is undoable.

export type AutonomyLevel = 'off' | 'suggest' | 'auto_safe';
export interface AutonomyConfig {
  level: AutonomyLevel;        // off = no proposals act; suggest = propose only; auto_safe = auto-approve safe kinds
  dailyCap: number;           // max auto-approvals per calendar day
  allowedKinds: ProposalKind[]; // which kinds may auto-approve
  minConfidence: number;      // only auto-approve at/above this confidence
}

const AUTONOMY_DEFAULTS: AutonomyConfig = {
  level: 'suggest',            // safe default — the user opts into auto_safe explicitly
  dailyCap: 5,
  allowedKinds: ['add_source'], // only the fully-reversible kind by default
  minConfidence: 0.7,
};

export function getAutonomyConfig(): AutonomyConfig {
  const level = (getSetting('autonomy_level') ?? '').trim();
  const capRaw = (getSetting('autonomy_daily_cap') ?? '').trim();
  const cap = capRaw ? Number(capRaw) : NaN;
  const kinds = (getSetting('autonomy_allowed_kinds') ?? '').split(',').map((k) => k.trim()).filter(Boolean) as ProposalKind[];
  const mincRaw = (getSetting('autonomy_min_confidence') ?? '').trim();
  const minc = mincRaw ? Number(mincRaw) : NaN;
  return {
    level: (level === 'off' || level === 'auto_safe') ? level : AUTONOMY_DEFAULTS.level,
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : AUTONOMY_DEFAULTS.dailyCap,
    allowedKinds: kinds.length ? kinds : AUTONOMY_DEFAULTS.allowedKinds,
    minConfidence: Number.isFinite(minc) && minc >= 0 ? minc : AUTONOMY_DEFAULTS.minConfidence,
  };
}

export function setAutonomyConfig(partial: Partial<AutonomyConfig>): AutonomyConfig {
  if (partial.level) setSetting('autonomy_level', partial.level);
  if (partial.dailyCap != null) setSetting('autonomy_daily_cap', String(partial.dailyCap));
  if (partial.allowedKinds) setSetting('autonomy_allowed_kinds', partial.allowedKinds.join(','));
  if (partial.minConfidence != null) setSetting('autonomy_min_confidence', String(partial.minConfidence));
  return getAutonomyConfig();
}

/** How many proposals the assistant has auto-approved today (drives the daily cap). */
export function countAutoApprovedToday(): number {
  try {
    return (getDb().prepare(
      `SELECT COUNT(*) c FROM assistant_proposals WHERE decided_by = 'auto' AND date(decided_at) = date('now')`
    ).get() as { c: number }).c;
  } catch { return 0; }
}

/**
 * The guarded executor: auto-approve pending proposals that pass every gate
 * (level=auto_safe, kind allow-listed, confidence ≥ threshold) without exceeding
 * the remaining daily budget. Returns what it did so the caller can report/log it.
 */
export function autoApprovePending(): { approved: number[]; skipped: number; reason?: string } {
  const cfg = getAutonomyConfig();
  if (cfg.level !== 'auto_safe') return { approved: [], skipped: 0, reason: 'disabled' };
  let budget = cfg.dailyCap - countAutoApprovedToday();
  if (budget <= 0) return { approved: [], skipped: 0, reason: 'cap_reached' };

  const pending = listProposals('pending');
  const approved: number[] = [];
  for (const p of pending) {
    if (budget <= 0) break;
    if (!cfg.allowedKinds.includes(p.kind)) continue;
    if (p.confidence < cfg.minConfidence) continue;
    const r = approveProposal(p.id, { auto: true });
    if (r.ok) { approved.push(p.id); budget--; }
  }
  if (approved.length) log.info('guarded autonomy auto-approved proposals', { count: approved.length });
  return { approved, skipped: pending.length - approved.length };
}

/** Recent auto-approved actions (for the audit view). */
export function listAutoApproved(limit = 20): Proposal[] {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM assistant_proposals WHERE decided_by = 'auto' ORDER BY id DESC LIMIT ?`
    ).all(limit) as ProposalRow[];
    return rows.map(hydrate);
  } catch { return []; }
}
