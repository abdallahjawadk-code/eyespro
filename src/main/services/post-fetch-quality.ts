import { getSetting } from './settings';
import { isDuplicate } from './dedup';

export interface QualityAssessment {
  ok: boolean;
  score: number;
  purityScore: number;
  warnings: string[];
  rejectReason?: string;
  tier?: QualityTier;
}

export type QualityTier = 'ready' | 'review' | 'draft' | 'reject';

const SOFT_404 = /\b(404|not found|page not found|الصفحة غير موجودة|غير موجود)\b/i;

const AD_PATTERNS = [
  /\b(إعلان|advertisement|sponsored|promoted)\b/i,
  /\b(اشترك الآن|subscribe now)\b/i
];

export function computePurityScore(htmlOrText: string): number {
  const text = htmlOrText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text.length) return 0;
  const tagCount = (htmlOrText.match(/<[^>]+>/g) ?? []).length;
  const tagRatio = tagCount / Math.max(text.length / 80, 1);
  let score = 100;
  if (tagRatio > 3) score -= 25;
  if (text.length < 80) score -= 40;
  if (text.length < 200) score -= 15;
  for (const p of AD_PATTERNS) {
    if (p.test(text)) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

export function assessFetchedArticle(opts: {
  title: string;
  summary: string;
  content: string;
  expectedLang?: string;
}): QualityAssessment {
  const warnings: string[] = [];
  const minChars = Number(getSetting('fetch_quality_min_chars') || '120') || 120;
  const minPurity = Number(getSetting('fetch_quality_min_purity') || '35') || 35;
  const text = opts.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const purityScore = computePurityScore(opts.content || opts.summary);

  let score = 100;
  if (!opts.title?.trim() || opts.title.trim().length < 4) {
    score -= 50;
    warnings.push('weak_title');
  }
  if (text.length < minChars) {
    score -= 35;
    warnings.push('short_content');
  }
  if (purityScore < minPurity) {
    score -= 20;
    warnings.push('low_purity');
  }
  if (/<script|javascript:/i.test(opts.content)) {
    score -= 30;
    warnings.push('unsafe_markup');
  }

  const dup = isDuplicate(opts.title, opts.summary || text.slice(0, 500));
  if (dup.duplicate) {
    score -= 40;
    warnings.push('near_duplicate');
  }

  const rejectReason =
    !opts.title?.trim() ? 'missing_title'
    : text.length < 40 ? 'content_too_short'
    : dup.duplicate ? 'duplicate'
    : undefined;

  if (SOFT_404.test(opts.title) && text.length < 200) {
    warnings.push('soft_404');
  }

  return {
    ok: !rejectReason && score >= 40,
    score: Math.max(0, score),
    purityScore,
    warnings,
    rejectReason
  };
}

/** Tiered quality gate — only 'reject' blocks ingestion; others are soft labels. */
export function assessFetchedArticleTier(opts: {
  title: string;
  summary: string;
  content: string;
  expectedLang?: string;
}): QualityAssessment & { tier: QualityTier } {
  const base = assessFetchedArticle(opts);
  let tier: QualityTier = 'ready';

  if (base.rejectReason || base.score < 40 || base.warnings.includes('soft_404')) {
    tier = 'reject';
  } else if (base.score < 55 || base.warnings.includes('near_duplicate') || base.warnings.includes('unsafe_markup')) {
    tier = 'review';
  } else if (base.score < 75 || base.warnings.length > 0) {
    tier = 'draft';
  }

  return {
    ...base,
    tier,
    ok: tier !== 'reject'
  };
}
