import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityHeatmap } from '../../dashboard/components/ActivityHeatmap';
import { Btn, Empty, Loading, Msg, Panel, Stat, StatGrid, Toolbar } from '../../../ui';

type Analytics = {
  total?: number; published?: number; pending?: number; sources?: number;
  today?: number; publishRate?: number;
  byDay?: { date: string; count: number }[];
};

export function AnalyticsScreen() {
  const { t } = useTranslation();
  const [data, setData]       = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [exportErr, setExportErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await window.eyespro.analytics.dashboard().catch(() => ({ ok: false, data: null }));
    if (res.ok && res.data) {
      setData(res.data as Analytics);
    } else {
      setError(t('common.loadError', { defaultValue: 'Failed to load data' }));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function exportCsv() {
    setExportMsg('');
    setExportErr('');
    try {
      const res = await window.eyespro.analytics.exportCsv();
      if (res.ok && res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'analytics.csv'; a.click();
        URL.revokeObjectURL(url);
        setExportMsg(t('analytics.exportDone', { defaultValue: 'CSV downloaded' }));
        setTimeout(() => setExportMsg(''), 3000);
      } else {
        setExportErr(t('analytics.exportFailed', { defaultValue: 'Export failed' }));
      }
    } catch {
      setExportErr(t('analytics.exportFailed', { defaultValue: 'Export failed' }));
    }
  }

  if (loading) return <Loading label={t('common.loading')} />;

  const last7 = (data?.byDay ?? []).slice(-7);
  // Normalise bar widths against the max value in the window
  const maxCount = Math.max(...last7.map((d) => d.count), 1);

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻</Btn>
        <Btn onClick={() => void exportCsv()}>{t('analytics.export')}</Btn>
      </Toolbar>

      {error     && <Msg tone="err"  style={{ marginBottom: 12 }}>{error}</Msg>}
      {exportErr && <Msg tone="err"  style={{ marginBottom: 12 }}>{exportErr}</Msg>}
      {exportMsg && <Msg tone="info" style={{ marginBottom: 12 }}>{exportMsg}</Msg>}

      {data ? (
        <>
          <StatGrid>
            <Stat label={t('dash.stat.pending')}   value={data.pending    ?? 0}   accent="#f59e0b" />
            <Stat label={t('dash.stat.published')} value={data.published  ?? 0}   accent="#22c55e" />
            <Stat label={t('dash.stat.today')}     value={data.today      ?? 0}   accent="var(--acc)" />
            <Stat label={t('dash.publishRate')}    value={`${data.publishRate ?? 0}%`} accent="#a855f7" />
          </StatGrid>

          {(data.byDay?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 20 }}>
              <ActivityHeatmap data={data.byDay!} weeks={26} />
            </div>
          )}

          {last7.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', marginBottom: 4 }}>
                {t('analytics.last7', { defaultValue: 'Last 7 days' })}
              </p>
              {last7.map((d) => (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 80, fontSize: 12, color: 'var(--t2)', flexShrink: 0 }}>{d.date}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg3)', borderRadius: 99 }}>
                    <div style={{
                      width: `${(d.count / maxCount) * 100}%`,
                      height: '100%', background: 'var(--acc)', borderRadius: 99,
                      transition: 'width .3s',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{d.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="📊"
              title={t('analytics.noData', { defaultValue: 'No activity yet' })}
              desc={t('analytics.noDataHint', { defaultValue: 'Publish some articles to see activity data here' })}
            />
          )}
        </>
      ) : (
        <Empty icon="📊"
          title={t('analytics.noData', { defaultValue: 'No activity yet' })}
          desc={t('analytics.noDataHint', { defaultValue: 'Publish some articles to see activity data here' })}
        />
      )}
    </Panel>
  );
}
