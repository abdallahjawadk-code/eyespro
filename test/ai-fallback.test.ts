import { describe, it, expect, vi } from 'vitest';
import { runProviderChain } from '../src/main/services/ai-fallback';

const onEmpty = () => new Error('AI unconfigured');
const chain = [
  { provider: 'openai', model: 'gpt' },
  { provider: 'groq', model: 'llama' },
  { provider: 'ollama', model: 'local' },
];

describe('runProviderChain (AI fallback)', () => {
  it('throws onEmpty for an empty chain', async () => {
    await expect(runProviderChain([], async () => 'x', onEmpty)).rejects.toThrow('AI unconfigured');
  });

  it('returns the primary result without trying fallbacks when it succeeds', async () => {
    const exec = vi.fn(async (p: string) => `out:${p}`);
    const r = await runProviderChain(chain, exec, onEmpty);
    expect(r).toBe('out:openai');
    expect(exec).toHaveBeenCalledTimes(1); // zero overhead on healthy primary
  });

  it('falls through to the next provider when the primary fails', async () => {
    const exec = vi.fn(async (p: string) => {
      if (p === 'openai') throw new Error('429 rate limited');
      return `out:${p}`;
    });
    const r = await runProviderChain(chain, exec, onEmpty);
    expect(r).toBe('out:groq');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('falls through multiple providers to the last healthy one (e.g. local Ollama)', async () => {
    const exec = vi.fn(async (p: string) => {
      if (p === 'ollama') return 'out:ollama';
      throw new Error('cloud provider down');
    });
    const r = await runProviderChain(chain, exec, onEmpty);
    expect(r).toBe('out:ollama');
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when every provider fails', async () => {
    const exec = vi.fn(async (p: string) => { throw new Error(`fail:${p}`); });
    await expect(runProviderChain(chain, exec, onEmpty)).rejects.toThrow('fail:ollama');
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('passes the correct model for each provider to exec', async () => {
    const seen: string[] = [];
    const exec = vi.fn(async (p: string, m: string) => {
      seen.push(`${p}/${m}`);
      if (p !== 'groq') throw new Error('skip');
      return 'ok';
    });
    await runProviderChain(chain, exec, onEmpty);
    expect(seen).toEqual(['openai/gpt', 'groq/llama']);
  });
});
