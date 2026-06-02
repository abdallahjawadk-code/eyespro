import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { Titlebar } from '../components/layout/Titlebar';
import { CommandPalette } from '../components/ui/CommandPalette';
import { ShortcutsHelp } from '../components/ui/ShortcutsHelp';
import { NAV_GROUPS, PAGE_TITLES } from '../core/navigation';
import { VFXLayer } from '../components/vfx/VFXLayer';
import { EyeLogo } from '../components/vfx/EyeLogo';
import '../components/layout/layout.css';

interface AlertItem {
  id: number;
  type?: string;
  message?: string;
  dismissed?: boolean;
  kind?: 'system' | 'keyword';
  created_at?: string;
}

function TopBar({ pageTitle, onOpenSearch }: { pageTitle: string; onOpenSearch: () => void }) {
  const { t } = useTranslation();
  const { theme, lang, toggleLang, setTheme } = useTheme();
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<AlertItem[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifs = () => {
    window.eyespro.analytics.alerts().then((res) => {
      if (res.ok && Array.isArray(res.data)) {
        const undismissed = (res.data as AlertItem[]).filter((a) => !a.dismissed);
        setNotifs(undismissed);
        setNotifCount(undismissed.length);
      }
    }).catch(() => undefined);
  };

  useEffect(() => {
    loadNotifs();
    const interval = setInterval(loadNotifs, 2 * 60 * 1000);
    window.addEventListener('focus', loadNotifs);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', loadNotifs);
    };
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

  async function dismissNotif(item: AlertItem) {
    const kind = item.kind ?? 'system';
    await window.eyespro.analytics.dismissNotif(item.id, kind).catch(() => undefined);
    setNotifs((prev) => prev.filter((n) => !(n.id === item.id && (n.kind ?? 'system') === kind)));
    setNotifCount((prev) => Math.max(0, prev - 1));
  }

  return (
    <header className="app-hdr">
      <div className="hdr-left">
        <div className="hdr-dot" />
        <span className="hdr-title">{t(pageTitle)}</span>
      </div>
      <div className="hdr-actions">
        <div className="hdr-search-wrap" onClick={onOpenSearch} style={{ cursor: 'pointer' }}>
          <span className="hdr-search-ico">🔍</span>
          <input type="search" placeholder={`${t('hdr.search')} (Ctrl+K)`} readOnly style={{ cursor: 'pointer' }} />
        </div>
        <div className="notif-wrap" ref={notifRef}>
          <button type="button" className="hdr-icon-btn" title={t('hdr.notifications')} onClick={() => setNotifOpen((v) => !v)}>
            🔔
            {notifCount > 0 && <span className="hdr-badge-dot">{notifCount > 9 ? '9+' : notifCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-panel">
              <div className="notif-panel-hdr">
                <span>🔔 {t('hdr.notifications')}</span>
                {notifCount > 0 && <span className="notif-count-badge">{notifCount}</span>}
              </div>
              {notifs.length === 0 ? (
                <div className="notif-empty">✓ {t('hdr.noNotifs')}</div>
              ) : (
                <div className="notif-list">
                  {notifs.slice(0, 12).map((n) => (
                    <div key={`${n.kind ?? 'system'}-${n.id}`} className="notif-item">
                      <div className="notif-item-body">
                        <span className={`notif-item-type type-${n.type ?? 'info'}`}>
                          {n.kind === 'keyword' ? '🔑' : '⚠️'} {n.type ?? 'info'}
                        </span>
                        <p className="notif-item-msg">{n.message ?? ''}</p>
                        {n.created_at && <span className="notif-item-time">{new Date(n.created_at).toLocaleString()}</span>}
                      </div>
                      <button type="button" className="notif-item-dismiss" title={t('common.dismiss')} onClick={() => void dismissNotif(n)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="hdr-sep-v" />

        {/* Theme cycle: dark → light → system → dark */}
        <button
          type="button"
          className="hdr-ctrl-btn hdr-theme-btn"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
            setTheme(next);
          }}
          title={
            theme === 'dark'
              ? t('theme.light')
              : theme === 'light'
              ? t('theme.system') || 'تلقائي'
              : t('theme.dark')
          }
        >
          {theme === 'dark' ? '☀️' : theme === 'light' ? '⚙️' : '🌓'}
        </button>

        <button type="button" className="hdr-ctrl-btn hdr-lang-btn" onClick={toggleLang} title={t('nav.toggleLang')}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
      </div>
    </header>
  );
}

function StatusBar() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('—');
  const [tenant, setTenant] = useState('—');

  useEffect(() => {
    window.eyespro.system.perf().then((res) => {
      if (res.ok && res.data) {
        const d = res.data as Record<string, unknown>;
        if (d.version) setVersion(String(d.version));
      }
    }).catch(() => undefined);
    window.eyespro.tenants.current().then((res) => {
      if (res.ok && res.data) {
        const d = res.data as Record<string, unknown>;
        if (d.name) setTenant(String(d.name));
      }
    }).catch(() => undefined);
  }, []);

  return (
    <footer className="app-statusbar">
      <div className="app-statusbar-left">
        <span className="app-statusbar-item"><span className="dot" /><span>{tenant}</span></span>
        <span className="app-statusbar-item"><span className="dot" /><span>{t('status.db')}</span></span>
      </div>
      <div className="app-statusbar-right">
        <span className="app-statusbar-item">{window.eyespro.app.copyright()}</span>
        <span className="app-statusbar-item">v{version}</span>
      </div>
    </footer>
  );
}

/** Application shell — sidebar, header, outlet, status bar */
export function AppShell() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const pageKey = PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/articles/') ? 'nav.editorialPublish' : 'nav.dashboard');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      } else if (e.key === '?') {
        const active = document.activeElement;
        if (active) {
          const name = active.tagName.toLowerCase();
          if (name === 'input' || name === 'textarea' || active.hasAttribute('contenteditable') || (active as HTMLElement).isContentEditable) return;
        }
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <VFXLayer />
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: '2px',
        background: 'linear-gradient(90deg, #e63946, #c0392b, #f4a261, #e63946)',
        backgroundSize: '300% 100%',
        animation: 'ep-btn-grad 4s linear infinite',
        zIndex: 99999,
        pointerEvents: 'none',
      }} />
      <Titlebar currentPage={t(pageKey)} />
      <div className="shell">
        <aside className="sidebar">
          <div className="sb-brand">
            {/* Animated eye logo with mouse tracking */}
            <div className="sb-ico-wrap sb-ico">
              <EyeLogo />
            </div>
            <div>
              <div className="sb-name">{t('app.name')}</div>
              <div className="sb-sub">{t('app.tagline')}</div>
            </div>
          </div>
          <nav className="sb-nav">
            {NAV_GROUPS.map((group) => (
              <div key={group.labelKey} className="nav-group">
                <div className="nav-group-label">{t(group.labelKey)}</div>
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <span className="nav-link-ico">{item.ico}</span>
                    <span className="nav-link-text">{t(item.key)}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sb-footer">
            <NavLink to="/" className="btn-home">{t('nav.backToWelcome')}</NavLink>
            <div className="version-tag"><span className="version-dot" />{i18n.language === 'ar' ? 'شبكة المسار v1.0' : 'Masar Network v1.0'}</div>
          </div>
        </aside>
        <div className="main">
          <TopBar pageTitle={pageKey} onOpenSearch={() => setCmdOpen(true)} />
          <div className="main-body"><Outlet /></div>
          <StatusBar />
        </div>
      </div>
      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      <ShortcutsHelp isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
