import { useMemo, useState, useEffect } from 'react';
import type { ApiResult } from '../../../../../shared/api-types';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAsyncData } from '../../../core';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { Btn, Card, Loading, Panel, Stat, StatGrid, Toolbar } from '../../../ui';

type Dash = {
  total?: number;
  published?: number;
  pending?: number;
  today?: number;
  sources?: number;
  publishRate?: number;
  byDay?: { date: string; count: number }[];
};

type PipeStats = { pending: number; running: number; failed: number };

type AuditRow = { id: number; ok: boolean; url?: string; duration_ms?: number; created_at?: string };

export function DashboardScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dashQuery = useAsyncData<Dash>(() => window.eyespro.analytics.dashboard() as unknown as Promise<ApiResult<Dash>>);
  const pipeQuery = useAsyncData<PipeStats>(() => window.eyespro.pipeline.queueStats());
  const loading = dashQuery.loading || pipeQuery.loading;

  const [torActive, setTorActive] = useState(false);
  const [latestAudit, setLatestAudit] = useState<AuditRow[]>([]);

  useEffect(() => {
    window.eyespro.tor.status()
      .then((res) => {
        if (res?.ok && res?.data) {
          setTorActive(res.data.enabled && res.data.status === 'ready');
        }
      })
      .catch(() => null);

    window.eyespro.fetch.audit({ limit: 4 })
      .then((res) => {
        if (res && Array.isArray(res)) {
          setLatestAudit(res as AuditRow[]);
        } else {
          const data = (res as { data?: unknown })?.data;
          if (Array.isArray(data)) setLatestAudit(data as AuditRow[]);
        }
      })
      .catch(() => null);
  }, []);

  const successCount = latestAudit.filter((l) => l.ok).length;
  const totalCount = latestAudit.length;
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100;

  const reload = () => {
    void dashQuery.reload();
    void pipeQuery.reload();
  };

  const hubs = useMemo(() => [
    { to: '/content', icon: '📦', title: t('nav.contentHub'), desc: t('dashboard.hubs.content'), accent: '#38bdf8' },
    { to: '/articles', icon: '📝', title: t('nav.articlesContent'), desc: t('dashboard.hubs.articles'), accent: 'var(--acc)' },
    { to: '/schedule', icon: '⏰', title: t('nav.scheduledTasks'), desc: t('dashboard.hubs.schedule'), accent: '#eab308' },
    { to: '/insights', icon: '📈', title: t('nav.insightsHub'), desc: t('dashboard.hubs.insights'), accent: '#38bdf8' },
    { to: '/settings', icon: '⚙️', title: t('nav.settings'), desc: t('dashboard.hubs.settings'), accent: '#64748b' },
  ], [t]);

  if (loading) return <Loading label={t('common.loading', { defaultValue: 'جاري التحميل…' })} />;

  return (
    <Panel>
      <Toolbar>
        <span style={{ fontSize: 12, color: 'var(--t2)' }}>{t('dashboard.hubDesc')}</span>
        <div style={{ flex: 1 }} />
        <Btn onClick={reload}>↻ {t('common.refresh')}</Btn>
      </Toolbar>

      {/* 🛡️ Privacy Status Banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: torActive ? 'rgba(34, 197, 94, 0.05)' : 'rgba(148, 163, 184, 0.05)',
        border: torActive ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: 12, padding: '12px 20px', marginBottom: 18,
        boxShadow: torActive ? '0 0 15px rgba(34, 197, 94, 0.05)' : 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{torActive ? '🛡️' : '🌐'}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>
              {torActive ? 'نظام التخفي وتجاوز الحجب نشط (Tor Mode)' : 'نظام التخفي معطل حالياً (Direct Connection)'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {torActive ? 'يتم تمرير كافة اتصالات جلب المحتوى والمنافسين وتنزيل الفيديوهات عبر شبكة Tor لحماية هويتك الرقمية.' : 'تتصل الخدمات بالإنترنت مباشرة دون تشفير هويتك عبر Tor. يمكنك تفعيله من الإعدادات.'}
            </div>
          </div>
        </div>
        {torActive && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--ok)',
            background: 'rgba(34, 197, 94, 0.1)', padding: '3px 8px', borderRadius: 20
          }}>
            مؤمن ومحمي
          </span>
        )}
      </div>

      <StatGrid>
        <Stat label={t('dash.stat.pending')} value={dashQuery.data?.pending ?? 0} accent="#f59e0b" />
        <Stat label={t('dash.stat.published')} value={dashQuery.data?.published ?? 0} accent="#22c55e" />
        <Stat label={t('dash.stat.today')} value={dashQuery.data?.today ?? 0} accent="var(--acc)" />
        <Stat label={t('dash.stat.sources')} value={dashQuery.data?.sources ?? 0} accent="#38bdf8" />
        <Stat label={t('dash.pipe.pending', { defaultValue: 'خط المعالجة' })} value={pipeQuery.data?.pending ?? 0} accent="#f59e0b" />
        <Stat label={t('dash.pipe.failed', { defaultValue: 'فشل' })} value={pipeQuery.data?.failed ?? 0} accent="#ef4444" />
      </StatGrid>

      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t2)', margin: '0 0 10px' }}>
        {t('dashboard.quickAccess', { defaultValue: 'وصول سريع' })}
      </p>
      <div className="ui-hub-cards">
        {hubs.map((h) => (
          <button
            key={h.to}
            type="button"
            className="ui-hub-card"
            style={{ '--ui-accent': h.accent } as React.CSSProperties}
            onClick={() => navigate(h.to)}
          >
            <span className="ui-hub-card-icon">{h.icon}</span>
            <span className="ui-hub-card-title">{h.title}</span>
            <span className="ui-hub-card-desc">{h.desc}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
        {/* Ingest Audit Log Drawer */}
        <Card title="📊 سجل عمليات جلب المحتوى المباشر">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {latestAudit.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: '20px 0' }}>
                لا توجد عمليات جلب مسجلة حالياً.
              </div>
            ) : (
              latestAudit.map((log) => {
                const dateStr = log.created_at ? new Date(log.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—';
                return (
                  <div key={log.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 11, color: 'var(--t2)', padding: '8px 10px',
                    background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px solid var(--border)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{
                        color: log.ok ? 'var(--ok)' : 'var(--err)',
                        background: log.ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0
                      }}>
                        {log.ok ? 'ناجح' : 'فشل'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--t1)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={log.url}>
                        {log.url ? log.url.split('/')[2] : 'مجهول'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, fontSize: 10, color: 'var(--t3)' }}>
                      <span>⏱ {log.duration_ms}ms</span>
                      <span>{dateStr}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Fetch Success Rate Gauge Card */}
        <Card title="📈 كفاءة جلب البيانات ومعدل النجاح">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 0', gap: 14 }}>
            <div style={{ position: 'relative', width: 90, height: 90 }}>
              <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="45" cy="45" r="38" fill="none" stroke="var(--border)" strokeWidth="6" />
                <circle
                  cx="45" cy="45" r="38" fill="none"
                  stroke={successRate >= 80 ? 'var(--ok)' : successRate >= 50 ? 'var(--warn)' : 'var(--err)'} strokeWidth="6"
                  strokeDasharray={`${(successRate / 100) * 238.76} 238.76`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.4s ease' }}
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>{successRate}%</span>
                <span style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>معدل النجاح</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', textAlign: 'center', lineHeight: 1.6, maxWidth: 220 }}>
              {successRate >= 80 ? '✓ يعمل المحرك بكفاءة ممتازة ومستقرة، تم تجاوز الحجوبات بنجاح.' : '⚠️ تم رصد بعض الأخطاء أو حجب الطلبات من قبل مواقع الطرف الثالث.'}
            </div>
          </div>
        </Card>
      </div>

      {dashQuery.data?.byDay && dashQuery.data.byDay.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Card title={t('dash.activityHeatmap')}>
            <ActivityHeatmap data={dashQuery.data.byDay} weeks={26} />
          </Card>
        </div>
      )}
    </Panel>
  );
}
