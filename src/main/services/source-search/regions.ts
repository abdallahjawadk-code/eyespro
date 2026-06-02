import type { RegionPresetId } from './types';

export const REGION_PRESETS: Record<
  RegionPresetId,
  { hl: string; gl: string; ceid: string; labelAr: string; labelEn: string }
> = {
  SA: { hl: 'ar', gl: 'SA', ceid: 'SA:ar', labelAr: 'السعودية', labelEn: 'Saudi Arabia' },
  EG: { hl: 'ar', gl: 'EG', ceid: 'EG:ar', labelAr: 'مصر', labelEn: 'Egypt' },
  AE: { hl: 'ar', gl: 'AE', ceid: 'AE:ar', labelAr: 'الإمارات', labelEn: 'UAE' },
  JO: { hl: 'ar', gl: 'JO', ceid: 'JO:ar', labelAr: 'الأردن', labelEn: 'Jordan' },
  MA: { hl: 'ar', gl: 'MA', ceid: 'MA:ar', labelAr: 'المغرب', labelEn: 'Morocco' },
  KW: { hl: 'ar', gl: 'KW', ceid: 'KW:ar', labelAr: 'الكويت', labelEn: 'Kuwait' },
  QA: { hl: 'ar', gl: 'QA', ceid: 'QA:ar', labelAr: 'قطر', labelEn: 'Qatar' },
  LB: { hl: 'ar', gl: 'LB', ceid: 'LB:ar', labelAr: 'لبنان', labelEn: 'Lebanon' },
  GLOBAL_AR: { hl: 'ar', gl: 'EG', ceid: 'EG:ar', labelAr: 'عربي — واسع', labelEn: 'Arabic (wide)' },
  GLOBAL_EN: { hl: 'en', gl: 'US', ceid: 'US:en', labelAr: 'عالمي — إنجليزي', labelEn: 'Global English' },
};

export function regionPreset(id?: string): (typeof REGION_PRESETS)[RegionPresetId] {
  if (id && id in REGION_PRESETS) return REGION_PRESETS[id as RegionPresetId];
  return REGION_PRESETS.SA;
}
