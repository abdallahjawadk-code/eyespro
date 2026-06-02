export type PlatformPolicy = {
  maxChars: number;
  supportsThread: boolean;
};

export const POLICIES: Record<string, PlatformPolicy> = {
  telegram: { maxChars: 4096, supportsThread: true },
  twitter: { maxChars: 280, supportsThread: false },
  facebook: { maxChars: 63206, supportsThread: false },
  linkedin: { maxChars: 3000, supportsThread: false },
  whatsapp: { maxChars: 65536, supportsThread: false },
  threads: { maxChars: 500, supportsThread: false },
  wordpress: { maxChars: 0, supportsThread: false },
};

export function splitSmart(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (maxChars <= 0 || trimmed.length <= maxChars) return [trimmed];

  const parts: string[] = [];
  const paragraphs = trimmed.split(/\n\n+/);
  let current = '';

  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      const next = current ? `${current}\n\n${para}` : para;
      if (next.length <= maxChars) {
        current = next;
      } else {
        flush();
        current = para;
      }
      continue;
    }

    flush();
    let rest = para;
    while (rest.length > maxChars) {
      const slice = rest.slice(0, maxChars);
      const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('。'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
      const cut = sentenceEnd > maxChars * 0.4 ? sentenceEnd + 1 : maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) current = rest;
  }

  flush();
  return parts.length ? parts : [trimmed.slice(0, maxChars)];
}

export function labelPart(text: string, index: number, total: number, maxChars: number): string {
  if (total <= 1) return text;
  const label = `\n\n(${index}/${total})`;
  if (maxChars <= 0) return `${text}${label}`;
  const budget = Math.max(0, maxChars - label.length);
  return `${text.slice(0, budget).trimEnd()}${label}`;
}

export function truncSmart(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0 || trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceEnd > maxChars * 0.5) return slice.slice(0, sentenceEnd + 1).trimEnd();
  return slice.trimEnd();
}
