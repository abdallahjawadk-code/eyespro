import { getText } from '../net/http';
import { getSetting, setSetting } from './settings';
import {
  getManagedOllamaBaseUrl,
  isBuiltinOllamaEnabled,
  isOllamaApiReachable,
  startManagedOllama,
} from './ollama-manager';

export type AiProviderTestResult = {
  ok: boolean;
  provider: string;
  latencyMs: number;
  message: string;
  modelsCount?: number;
  sampleModel?: string;
};

function cfg(key: string, overrides?: Record<string, string>): string {
  const v = overrides?.[key];
  if (v !== undefined && v !== null) return String(v).trim();
  return (getSetting(key) ?? '').trim();
}

function parseApiError(body: string, status: number): string {
  const slice = body.slice(0, 280);
  if (status === 401 || status === 403) return 'مفتاح API غير صالح أو منتهي الصلاحية';
  if (status === 429) return 'تجاوز حد الطلبات — حاول لاحقاً';
  if (status >= 500) return 'خطأ من خادم المزود — حاول لاحقاً';
  try {
    const j = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return (j.error?.message ?? j.message ?? slice) || `HTTP ${status}`;
  } catch {
    return slice || `HTTP ${status}`;
  }
}

export async function testAiProvider(
  provider: string,
  overrides?: Record<string, string>
): Promise<AiProviderTestResult> {
  const p = provider.trim().toLowerCase();
  const started = Date.now();

  try {
    if (p === 'gemini') {
      const key = cfg('gemini_api_key', overrides);
      if (!key) return fail(p, started, 'أدخل مفتاح Gemini API أولاً');
      const res = await getText(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!res.ok) return fail(p, started, parseApiError(res.body, res.status));
      const data = JSON.parse(res.body) as { models?: { name: string }[] };
      const count = data.models?.length ?? 0;
      const sample = data.models?.[0]?.name?.replace(/^models\//, '') ?? 'gemini-2.0-flash';
      return ok(p, started, `متصل — ${count} نموذج متاح`, count, sample);
    }

    if (p === 'openai') {
      const key = cfg('openai_api_key', overrides);
      if (!key) return fail(p, started, 'أدخل مفتاح OpenAI API أولاً');
      const res = await getText('https://api.openai.com/v1/models', {
        Authorization: `Bearer ${key}`,
      });
      if (!res.ok) return fail(p, started, parseApiError(res.body, res.status));
      const data = JSON.parse(res.body) as { data?: { id: string }[] };
      const gpt = (data.data ?? []).filter((m) => /^gpt-|^o\d/.test(m.id));
      return ok(p, started, `متصل — ${gpt.length} نموذج GPT`, gpt.length, gpt[0]?.id);
    }

    if (p === 'groq') {
      const key = cfg('groq_api_key', overrides);
      if (!key) return fail(p, started, 'أدخل مفتاح Groq API أولاً');
      const res = await getText('https://api.groq.com/openai/v1/models', {
        Authorization: `Bearer ${key}`,
      });
      if (!res.ok) return fail(p, started, parseApiError(res.body, res.status));
      const data = JSON.parse(res.body) as { data?: { id: string }[] };
      const count = data.data?.length ?? 0;
      return ok(p, started, `متصل — ${count} نموذج`, count, data.data?.[0]?.id);
    }

    if (p === 'anthropic') {
      const key = cfg('anthropic_api_key', overrides);
      if (!key) return fail(p, started, 'أدخل مفتاح Anthropic API أولاً');
      const res = await postJsonMinimal(key);
      if (!res.ok) return fail(p, started, parseApiError(res.body, res.status));
      return ok(p, started, 'متصل — Claude جاهز', 5, 'claude-3-5-haiku-20241022');
    }

    if (p === 'ollama') {
      if (isBuiltinOllamaEnabled() && !(await isOllamaApiReachable())) {
        const st = await startManagedOllama();
        if (!st.ok) return fail(p, started, 'شغّل محرك Ollama من قسم التثبيت المدمج أولاً');
      }
      const base = getManagedOllamaBaseUrl().replace(/\/$/, '');
      const res = await getText(`${base}/api/tags`);
      if (!res.ok) return fail(p, started, `Ollama لا يستجيب (${res.status})`);
      const data = JSON.parse(res.body) as { models?: { name: string }[] };
      const count = data.models?.length ?? 0;
      if (count === 0) return fail(p, started, 'المحرك يعمل لكن لا توجد نماذج — حمّل نموذجاً');
      return ok(p, started, `متصل — ${count} نموذج محلي`, count, data.models?.[0]?.name);
    }

    return fail(p, started, `مزود غير معروف: ${p}`);
  } catch (e) {
    return fail(p, started, (e as Error).message);
  }
}

async function postJsonMinimal(apiKey: string): Promise<{ ok: boolean; status: number; body: string }> {
  const { postJson } = await import('../net/http');
  return postJson(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    },
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  );
}

function ok(
  provider: string,
  started: number,
  message: string,
  modelsCount?: number,
  sampleModel?: string
): AiProviderTestResult {
  return {
    ok: true,
    provider,
    latencyMs: Date.now() - started,
    message,
    modelsCount,
    sampleModel,
  };
}

function fail(provider: string, started: number, message: string): AiProviderTestResult {
  return {
    ok: false,
    provider,
    latencyMs: Date.now() - started,
    message,
  };
}

/** Persist provider keys from UI then test. */
export async function testAndSaveProvider(
  provider: string,
  fields: Record<string, string>
): Promise<AiProviderTestResult> {
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith('gemini_') || k.startsWith('openai_') || k.startsWith('groq_') || k.startsWith('anthropic_')) {
      setSetting(k, v);
    }
  }
  return testAiProvider(provider, fields);
}
