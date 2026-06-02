import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeMode } from '../../../shared/api-types';

const THEME_KEY = 'eyespro_theme';
const LANG_KEY  = 'eyespro_lang';

export type AppLang = 'ar' | 'en';

interface ThemeState {
  theme: ThemeMode;
  /** Resolved theme after evaluating 'system' */
  resolvedTheme: 'dark' | 'light';
  lang: AppLang;
  setTheme: (t: ThemeMode) => void;
  setLang: (l: AppLang) => void;
  toggle: () => void;
  toggleLang: () => void;
  isRTL: boolean;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeState | null>(null);

/** Resolves 'system' → actual dark/light based on OS preference */
function resolveTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme: ThemeMode): void {
  const resolved = resolveTheme(theme);
  const html = document.documentElement;
  html.classList.add('theme-transitioning');
  html.setAttribute('data-theme', resolved);
  html.style.colorScheme = resolved;
  setTimeout(() => html.classList.remove('theme-transitioning'), 420);
}

function applyLang(lang: AppLang): void {
  const html = document.documentElement;
  html.setAttribute('lang', lang);
  html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const t: ThemeMode = (saved === 'light' || saved === 'system') ? saved : 'dark';
    applyTheme(t);
    return t;
  });

  const [lang, setLangState] = useState<AppLang>(() => {
    const saved = (localStorage.getItem(LANG_KEY) ?? 'ar') as AppLang;
    applyLang(saved);
    return saved;
  });

  /* Track OS color-scheme changes when theme === 'system' */
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
    void window.eyespro?.settings.set('ui_theme', theme).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    applyLang(lang);
    localStorage.setItem(LANG_KEY, lang);
    void i18n.changeLanguage(lang);
    void window.eyespro?.settings.set('ui_language', lang).catch(() => undefined);
  }, [lang, i18n]);

  const setTheme = useCallback((t: ThemeMode) => setThemeState(t), []);
  const setLang  = useCallback((l: AppLang)  => setLangState(l), []);

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const resolved = resolveTheme(prev);
      return resolved === 'dark' ? 'light' : 'dark';
    });
  }, []);

  const toggleLang = useCallback(() => {
    setLangState(prev => prev === 'ar' ? 'en' : 'ar');
  }, []);

  const resolvedTheme = resolveTheme(theme);

  const value = useMemo<ThemeState>(() => ({
    theme,
    resolvedTheme,
    lang,
    setTheme,
    setLang,
    toggle,
    toggleLang,
    isRTL: lang === 'ar',
    isDark: resolvedTheme === 'dark',
  }), [theme, resolvedTheme, lang, setTheme, setLang, toggle, toggleLang]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
