/** Polite, identifiable User-Agent for outbound HTTP fetches. */
export const POLITE_USER_AGENT =
  'EyesPro/1.0 (+local; content-aggregator; respects-robots)';

export function getPoliteUserAgent(): string {
  return POLITE_USER_AGENT;
}

export function defaultFetchHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': getPoliteUserAgent(),
    'Accept-Encoding': 'gzip, deflate, br',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,application/atom+xml,application/json;q=0.8,*/*;q=0.7',
    ...extra
  };
}
