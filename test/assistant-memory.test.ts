import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers/test-db';
import type Database from 'better-sqlite3';

// Same dependency mocks as assistant.test.ts — importing the service pulls these in.
const runAiChainMock = vi.fn();
vi.mock('../src/main/services/ai', () => ({
  runAiChain: (p: string, i: string) => runAiChainMock(p, i),
  checkAiProviderReady: () => Promise.resolve({ ok: true, provider: 'gemini' }),
  resolveEffectiveAiProvider: () => 'gemini',
  formatAiErrorMessage: (m: string) => `Formatted: ${m}`,
}));
vi.mock('../src/main/services/settings', () => ({
  getSetting: () => '',
  setSetting: () => {},
}));
vi.mock('../src/main/services/analytics', () => ({
  dashboardMetrics: () => ({ total: 10, published: 5, pending: 3, sources: 2 }),
}));

import {
  decayedWeight,
  potentiate,
  factSimilarity,
  rememberFact,
  listFacts,
  weakenFact,
  perceive,
} from '../src/main/services/assistant';

let db: Database.Database;
beforeEach(() => { db = setupTestDb(); });
afterEach(() => { teardownTestDb(); vi.restoreAllMocks(); });

describe('Adaptive synaptic memory — pure helpers', () => {
  it('decayedWeight does not decay at 0 days and shrinks over time', () => {
    expect(decayedWeight(2, 0)).toBe(2);
    expect(decayedWeight(2, 100)).toBeLessThan(2);
    expect(decayedWeight(2, 100)).toBeGreaterThan(0);
    // ~23-day half-life: 23 days ≈ half strength
    expect(decayedWeight(2, 23)).toBeCloseTo(1, 0);
  });

  it('potentiate grows weak synapses but saturates at the ceiling (5)', () => {
    expect(potentiate(1)).toBeGreaterThan(1);
    expect(potentiate(1)).toBeLessThanOrEqual(5);
    expect(potentiate(5)).toBe(5);
    // monotonic, never exceeds ceiling
    expect(potentiate(4.9)).toBeLessThanOrEqual(5);
  });

  it('factSimilarity is 1 for identical, 0 for disjoint, fractional for partial overlap', () => {
    expect(factSimilarity('hello world foo', 'hello world foo')).toBe(1);
    expect(factSimilarity('alpha beta', 'gamma delta')).toBe(0);
    expect(factSimilarity('hello world foo', 'hello world bar')).toBeCloseTo(0.5, 5);
  });
});

describe('Adaptive synaptic memory — DB-backed behaviour', () => {
  const rowCount = () => (db.prepare('SELECT COUNT(*) c FROM assistant_facts').get() as { c: number }).c;

  it('learns a new fact with initial strength', () => {
    rememberFact('user prefers short concise headlines');
    const f = listFacts();
    expect(f).toHaveLength(1);
    expect(f[0].weight).toBe(1);
    expect(f[0].content).toContain('short concise headlines');
  });

  it('reinforces a similar fact instead of duplicating it (Hebbian)', () => {
    rememberFact('user prefers short concise headlines');
    rememberFact('user prefers short concise headlines'); // re-derived → reinforce
    expect(rowCount()).toBe(1);              // no duplicate row
    const f = listFacts();
    expect(f[0].hits).toBeGreaterThan(1);    // activation counted
    expect(f[0].weight).toBeGreaterThan(1);  // synapse strengthened
  });

  it('orders facts by effective strength — reinforced facts rank first', () => {
    rememberFact('alpha beta gamma topic');
    rememberFact('delta epsilon zeta subject');
    rememberFact('delta epsilon zeta subject'); // reinforce the second
    rememberFact('delta epsilon zeta subject');
    expect(listFacts()[0].content).toContain('delta epsilon zeta');
  });

  it('forgetting weakens a fact and eventually deletes it', () => {
    rememberFact('a throwaway note to forget');
    const id = listFacts()[0].id;
    weakenFact(id); weakenFact(id); weakenFact(id); // drops below the floor → removed
    expect(rowCount()).toBe(0);
  });

  it('a long-dormant fact has lower strength than its stored weight (decay)', () => {
    // Insert directly with an old last_used to simulate disuse.
    db.prepare(
      `INSERT INTO assistant_facts (kind, content, weight, hits, last_used)
       VALUES ('fact', 'an old neglected memory', 3, 1, datetime('now', '-60 days'))`
    ).run();
    const f = listFacts()[0];
    expect(f.weight).toBe(3);
    expect(f.strength).toBeLessThan(3);
  });
});

describe('Provenance-aware memory', () => {
  it('records source, trust and observed/inferred provenance', () => {
    rememberFact('user told me this', 'fact', { source: 'user', trust: 1, observed: true });
    rememberFact('the model guessed this', 'reflection', { source: 'inferred:reflection', trust: 0.5, observed: false });
    const byContent = Object.fromEntries(listFacts().map((f) => [f.content, f]));
    expect(byContent['user told me this'].source).toBe('user');
    expect(byContent['user told me this'].observed).toBe(true);
    expect(byContent['the model guessed this'].trust).toBe(0.5);
    expect(byContent['the model guessed this'].observed).toBe(false);
  });

  it('ranks by influence = strength × trust — a trusted fact outranks an equal-strength low-trust one', () => {
    // Both fresh (strength ≈ 1); trust breaks the tie.
    rememberFact('low trust inferred claim alpha', 'reflection', { source: 'inferred', trust: 0.3, observed: false });
    rememberFact('high trust user stated beta', 'fact', { source: 'user', trust: 1, observed: true });
    expect(listFacts()[0].content).toContain('high trust user stated beta');
  });

  it('reinforcement corroborates — repeated activation nudges trust upward', () => {
    rememberFact('a tentative inferred preference', 'reflection', { source: 'inferred', trust: 0.5, observed: false });
    const before = listFacts()[0].trust;
    rememberFact('a tentative inferred preference'); // re-derived → reinforced
    const after = listFacts()[0].trust;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(1);
  });

  it('defaults provenance to user/full-trust/observed when unspecified', () => {
    rememberFact('a plainly remembered fact');
    const f = listFacts()[0];
    expect(f.source).toBe('user');
    expect(f.trust).toBe(1);
    expect(f.observed).toBe(true);
  });
});

describe('Perception loop — live content reinforces interests', () => {
  it('reinforces an interest the fetched batch corroborates (recurs across ≥2 items)', () => {
    rememberFact('user follows artificial intelligence policy news', 'reflection', { source: 'inferred:reflection', trust: 0.5, observed: false });
    const before = listFacts()[0];
    const res = perceive([
      { title: 'New artificial intelligence policy proposed' },
      { title: 'Lawmakers debate artificial intelligence policy' },
      { title: 'Football transfer window latest' },
    ], { source: 'trends' });
    expect(res.reinforced).toHaveLength(1);
    expect(res.reinforced[0].matches).toBeGreaterThanOrEqual(2);
    expect(listFacts()[0].weight).toBeGreaterThan(before.weight); // strengthened
  });

  it('ignores a one-off coincidence (topic appears in only one item)', () => {
    rememberFact('user follows climate change coverage', 'reflection', { source: 'inferred:reflection', trust: 0.5, observed: false });
    const res = perceive([
      { title: 'Climate change summit opens' },
      { title: 'Stock markets rally today' },
    ], { source: 'trends' });
    expect(res.reinforced).toHaveLength(0); // single match < MIN_MATCHES
  });

  it('is a no-op with no facts or no items', () => {
    expect(perceive([{ title: 'anything' }], { source: 'trends' }).reinforced).toHaveLength(0);
    rememberFact('some interest about economy');
    expect(perceive([], { source: 'trends' }).reinforced).toHaveLength(0);
  });
});
