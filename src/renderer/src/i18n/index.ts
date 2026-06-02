import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const LANG_STORAGE_KEY = 'eyespro_lang';

const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_STORAGE_KEY)) || 'ar';
const initial = saved === 'en' ? 'en' : 'ar';

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en }
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

function applyDocumentDir(lng: string): void {
  const html = document.documentElement;
  html.lang = lng;
  html.dir = lng === 'ar' ? 'rtl' : 'ltr';
}

applyDocumentDir(initial);

i18n.on('languageChanged', (lng) => {
  applyDocumentDir(lng);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lng);
    void window.eyespro?.settings.set('ui_language', lng);
  } catch {
    /* ignore */
  }
});

export default i18n;

export async function syncLanguageFromSettings(): Promise<void> {
  try {
    const res = await window.eyespro?.settings.get('ui_language');
    const lang = res?.data === 'en' ? 'en' : res?.data === 'ar' ? 'ar' : null;
    if (lang && lang !== i18n.language) await i18n.changeLanguage(lang);
  } catch {
    /* not logged in yet */
  }
}
