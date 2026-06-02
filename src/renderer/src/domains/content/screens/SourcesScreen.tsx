import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceRow } from '../../../../../shared/api-types';
import { SourceDiscoveryPanel } from '../components/discovery/SourceDiscoveryPanel';
import { normalizeSourceUrl } from '../lib/source-url';
import { Btn, Empty, Field, Input, Loading, Modal, Msg, Panel, Select, Toolbar, ToolbarSpacer } from '../../../ui';

/* ── TrustScoreRing Component ── */
function TrustScoreRing({ score }: { score: number }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--warn)' : 'var(--err)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }} title={`مقياس الموثوقية: ${score}%`}>
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r={radius} fill="transparent" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        fontWeight: 'bold',
        color: 'var(--t1)',
        direction: 'ltr'
      }}>
        {score}
      </div>
    </div>
  );
}

/* ── StatusIndicator Component ── */
function StatusIndicator({ enabled, isFetching, hasError }: { enabled: boolean; isFetching: boolean; hasError: boolean }) {
  if (!enabled) {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--border)', display: 'inline-block', flexShrink: 0
      }} title="معطل" />
    );
  }
  if (isFetching) {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#6366f1', display: 'inline-block', flexShrink: 0,
        animation: 'pulse-blue 1.5s infinite'
      }} title="جاري التحديث..." />
    );
  }
  if (hasError) {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--err)', display: 'inline-block', flexShrink: 0,
        animation: 'pulse-red 1.5s infinite'
      }} title="يوجد خطأ" />
    );
  }
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: 'var(--ok)', display: 'inline-block', flexShrink: 0
    }} title="جاهز ومتصل" />
  );
}

/* ── ActivityDrawer Component ── */
type FetchLogRow = {
  id: number;
  ok?: boolean;
  status_code?: number;
  method?: string;
  duration_ms?: number;
  bytes_read?: number;
  created_at?: string;
};

interface ActivityDrawerProps {
  logs: FetchLogRow[];
  loading: boolean;
  lastError: string | null;
}

function ActivityDrawer({ logs, loading, lastError }: ActivityDrawerProps) {
  if (loading) {
    return (
      <div style={{
        padding: '12px 14px',
        background: 'rgba(255, 255, 255, 0.01)',
        borderRadius: 8,
        border: '1px dashed var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--t3)',
        gap: 8,
        marginTop: 6
      }}>
        <div className="animate-spin-custom" style={{
          width: 12, height: 12, border: '2px solid var(--accent)',
          borderTopColor: 'transparent', borderRadius: '50%'
        }} />
        <span>جاري جلب سجل النشاط المباشر...</span>
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 14px',
      background: 'rgba(0, 0, 0, 0.15)',
      borderRadius: 8,
      border: '1px solid rgba(255, 255, 255, 0.04)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      marginTop: 6
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 6 }}>
        📊 سجل العمليات الأخير (آخر 5 محاولات)
      </div>

      {logs.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--t3)', textAlign: 'center', padding: '6px 0' }}>
          لا توجد عمليات مسجلة حالياً لهذا المصدر.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.map((log) => {
            const dateStr = log.created_at ? new Date(log.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
            return (
              <div key={log.id} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 10,
                color: 'var(--t3)',
                padding: '4px 6px',
                background: 'rgba(255, 255, 255, 0.01)',
                borderRadius: 4
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    color: log.ok ? 'var(--ok)' : 'var(--err)',
                    fontWeight: 'bold',
                    background: log.ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    padding: '1px 4px',
                    borderRadius: 3,
                    fontSize: 9
                  }}>
                    {log.ok ? 'ناجحة' : 'فاشلة'} {log.status_code ? `(${log.status_code})` : ''}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--t3)' }}>{log.method}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⏱ {log.duration_ms}ms</span>
                  <span>📦 {Math.round((log.bytes_read ?? 0) / 1024)} KB</span>
                  <span style={{ fontSize: 9, color: 'var(--t4)' }}>{dateStr}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastError && (
        <div style={{
          marginTop: 4,
          padding: '6px 8px',
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.15)',
          borderRadius: 6,
          fontSize: 10,
          color: 'var(--err)',
          lineHeight: '1.4'
        }}>
          <strong>⚠️ تفاصيل الخطأ الأخير:</strong> {lastError}
        </div>
      )}
    </div>
  );
}

export function SourcesScreen() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: '', url: '', source_type: 'rss' });
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  /* Modern state additions */
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'disabled' | 'errors'>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [auditLogs, setAuditLogs] = useState<FetchLogRow[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [fetchingIds, setFetchingIds] = useState<Set<number>>(new Set());

  const togglingIds = useRef(new Set<number>());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.sources.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) setRows(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const knownUrls = useMemo(
    () => new Set(rows.map((s) => normalizeSourceUrl(s.url)).filter(Boolean)),
    [rows],
  );

  function showMsg(msg: { ok: boolean; text: string }) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 5000);
  }

  async function toggle(id: number, enabled: boolean) {
    if (togglingIds.current.has(id)) return;
    togglingIds.current.add(id);
    setRows((prev) => prev.map((s) => s.id === id ? { ...s, enabled: enabled ? 0 : 1 } : s));
    try {
      const res = await window.eyespro.sources.toggle(id, !enabled).catch(() => ({ ok: false }));
      if (!res.ok) {
        setRows((prev) => prev.map((s) => s.id === id ? { ...s, enabled: enabled ? 1 : 0 } : s));
      }
    } finally {
      togglingIds.current.delete(id);
    }
  }

  const loadAuditLogsFor = useCallback(async (id: number) => {
    setLoadingAudit(true);
    setAuditLogs([]);
    try {
      const res = await window.eyespro.fetch.audit({ sourceId: id, limit: 5 }).catch(() => ({ ok: false, data: [] }));
      if (res && Array.isArray(res)) {
        setAuditLogs(res as FetchLogRow[]);
      } else {
        const data = (res as { data?: unknown })?.data;
        if (Array.isArray(data)) setAuditLogs(data as FetchLogRow[]);
      }
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  const toggleExpand = useCallback(async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setAuditLogs([]);
    } else {
      setExpandedId(id);
      await loadAuditLogsFor(id);
    }
  }, [expandedId, loadAuditLogsFor]);

  async function fetchOne(id: number) {
    setActionMsg(null);
    setFetchingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      const res = await window.eyespro.sources.fetch(id).catch(() => ({ ok: false, data: undefined, error: undefined }));
      const data = res.ok ? (res.data as { ok?: boolean; saved?: number; error?: string } | undefined) : null;
      if (res.ok && data?.ok !== false) {
        await load();
        const n = data?.saved ?? 0;
        showMsg({ ok: true, text: `${t('sources.fetched')}: +${n}` });
        if (expandedId === id) {
          void loadAuditLogsFor(id);
        }
      } else {
        showMsg({ ok: false, text: data?.error ?? (res as { error?: string }).error ?? t('sources.fetchFailed') });
      }
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function remove(id: number) {
    if (!confirm(t('sources.deleteConfirm'))) return;
    await window.eyespro.sources.delete(id);
    void load();
  }

  async function addSource(data: {
    name: string;
    url: string;
    source_type: string;
    category?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const url = normalizeSourceUrl(data.url);
    if (!url) return { ok: false, error: t('sources.discovery.invalidUrl') };

    const createPayload: Record<string, unknown> = {
      name: data.name.trim() || url,
      url,
      source_type: data.source_type,
      enabled: 1,
      skipDetect: true,
    };
    const res = await window.eyespro.sources.create(createPayload as Parameters<typeof window.eyespro.sources.create>[0]);
    if (res.ok) {
      await load();
      return { ok: true };
    }
    return { ok: false, error: res.error ?? t('sources.discovery.addFailed') };
  }

  async function submitAdd() {
    if (!draft.name.trim() || !draft.url.trim()) return;
    const res = await addSource(draft);
    if (!res.ok) return;
    setShowAdd(false);
    setDraft({ name: '', url: '', source_type: 'rss' });
  }

  const ql = q.toLowerCase();
  const filtered = rows.filter((s) => {
    const matchesQuery = !q ||
      s.name.toLowerCase().includes(ql) ||
      (s.url ?? '').toLowerCase().includes(ql) ||
      (s.category ?? '').toLowerCase().includes(ql);

    if (!matchesQuery) return false;
    if (activeTab === 'active' && s.enabled === 0) return false;
    if (activeTab === 'disabled' && s.enabled !== 0) return false;
    if (activeTab === 'errors' && (!s.last_error || s.enabled === 0)) return false;
    if (platformFilter !== 'all' && s.source_type !== platformFilter) return false;

    return true;
  });

  return (
    <Panel>
      <style>{`
        .source-card-premium {
          background: var(--surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          padding: 14px 16px !important;
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
          position: relative;
          overflow: hidden;
        }
        .source-card-premium:hover {
          transform: translateY(-4px) scale(1.01);
          border-color: rgba(255, 255, 255, 0.12) !important;
        }
        .glow-rss:hover {
          box-shadow: 0 8px 30px rgba(245, 158, 11, 0.08) !important;
          border-color: rgba(245, 158, 11, 0.3) !important;
        }
        .glow-wordpress:hover {
          box-shadow: 0 8px 30px rgba(33, 117, 155, 0.08) !important;
          border-color: rgba(33, 117, 155, 0.3) !important;
        }
        .glow-telegram:hover {
          box-shadow: 0 8px 30px rgba(34, 158, 217, 0.08) !important;
          border-color: rgba(34, 158, 217, 0.3) !important;
        }
        .glow-json:hover {
          box-shadow: 0 8px 30px rgba(99, 102, 241, 0.08) !important;
          border-color: rgba(99, 102, 241, 0.3) !important;
        }
        .glow-html:hover {
          box-shadow: 0 8px 30px rgba(16, 185, 129, 0.08) !important;
          border-color: rgba(16, 185, 129, 0.3) !important;
        }
        .glow-youtube:hover {
          box-shadow: 0 8px 30px rgba(255, 0, 0, 0.08) !important;
          border-color: rgba(255, 0, 0, 0.3) !important;
        }
        @keyframes pulse-blue {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 10px rgba(99, 102, 241, 0.6); }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        @keyframes pulse-red {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 10px rgba(239, 68, 68, 0.6); }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .animate-spin-custom {
          animation: spin 1s linear infinite;
        }
      `}</style>

      <Toolbar>
        <Input placeholder={t('sources.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <Btn onClick={() => void load()}>↻</Btn>
        <ToolbarSpacer />
        <Btn onClick={() => setShowAdd(true)}>+ {t('sources.add')}</Btn>
        <Btn variant="primary" onClick={async () => {
          setActionMsg(null);
          const activeIds = rows.filter(r => r.enabled !== 0).map(r => r.id);
          setFetchingIds(prev => {
            const next = new Set(prev);
            activeIds.forEach(id => next.add(id));
            return next;
          });
          try {
            const res = await window.eyespro.sources.fetchAll().catch(() => ({ ok: false, data: undefined }));
            if (res.ok && res.data) {
              const d = res.data as { saved?: number; failed?: number };
              showMsg({ ok: true, text: `${t('sources.fetched')}: +${d.saved ?? 0}${(d.failed ?? 0) > 0 ? ` (${d.failed} failed)` : ''}` });
            } else if (res.ok) {
              showMsg({ ok: true, text: t('sources.fetched') });
            } else {
              showMsg({ ok: false, text: t('common.error') });
            }
            await load();
            if (expandedId !== null) {
              void loadAuditLogsFor(expandedId);
            }
          } finally {
            setFetchingIds(prev => {
              const next = new Set(prev);
              activeIds.forEach(id => next.delete(id));
              return next;
            });
          }
        }}>{t('sources.fetchAll')}</Btn>
      </Toolbar>

      {/* ── Segmented Filtering Tabs ── */}
      <div style={{
        display: 'flex',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 3,
        gap: 2,
        margin: '12px 0',
        width: 'fit-content'
      }}>
        {[
          { key: 'all', label: t('sources.tabs.all', { defaultValue: 'All' }) },
          { key: 'active', label: t('sources.tabs.active', { defaultValue: 'Active' }) },
          { key: 'disabled', label: t('sources.tabs.disabled', { defaultValue: 'Disabled' }) },
          { key: 'errors', label: t('sources.tabs.errors', { defaultValue: 'With errors' }) },
        ].map(tInfo => {
          const isActive = activeTab === tInfo.key;
          return (
            <button
              key={tInfo.key}
              type="button"
              onClick={() => setActiveTab(tInfo.key as typeof activeTab)}
              style={{
                padding: '6px 16px',
                borderRadius: 9,
                border: 'none',
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--t3)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {tInfo.label}
            </button>
          );
        })}
      </div>

      {/* ── Platform Filters ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 16
      }}>
        {[
          { key: 'all', label: t('sources.platform.all', { defaultValue: 'All platforms' }), icon: '🌍', color: 'var(--t3)' },
          { key: 'rss', label: 'RSS', icon: '📡', color: '#f59e0b' },
          { key: 'wordpress', label: 'WordPress', icon: '🌐', color: '#21759b' },
          { key: 'telegram', label: 'Telegram', icon: '✈️', color: '#229ed9' },
          { key: 'youtube', label: 'YouTube', icon: '▶️', color: '#ff0000' },
          { key: 'json_api', label: 'JSON API', icon: '⚙️', color: '#6366f1' },
          { key: 'html', label: 'HTML', icon: '🔗', color: '#10b981' },
        ].map(pInfo => {
          const isActive = platformFilter === pInfo.key;
          return (
            <button
              key={pInfo.key}
              type="button"
              onClick={() => setPlatformFilter(pInfo.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                border: `1px solid ${isActive ? pInfo.color : 'var(--border)'}`,
                background: isActive ? `${pInfo.color}15` : 'transparent',
                color: isActive ? pInfo.color : 'var(--t3)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span>{pInfo.icon}</span>
              <span>{pInfo.label}</span>
            </button>
          );
        })}
      </div>

      <SourceDiscoveryPanel
        knownUrls={knownUrls}
        onAddSource={(d) => addSource(d)}
        onImported={() => void load()}
      />

      {actionMsg && (
        <div style={{ marginTop: 12 }}>
          <Msg tone={actionMsg.ok ? 'ok' : 'err'}>{actionMsg.text}</Msg>
        </div>
      )}

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty title={t('sources.empty')} desc={t('sources.emptyHint')} icon="📡" />
      ) : (
        <div className="ui-grid ui-grid--2" style={{ marginTop: 16 }}>
          {filtered.map((s) => {
            const isExpanded = expandedId === s.id;
            const isFetching = fetchingIds.has(s.id);
            return (
              <SourceCard
                key={s.id}
                source={s}
                isFetching={isFetching}
                isExpanded={isExpanded}
                auditLogs={auditLogs}
                loadingAudit={loadingAudit}
                onToggle={() => void toggle(s.id, s.enabled !== 0)}
                onFetch={() => void fetchOne(s.id)}
                onDelete={() => void remove(s.id)}
                onToggleExpand={() => void toggleExpand(s.id)}
              />
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title={t('sources.addTitle')} onClose={() => setShowAdd(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('sources.name')}>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label={t('sources.url')}>
              <Input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} dir="ltr" />
            </Field>
            <Field label={t('sources.type', { defaultValue: 'Type' })}>
              <Select value={draft.source_type} onChange={(e) => setDraft((d) => ({ ...d, source_type: e.target.value }))}>
                <option value="rss">RSS</option>
                <option value="wordpress">WordPress</option>
                <option value="telegram">Telegram</option>
                <option value="json_api">JSON API</option>
                <option value="html">HTML</option>
                <option value="youtube">YouTube</option>
              </Select>
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setShowAdd(false)}>{t('common.cancel')}</Btn>
              <Btn variant="primary" onClick={() => void submitAdd()}>{t('common.save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

/* ── Source type metadata ───────────────────────────────────────── */
const SOURCE_TYPE_META: Record<string, { icon: string; color: string; label: string; glowClass: string }> = {
  rss:       { icon: '📡', color: '#f59e0b', label: 'RSS', glowClass: 'glow-rss' },
  wordpress: { icon: '🌐', color: '#21759b', label: 'WordPress', glowClass: 'glow-wordpress' },
  telegram:  { icon: '✈️', color: '#229ed9', label: 'Telegram', glowClass: 'glow-telegram' },
  json_api:  { icon: '⚙️', color: '#6366f1', label: 'JSON API', glowClass: 'glow-json' },
  html:      { icon: '🔗', color: '#10b981', label: 'HTML', glowClass: 'glow-html' },
  youtube:   { icon: '▶️', color: '#ff0000', label: 'YouTube', glowClass: 'glow-youtube' },
};

function formatLastFetch(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return '< 1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/* ── SourceCard component ────────────────────────────────────────── */
interface SourceCardProps {
  source: SourceRow;
  isFetching: boolean;
  isExpanded: boolean;
  auditLogs: FetchLogRow[];
  loadingAudit: boolean;
  onToggle: () => void;
  onFetch: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}

function SourceCard({
  source: s,
  isFetching,
  isExpanded,
  auditLogs,
  loadingAudit,
  onToggle,
  onFetch,
  onDelete,
  onToggleExpand
}: SourceCardProps) {
  const { t } = useTranslation();
  const meta = SOURCE_TYPE_META[s.source_type ?? 'rss'] ?? SOURCE_TYPE_META['rss'];
  const enabled = Boolean(s.enabled);
  const hasError = Boolean(s.last_error);

  return (
    <div
      className={`source-card-premium ${meta.glowClass}`}
      style={{
        opacity: enabled ? 1 : 0.65,
        border: `1px solid ${hasError && enabled ? 'color-mix(in srgb, var(--err) 30%, var(--border))' : 'var(--border)'}`,
      }}
    >
      {/* ── Header row: icon + name + toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Type icon bubble */}
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          background: `${meta.color}18`,
          border: `1px solid ${meta.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          {meta.icon}
        </div>

        {/* Name + type */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              background: `${meta.color}20`, color: meta.color,
              borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 600,
            }}>
              {meta.label}
            </span>
            {s.category && (
              <span style={{ color: 'var(--t3)' }}>{s.category}</span>
            )}
            <StatusIndicator enabled={enabled} isFetching={isFetching} hasError={hasError} />
          </div>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          onClick={onToggle}
          title={enabled ? t('common.disable', { defaultValue: 'Disable' }) : t('common.enable', { defaultValue: 'Enable' })}
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: enabled ? 'var(--ok)' : 'var(--border)',
            position: 'relative', flexShrink: 0,
            transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%',
            background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
            transition: 'inset-inline-start 0.2s',
            insetInlineStart: enabled ? 18 : 2,
          }} />
        </button>
      </div>

      {/* ── URL row ── */}
      <div style={{
        fontSize: 11, color: 'var(--t3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} dir="ltr" title={s.url ?? ''}>
        {s.url}
      </div>

      {/* ── Stats + Trust score row ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            🕐 {formatLastFetch(s.last_fetched_at)}
          </span>
          {s.fetch_interval_min != null && s.fetch_interval_min > 0 && (
            <span style={{ color: 'var(--t3)', fontSize: 10 }}>⏱ {s.fetch_interval_min}m</span>
          )}
          {hasError && enabled && (
            <span style={{
              color: 'var(--err)', background: 'var(--err-soft)',
              borderRadius: 4, padding: '2px 6px', fontSize: 10,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 160, display: 'inline-block',
            }} title={s.last_error ?? ''}>
              ⚠ {s.last_error}
            </span>
          )}
        </div>

        {s.trust_score != null && (
          <TrustScoreRing score={s.trust_score} />
        )}
      </div>

      {/* ── Actions row ── */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          type="button"
          disabled={isFetching}
          onClick={onFetch}
          style={{
            flex: 1, padding: '5px 0', borderRadius: 7, border: '1px solid var(--accent)',
            background: isFetching ? 'var(--accent)' : 'transparent',
            color: isFetching ? '#fff' : 'var(--accent)', fontSize: 12, fontWeight: 500,
            cursor: isFetching ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}
          onMouseEnter={(e) => { if (!isFetching) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = '#fff'; } }}
          onMouseLeave={(e) => { if (!isFetching) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent)'; } }}
        >
          {isFetching ? (
            <>
              <div className="animate-spin-custom" style={{
                width: 10, height: 10, border: '2px solid #fff',
                borderTopColor: 'transparent', borderRadius: '50%'
              }} />
              <span>جاري...</span>
            </>
          ) : (
            <>
              <span>↻</span>
              <span>{t('sources.fetch')}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          style={{
            padding: '5px 10px', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent',
            color: isExpanded ? 'var(--accent)' : 'var(--t3)', fontSize: 12, cursor: 'pointer',
            transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          title="عرض سجل النشاط"
        >
          <span style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            display: 'inline-block'
          }}>
            ▼
          </span>
        </button>

        <button
          type="button"
          onClick={onDelete}
          style={{
            padding: '5px 10px', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--t3)', fontSize: 12, cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          🗑
        </button>
      </div>

      {/* Expanded Activity Drawer */}
      {isExpanded && (
        <ActivityDrawer
          logs={auditLogs}
          loading={loadingAudit}
          lastError={s.last_error}
        />
      )}
    </div>
  );
}
