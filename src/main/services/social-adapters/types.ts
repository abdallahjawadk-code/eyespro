export type TestResult = { ok: boolean; info?: string; error?: string };
export type Cfg = Record<string, string>;

export const get = async (url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, body: await res.text() };
};

export const post = async (url: string, body: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.text() };
};

export function stripHtml(text: string): string {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function articleVideoBody(article: { summary?: string | null; content?: string | null }): string {
  const summary = article.summary?.trim() || '';
  let content = article.content ? stripHtml(article.content) : '';

  if (!summary) return content;
  if (!content) return summary;

  if (content.toLowerCase().startsWith(summary.toLowerCase())) {
    content = content.slice(summary.length).trim();
    return content ? `${summary} ${content}` : summary;
  }

  return `${summary}\n\n${content}`;
}
