import { getText } from '../net/http';
import { getSetting } from './settings';
import { getDb } from '../db/database';

export type TranslationBackend = 'google' | 'ai';

// ── Google Translate (unofficial free endpoint) ───────────────────────────────
const GOOGLE_TRANSLATE_CHUNK = 3500;

async function googleTranslateChunk(text: string, targetLang: string): Promise<string> {
  const encoded = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encoded}`;
  const res = await getText(url, { 'User-Agent': 'Mozilla/5.0' });
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  const json = JSON.parse(res.body) as unknown[][];
  const parts: string[] = [];
  const sentences = json[0] as unknown[][];
  for (const seg of sentences) {
    if (Array.isArray(seg) && seg[0]) parts.push(String(seg[0]));
  }
  return parts.join('');
}

async function googleTranslate(text: string, targetLang: string): Promise<string> {
  if (!text.trim()) return text;
  if (text.length <= GOOGLE_TRANSLATE_CHUNK) {
    return googleTranslateChunk(text, targetLang);
  }

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > GOOGLE_TRANSLATE_CHUNK) {
    let cut = rest.lastIndexOf('\n\n', GOOGLE_TRANSLATE_CHUNK);
    if (cut < GOOGLE_TRANSLATE_CHUNK / 2) cut = rest.lastIndexOf('\n', GOOGLE_TRANSLATE_CHUNK);
    if (cut < GOOGLE_TRANSLATE_CHUNK / 2) cut = rest.lastIndexOf(' ', GOOGLE_TRANSLATE_CHUNK);
    if (cut < 1) cut = GOOGLE_TRANSLATE_CHUNK;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);

  const translated: string[] = [];
  for (const chunk of chunks) {
    translated.push(await googleTranslateChunk(chunk, targetLang));
  }
  return translated.join('');
}

// ── AI translation via existing ai service ────────────────────────────────────
async function aiTranslate(text: string, targetLang: string): Promise<string> {
  const { runAiPrompt } = await import('./ai');
  const langNames: Record<string, string> = {
    ar: 'Arabic', en: 'English', fr: 'French', es: 'Spanish',
    de: 'German', tr: 'Turkish', fa: 'Persian', ur: 'Urdu'
  };
  const langName = langNames[targetLang] ?? targetLang;
  const prompt = `Translate the following text to ${langName}. Return only the translated text with no explanation:\n\n${text}`;
  return runAiPrompt(prompt);
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function translateText(
  text: string,
  targetLang: string,
  backend?: TranslationBackend
): Promise<string> {
  const b = backend ?? (getSetting('translation_backend') as TranslationBackend) ?? 'google';
  if (b === 'ai') return aiTranslate(text, targetLang);
  return googleTranslate(text, targetLang);
}

export async function translateArticle(
  articleId: number,
  targetLang: string,
  backend?: TranslationBackend,
  opts?: { save?: boolean }
): Promise<{ title: string; content: string; summary: string }> {
  const row = getDb()
    .prepare(`SELECT title, content, summary FROM articles WHERE id = ?`)
    .get(articleId) as { title: string; content: string; summary: string } | undefined;
  if (!row) throw new Error('Article not found');

  const [title, content, summary] = await Promise.all([
    translateText(row.title ?? '', targetLang, backend),
    translateText(row.content ?? '', targetLang, backend),
    translateText(row.summary ?? '', targetLang, backend),
  ]);

  if (opts?.save) {
    getDb()
      .prepare(`UPDATE articles SET title = ?, content = ?, summary = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(title, content, summary, articleId);
  }

  return { title, content, summary };
}

export async function bulkTranslate(
  ids: number[],
  targetLang: string,
  backend?: TranslationBackend
): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0;
  for (const id of ids) {
    try {
      const result = await translateArticle(id, targetLang, backend);
      getDb()
        .prepare(`UPDATE articles SET title=?, content=?, summary=? WHERE id=?`)
        .run(result.title, result.content, result.summary, id);
      done++;
    } catch { failed++; }
  }
  return { done, failed };
}
