export type EditorialPhase = 'collect' | 'process' | 'download';

export const EDITORIAL_PHASES: EditorialPhase[] = ['collect', 'process', 'download'];

export function parseEditorialPhase(value: string | null, fallback: EditorialPhase = 'collect'): EditorialPhase {
  if (value === 'process' || value === 'download' || value === 'collect') return value;
  // legacy 'publish' maps to 'download'
  if (value === 'publish') return 'download';
  return fallback;
}
