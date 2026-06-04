import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory settings the router reads through getSetting.
const settings: Record<string, string> = {};
vi.mock('../src/main/services/settings', () => ({
  getSetting: (k: string) => settings[k] ?? '',
  setSetting: (k: string, v: string) => { settings[k] = v; },
}));

// Stub the AI layer so we can see which path the router took.
const runAiRawMock = vi.fn(async () => 'LOCAL_ANSWER');
const runAiChainMock = vi.fn(async () => 'CLOUD_ANSWER');
vi.mock('../src/main/services/ai', () => ({
  runAiRaw: (...a: unknown[]) => runAiRawMock(...a),
  runAiChain: (...a: unknown[]) => runAiChainMock(...a),
  resolveModelForProvider: () => 'llama3',
}));

// Control local-model availability.
const builtinOllamaMock = vi.fn(() => false);
vi.mock('../src/main/services/ollama-manager', () => ({
  isBuiltinOllamaEnabled: () => builtinOllamaMock(),
}));

import { runAiRouted, isPrivacyBlocked, PRIVACY_BLOCKED, getPrivacyMode, localAiAvailable, classifySensitivity } from '../src/main/services/ai-privacy';

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
  runAiRawMock.mockClear(); runAiChainMock.mockClear();
  builtinOllamaMock.mockReturnValue(false);
});

describe('Privacy Router', () => {
  it('defaults to hybrid mode', () => {
    expect(getPrivacyMode()).toBe('hybrid');
  });

  it('hybrid: routes a SENSITIVE call to the local model when available', async () => {
    builtinOllamaMock.mockReturnValue(true);
    const r = await runAiRouted('p', 'i', { sensitive: true });
    expect(r.via).toBe('local');
    expect(r.text).toBe('LOCAL_ANSWER');
    expect(runAiRawMock).toHaveBeenCalledOnce();
    expect(runAiChainMock).not.toHaveBeenCalled();
  });

  it('hybrid: REFUSES a sensitive call when no local model and no opt-in (no leak)', async () => {
    settings.privacy_mode = 'hybrid'; // no local, allow_cloud_for_sensitive unset
    const err = await runAiRouted('p', 'i', { sensitive: true }).catch((e) => e);
    expect(isPrivacyBlocked(err)).toBe(true);
    expect(runAiChainMock).not.toHaveBeenCalled(); // nothing left the device
  });

  it('hybrid: allows sensitive→cloud only when the user explicitly opts in', async () => {
    settings.allow_cloud_for_sensitive = '1';
    const r = await runAiRouted('p', 'i', { sensitive: true });
    expect(r.via).toBe('cloud');
    expect(runAiChainMock).toHaveBeenCalledOnce();
  });

  it('hybrid: a NON-sensitive (public) call uses the cloud chain', async () => {
    const r = await runAiRouted('p', 'i', { sensitive: false });
    expect(r.via).toBe('cloud');
    expect(runAiChainMock).toHaveBeenCalledOnce();
  });

  it('local_only: forces local even for non-sensitive, and refuses if no local model', async () => {
    settings.privacy_mode = 'local_only';
    await expect(runAiRouted('p', 'i', { sensitive: false })).rejects.toThrow(PRIVACY_BLOCKED);
    builtinOllamaMock.mockReturnValue(true);
    const r = await runAiRouted('p', 'i', { sensitive: false });
    expect(r.via).toBe('local');
  });

  it('local_only: never falls back to cloud even with the sensitive opt-in', async () => {
    settings.privacy_mode = 'local_only';
    settings.allow_cloud_for_sensitive = '1';
    await expect(runAiRouted('p', 'i', { sensitive: true })).rejects.toThrow(PRIVACY_BLOCKED);
    expect(runAiChainMock).not.toHaveBeenCalled();
  });

  it('cloud: always uses the chain', async () => {
    settings.privacy_mode = 'cloud';
    const r = await runAiRouted('p', 'i', { sensitive: true });
    expect(r.via).toBe('cloud');
  });

  it('localAiAvailable reflects built-in Ollama or the user allow-flag', () => {
    expect(localAiAvailable()).toBe(false);
    settings.ai_allow_local_ollama = '1';
    expect(localAiAvailable()).toBe(true);
  });

  it('classifySensitivity flags private-corpus markers', () => {
    expect(classifySensitivity('يفضل المستخدم العناوين القصيرة')).toBe(true);
    expect(classifySensitivity('fetch the latest trends')).toBe(false);
  });
});
