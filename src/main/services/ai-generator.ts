/**
 * Feature 1 — AI Article Generator from scratch
 *
 * Takes a topic + optional parameters and asks the configured AI provider
 * to write a complete article (title, content, summary, tags).
 * Creates and saves the article to the DB, ready for editing and publishing.
 */

import { formatAiErrorMessage, runAiPrompt } from './ai';
import { createArticle } from './articles';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArticleStyle = 'news' | 'analysis' | 'opinion' | 'explainer' | 'interview';

export interface GenerateOptions {
  keywords?:  string[];
  style?:     ArticleStyle;
  wordCount?: number;      // target word count, default 400
  language?:  string;      // ISO code, default 'ar'
  category?:  string;
  tone?:      'formal' | 'neutral' | 'conversational';
}

export interface GenerateResult {
  ok:       boolean;
  articleId?: number;
  title?:   string;
  error?:   string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const STYLE_LABELS: Record<ArticleStyle, string> = {
  news:       'خبر صحفي موضوعي',
  analysis:   'تحليل معمّق',
  opinion:    'مقال رأي',
  explainer:  'شرح وتوضيح',
  interview:  'حوار صحفي',
};

function buildPrompt(topic: string, opts: GenerateOptions): string {
  const style     = STYLE_LABELS[opts.style ?? 'news'];
  const lang      = opts.language ?? 'ar';
  const words     = opts.wordCount ?? 400;
  const tone      = opts.tone ?? 'formal';
  const keywords  = opts.keywords?.length ? `الكلمات المفتاحية: ${opts.keywords.join('، ')}` : '';
  const category  = opts.category ? `التصنيف: ${opts.category}` : '';
  const langLabel = lang === 'ar' ? 'العربية' : lang === 'en' ? 'الإنجليزية' : lang;

  return `أنت محرر صحفي محترف. اكتب مقالاً كاملاً بأسلوب "${style}" باللغة ${langLabel}.

الموضوع: ${topic}
${keywords}
${category}
النبرة: ${tone}
عدد الكلمات المستهدف: ${words} كلمة تقريباً

أعد الإجابة بالتنسيق JSON التالي فقط، بدون أي نص خارجه:
{
  "title": "عنوان المقال",
  "summary": "ملخص في جملتين أو ثلاث",
  "content": "نص المقال الكامل بتنسيق HTML بسيط (فقرات <p>، عناوين <h2>، قوائم <ul><li>)",
  "tags": ["وسم1", "وسم2", "وسم3"]
}`;
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

interface GeneratedArticle {
  title:   string;
  summary: string;
  content: string;
  tags:    string[];
}

function extractJson(raw: string): GeneratedArticle | null {
  // Try to find a JSON block in the response
  const match = raw.match(/\{[\s\S]*"title"[\s\S]*"content"[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as GeneratedArticle;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateArticle(
  topic: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  if (!topic?.trim()) return { ok: false, error: 'الموضوع مطلوب' };

  const prompt = buildPrompt(topic.trim(), opts);

  let raw: string;
  try {
    raw = await runAiPrompt(prompt);
  } catch (e) {
    return { ok: false, error: formatAiErrorMessage((e as Error).message) };
  }

  const parsed = extractJson(raw);
  if (!parsed?.title || !parsed?.content) {
    // Fallback: use raw output as content
    const fallbackTitle = topic.slice(0, 200);
    const id = createArticle({
      title:    fallbackTitle,
      content:  raw.slice(0, 50000),
      summary:  raw.slice(0, 500),
      category: opts.category,
      status:   'draft',
    });
    return { ok: true, articleId: id, title: fallbackTitle };
  }

  const id = createArticle({
    title:    parsed.title.slice(0, 500),
    summary:  parsed.summary?.slice(0, 2000) ?? '',
    content:  parsed.content.slice(0, 50000),
    tags:     Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '',
    category: opts.category ?? '',
    status:   'draft',
  } as Parameters<typeof createArticle>[0]);

  return { ok: true, articleId: id, title: parsed.title };
}

/** Generate multiple article variants on the same topic (A/B testing). */
export async function generateVariants(
  topic: string,
  count = 2,
  opts: GenerateOptions = {}
): Promise<GenerateResult[]> {
  const styles: ArticleStyle[] = ['news', 'analysis', 'opinion', 'explainer'];
  const results: GenerateResult[] = [];
  for (let i = 0; i < Math.min(count, 4); i++) {
    results.push(
      await generateArticle(topic, { ...opts, style: styles[i % styles.length] })
    );
  }
  return results;
}
