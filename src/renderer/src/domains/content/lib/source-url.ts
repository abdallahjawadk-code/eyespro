/** Match main-process `normaliseTelegramUrl` for dedup in the UI. */
export function normalizeSourceUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  const m = trimmed.match(/^https?:\/\/(?:t\.me|telegram\.me)\/(?!s\/)([^/?#]+)/i);
  if (m) return `https://t.me/s/${m[1]}`;
  return trimmed;
}
