import { useCallback, useEffect, useState } from 'react';
import type { AiProviderTestState } from '../components/AiProvidersPanel';

const PROVIDER_FIELDS: Record<string, string[]> = {
  gemini: ['gemini_api_key'],
  openai: ['openai_api_key'],
  groq: ['groq_api_key'],
  anthropic: ['anthropic_api_key'],
};

/** Model auto-selected when a provider is activated — no manual picker needed. */
export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  anthropic: 'claude-3-5-haiku-20241022',
  ollama: 'llama3.2',
};

export function useAiSettings() {
  const [integrations, setIntegrations] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, AiProviderTestState>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState('gemini');
  const [activeModel, setActiveModel] = useState('');

  const load = useCallback(async () => {
    const res = await window.eyespro.settings.getAll().catch(() => ({ ok: false, data: {} }));
    if (res.ok && res.data) {
      const data = res.data as Record<string, string>;
      setIntegrations(data);
      const ap = data.ai_provider ?? data.default_ai_provider ?? 'gemini';
      setActiveProvider(ap);
      // Show the model currently in use for the active provider
      const model = data[`${ap}_model`] || data.ai_model || PROVIDER_DEFAULT_MODELS[ap] || '';
      setActiveModel(model);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onFieldChange = useCallback((key: string, val: string) => {
    setIntegrations((prev) => ({ ...prev, [key]: val }));
  }, []);

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const onSave = useCallback(async (providerId: string) => {
    setSavingProvider(providerId);
    const keys = PROVIDER_FIELDS[providerId] ?? [];
    for (const key of keys) {
      await window.eyespro.settings.set(key, integrations[key] ?? '');
    }
    setSavingProvider(null);
    void load();
  }, [integrations, load]);

  const onTest = useCallback(async (providerId: string) => {
    setTests((prev) => ({ ...prev, [providerId]: { loading: true } }));
    const fields: Record<string, string> = {};
    for (const key of PROVIDER_FIELDS[providerId] ?? []) {
      fields[key] = integrations[key] ?? '';
    }
    const res = await window.eyespro.ai.testProvider(providerId, fields).catch(() => ({ ok: false as const, error: 'Network error', data: undefined }));
    setTests((prev) => ({
      ...prev,
      [providerId]: {
        loading: false,
        ok: res.ok,
        msg: res.ok ? 'OK' : (res.error ?? 'Failed'),
        latencyMs: res.data?.latencyMs as number | undefined,
      },
    }));
  }, [integrations]);

  /**
   * Activate a provider — the model is determined automatically from PROVIDER_DEFAULT_MODELS.
   * No manual model selection required.
   */
  const onSetActive = useCallback(async (providerId: string) => {
    const model = PROVIDER_DEFAULT_MODELS[providerId] ?? '';
    await window.eyespro.ai.setModel(providerId, model);
    setActiveProvider(providerId);
    setActiveModel(model);
    void load();
  }, [load]);

  return {
    integrations,
    expanded,
    tests,
    savingProvider,
    activeProvider,
    activeModel,
    onToggle,
    onFieldChange,
    onSave,
    onTest,
    onSetActive,
    reload: load,
  };
}
