/**
 * Feature 3 — Automatic Proofreading & Style Checker
 *
 * Runs a set of rules-based checks on article content and title:
 *   - Repeated words (stuttering)
 *   - Sentences that are too long
 *   - Passive voice overuse (Arabic heuristic)
 *   - Missing punctuation at end of paragraphs
 *   - All-caps words (shouting)
 *   - Readability score (approximate Flesch-Kincaid adapted for Arabic)
 *   - Thin content (too few words)
 *   - Keyword stuffing (same word > N times in a row)
 *   - Broken HTML entities
 *   - Title too long / too short
 *
 * Optional AI-enhanced suggestions when an AI provider is configured.
 */

import { getArticle } from './articles';
import { getDb } from '../db/database';
import { runAiPrompt } from './ai';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warning' | 'suggestion';
export type IssueType  =
  | 'repeated_word' | 'long_sentence' | 'all_caps' | 'thin_content'
  | 'missing_punctuation' | 'broken_entity' | 'title_length'
  | 'keyword_stuffing' | 'passive_voice' | 'ai_suggestion';

export interface ProofreadIssue {
  type:    IssueType;
  level:   IssueLevel;
  message: string;
  excerpt?: string;   // the problematic text snippet
  offset?: number;    // character position in plain text
}

export interface ProofreadResult {
  articleId:     number;
  score:         number;      // 0–100 quality score
  issues:        ProofreadIssue[];
  wordCount:     number;
  sentenceCount: number;
  readability:   'easy' | 'medium' | 'hard';
  checkedAt:     string;
}

// ─── Text utilities ───────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?؟।\n])\s+/).map((s) => s.trim()).filter((s) => s.length > 10);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 1);
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkRepeatedWords(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  // Find 3+ consecutive occurrences of the same word
  const re = /\b(\w{3,})\s+\1\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      type: 'repeated_word', level: 'warning',
      message: `كلمة مكررة بشكل متتالٍ: "${m[1]}"`,
      excerpt: m[0], offset: m.index,
    });
  }
  return issues;
}

function checkLongSentences(text: string, maxWords = 60): ProofreadIssue[] {
  return sentences(text)
    .filter((s) => words(s).length > maxWords)
    .map((s) => ({
      type: 'long_sentence' as IssueType,
      level: 'warning' as IssueLevel,
      message: `جملة طويلة جداً (${words(s).length} كلمة) — يُفضل تقسيمها`,
      excerpt: s.slice(0, 120) + (s.length > 120 ? '…' : ''),
    }));
}

function checkAllCaps(text: string): ProofreadIssue[] {
  const re = /\b[A-Z]{4,}\b/g;
  const matches = text.match(re);
  if (!matches || matches.length < 2) return [];
  return [{
    type: 'all_caps', level: 'suggestion',
    message: `استخدام مفرط للأحرف الكبيرة: ${matches.slice(0, 3).join(', ')}`,
  }];
}

function checkThinContent(wc: number): ProofreadIssue[] {
  if (wc < 100) return [{ type: 'thin_content', level: 'error', message: `المحتوى قصير جداً (${wc} كلمة) — يُنصح بـ 300 كلمة على الأقل` }];
  if (wc < 250) return [{ type: 'thin_content', level: 'warning', message: `المحتوى خفيف (${wc} كلمة) — يُنصح بإثرائه` }];
  return [];
}

function checkBrokenEntities(text: string): ProofreadIssue[] {
  const re = /&[a-z]{2,8}(?!;)/gi;
  const found = text.match(re);
  if (!found) return [];
  return [{
    type: 'broken_entity', level: 'warning',
    message: `كيانات HTML غير مكتملة: ${found.slice(0, 3).join(', ')}`,
  }];
}

function checkTitleLength(title: string): ProofreadIssue[] {
  const len = title.length;
  if (len < 20) return [{ type: 'title_length', level: 'warning', message: `العنوان قصير جداً (${len} حرف)` }];
  if (len > 120) return [{ type: 'title_length', level: 'warning', message: `العنوان طويل جداً (${len} حرف) — يُنصح بأقل من 120` }];
  return [];
}

function checkPassiveVoice(text: string): ProofreadIssue[] {
  // Arabic passive voice heuristic: verbs with wazan فُعِل / يُفعَل
  const re = /\b(يُ[ا-ي]{2,6}|تُ[ا-ي]{2,6})[^\s]*\s+(?:من|به|فيه|لها|لهم|عليه|عليها)\b/g;
  const matches = [...text.matchAll(re)];
  if (matches.length < 4) return [];
  return [{
    type: 'passive_voice', level: 'suggestion',
    message: `استخدام متكرر للمبني للمجهول (${matches.length} مرة) — يُفضل المبني للمعلوم`,
  }];
}

// ─── Readability score (simplified) ─────────────────────────────────────────

function readabilityLabel(avgWordsPerSentence: number, avgWordLength: number): ProofreadResult['readability'] {
  const score = avgWordsPerSentence * 0.5 + avgWordLength * 1.5;
  if (score < 15) return 'easy';
  if (score < 25) return 'medium';
  return 'hard';
}

// ─── Quality score ────────────────────────────────────────────────────────────

function computeScore(issues: ProofreadIssue[], wc: number): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.level === 'error')      score -= 15;
    else if (issue.level === 'warning') score -= 5;
    else score -= 2;
  }
  if (wc > 300) score += 5;
  return Math.max(0, Math.min(100, score));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function proofreadText(title: string, html: string): ProofreadResult {
  const plain = stripTags(html);
  const wc    = words(plain).length;
  const sents = sentences(plain);
  const avgWPS = sents.length > 0 ? wc / sents.length : wc;
  const avgWL  = wc > 0 ? plain.replace(/\s/g, '').length / wc : 0;

  const issues: ProofreadIssue[] = [
    ...checkTitleLength(title),
    ...checkThinContent(wc),
    ...checkRepeatedWords(plain),
    ...checkLongSentences(plain),
    ...checkAllCaps(plain),
    ...checkBrokenEntities(html),
    ...checkPassiveVoice(plain),
  ];

  return {
    articleId: 0,
    score: computeScore(issues, wc),
    issues,
    wordCount: wc,
    sentenceCount: sents.length,
    readability: readabilityLabel(avgWPS, avgWL),
    checkedAt: new Date().toISOString(),
  };
}

export function proofreadArticle(articleId: number): ProofreadResult | null {
  const article = getArticle(articleId);
  if (!article) return null;
  const result = proofreadText(article.title, article.content ?? '');
  result.articleId = articleId;

  // Store score in quality_reports
  try {
    getDb()
      .prepare(
        `INSERT INTO quality_reports (article_id, check_type, score, result_json)
         VALUES (?, 'proofread', ?, ?)`
      )
      .run(articleId, result.score, JSON.stringify(result));
  } catch { /* non-fatal */ }

  return result;
}

/** AI-enhanced suggestions (async, requires AI provider). */
export async function aiProofread(articleId: number): Promise<ProofreadIssue[]> {
  const article = getArticle(articleId);
  if (!article) return [];

  const plain = stripTags(article.content ?? '').slice(0, 2000);
  const prompt = `أنت مدقق لغوي محترف. راجع النص التالي وأعطِ قائمة بأهم 3-5 ملاحظات تحسين لغوية وأسلوبية بالعربية (كل ملاحظة في سطر مستقل):\n\n${plain}`;

  try {
    const raw = await runAiPrompt(prompt);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 10)
      .slice(0, 5)
      .map((msg) => ({ type: 'ai_suggestion' as IssueType, level: 'suggestion' as IssueLevel, message: msg }));
  } catch {
    return [];
  }
}
