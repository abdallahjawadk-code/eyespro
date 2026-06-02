import { createHash } from 'node:crypto';

export function articleContentHash(title: string, content: string): string {
  return createHash('sha256').update(`${title}\n${content}`).digest('hex').slice(0, 32);
}

export function hasMeaningfulContent(article: {
  content?: string | null;
  title?: string | null;
  summary?: string | null;
}): boolean {
  const text = `${article.title ?? ''} ${article.summary ?? ''} ${article.content ?? ''}`
    .replace(/<[^>]+>/g, ' ')
    .trim();
  return text.length >= 20;
}
