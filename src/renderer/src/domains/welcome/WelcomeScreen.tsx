import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { EyeLogo } from '../../components/vfx/EyeLogo';
import './welcome.css';

/* ── Breaking-news ticker ─────────────────────────────────── */
const TICKER_AR = [
  'منصة التحرير الإخباري الذكية — رصد، تحليل، ونشر فوري',
  'استيراد تلقائي من مئات المصادر الإخبارية حول العالم',
  'معالجة المحتوى بالذكاء الاصطناعي: تلخيص، تحقق، وإعادة صياغة',
  'نشر المقالات على منصات التواصل الاجتماعي بضغطة واحدة',
  'تقارير أداء تفاعلية وتحليل مستمر للمحتوى',
];
const TICKER_EN = [
  'Intelligent editorial platform — monitor, analyze, publish instantly',
  'Auto-import from hundreds of global news sources',
  'AI-powered processing: summarize, verify & rewrite content',
  'Publish articles to social platforms with one click',
  'Interactive performance reports and continuous content analytics',
];

/* ── Left panel: capabilities ─────────────────────────────── */
const CAPABILITIES = [
  { id: 'newsroom', ico: '◈', labelAr: 'غرفة التحرير',     labelEn: 'Newsroom',        descAr: 'إدارة المقالات والمراسلين',     descEn: 'Manage articles & journalists' },
  { id: 'ai',       ico: '⬡', labelAr: 'محرك الذكاء',      labelEn: 'AI Engine',       descAr: 'تلخيص، تحقق، إعادة صياغة',     descEn: 'Summarize, verify & rewrite' },
  { id: 'sources',  ico: '◉', labelAr: 'مراقبة المصادر',   labelEn: 'Source Monitor',  descAr: 'رصد مئات المصادر تلقائياً',     descEn: 'Track hundreds of sources' },
  { id: 'publish',  ico: '◎', labelAr: 'النشر الفوري',     labelEn: 'Multi-Publish',   descAr: 'منصات التواصل بضغطة واحدة',     descEn: 'Social platforms at once' },
  { id: 'reports',  ico: '◇', labelAr: 'التحليل والتقارير', labelEn: 'Analytics',      descAr: 'إحصاءات الأداء والمحتوى',       descEn: 'Performance insights' },
];

/* ── Right panel: editorial workflow ─────────────────────── */
const WORKFLOW = [
  { step: '01', labelAr: 'استيراد المحتوى',          labelEn: 'Content Intake',    descAr: 'جلب مقالات من مصادر متعددة',   descEn: 'Fetch from multiple sources' },
  { step: '02', labelAr: 'معالجة بالذكاء الاصطناعي', labelEn: 'AI Processing',     descAr: 'تلخيص وتحقق وتحسين آلي',       descEn: 'Auto-summarize & verify' },
  { step: '03', labelAr: 'التحرير والمراجعة',         labelEn: 'Edit & Review',     descAr: 'محرر نصوص متكامل واحترافي',    descEn: 'Full-featured article editor' },
  { step: '04', labelAr: 'النشر الفوري',              labelEn: 'Instant Publish',   descAr: 'نشر متزامن على كل المنصات',    descEn: 'Publish across all platforms' },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/* ── Trial countdown — integrated, interactive ────────────── */
const TRIAL_TOTAL_MS = 3 * 24 * 3600 * 1000;

function TrialCountdown({ lang }: { lang: string }) {
  const [ms, setMs]             = useState<number | null>(null);
  const [licensed, setLicensed] = useState(false);

  useEffect(() => {
    let active = true;
    const api = (window as unknown as { eyespro?: { license?: { status: () => Promise<{ ok: boolean; trial?: boolean; trialRemainingMs?: number }> } } }).eyespro?.license;
    if (!api) return;
    api.status().then((r) => {
      if (!active) return;
      if (r.ok && r.trial && typeof r.trialRemainingMs === 'number') setMs(r.trialRemainingMs);
      else if (r.ok && !r.trial) setLicensed(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => setMs(v => (v === null ? null : Math.max(0, v - 1000))), 1000);
    return () => clearInterval(id);
    // Depend only on null-ness: the interval uses a functional updater, so it must
    // recreate when ms goes null↔non-null, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms === null]);

  if (licensed) {
    return (
      <div className="wl-trial wl-trial--licensed">
        <span className="wl-trial-check" aria-hidden>✓</span>
        <span className="wl-trial-licensed-text">
          {lang === 'ar' ? 'النسخة الكاملة مُفعّلة' : 'Full version activated'}
        </span>
      </div>
    );
  }
  if (ms === null) return null;

  const expired  = ms <= 0;
  const pct      = Math.max(0, Math.min(100, (ms / TRIAL_TOTAL_MS) * 100));
  const totalSec = Math.floor(ms / 1000);
  const segs = [
    { v: Math.floor(totalSec / 86400),        ar: 'يوم',   en: 'days' },
    { v: Math.floor((totalSec % 86400) / 3600), ar: 'ساعة', en: 'hrs'  },
    { v: Math.floor((totalSec % 3600) / 60),  ar: 'دقيقة', en: 'min'  },
    { v: totalSec % 60,                        ar: 'ثانية', en: 'sec'  },
  ];

  return (
    <div className={`wl-trial${expired ? ' is-expired' : ''}`}>
      <div className="wl-trial-head">
        <span className="wl-trial-pulse" aria-hidden />
        <span className="wl-trial-title">
          {expired
            ? (lang === 'ar' ? 'انتهت الفترة التجريبية' : 'Trial ended')
            : (lang === 'ar' ? 'النسخة التجريبية المجانية' : 'Free Trial')}
        </span>
      </div>

      <div className="wl-trial-clock" dir="ltr">
        {segs.map((seg, i) => (
          <div key={i} className="wl-trial-seg-wrap">
            <div className={`wl-trial-seg${i === 3 ? ' is-sec' : ''}`}>
              <span className="wl-trial-num">{String(seg.v).padStart(2, '0')}</span>
              <span className="wl-trial-unit">{lang === 'ar' ? seg.ar : seg.en}</span>
            </div>
            {i < segs.length - 1 && <span className="wl-trial-colon" aria-hidden>:</span>}
          </div>
        ))}
      </div>

      <div className="wl-trial-bar" aria-hidden>
        <div className="wl-trial-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="wl-trial-hint">
        {expired
          ? (lang === 'ar' ? 'أعد تشغيل البرنامج وأدخل رمز التفعيل للمتابعة' : 'Restart and enter your license key to continue')
          : (lang === 'ar' ? 'بعد انتهاء الفترة يلزم إدخال رمز التفعيل للمتابعة' : 'A license key will be required to continue after the trial')}
      </div>
    </div>
  );
}

/* ── Live Clock ───────────────────────────────────────────── */
function LiveClock({ lang }: { lang: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const locale = lang === 'ar' ? 'ar-SA' : 'en-GB';
  const hms  = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = time.toLocaleDateString(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div className="wl-clock">
      <span className="wl-clock-time">{hms}</span>
      <span className="wl-clock-date">{date}</span>
    </div>
  );
}

/* ── Capability row ───────────────────────────────────────── */
function CapRow({ cap, lang, active, onClick }: {
  cap: typeof CAPABILITIES[0]; lang: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wl-cap-row${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <span className="wl-cap-marker" aria-hidden />
      <span className="wl-cap-ico" aria-hidden>{cap.ico}</span>
      <div className="wl-cap-text">
        <span className="wl-cap-label">{lang === 'ar' ? cap.labelAr : cap.labelEn}</span>
        {active && (
          <span className="wl-cap-desc">{lang === 'ar' ? cap.descAr : cap.descEn}</span>
        )}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   WELCOME SCREEN
═══════════════════════════════════════════════════════════ */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme, lang, setLang, isDark } = useTheme();

  const [leaving,    setLeaving]    = useState(false);
  const [tickerIdx,  setTickerIdx]  = useState(0);
  const [tickerFade, setTickerFade] = useState(true);
  const [activeCap,  setActiveCap]  = useState(0);

  const mouseRef   = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const targetRef  = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const bodyRef    = useRef<HTMLDivElement>(null);
  const rootRef    = useRef<HTMLDivElement>(null);
  const rafRef     = useRef<number>(0);

  /* Gentle parallax */
  const tick = useCallback(() => {
    const m  = mouseRef.current;
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    targetRef.current.x  = ((m.x - cx) / cx) * 5;
    targetRef.current.y  = ((m.y - cy) / cy) * 3;
    currentRef.current.x = lerp(currentRef.current.x, targetRef.current.x, 0.04);
    currentRef.current.y = lerp(currentRef.current.y, targetRef.current.y, 0.04);
    if (bodyRef.current) {
      bodyRef.current.style.transform =
        `translate(${currentRef.current.x}px,${currentRef.current.y}px)`;
    }
    if (rootRef.current) {
      rootRef.current.style.setProperty('--mx', `${(m.x / window.innerWidth  * 100).toFixed(1)}%`);
      rootRef.current.style.setProperty('--my', `${(m.y / window.innerHeight * 100).toFixed(1)}%`);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', h, { passive: true });
    rafRef.current = requestAnimationFrame(tick);
    return () => { window.removeEventListener('mousemove', h); cancelAnimationFrame(rafRef.current); };
  }, [tick]);

  /* Ticker rotation */
  useEffect(() => {
    const items = lang === 'ar' ? TICKER_AR : TICKER_EN;
    const id = setInterval(() => {
      setTickerFade(false);
      setTimeout(() => { setTickerIdx(i => (i + 1) % items.length); setTickerFade(true); }, 280);
    }, 4800);
    return () => clearInterval(id);
  }, [lang]);

  /* Auto-cycle capabilities */
  useEffect(() => {
    const id = setInterval(() => setActiveCap(i => (i + 1) % CAPABILITIES.length), 3000);
    return () => clearInterval(id);
  }, []);

  function enter() {
    setLeaving(true);
    setTimeout(() => navigate('/dashboard'), 500);
  }

  const ticker    = lang === 'ar' ? TICKER_AR : TICKER_EN;
  const themeIcon = isDark ? '☀' : '☾';
  const year      = new Date().getFullYear();

  return (
    <div ref={rootRef} className={`wl-root${leaving ? ' is-leaving' : ''}`}>

      {/* ── Background ── */}
      <div className="wl-bg" aria-hidden>
        <div className="wl-bg-base" />
        <div className="wl-bg-glow" />
        <div className="wl-bg-grid" />
        <div className="wl-bg-vignette" />
      </div>

      {/* ── Ticker ── */}
      <div className="wl-ticker" role="marquee" aria-live="polite">
        <div className="wl-ticker-badge">
          <span className="wl-ticker-dot" aria-hidden />
          {lang === 'ar' ? 'عاجل' : 'BREAKING'}
        </div>
        <div className="wl-ticker-sep" aria-hidden />
        <div className="wl-ticker-track">
          <span className={`wl-ticker-text${tickerFade ? ' is-visible' : ''}`}>
            {ticker[tickerIdx]}
          </span>
        </div>
        <span className="wl-ticker-index" aria-hidden>
          {String(tickerIdx + 1).padStart(2, '0')} / {String(ticker.length).padStart(2, '0')}
        </span>
      </div>

      {/* ── Top bar ── */}
      <header className="wl-topbar">
        <div className="wl-brand">
          <div className="wl-brand-icon" aria-hidden>
            <span /><span /><span />
          </div>
        </div>

        <LiveClock lang={lang} />

        <div className="wl-topbar-actions">
          <button type="button" className="wl-ctrl-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={isDark ? t('theme.light') : t('theme.dark')}>
            {themeIcon}
          </button>
          <button type="button" className="wl-ctrl-btn wl-ctrl-lang"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
      </header>

      {/* ── Main 3-column body ── */}
      <main ref={bodyRef} className="wl-body">

        {/* LEFT — capabilities */}
        <aside className="wl-left-panel">
          <div className="wl-panel-eyebrow">
            <span className="wl-panel-eyebrow-line" aria-hidden />
            <span>{lang === 'ar' ? 'قدرات المنصة' : 'Platform Capabilities'}</span>
          </div>
          <div className="wl-cap-list">
            {CAPABILITIES.map((cap, i) => (
              <CapRow key={cap.id} cap={cap} lang={lang}
                active={activeCap === i} onClick={() => setActiveCap(i)} />
            ))}
          </div>
          <div className="wl-panel-edition">
            {lang === 'ar' ? 'إصدار غرفة التحرير' : 'Newsroom Edition'}
          </div>
        </aside>

        {/* CENTER — hero */}
        <section className="wl-center">

          {/* Masthead decoration */}
          <div className="wl-masthead" aria-hidden>
            <span className="wl-masthead-line" />
            <span className="wl-masthead-diamond" />
            <span className="wl-masthead-line" />
          </div>

          {/* Logo */}
          <div className="wl-logo-wrap" onClick={enter} role="button" tabIndex={0}
            aria-label={t('welcome.enter')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') enter(); }}>
            <div className="wl-logo-ring" aria-hidden />
            <div className="wl-logo-eye"><EyeLogo /></div>
            <div className="wl-logo-label" aria-hidden>
              {lang === 'ar' ? 'انقر للدخول' : 'Click to Enter'}
            </div>
          </div>

          {/* Title */}
          <h1 className="wl-hero-title">{t('app.name')}</h1>
          <p  className="wl-hero-sub">{t('welcome.subtitle')}</p>

          {/* Divider */}
          <div className="wl-divider" aria-hidden>
            <span /><span className="wl-divider-mark" /><span />
          </div>

          {/* Feature tags */}
          <div className="wl-tags">
            {(lang === 'ar'
              ? ['ذكاء اصطناعي', 'محلي وآمن', 'نشر متعدد']
              : ['AI-Powered', 'Local & Secure', 'Multi-Platform']
            ).map((label, i) => (
              <span key={i} className="wl-tag" style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
                {label}
              </span>
            ))}
          </div>

          {/* Trial countdown — integrated, interactive */}
          <TrialCountdown lang={lang} />

          {/* CTA */}
          <div className="wl-cta-zone">
            <button type="button" className="wl-cta-btn" onClick={enter}>
              <span className="wl-cta-btn-text">{t('welcome.enter')}</span>
              <svg className="wl-cta-btn-arrow" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>

          {/* Live indicator */}
          <div className="wl-live-badge">
            <span className="wl-live-dot" aria-hidden />
            <span>{lang === 'ar' ? 'النظام مباشر' : 'System Live'}</span>
          </div>

        </section>

        {/* RIGHT — editorial workflow */}
        <aside className="wl-right-panel">
          <div className="wl-panel-eyebrow">
            <span className="wl-panel-eyebrow-line" aria-hidden />
            <span>{lang === 'ar' ? 'سير العمل الإخباري' : 'Editorial Workflow'}</span>
          </div>

          <div className="wl-workflow-list">
            {WORKFLOW.map((w, i) => (
              <div key={i} className="wl-workflow-item"
                style={{ animationDelay: `${0.15 + i * 0.1}s` }}>
                <div className="wl-workflow-meta">
                  <span className="wl-workflow-num">{w.step}</span>
                  {i < WORKFLOW.length - 1 && <span className="wl-workflow-thread" aria-hidden />}
                </div>
                <div className="wl-workflow-card">
                  <div className="wl-workflow-title">{lang === 'ar' ? w.labelAr : w.labelEn}</div>
                  <div className="wl-workflow-desc">{lang === 'ar' ? w.descAr : w.descEn}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="wl-status-row">
            <span className="wl-status-dot" aria-hidden />
            <span className="wl-status-label">{lang === 'ar' ? 'النظام جاهز' : 'System Online'}</span>
            <span className="wl-status-ver">v1.0</span>
          </div>
        </aside>

      </main>

      {/* ── Footer ── */}
      <footer className="wl-footer">
        <span className="wl-footer-brand">
          {lang === 'ar' ? 'مسار' : 'Masar'}
        </span>
        <span className="wl-footer-sep" aria-hidden>·</span>
        <span className="wl-footer-copy">
          © {year} {lang === 'ar' ? 'جميع الحقوق محفوظة' : 'All rights reserved'}
        </span>
        <span className="wl-footer-sep" aria-hidden>·</span>
        <span className="wl-footer-ver">v1.0.0</span>
      </footer>

    </div>
  );
}
