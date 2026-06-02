import { decodeContentForDisplay } from '../../../../../../shared/content-cleaner';
import type { PipelineArticleDetail } from '../pipeline/types';

export function formatCompareText(raw: string): string {
  const decoded = decodeContentForDisplay(raw);
  const plain = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain || decoded.trim();
}

export function rewriteCompleted(log: PipelineArticleDetail['log'] | undefined): boolean {
  return (log ?? []).some(
    (line) =>
      line.step === 'rewrite' &&
      line.status === 'ok' &&
      (line.message ?? '').startsWith('completed')
  );
}

export function contentChanged(original: string, current: string): boolean {
  return formatCompareText(original) !== formatCompareText(current);
}

export function skippedAiRuns(
  aiRuns: PipelineArticleDetail['aiRuns'] | undefined
): NonNullable<PipelineArticleDetail['aiRuns']> {
  return (aiRuns ?? []).filter((r) => !!r.skipped);
}

export function successfulAiRuns(
  aiRuns: PipelineArticleDetail['aiRuns'] | undefined
): NonNullable<PipelineArticleDetail['aiRuns']> {
  return (aiRuns ?? []).filter((r) => !!r.ok && !r.skipped);
}
