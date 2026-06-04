import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers/test-db';
import type Database from 'better-sqlite3';

// Observe the side effects of executing/undoing proposals.
const createSourceMock = vi.fn(() => 101);
const deleteSourceMock = vi.fn(() => true);
const addMonitorMock = vi.fn(() => ({ id: 202 }));
vi.mock('../src/main/services/sources', () => ({
  createSource: (...a: unknown[]) => createSourceMock(...a),
  deleteSource: (...a: unknown[]) => deleteSourceMock(...a),
}));
vi.mock('../src/main/services/competitor-monitor', () => ({
  addMonitor: (...a: unknown[]) => addMonitorMock(...a),
}));

// In-memory settings for the autonomy config.
const settings: Record<string, string> = {};
vi.mock('../src/main/services/settings', () => ({
  getSetting: (k: string) => settings[k] ?? '',
  setSetting: (k: string, v: string) => { settings[k] = v; },
}));

import {
  createProposal, listProposals, countPending,
  approveProposal, rejectProposal, undoProposal, generateSourceProposals,
  getAutonomyConfig, setAutonomyConfig, autoApprovePending, countAutoApprovedToday, listAutoApproved,
} from '../src/main/services/copilot';

let db: Database.Database;
beforeEach(() => {
  db = setupTestDb();
  createSourceMock.mockClear(); deleteSourceMock.mockClear(); addMonitorMock.mockClear();
  for (const k of Object.keys(settings)) delete settings[k];
});
afterEach(() => { teardownTestDb(); vi.restoreAllMocks(); });

describe('Co-pilot proposal ledger', () => {
  it('creates a pending proposal and lists it', () => {
    const id = createProposal({ kind: 'add_source', title: 'Add BBC', payload: { name: 'BBC', url: 'https://bbc.com' } });
    expect(id).toBeGreaterThan(0);
    expect(countPending()).toBe(1);
    expect(listProposals('pending')[0].title).toBe('Add BBC');
  });

  it('dedupes an identical pending proposal', () => {
    createProposal({ kind: 'add_source', title: 'Add BBC', payload: { name: 'BBC', url: 'https://bbc.com' } });
    createProposal({ kind: 'add_source', title: 'Add BBC again', payload: { name: 'BBC', url: 'https://bbc.com' } });
    expect(countPending()).toBe(1);
  });

  it('approve executes the side effect and records a reversible result', () => {
    const id = createProposal({ kind: 'add_source', title: 'Add BBC', payload: { name: 'BBC', url: 'https://bbc.com' } });
    const r = approveProposal(id);
    expect(r.ok).toBe(true);
    expect(createSourceMock).toHaveBeenCalledOnce();
    expect(r.result).toEqual({ sourceId: 101 });
    expect(listProposals('approved')[0].id).toBe(id);
    expect(countPending()).toBe(0);
  });

  it('approve on a monitor_competitor proposal calls addMonitor', () => {
    const id = createProposal({ kind: 'monitor_competitor', title: 'Watch X', payload: { name: 'X', feedUrl: 'https://x.com/feed' } });
    const r = approveProposal(id);
    expect(r.ok).toBe(true);
    expect(addMonitorMock).toHaveBeenCalledOnce();
    expect(r.result).toEqual({ monitorId: 202 });
  });

  it('reject marks the proposal without side effects', () => {
    const id = createProposal({ kind: 'add_source', title: 'Add CNN', payload: { name: 'CNN' } });
    expect(rejectProposal(id).ok).toBe(true);
    expect(createSourceMock).not.toHaveBeenCalled();
    expect(listProposals('rejected')[0].id).toBe(id);
  });

  it('cannot approve an already-decided proposal', () => {
    const id = createProposal({ kind: 'add_source', title: 'Add CNN', payload: { name: 'CNN' } });
    rejectProposal(id);
    expect(approveProposal(id)).toEqual({ ok: false, error: 'already_rejected' });
  });

  it('undo reverses an approved add_source by deleting the created source', () => {
    const id = createProposal({ kind: 'add_source', title: 'Add BBC', payload: { name: 'BBC', url: 'https://bbc.com' } });
    approveProposal(id);
    const r = undoProposal(id);
    expect(r.ok).toBe(true);
    expect(deleteSourceMock).toHaveBeenCalledWith(101);
    expect(listProposals('undone')[0].id).toBe(id);
  });

  it('generateSourceProposals turns discovered-source facts into proposals', () => {
    db.prepare(
      `INSERT INTO assistant_facts (kind, content, source, trust, observed)
       VALUES ('recommended_source', 'مصدر مقترح: BBC News - يغطي اهتماماتك بـ "السياسة" (عينة مقال: https://bbc.com/a1)', 'web:google-news', 0.7, 1)`
    ).run();
    const made = generateSourceProposals();
    expect(made).toBe(1);
    const p = listProposals('pending')[0];
    expect(p.kind).toBe('add_source');
    expect(p.payload.name).toBe('BBC News');
    expect(p.payload.url).toBe('https://bbc.com/a1');
    // idempotent — running again raises nothing new
    expect(generateSourceProposals()).toBe(0);
    expect(countPending()).toBe(1);
  });
});

describe('Guarded autonomy', () => {
  const addSrc = (conf: number) => createProposal({ kind: 'add_source', title: `src ${conf}`, payload: { name: `S${conf}`, url: `https://s${conf}.com` }, confidence: conf });

  it('defaults to a safe, conservative config', () => {
    const cfg = getAutonomyConfig();
    expect(cfg.level).toBe('suggest');
    expect(cfg.dailyCap).toBe(5);
    expect(cfg.allowedKinds).toEqual(['add_source']);
    expect(cfg.minConfidence).toBe(0.7);
  });

  it('does nothing while level is suggest (proposes only)', () => {
    addSrc(0.9);
    const r = autoApprovePending();
    expect(r.reason).toBe('disabled');
    expect(r.approved).toHaveLength(0);
    expect(countPending()).toBe(1);
    expect(createSourceMock).not.toHaveBeenCalled();
  });

  it('auto_safe approves an allowed, confident proposal and marks it decided_by=auto', () => {
    setAutonomyConfig({ level: 'auto_safe' });
    addSrc(0.8);
    const r = autoApprovePending();
    expect(r.approved).toHaveLength(1);
    expect(createSourceMock).toHaveBeenCalledOnce();
    expect(countAutoApprovedToday()).toBe(1);
    expect(listAutoApproved()[0].status).toBe('approved');
  });

  it('skips proposals below the confidence threshold', () => {
    setAutonomyConfig({ level: 'auto_safe', minConfidence: 0.7 });
    addSrc(0.5); // too low
    expect(autoApprovePending().approved).toHaveLength(0);
    expect(countPending()).toBe(1);
  });

  it('skips kinds that are not on the allow-list', () => {
    setAutonomyConfig({ level: 'auto_safe' }); // allowedKinds default = [add_source]
    createProposal({ kind: 'monitor_competitor', title: 'watch', payload: { name: 'X', feedUrl: 'https://x/feed' }, confidence: 0.9 });
    expect(autoApprovePending().approved).toHaveLength(0);
    expect(addMonitorMock).not.toHaveBeenCalled();
  });

  it('never exceeds the daily cap', () => {
    setAutonomyConfig({ level: 'auto_safe', dailyCap: 1 });
    addSrc(0.8); addSrc(0.9);
    expect(autoApprovePending().approved).toHaveLength(1); // cap hit
    expect(autoApprovePending().reason).toBe('cap_reached'); // subsequent run blocked
    expect(countAutoApprovedToday()).toBe(1);
  });

  it('auto-approved actions remain reversible via the ledger', () => {
    setAutonomyConfig({ level: 'auto_safe' });
    addSrc(0.9);
    const id = autoApprovePending().approved[0];
    expect(undoProposal(id).ok).toBe(true);
    expect(deleteSourceMock).toHaveBeenCalled();
  });
});
