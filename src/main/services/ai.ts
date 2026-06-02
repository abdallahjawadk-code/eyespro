import { getDb } from '../db/database';
import { getText, postJson } from '../net/http';
import { getSetting } from './settings';
import { getArticle, snapshotOriginalBeforeRewrite, snapshotOriginalContentIfEmpty, updateArticle } from './articles';
import {
  getManagedOllamaBaseUrl,
  isBuiltinOllamaEnabled,
  isOllamaApiReachable,
  startManagedOllama,
} from './ollama-manager';

export type AiMode =
  | 'summarize'
  | 'rewrite'
  | 'tldr'
  | 'seo_meta'
  | 'translate'
  | 'grammar'
  | 'tag_sentiment';

export interface AiModel {
  id: string;
  name: string;
  provider: 'gemini' | 'ollama' | 'openai' | 'groq' | 'anthropic';
  type: 'cloud' | 'local';
}

/** Default model ID used for each provider when none is explicitly configured. */
export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  anthropic: 'claude-3-5-haiku-20241022',
  ollama: 'llama3.2',
};

/**
 * Resolve the model to use for a specific provider.
 * Priority: per-provider setting (`${provider}_model`) → global `ai_model`
 * (only when provider matches) → provider default.
 */
export function resolveModelForProvider(provider: string): string {
  const perProvider = (getSetting(`${provider}_model`) ?? '').trim();
  if (perProvider) return perProvider;
  const global = (getSetting('ai_model') ?? '').trim();
  if (global) return global;
  return PROVIDER_DEFAULT_MODELS[provider] ?? '';
}

function allowLocalOllama(): boolean {
  if (isBuiltinOllamaEnabled()) return true;
  const v = getSetting('ai_allow_local_ollama');
  return v === '1' || v === 'true';
}

function ollamaApiBase(): string {
  return getManagedOllamaBaseUrl().replace(/\/$/, '');
}

const SYSTEM_PROMPT =
  'أنت محرر أخبار محترف متخصص في اللغة العربية الفصحى. ' +
  'تكتب بأسلوب صحفي دقيق ومحايد. لا تضف تعليقاً ولا مقدمة، فقط النتيجة المطلوبة مباشرة.';

const PROMPTS: Record<AiMode, string> = {
  summarize:
    'لخّص هذا المقال الإخباري في ٢-٣ جمل باللغة العربية الفصحى، مع الحفاظ على الوقائع والأرقام:',
  rewrite:
    'أعد صياغة هذا المقال الإخباري بأسلوب صحفي احترافي باللغة العربية الفصحى. ' +
    'احتفظ بجميع الحقائق والتواريخ والأرقام. لا تحذف معلومات جوهرية:',
  tldr:
    'اكتب جملة واحدة موجزة (TL;DR) تلخّص أهم نقطة في هذا المقال باللغة العربية:',
  seo_meta:
    'اكتب عنوان SEO ووصف SEO لهذا المقال باللغة العربية. ' +
    'أعد النتيجة بتنسيق JSON فقط بدون أي نص إضافي:\n' +
    '{"meta_title": "...", "meta_description": "..."}',
  translate:
    'ترجم هذا المقال إلى اللغة الإنجليزية بأسلوب صحفي احترافي:',
  grammar:
    'صحّح الأخطاء النحوية والإملائية والأسلوبية في هذا النص العربي. ' +
    'أعد النص المصحح فقط بدون أي تعليق:',
  tag_sentiment:
    'قم بتحليل المقال الإخباري التالي واستخلاص البيانات بدقة:\n' +
    '1. كلمات مفتاحية أو وسوم مناسبة (tags) كـ قائمة مفصولة بفاصلة.\n' +
    '2. التصنيف الأنسب للمقال (category) مثل (سياسة، اقتصاد، تكنولوجيا، رياضة، ثقافة، عام).\n' +
    '3. نبرة ومشاعر المقال (sentiment) وتكون إما (positive) أو (negative) أو (neutral).\n' +
    '4. درجة المشاعر (sentiment_score) كـ رقم عشري بين -1.0 و 1.0 (حيث -1.0 سلبي جداً، و 0.0 محايد، و 1.0 إيجابي جداً).\n\n' +
    'أعد النتيجة بتنسيق JSON فقط مطابق تمامًا للهيكل التالي دون أي نص إضافي أو علامات ماركداون:\n' +
    '{"tags": "كلمة1, كلمة2", "category": "التصنيف", "sentiment": "neutral", "sentiment_score": 0.0}'
};

export function listAiModes(): AiMode[] {
  return Object.keys(PROMPTS) as AiMode[];
}

/* ── Model discovery ────────────────────────────────────────────────────── */
export async function listAvailableModels(): Promise<AiModel[]> {
  const models: AiModel[] = [];

  // Ollama — built-in / local
  if (allowLocalOllama()) {
    if (isBuiltinOllamaEnabled() && !(await isOllamaApiReachable())) {
      await startManagedOllama();
    }
    const ollamaBase = ollamaApiBase();
    try {
      const res = await getText(`${ollamaBase}/api/tags`);
      if (res.ok) {
        const data = JSON.parse(res.body) as { models?: { name: string }[] };
        for (const m of data.models ?? []) {
          models.push({ id: m.name, name: `${m.name} (محلي)`, provider: 'ollama', type: 'local' });
        }
      }
    } catch { /* Ollama not running */ }
  }

  // Gemini — cloud
  if (getSetting('gemini_api_key')) {
    for (const [id, name] of [
      ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
      ['gemini-1.5-pro', 'Gemini 1.5 Pro'],
      ['gemini-1.5-flash', 'Gemini 1.5 Flash'],
      ['gemini-1.0-pro', 'Gemini 1.0 Pro'],
    ]) models.push({ id, name, provider: 'gemini', type: 'cloud' });
  }

  // OpenAI — cloud (fetch real list)
  const openaiKey = getSetting('openai_api_key');
  if (openaiKey) {
    try {
      const res = await getText('https://api.openai.com/v1/models', { Authorization: `Bearer ${openaiKey}` });
      if (res.ok) {
        const data = JSON.parse(res.body) as { data?: { id: string; created: number }[] };
        const gpt = (data.data ?? [])
          .filter(m => /^gpt-|^o\d/.test(m.id))
          .sort((a, b) => b.created - a.created)
          .slice(0, 12);
        for (const m of gpt) models.push({ id: m.id, name: m.id, provider: 'openai', type: 'cloud' });
      } else {
        for (const id of ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'])
          models.push({ id, name: id, provider: 'openai', type: 'cloud' });
      }
    } catch {
      for (const id of ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'])
        models.push({ id, name: id, provider: 'openai', type: 'cloud' });
    }
  }

  // Groq — cloud (predefined)
  if (getSetting('groq_api_key')) {
    for (const [id, name] of [
      ['llama-3.3-70b-versatile', 'Llama 3.3 70B (Groq)'],
      ['llama-3.1-8b-instant', 'Llama 3.1 8B Instant (Groq)'],
      ['mixtral-8x7b-32768', 'Mixtral 8x7B (Groq)'],
      ['gemma2-9b-it', 'Gemma 2 9B (Groq)'],
      ['qwen-qwq-32b', 'Qwen QwQ 32B (Groq)'],
    ]) models.push({ id, name, provider: 'groq', type: 'cloud' });
  }

  // Anthropic — cloud (predefined)
  if (getSetting('anthropic_api_key')) {
    for (const [id, name] of [
      ['claude-opus-4-7', 'Claude Opus 4.7'],
      ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
      ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
      ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'],
      ['claude-3-5-haiku-20241022', 'Claude 3.5 Haiku'],
    ]) models.push({ id, name, provider: 'anthropic', type: 'cloud' });
  }

  return models;
}

/* ── Provider call functions ─────────────────────────────────────────────── */

async function callGemini(prompt: string, text: string, model?: string): Promise<string> {
  const key = getSetting('gemini_api_key');
  if (!key) throw new Error('Gemini API key not configured');
  const m = model?.trim() || resolveModelForProvider('gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
  const res = await postJson(url, {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: `${prompt}\n\n${text.slice(0, 12000)}` }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
  }, {}, { timeout: 120_000 }); // 2 min
  if (!res.ok) throw new Error(res.body.slice(0, 300));
  const parsed = JSON.parse(res.body) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function callOllama(prompt: string, text: string, model?: string): Promise<string> {
  if (isBuiltinOllamaEnabled() && !(await isOllamaApiReachable())) {
    const started = await startManagedOllama();
    if (!started.ok) throw new Error(started.error ?? 'Ollama not running');
  }
  const base = ollamaApiBase();
  const m = model?.trim() || resolveModelForProvider('ollama');
  const res = await postJson(`${base}/api/generate`, {
    model: m,
    system: SYSTEM_PROMPT,
    prompt: `${prompt}\n\n${text.slice(0, 8000)}`,
    stream: false,
    options: { temperature: 0.3 }
  }, {}, { timeout: 300_000 }); // 5 min — local models can be slow
  if (!res.ok) throw new Error(res.body.slice(0, 300));
  const parsed = JSON.parse(res.body) as { response?: string };
  return parsed.response?.trim() ?? '';
}

async function callOpenAI(prompt: string, text: string, model?: string): Promise<string> {
  const key = getSetting('openai_api_key');
  if (!key) throw new Error('OpenAI API key not configured');
  const m = model?.trim() || resolveModelForProvider('openai');
  const res = await postJson('https://api.openai.com/v1/chat/completions', {
    model: m,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${prompt}\n\n${text.slice(0, 12000)}` }
    ],
    max_tokens: 2048,
    temperature: 0.3
  }, { Authorization: `Bearer ${key}` }, { timeout: 120_000 }); // 2 min
  if (!res.ok) throw new Error(res.body.slice(0, 300));
  const parsed = JSON.parse(res.body) as { choices?: { message?: { content?: string } }[] };
  return parsed.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callGroq(prompt: string, text: string, model?: string): Promise<string> {
  const key = getSetting('groq_api_key');
  if (!key) throw new Error('Groq API key not configured');
  const m = model?.trim() || resolveModelForProvider('groq');
  const res = await postJson('https://api.groq.com/openai/v1/chat/completions', {
    model: m,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${prompt}\n\n${text.slice(0, 12000)}` }
    ],
    max_tokens: 2048,
    temperature: 0.3
  }, { Authorization: `Bearer ${key}` }, { timeout: 60_000 }); // 1 min — Groq is fast
  if (!res.ok) throw new Error(res.body.slice(0, 300));
  const parsed = JSON.parse(res.body) as { choices?: { message?: { content?: string } }[] };
  return parsed.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropic(prompt: string, text: string, model?: string): Promise<string> {
  const key = getSetting('anthropic_api_key');
  if (!key) throw new Error('Anthropic API key not configured');
  const m = model?.trim() || resolveModelForProvider('anthropic');
  const res = await postJson('https://api.anthropic.com/v1/messages', {
    model: m,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${prompt}\n\n${text.slice(0, 12000)}` }]
  }, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { timeout: 120_000 }); // 2 min
  if (!res.ok) throw new Error(res.body.slice(0, 300));
  const parsed = JSON.parse(res.body) as { content?: { text?: string }[] };
  return parsed.content?.[0]?.text?.trim() ?? '';
}

/** Which AI backend will run when provider setting is empty. */
export function resolveEffectiveAiProvider(): string {
  const explicit = (getSetting('ai_provider') ?? '').trim();
  if (explicit) return explicit;
  if (isBuiltinOllamaEnabled()) return 'ollama';
  if (getSetting('gemini_api_key')?.trim()) return 'gemini';
  if (getSetting('openai_api_key')?.trim()) return 'openai';
  if (getSetting('groq_api_key')?.trim()) return 'groq';
  if (getSetting('anthropic_api_key')?.trim()) return 'anthropic';
  if (allowLocalOllama()) return 'ollama';
  return 'unconfigured';
}

/** Explicit platform default from settings (`ai_provider`); null = auto-detect. */
export function getConfiguredAiProvider(): string | null {
  const v = (getSetting('ai_provider') ?? '').trim();
  return v || null;
}

const AI_PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  groq: 'Groq',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  unconfigured: 'Unconfigured',
};

export function getAiProviderLabel(provider: string): string {
  return AI_PROVIDER_LABELS[provider] ?? provider;
}

export function isAiConnectivityError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('etimedout') ||
    m.includes('socket hang up') ||
    m.includes('fetch failed') ||
    m.includes('network') ||
    m.includes('not configured') ||
    m.includes('api key')
  );
}

export function extractAiErrorText(raw?: string): string {
  if (!raw) return '';
  let text = raw.trim().replace(/^Error:\s*/i, '');
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as {
        error?: { message?: string };
        message?: string;
      };
      text = parsed.error?.message ?? parsed.message ?? text;
    } catch {
      /* keep original */
    }
  }
  return text.trim();
}

function formatRateLimitMessage(text: string): string | null {
  const m = text.toLowerCase();
  if (!m.includes('rate limit') && !m.includes('ratelimit') && !m.includes('tokens per day') && !m.includes('(tpd)')) {
    return null;
  }

  const retryMinSec = text.match(/try again in (\d+)m([\d.]+)s/i);
  const retrySecOnly = text.match(/try again in ([\d.]+)s/i);
  let waitHint = '';
  if (retryMinSec) {
    const mins = retryMinSec[1];
    const secs = Math.ceil(parseFloat(retryMinSec[2]));
    waitHint = ` انتظر حوالي **${mins} دقيقة و${secs} ثانية** ثم أعد المحاولة.`;
  } else if (retrySecOnly) {
    const secs = Math.ceil(parseFloat(retrySecOnly[1]));
    waitHint = secs >= 60
      ? ` انتظر حوالي **${Math.ceil(secs / 60)} دقيقة** ثم أعد المحاولة.`
      : ` انتظر **${secs} ثانية** ثم أعد المحاولة.`;
  }

  const modelMatch = text.match(/model `([^`]+)`/i);
  const modelHint = modelMatch ? ` (النموذج: ${modelMatch[1]})` : '';

  if (m.includes('groq') || m.includes('llama') || m.includes('tokens per day')) {
    return (
      `تم استنفاد **الحصة اليومية** لـ Groq${modelHint}.${waitHint}\n\n` +
      '**ما يمكنك فعله:**\n' +
      '- انتظر حتى تتجدد الحصة (عادة منتصف الليل بتوقيت UTC)\n' +
      '- أو غيّر المزود من **الإعدادات** ← **الذكاء الاصطناعي** (Gemini / OpenAI / Ollama)\n' +
      '- أو استخدم نموذج Groq أصغر يستهلك توكنات أقل'
    );
  }

  return (
    `تم تجاوز **حد طلبات** مزود الذكاء الاصطناعي.${waitHint}\n\n` +
    'جرّب لاحقاً أو غيّر المزود من **الإعدادات** ← **الذكاء الاصطناعي**.'
  );
}

export function formatAiErrorMessage(raw?: string): string {
  const text = extractAiErrorText(raw);
  const m = text.toLowerCase();

  const rateLimit = formatRateLimitMessage(text);
  if (rateLimit) return rateLimit;

  if (m.includes('429') || m.includes('too many requests')) {
    return 'طلبات كثيرة جداً على مزود الذكاء الاصطناعي. انتظر دقيقة ثم أعد المحاولة، أو غيّر المزود من الإعدادات.';
  }
  if (m.includes('unconfigured') || m.includes('not configured')) {
    return 'لم يُضبط الذكاء الاصطناعي. من الإعدادات → الذكاء الاصطناعي: فعّل Ollama المدمج أو أدخل مفتاح Gemini/OpenAI/Groq/Anthropic.';
  }
  if (m.includes('ollama_not_installed')) {
    return 'Ollama غير مثبت. من الإعدادات → الذكاء الاصطناعي → قسم Ollama المدمج: اضغط «تثبيت Ollama» ثم فعّل الذكاء المحلي.';
  }
  if (m.includes('11434') || (m.includes('econnrefused') && m.includes('127.0.0.1'))) {
    return 'محرك Ollama غير شغّال. من الإعدادات → الذكاء الاصطناعي فعّل «الذكاء المحلي المدمج» أو شغّل Ollama يدوياً.';
  }
  if (m.includes('gemini') && m.includes('not configured')) {
    return 'مفتاح Gemini غير مضبوط في الإعدادات.';
  }
  if (m.includes('openai') && m.includes('not configured')) {
    return 'مفتاح OpenAI غير مضبوط في الإعدادات.';
  }
  return text || raw || 'AI request failed';
}

export async function checkAiProviderReady(): Promise<{
  ok: boolean;
  provider: string;
  error?: string;
}> {
  const provider = resolveEffectiveAiProvider();

  try {
    if (provider === 'unconfigured') {
      return { ok: false, provider, error: formatAiErrorMessage('AI unconfigured') };
    }
    if (provider === 'ollama') {
      if (isBuiltinOllamaEnabled() && !(await isOllamaApiReachable())) {
        await startManagedOllama();
      }
      const base = ollamaApiBase();
      const res = await getText(`${base}/api/tags`);
      if (!res.ok) {
        return { ok: false, provider, error: formatAiErrorMessage(`Ollama HTTP ${res.status}`) };
      }
      return { ok: true, provider };
    }
    if (provider === 'gemini' && !getSetting('gemini_api_key')?.trim()) {
      return { ok: false, provider, error: formatAiErrorMessage('Gemini API key not configured') };
    }
    if (provider === 'openai' && !getSetting('openai_api_key')?.trim()) {
      return { ok: false, provider, error: formatAiErrorMessage('OpenAI API key not configured') };
    }
    if (provider === 'groq' && !getSetting('groq_api_key')?.trim()) {
      return { ok: false, provider, error: formatAiErrorMessage('Groq API key not configured') };
    }
    if (provider === 'anthropic' && !getSetting('anthropic_api_key')?.trim()) {
      return { ok: false, provider, error: formatAiErrorMessage('Anthropic API key not configured') };
    }
    return { ok: true, provider };
  } catch (e) {
    return { ok: false, provider, error: formatAiErrorMessage((e as Error).message) };
  }
}

/* ── runAiRaw: single call, no retry ────────────────────────────────────── */
export async function runAiRaw(prompt: string, input: string, provider: string, model: string): Promise<string> {
  const p = provider?.trim() || resolveEffectiveAiProvider();
  if (p === 'unconfigured') throw new Error(formatAiErrorMessage('AI unconfigured'));
  // Resolve model per-provider so a stale global ai_model never poisons a different provider
  const m = model?.trim() || resolveModelForProvider(p);
  if (p === 'openai') return callOpenAI(prompt, input, m);
  if (p === 'groq') return callGroq(prompt, input, m);
  if (p === 'anthropic') return callAnthropic(prompt, input, m);
  if (p === 'gemini') return callGemini(prompt, input, m);
  if (p === 'ollama') return callOllama(prompt, input, m);
  throw new Error(`Unknown AI provider: ${p}`);
}

/* ── runAiPrompt: single prompt call for general utilities ───────────────── */
export async function runAiPrompt(prompt: string): Promise<string> {
  const provider = resolveEffectiveAiProvider();
  const model = resolveModelForProvider(provider);
  return runAiRaw(prompt, '', provider, model);
}

/* ── runAi ────────────────────────────────────────────────────────────────── */
export async function runAi(
  articleId: number,
  mode: AiMode,
  retries = 1
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const article = getArticle(articleId);
  if (!article) return { ok: false, error: 'Article not found' };

  const input = `${article.title}\n\n${article.content || article.summary || ''}`;
  const prompt = PROMPTS[mode] ?? PROMPTS.summarize;
  const provider = resolveEffectiveAiProvider();
  const model = resolveModelForProvider(provider);

  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await runAiRaw(prompt, input, provider, model);

      if (mode === 'summarize') {
        updateArticle(articleId, { summary: result });
      } else if (mode === 'rewrite' || mode === 'grammar' || mode === 'translate') {
        snapshotOriginalBeforeRewrite(articleId);
        snapshotOriginalContentIfEmpty(articleId);
        updateArticle(articleId, { content: result });
      } else if (mode === 'tldr') {
        getDb().prepare(`UPDATE articles SET tldr=? WHERE id=?`).run(result, articleId);
      } else if (mode === 'seo_meta') {
        try {
          const cleaned = result.replace(/```json|```/g, '').trim();
          const seo = JSON.parse(cleaned) as { meta_title?: string; meta_description?: string };
          getDb()
            .prepare(`UPDATE articles SET meta_title=?, meta_description=? WHERE id=?`)
            .run(seo.meta_title ?? null, seo.meta_description ?? null, articleId);
        } catch {
          // AI didn't return valid JSON — try extracting with regex
          const titleMatch = result.match(/"meta_title"\s*:\s*"([^"]+)"/);
          const descMatch  = result.match(/"meta_description"\s*:\s*"([^"]+)"/);
          if (titleMatch || descMatch) {
            getDb()
              .prepare(`UPDATE articles SET meta_title=?, meta_description=? WHERE id=?`)
              .run(titleMatch?.[1] ?? null, descMatch?.[1] ?? null, articleId);
          }
        }
      } else if (mode === 'tag_sentiment') {
        try {
          const cleaned = result.replace(/```json|```/g, '').trim();
          const data = JSON.parse(cleaned) as { tags?: string; category?: string; sentiment?: string; sentiment_score?: number };
          getDb()
            .prepare(`UPDATE articles SET tags=?, category=?, sentiment=?, sentiment_score=?, updated_at=datetime('now') WHERE id=?`)
            .run(data.tags ?? null, data.category ?? null, data.sentiment ?? 'neutral', data.sentiment_score ?? 0.0, articleId);
        } catch {
          // Fallback parsing with regex
          const tagsMatch = result.match(/"tags"\s*:\s*"([^"]+)"/);
          const catMatch  = result.match(/"category"\s*:\s*"([^"]+)"/);
          const sentMatch = result.match(/"sentiment"\s*:\s*"([^"]+)"/);
          // eslint-disable-next-line security/detect-unsafe-regex -- anchored inside match(), no catastrophic backtracking path
          const scoreMatch = result.match(/"sentiment_score"\s*:\s*(-?\d+(\.\d+)?)/);
          
          const tags = tagsMatch?.[1] ?? null;
          const category = catMatch?.[1] ?? null;
          const sentiment = sentMatch?.[1] ?? 'neutral';
          const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 0.0;
          
          getDb()
            .prepare(`UPDATE articles SET tags=?, category=?, sentiment=?, sentiment_score=?, updated_at=datetime('now') WHERE id=?`)
            .run(tags, category, sentiment, score, articleId);
        }
      }

      return { ok: true, result };
    } catch (e) {
      lastErr = (e as Error).message;
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
    }
  }

  return { ok: false, error: formatAiErrorMessage(lastErr) };
}

export function createBatchJob(articleIds: number[], mode: AiMode): number {
  const r = getDb()
    .prepare(`INSERT INTO job_queue (job_type, payload_json, status) VALUES ('ai_batch', ?, 'pending')`)
    .run(JSON.stringify({ articleIds, mode }));
  return Number(r.lastInsertRowid);
}

export async function processPendingJobs(limit = 5): Promise<number> {
  const jobs = getDb()
    .prepare(`SELECT * FROM job_queue WHERE status='pending' ORDER BY id LIMIT ?`)
    .all(limit) as { id: number; payload_json: string }[];
  let done = 0;
  for (const job of jobs) {
    getDb().prepare(`UPDATE job_queue SET status='running', updated_at=datetime('now') WHERE id=?`).run(job.id);
    try {
      const payload = JSON.parse(job.payload_json) as { articleIds: number[]; mode: AiMode };
      const results: unknown[] = [];
      for (const id of payload.articleIds) {
        results.push(await runAi(id, payload.mode));
      }
      getDb()
        .prepare(`UPDATE job_queue SET status='done', result_json=?, progress=100, updated_at=datetime('now') WHERE id=?`)
        .run(JSON.stringify(results), job.id);
      done++;
    } catch (e) {
      getDb()
        .prepare(`UPDATE job_queue SET status='failed', error=?, updated_at=datetime('now') WHERE id=?`)
        .run((e as Error).message, job.id);
    }
  }
  return done;
}

export function listJobs(limit = 50) {
  return getDb().prepare(`SELECT * FROM job_queue ORDER BY id DESC LIMIT ?`).all(limit);
}
