export function formatArticleDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function articleExcerpt(article: { summary?: string | null; content?: string | null }, max = 140): string {
  const raw = article.summary?.trim() || (article.content ? stripHtml(article.content) : '');
  if (!raw) return '';
  return raw.length <= max ? raw : `${raw.slice(0, max).trim()}…`;
}
