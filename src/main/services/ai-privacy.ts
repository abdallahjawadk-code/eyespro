/**
 * Privacy Router — the data-leakage guard for the assistant's adaptive brain.
 *
 * The user picks a privacy mode; this module decides whether a given AI call may
 * touch a cloud provider or must stay on-device (Ollama):
 *
 *   - 'local_only' : nothing ever leaves the machine. Refuses if no local model.
 *   - 'hybrid'     : the user's PRIVATE corpus (drafts, learned facts, knowledge
 *                    questions) stays local; lightweight/public work may use cloud.
 *   - 'cloud'      : the legacy behaviour — always use the configured provider chain.
 *
 * A "sensitive" call carries the user's own data. In hybrid/local_only we route it
 * to the local model; if no local model is available we REFUSE rather than silently
 * leak it to the cloud — unless the user has explicitly opted into a cloud fallback
 * for sensitive data (`allow_cloud_for_sensitive`). This is the concrete mechanism
 * behind "guarantee no data leakage".
 */
import { getSetting } from './settings';
import { runAiRaw, runAiChain, resolveModelForProvider } from './ai';
import { isBuiltinOllamaEnabled } from './ollama-manager';

export type PrivacyMode = 'local_only' | 'hybrid' | 'cloud';

/** Sentinel thrown when a sensitive call cannot run without leaking. Caller maps to UI. */
export const PRIVACY_BLOCKED = 'PRIVACY_LOCAL_REQUIRED';

/** Active privacy mode. Defaults to 'hybrid' — local for private data, cloud for public. */
export function getPrivacyMode(): PrivacyMode {
  const v = (getSetting('privacy_mode') ?? '').trim();
  return v === 'local_only' || v === 'cloud' ? v : 'hybrid';
}

/** True when an on-device model can serve a request (built-in Ollama or user-allowed local). */
export function localAiAvailable(): boolean {
  if (isBuiltinOllamaEnabled()) return true;
  const v = getSetting('ai_allow_local_ollama');
  return v === '1' || v === 'true';
}

function allowCloudForSensitive(): boolean {
  const v = getSetting('allow_cloud_for_sensitive');
  return v === '1' || v === 'true';
}

/**
 * Heuristic flag for callers that don't know a priori. Marks text that plainly
 * carries the user's own corpus. Explicit `{ sensitive }` from the caller always
 * wins; this only helps autonomous flows classify their own payloads.
 */
export function classifySensitivity(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  // Personal-preference / private-corpus markers (Arabic + English).
  return /يفضل المستخدم|يهتم المستخدم|يركز المستخدم|تفضيلات|مسودة|مسودّة|my draft|my article|i prefer|my preference/.test(t);
}

export interface RoutedResult { text: string; via: 'local' | 'cloud' }

/**
 * Run an AI call under the active privacy policy.
 * @throws Error(PRIVACY_BLOCKED) when a sensitive call would have to leak to satisfy it.
 */
export async function runAiRouted(
  prompt: string,
  input: string,
  opts: { sensitive: boolean },
): Promise<RoutedResult> {
  const mode = getPrivacyMode();
  const mustStayLocal = mode === 'local_only' || (mode === 'hybrid' && opts.sensitive);

  if (mustStayLocal) {
    if (localAiAvailable()) {
      const text = await runAiRaw(prompt, input, 'ollama', resolveModelForProvider('ollama'));
      return { text, via: 'local' };
    }
    // No local model. Refuse rather than leak — unless the user opted in for sensitive data.
    if (opts.sensitive && allowCloudForSensitive() && mode !== 'local_only') {
      return { text: await runAiChain(prompt, input), via: 'cloud' };
    }
    throw new Error(PRIVACY_BLOCKED);
  }

  // Public/non-sensitive work, or 'cloud' mode: use the normal provider chain.
  return { text: await runAiChain(prompt, input), via: 'cloud' };
}

/** Whether a thrown error is the privacy-block sentinel. */
export function isPrivacyBlocked(err: unknown): boolean {
  return err instanceof Error && err.message === PRIVACY_BLOCKED;
}
