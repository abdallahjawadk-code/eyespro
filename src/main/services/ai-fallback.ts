/**
 * Pure AI provider fallback runner — no DB/electron imports, so it's unit-testable
 * in isolation. ai.ts builds the provider chain and supplies the executor.
 */
import { createLogger } from '../logger';

const log = createLogger('ai-fallback');

export interface ProviderRef {
  provider: string;
  model: string;
}

/**
 * Try each provider in `chain` via `exec`, returning the first success. Falls
 * through to the next provider only on error, so a healthy primary has zero
 * overhead. Throws `onEmpty()` for an empty chain, or the last error if all fail.
 */
export async function runProviderChain<T>(
  chain: ProviderRef[],
  exec: (provider: string, model: string) => Promise<T>,
  onEmpty: () => Error,
): Promise<T> {
  if (chain.length === 0) throw onEmpty();
  let lastErr: unknown = onEmpty();
  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i]!;
    try {
      const out = await exec(provider, model);
      if (i > 0) log.warn('AI fallback succeeded', { provider, primary: chain[0]!.provider });
      return out;
    } catch (err) {
      lastErr = err;
      log.warn('AI provider failed, trying next', {
        provider,
        next: chain[i + 1]?.provider ?? 'none',
        error: (err as Error).message,
      });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
