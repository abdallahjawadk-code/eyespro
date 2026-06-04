import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompetitorMonitor, CompetitorSnapshot, DownloadJob, DownloadQuality, MonitorSourceType, SnapshotCluster, TopicAlert } from '../../../../shared/api-types';
import { Badge, Btn, Card, Empty, Field, Input, Loading, Msg, Panel, Toolbar } from '../../ui';
import { Workspace } from '../../shell/Workspace';
import { VideoPlayer } from '../../components/media/VideoPlayer';
import { SemanticForceGraph } from './components/SemanticForceGraph';
import { VisualDiff } from './components/VisualDiff';

// ─── Source type meta ─────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<MonitorSourceType, string> = {
  rss: '📡',
  facebook: '🇫',
  youtube: '▶️',
  tiktok: '🎵',
  google_news: '📰',
  twitter: '𝕏',
  instagram: '📸',
  website: '🌐',
};

const VIDEO_TYPES: MonitorSourceType[] = ['youtube'];

function sourceIcon(type: MonitorSourceType): string {
  return SOURCE_ICONS[type] ?? '📡';
}

function renderPlatformBadge(type: MonitorSourceType) {
  const meta: Record<MonitorSourceType, { bg: string; color: string; label: string; icon: string }> = {
    rss: { bg: 'rgba(242, 101, 34, 0.08)', color: '#f26522', label: 'RSS Feed', icon: '📡' },
    facebook: { bg: 'rgba(24, 119, 242, 0.08)', color: '#1877f2', label: 'Facebook', icon: '📘' },
    youtube: { bg: 'rgba(255, 0, 0, 0.08)', color: '#ff4444', label: 'YouTube', icon: '🔴' },
    tiktok: { bg: 'rgba(0, 242, 254, 0.08)', color: '#00f2fe', label: 'TikTok', icon: '🎵' },
    google_news: { bg: 'rgba(66, 133, 244, 0.08)', color: '#4285f4', label: 'Google News', icon: '📰' },
    twitter: { bg: 'rgba(255, 255, 255, 0.06)', color: '#e5e7eb', label: '𝕏 / Twitter', icon: '𝕏' },
    instagram: { bg: 'rgba(225, 48, 108, 0.08)', color: '#e1306c', label: 'Instagram', icon: '📸' },
    website: { bg: 'rgba(16, 185, 129, 0.08)', color: '#10b981', label: 'موقع ويب', icon: '🌐' },
  };

  const current = meta[type] ?? { bg: 'rgba(255,255,255,0.05)', color: '#9ca3af', label: String(type), icon: '📡' };

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 6,
      background: current.bg,
      color: current.color,
      fontSize: 10,
      fontWeight: 600,
      border: `1px solid ${current.color}25`,
      whiteSpace: 'nowrap'
    }}>
      <span>{current.icon}</span>
      <span>{current.label}</span>
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MonitorDomain() {
  const { t, i18n } = useTranslation();
  const SOURCE_TYPES: { value: MonitorSourceType; icon: string; label: string; hint: string }[] = [
    { value: 'rss', icon: '📡', label: 'RSS / Atom', hint: t('monitor.rssHint') },
    { value: 'facebook', icon: '🇫', label: t('monitor.sourceTypes.facebook'), hint: t('monitor.facebookHint') },
    { value: 'youtube', icon: '▶️', label: t('monitor.sourceTypes.youtube'), hint: t('monitor.youtubeHint') },
    { value: 'google_news', icon: '📰', label: 'Google News', hint: t('monitor.googleNewsHint') },
    { value: 'twitter', icon: '𝕏', label: t('monitor.sourceTypes.twitter'), hint: t('monitor.twitterHint') },
    { value: 'website', icon: '🌐', label: t('monitor.sourceTypes.website'), hint: t('monitor.websiteHint') },
  ];
  const [monitors, setMonitors] = useState<CompetitorMonitor[]>([]);
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-GB';
  const [snapshots, setSnapshots] = useState<CompetitorSnapshot[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [hoveredSnapId, setHoveredSnapId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [crawling, setCrawling] = useState<number | null>(null);

  // Competitor intelligence upgrades state
  const [clusters, setClusters] = useState<SnapshotCluster[]>([]);
  const [alerts, setAlerts] = useState<TopicAlert[]>([]);
  const [activeTab, setActiveTab] = useState<'snapshots' | 'clusters' | 'alerts'>('snapshots');
  const [expandedDiffSnapId, setExpandedDiffSnapId] = useState<number | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);

  // Add-monitor form state
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<MonitorSourceType>('rss');
  const [addInput, setAddInput] = useState('');   // main input (feed/query/handle/url)
  const [addSite, setAddSite] = useState('');     // optional website URL
  const [addLang, setAddLang] = useState('ar');
  const [addCountry, setAddCountry] = useState('SA');
  const [addSelector, setAddSelector] = useState('');
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Downloader state
  const [dlJobs, setDlJobs] = useState<DownloadJob[]>([]);
  const [dlQuality, setDlQuality] = useState<DownloadQuality>('best');
  const [ytdlpReady, setYtdlpReady] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const dlListenerRef = useRef(false);
  // Video player
  const [player, setPlayer] = useState<{ src: string; title: string; filePath?: string } | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [m, u, cRes, aRes] = await Promise.all([
      window.eyespro.monitor.list(),
      window.eyespro.monitor.unreadCount(),
      window.eyespro.monitor.getSemanticClusters(),
      window.eyespro.monitor.getTopicAlerts()
    ]);
    if (m.ok && m.data) {
      setMonitors(m.data);
      if (m.data.length > 0 && activeId === null) setActiveId(m.data[0].id);
    }
    if (u.ok && u.data != null) setUnread(u.data);
    if (cRes.ok && cRes.data) setClusters(cRes.data);
    if (aRes.ok && aRes.data) setAlerts(aRes.data);
    if (!silent) setLoading(false);
  }, [activeId]);

  const loadSnapshots = useCallback(async (monitorId: number) => {
    const res = await window.eyespro.monitor.snapshots(monitorId);
    if (res.ok && res.data) setSnapshots(res.data);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Check yt-dlp status once
  useEffect(() => {
    void window.eyespro.downloader.status().then((r) => {
      if (r.ok && r.data) setYtdlpReady(r.data.installed);
    });
    // Listen for download progress events
    if (!dlListenerRef.current) {
      dlListenerRef.current = true;
      window.eyespro.on?.('downloader:progress', (job: unknown) => {
        const j = job as DownloadJob;
        setDlJobs((prev) => {
          const idx = prev.findIndex((x) => x.id === j.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = j; return next; }
          return [j, ...prev];
        });
      });
    }
  }, []);
  useEffect(() => {
    if (activeId !== null) void loadSnapshots(activeId);
    else setSnapshots([]);
  }, [activeId, loadSnapshots]);

  async function addMonitor() {
    if (!addName.trim() || !addInput.trim()) return;
    setAddMsg(null);

    // Build extraConfig for new source types
    let feedUrl = '';
    let fbPageUrl: string | undefined;
    let websiteUrl: string | undefined;
    let extraConfig: Record<string, string> | undefined;

    switch (addType) {
      case 'rss':
        feedUrl = addInput.trim();
        break;
      case 'facebook':
        fbPageUrl = addInput.trim();
        feedUrl = '';
        break;
      case 'youtube':
        extraConfig = { channelId: addInput.trim() };
        feedUrl = addInput.trim();
        break;
      case 'google_news':
        extraConfig = { query: addInput.trim(), language: addLang, country: addCountry };
        feedUrl = addInput.trim();
        break;
      case 'twitter':
        extraConfig = { handle: addInput.trim().replace(/^@/, '') };
        feedUrl = addInput.trim();
        break;
      case 'instagram':
        extraConfig = { handle: addInput.trim().replace(/^@/, '') };
        feedUrl = addInput.trim();
        break;
      case 'tiktok':
        extraConfig = { handle: addInput.trim().replace(/^@/, '') };
        feedUrl = addInput.trim();
        break;
      case 'website':
        websiteUrl = addInput.trim();
        feedUrl = addInput.trim();
        if (addSelector.trim()) extraConfig = { selector: addSelector.trim() };
        break;
    }

    const res = await window.eyespro.monitor.add(
      addName.trim(),
      feedUrl,
      websiteUrl ?? (addSite.trim() || undefined),
      addType,
      fbPageUrl,
      extraConfig ? JSON.stringify(extraConfig) : undefined,
    );

    if (res.ok) {
      setAddName(''); setAddInput(''); setAddSite(''); setAddSelector('');
      setAddMsg({ ok: true, text: t('monitor.added') });
      await loadAll(true);
    } else {
      setAddMsg({ ok: false, text: res.error ?? t('monitor.addFailed') });
    }
  }

  async function deleteMonitor(id: number) {
    if (!window.confirm(t('common.delete') + '?')) return;
    await window.eyespro.monitor.delete(id);
    if (activeId === id) setActiveId(null);
    await loadAll(true);
  }

  async function checkOne(id: number) {
    setChecking(id); setMsg(null);
    const res = await window.eyespro.monitor.check(id);
    setChecking(null);
    if (res.ok) {
      setMsg({ ok: true, text: t('monitor.checkDone') });
      void loadSnapshots(id);
      void loadAll(true);
    } else {
      setMsg({ ok: false, text: res.error ?? t('monitor.checkFailed') });
    }
  }

  async function checkAll() {
    setChecking(-1); setMsg(null);
    const res = await window.eyespro.monitor.checkAll();
    setChecking(null);
    if (res.ok) {
      setMsg({ ok: true, text: t('monitor.checkAllDone') });
      await loadAll(true);
      if (activeId !== null) void loadSnapshots(activeId);
    } else {
      setMsg({ ok: false, text: res.error ?? t('monitor.checkFailed') });
    }
  }

  async function markRead(snapshotId: number) {
    await window.eyespro.monitor.markRead(snapshotId);
    setSnapshots((prev) => prev.map((s) => s.id === snapshotId ? { ...s, is_read: 1 } : s));
    const u = await window.eyespro.monitor.unreadCount();
    if (u.ok && u.data != null) setUnread(u.data);
  }

  async function rewrite(snapshotId: number) {
    setRewriting(snapshotId);
    const res = await window.eyespro.monitor.rewrite(snapshotId);
    setRewriting(null);
    if (res.ok) {
      setMsg({ ok: true, text: t('monitor.rewriteDone') });
      setSnapshots((prev) => prev.map((s) => s.id === snapshotId ? { ...s, is_read: 1 } : s));
    } else {
      setMsg({ ok: false, text: res.error ?? t('monitor.rewriteFailed') });
    }
  }

  async function handleSynthesize(ids: number[]) {
    setSynthesizing(true);
    setMsg(null);
    const res = await window.eyespro.monitor.synthesizeNews(ids);
    setSynthesizing(false);
    if (res.ok) {
      setMsg({ ok: true, text: 'تم دمج وتوليف الأخبار بنجاح ونقلها للمسودات.' });
      await loadAll(true);
      if (activeId !== null) void loadSnapshots(activeId);
    } else {
      setMsg({ ok: false, text: res.error || 'فشل دمج وتوليف الأخبار.' });
    }
  }

  async function openInPlayer(job: DownloadJob) {
    if (!job.outputPath) return;
    const res = await window.eyespro.downloader.mediaUrl(job.outputPath);
    if (res.ok && res.data) {
      setPlayer({ src: res.data, title: job.title || job.url, filePath: job.outputPath ?? undefined });
    }
  }

  async function installYtDlp() {
    setInstalling(true);
    const res = await window.eyespro.downloader.install();
    setInstalling(false);
    setYtdlpReady(res.ok);
  }

  async function downloadSnap(snap: CompetitorSnapshot) {
    if (!snap.link) return;
    const jobId = `dl_${snap.id}_${Date.now()}`;
    await window.eyespro.downloader.start(snap.link, dlQuality, jobId);
  }

  if (loading) return <Loading />;

  const activeMonitor = monitors.find((m) => m.id === activeId);
  const unreadSnaps = snapshots.filter((s) => s.is_read === 0).length;
  const currentType = SOURCE_TYPES.find((s) => s.value === addType)!;

  return (
    <>
    {player && (
      <VideoPlayer
        src={player.src}
        title={player.title}
        filePath={player.filePath}
        onClose={() => setPlayer(null)}
      />
    )}
    <Workspace
      eyebrow={t('nav.groupInsights')}
      title={t('nav.monitor')}
      description={t('monitor.description')}
    >
      <Panel>
        <Toolbar>
          <Btn onClick={() => void loadAll()}>↻ {t('common.refresh')}</Btn>
          <Btn
            variant="primary"
            disabled={checking === -1 || monitors.length === 0}
            onClick={() => void checkAll()}
          >
            {checking === -1 ? `⏳ ${t('monitor.checking')}` : `🔍 ${t('monitor.checkAll')}`}
          </Btn>
          {unread > 0 && <Badge tone="warn">🔔 {unread} {t('monitor.unread')}</Badge>}
        </Toolbar>

        {msg && <div style={{ marginBottom: 12 }}><Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg></div>}

        <div className="ui-grid ui-grid--2" style={{ alignItems: 'start' }}>

          {/* ── Left column: list + add form ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Monitor list */}
            <Card title={`🕵️ ${t('monitor.monitors')} (${monitors.length})`}>
              {monitors.length === 0 ? (
                <Empty icon="🕵️" title={t('monitor.noMonitors')} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {monitors.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => setActiveId(m.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        border: `1.5px solid ${activeId === m.id ? 'var(--accent)' : 'var(--border)'}`,
                        background: activeId === m.id ? 'var(--accent-muted, rgba(99,102,241,.08))' : 'var(--bg2)',
                        transition: 'border-color .15s',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{sourceIcon(m.source_type)}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: 'var(--accent-muted)', color: 'var(--accent)', fontWeight: 600,
                      }}>
                        {m.source_type}
                      </span>
                      <Btn
                        variant="ghost"
                        disabled={checking === m.id}
                        onClick={(e) => { e.stopPropagation(); void checkOne(m.id); }}
                        style={{ fontSize: 11, padding: '3px 8px' }}
                      >
                        {checking === m.id ? '⏳' : '🔍'}
                      </Btn>
                      {m.source_type === 'website' && (
                        <Btn
                          variant="ghost"
                          disabled={crawling === m.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setCrawling(m.id);
                            setMsg(null);
                            try {
                              const res = await window.eyespro.crawler.crawl(m.id, m.feed_url || m.website_url || '').catch(() => ({ ok: false, error: 'تعذر بدء عملية الزحف' }));
                              setMsg({
                                ok: res.ok,
                                text: res.ok ? 'اكتملت عملية الزحف العميق لموقع المنافس وتحديث المحتوى بنجاح.' : `فشل الزحف: ${res.error || 'خطأ غير معروف'}`
                              });
                              void loadSnapshots(m.id);
                            } finally {
                              setCrawling(null);
                            }
                          }}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          title="تشغيل الزحف العميق المتبع للروابط"
                        >
                          {crawling === m.id ? '⏳' : '🕸️'}
                        </Btn>
                      )}
                      <Btn
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); void deleteMonitor(m.id); }}
                        style={{ fontSize: 11, padding: '3px 8px', color: 'var(--err)' }}
                      >
                        🗑
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Add monitor form */}
            <Card title={`➕ ${t('monitor.addMonitor')}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Source type selector */}
                <Field label={t('monitor.sourceType')}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {SOURCE_TYPES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => { setAddType(s.value); setAddInput(''); }}
                        style={{
                          padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                          border: `1.5px solid ${addType === s.value ? 'var(--accent)' : 'var(--border)'}`,
                          background: addType === s.value ? 'var(--accent-muted)' : 'var(--bg2)',
                          color: addType === s.value ? 'var(--accent)' : 'var(--t1)',
                          fontWeight: addType === s.value ? 600 : 400,
                        }}
                      >
                        {s.icon} {s.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t('monitor.competitorName')}>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder={t('monitor.namePlaceholder')}
                  />
                </Field>

                <Field label={currentType.hint}>
                  <Input
                    dir="ltr"
                    value={addInput}
                    onChange={(e) => setAddInput(e.target.value)}
                    placeholder={
                      addType === 'rss'         ? 'https://site.com/feed.xml' :
                      addType === 'facebook'    ? 'https://facebook.com/PageName' :
                      addType === 'youtube'     ? t('monitor.youtubeHint') :
                      addType === 'tiktok'      ? t('monitor.tiktokHint') :
                      addType === 'google_news' ? t('monitor.googleNewsHint') :
                      addType === 'twitter'     ? t('monitor.twitterHint') :
                      addType === 'instagram'   ? t('monitor.instagramHint') :
                                                  'https://competitor.com/page'
                    }
                  />
                </Field>

                {/* Google News: language & country */}
                {addType === 'google_news' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Field label={t('monitor.language')} style={{ flex: 1 }}>
                      <select
                        value={addLang}
                        onChange={(e) => setAddLang(e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--t1)' }}
                      >
                        <option value="ar">{t('translation.lang.ar')}</option>
                        <option value="en">{t('translation.lang.en')}</option>
                        <option value="fr">{t('translation.lang.fr')}</option>
                      </select>
                    </Field>
                    <Field label={t('monitor.country')} style={{ flex: 1 }}>
                      <select
                        value={addCountry}
                        onChange={(e) => setAddCountry(e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--t1)' }}
                      >
                        <option value="SA">{t('trends.regions.SA')}</option>
                        <option value="EG">{t('trends.regions.EG')}</option>
                        <option value="AE">{t('trends.regions.AE')}</option>
                        <option value="US">{t('trends.regions.US')}</option>
                        <option value="GB">{t('trends.regions.GB')}</option>
                      </select>
                    </Field>
                  </div>
                )}

                {/* Website: optional CSS selector */}
                {addType === 'website' && (
                  <Field label={t('monitor.websiteSelector')}>
                    <Input
                      dir="ltr"
                      value={addSelector}
                      onChange={(e) => setAddSelector(e.target.value)}
                      placeholder={t('monitor.websiteSelectorPlaceholder')}
                    />
                  </Field>
                )}

                {addMsg && <Msg tone={addMsg.ok ? 'ok' : 'err'}>{addMsg.text}</Msg>}

                <Btn
                  variant="primary"
                  disabled={!addName.trim() || !addInput.trim()}
                  onClick={() => void addMonitor()}
                >
                  ➕ {t('monitor.addBtn')}
                </Btn>
              </div>
            </Card>
          </div>

          {/* ── Right column: snapshots ── */}
          <Card
            title={
              activeTab === 'clusters'
                ? '🕸️ خريطة الترابط الدلالي بين المنافسين'
                : activeTab === 'alerts'
                  ? '🚨 تنبيهات النشاط والتحليل الذكي'
                  : activeMonitor
                    ? `${sourceIcon(activeMonitor.source_type)} ${activeMonitor.name}${unreadSnaps > 0 ? ` — ${unreadSnaps} ${t('monitor.unread')}` : ''}`
                    : `📰 ${t('monitor.snapshots')}`
            }
          >
            {/* ── Analysis tab bar (harmonised with the app's pill selectors) ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
              {([
                { key: 'snapshots', icon: '📰', label: 'اللقطات الإخبارية', count: activeMonitor ? snapshots.length : null, danger: false },
                { key: 'clusters', icon: '🕸️', label: 'خريطة الترابط الدلالي', count: clusters.length, danger: false },
                { key: 'alerts', icon: '🚨', label: 'التنبؤ والتحليل الذكي', count: alerts.length, danger: true },
              ] as const).map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-muted)' : 'var(--bg2)',
                      color: active ? 'var(--accent)' : 'var(--t2)',
                      fontWeight: active ? 600 : 400,
                      transition: 'border-color .15s, background .15s',
                    }}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                    {tab.count != null && tab.count > 0 && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, minWidth: 16, textAlign: 'center',
                        padding: '1px 5px', borderRadius: 10,
                        background: tab.danger ? 'var(--err)' : active ? 'var(--accent)' : 'var(--border)',
                        color: tab.danger || active ? '#fff' : 'var(--t2)',
                      }}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === 'snapshots' ? (
              !activeMonitor ? (
                <Empty icon="📰" title={t('monitor.selectMonitor')} />
              ) : snapshots.length === 0 ? (
                <Empty icon="📰" title={t('monitor.noSnapshots')} desc={t('monitor.noSnapshotsHint')} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto', padding: '4px 2px' }}>
                  {snapshots.map((snap) => {
                    const isHovered = hoveredSnapId === snap.id;
                    const isUnread = snap.is_read === 0;
                    return (
                      <div
                        key={snap.id}
                        onMouseEnter={() => setHoveredSnapId(snap.id)}
                        onMouseLeave={() => setHoveredSnapId(null)}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 12,
                          border: isHovered
                            ? '1px solid rgba(99, 102, 241, 0.4)'
                            : isUnread
                              ? '1px solid rgba(99, 102, 241, 0.15)'
                              : '1px solid rgba(255, 255, 255, 0.06)',
                          background: isUnread
                            ? (isHovered ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.06)')
                            : (isHovered ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.01)'),
                          boxShadow: isHovered
                            ? '0 8px 24px rgba(0, 0, 0, 0.3), 0 0 12px rgba(99, 102, 241, 0.1)'
                            : '0 4px 12px rgba(0, 0, 0, 0.15)',
                          backdropFilter: 'blur(10px)',
                          transition: 'all 0.25s ease-in-out',
                          transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                          opacity: snap.is_read ? 0.85 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                          {isUnread && (
                            <span style={{ color: 'var(--accent)', fontSize: 10, marginTop: 5, flexShrink: 0 }}>●</span>
                          )}

                          {/* Video thumbnail */}
                          {snap.thumbnail_url && (
                            <div style={{ flexShrink: 0, position: 'relative' }}>
                              <img
                                src={snap.thumbnail_url}
                                alt=""
                                style={{
                                  width: 100, height: 62, objectFit: 'cover',
                                  borderRadius: 8, display: 'block',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              {activeMonitor && VIDEO_TYPES.includes(activeMonitor.source_type) && (
                                <span style={{
                                  position: 'absolute', bottom: 4, insetInlineEnd: 4,
                                  background: 'rgba(0,0,0,0.75)', color: '#fff',
                                  fontSize: 9, padding: '1px 4px', borderRadius: 4,
                                  fontWeight: 'bold'
                                }}>
                                  {activeMonitor.source_type === 'youtube' ? '▶' : '🎵'}
                                </span>
                              )}
                            </div>
                          )}

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--fg)' }}>{snap.title}</div>
                              {activeMonitor && (
                                <div style={{ flexShrink: 0 }}>
                                  {renderPlatformBadge(activeMonitor.source_type)}
                                </div>
                              )}
                            </div>
                            {snap.summary && (
                              <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4, lineHeight: 1.6 }}>
                                {snap.summary.slice(0, 200)}{snap.summary.length > 200 ? '…' : ''}
                              </div>
                            )}
                            {/* Website diff or visual diff */}
                            {snap.diff_text && (
                              (() => {
                                let parsedDiff: { oldText: string; newText: string } | null = null;
                                if (snap.diff_text && snap.diff_text.startsWith('{')) {
                                  try { parsedDiff = JSON.parse(snap.diff_text); }
                                  catch { parsedDiff = null; }
                                }
                                return (
                                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {parsedDiff ? (
                                      <>
                                        <Btn
                                          variant="ghost"
                                          style={{ fontSize: 10, padding: '2px 8px', alignSelf: 'flex-start', color: 'var(--accent)' }}
                                          onClick={() => setExpandedDiffSnapId(expandedDiffSnapId === snap.id ? null : snap.id)}
                                        >
                                          {expandedDiffSnapId === snap.id ? '🔼 إخفاء المقارنة البصرية' : '🔎 مقارنة التعديلات البصرية'}
                                        </Btn>
                                        {expandedDiffSnapId === snap.id && (
                                          <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: '#000' }}>
                                            <VisualDiff oldText={parsedDiff.oldText} newText={parsedDiff.newText} />
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <div style={{
                                        padding: '6px 8px', borderRadius: 6,
                                        background: 'var(--bg3)', fontSize: 11,
                                        fontFamily: 'monospace', color: 'var(--t2)', whiteSpace: 'pre-wrap',
                                      }}>
                                        {snap.diff_text}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8 }}>
                          {snap.link && (
                            <a href={snap.link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                              🔗 {t('common.open')}
                            </a>
                          )}
                          {isUnread && (
                            <Btn variant="ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void markRead(snap.id)}>
                              ✓ {t('monitor.markRead')}
                            </Btn>
                          )}
                          <Btn
                            variant="ghost"
                            disabled={rewriting === snap.id}
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => void rewrite(snap.id)}
                          >
                            {rewriting === snap.id ? '⏳' : `✨ ${t('monitor.rewriteBtn')}`}
                          </Btn>
                          {/* Download button for video types */}
                          {activeMonitor && VIDEO_TYPES.includes(activeMonitor.source_type) && snap.link && (
                            <Btn
                              variant="ghost"
                              style={{ fontSize: 11, padding: '2px 8px', color: 'var(--ok)' }}
                              onClick={() => void downloadSnap(snap)}
                              title={ytdlpReady ? t('monitor.ytdlpTooltip') : t('monitor.ytdlpTooltipRequired')}
                            >
                              ⬇ {dlQuality === 'audio_only' ? t('monitor.qualityAudio') : t('socialVideo.downloadBtn')}
                            </Btn>
                          )}
                          {snap.rewritten_article_id && (
                            <Badge tone="ok" style={{ fontSize: 10 }}>✅ {t('monitor.rewritten')}</Badge>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--t3)', marginInlineStart: 'auto' }}>
                            {snap.published_at ? new Date(snap.published_at).toLocaleDateString(locale) : snap.seen_at ? new Date(snap.seen_at).toLocaleDateString(locale) : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : activeTab === 'clusters' ? (
              clusters.length === 0 ? (
                <Empty icon="🕸️" title="لا توجد تجمعات دلالية حالياً" desc="سيقوم البرنامج بتجميع أخبار المنافسين دلالياً تلقائياً متى توفرت لقطات أخبار غير مقروءة ومتشابهة." />
              ) : (
                <SemanticForceGraph
                  clusters={clusters}
                  onSynthesize={handleSynthesize}
                  synthesizing={synthesizing}
                />
              )
            ) : (
              // activeTab === 'alerts'
              alerts.length === 0 ? (
                <Empty icon="🚨" title="لا توجد تنبيهات نشاط عاجلة" desc="يقوم المساعد بمراقبة نشاط المنافسين على مدار الساعة وسيتم تنبيهك فوراً عند رصد نشر متزامن كثيف لموضوع معين." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto', padding: '4px 2px' }}>
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: alert.severity === 'high' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(245, 158, 11, 0.3)',
                        background: alert.severity === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.03)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        transition: 'all 0.2s ease-in-out',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 4,
                          background: alert.severity === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                          color: alert.severity === 'high' ? '#ef4444' : '#f59e0b',
                        }}>
                          {alert.severity === 'high' ? '🚨 تنبيه نشاط مكثف' : '⚠️ رصد متزامن متوسط'}
                        </span>
                      </div>
                      
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--fg)', marginBottom: 6 }}>
                        {alert.topicTitle}
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 10, lineHeight: 1.5 }}>
                        {alert.summary}
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 12 }}>
                        <strong>المنافسون المشاركون:</strong>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {alert.snapshots.map(s => (
                            <span key={s.id} style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                              {s.monitorName}
                            </span>
                          ))}
                        </div>
                      </div>

                      <Btn
                        variant="primary"
                        disabled={synthesizing}
                        onClick={() => void handleSynthesize(alert.snapshotIds)}
                        style={{ fontSize: 11, padding: '4px 12px' }}
                      >
                        {synthesizing ? '⏳ جاري الدمج...' : '✨ دمج التغطية وصياغة تقرير مدمج'}
                      </Btn>
                    </div>
                  ))}
                </div>
              )
            )}
          </Card>
        </div>

        {/* ── Downloader panel ─────────────────────────────────────── */}
        <Card title={`⬇ ${t('downloader.title')}`} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* yt-dlp status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>
                {ytdlpReady === null ? t('downloader.statusChecking') :
                 ytdlpReady ? t('downloader.statusReady') :
                 t('downloader.statusNotInstalled')}
              </span>
              {ytdlpReady === false && (
                <Btn variant="primary" style={{ fontSize: 11 }} disabled={installing} onClick={() => void installYtDlp()}>
                  {installing ? t('downloader.installing') : t('downloader.installBtn')}
                </Btn>
              )}
              {ytdlpReady && (
                <Btn variant="ghost" style={{ fontSize: 11 }} onClick={() => void window.eyespro.downloader.openFolder()}>
                  {t('downloader.openFolder')}
                </Btn>
              )}

              {/* Quality selector */}
              {ytdlpReady && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginInlineStart: 'auto' }}>
                  <span style={{ fontSize: 11, color: 'var(--t2)' }}>{t('downloader.quality')}</span>
                  {(['best','1080p','720p','480p','360p','audio_only'] as DownloadQuality[]).map((q) => (
                    <button key={q} onClick={() => setDlQuality(q)} style={{
                      padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                      border: `1px solid ${dlQuality === q ? 'var(--accent)' : 'var(--border)'}`,
                      background: dlQuality === q ? 'var(--accent-muted)' : 'var(--bg2)',
                      color: dlQuality === q ? 'var(--accent)' : 'var(--t2)',
                    }}>
                      {q === 'audio_only' ? t('downloader.qualityAudio') : q === 'best' ? t('downloader.qualityBest') : q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Downloads list */}
            {dlJobs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{t('downloader.downloadsCount', { count: dlJobs.length })}</span>
                  <Btn variant="ghost" style={{ fontSize: 10 }} onClick={() => {
                    void window.eyespro.downloader.clear();
                    setDlJobs((prev) => prev.filter((j) => j.status === 'downloading' || j.status === 'pending'));
                  }}>
                    🗑 {t('downloader.clearFinished')}
                  </Btn>
                </div>
                {dlJobs.map((job) => (
                  <div key={job.id} style={{
                    padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg2)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.title || job.url.slice(0, 60)}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 4, marginInlineStart: 8, flexShrink: 0,
                        background: job.status === 'done' ? 'var(--ok-soft)' : job.status === 'error' ? 'var(--err-soft)' : 'var(--accent-muted)',
                        color: job.status === 'done' ? 'var(--ok)' : job.status === 'error' ? 'var(--err)' : 'var(--accent)',
                      }}>
                        {job.status === 'done' ? t('downloader.statusDone') : job.status === 'error' ? t('downloader.statusFailed') : job.status === 'downloading' ? t('downloader.statusDownloading', { progress: job.progress }) : '⏳'}
                      </span>
                    </div>

                    {/* Progress bar */}
                    {(job.status === 'downloading' || job.status === 'pending') && (
                      <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${job.progress}%`, background: 'var(--accent)', borderRadius: 2 }} />
                      </div>
                    )}

                    {job.status === 'downloading' && (
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                        {job.speed && `🚀 ${job.speed}`} {job.eta && `· ETA ${job.eta}`}
                      </div>
                    )}
                    {job.status === 'error' && (
                      <div style={{ fontSize: 10, color: 'var(--err)', marginTop: 3 }}>{job.error?.slice(0, 150)}</div>
                    )}
                    {job.status === 'done' && job.outputPath && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <Btn variant="primary" style={{ fontSize: 10 }}
                          onClick={() => void openInPlayer(job)}>
                          {t('downloader.play')}
                        </Btn>
                        <Btn variant="ghost" style={{ fontSize: 10 }}
                          onClick={() => void window.eyespro.downloader.openFile(job.outputPath!)}>
                          {t('downloader.openFile')}
                        </Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {ytdlpReady && dlJobs.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
                {t('downloader.clickDownloadHint')}
              </p>
            )}
          </div>
        </Card>

      </Panel>
    </Workspace>
    </>
  );
}
