const CTRL = /[\u0000-\u001F\u007F]/g;

export function sanitizeString(input: unknown, maxLen = 500): string {
  if (input == null) return '';
  return String(input).replace(CTRL, '').trim().slice(0, maxLen);
}

export function sanitizeUsername(input: unknown): string {
  const s = sanitizeString(input, 64);
  return s.replace(/[^a-zA-Z0-9._@-]/g, '');
}

export function sanitizeInt(input: unknown, min = 0, max = 1_000_000): number {
  const n = Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
