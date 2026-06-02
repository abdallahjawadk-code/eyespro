import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Card, Loading, Panel, Stat, StatGrid, Toolbar } from '../../../ui';

export function MonitorScreen() {
  const { t } = useTranslation();
  const [perf, setPerf] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.system.perf().catch(() => ({ ok: false, data: null }));
    if (res.ok && res.data) setPerf(res.data as Record<string, unknown>);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;

  return (
    <Panel>
      <Toolbar><Btn onClick={() => void load()}>↻</Btn></Toolbar>
      <StatGrid>
        <Stat label={t('system.version', { defaultValue: 'الإصدار' })} value={String(perf?.version ?? '—')} accent="var(--acc)" />
        <Stat label={t('system.memory', { defaultValue: 'الذاكرة' })} value={perf?.memoryMB ? `${perf.memoryMB} MB` : '—'} accent="#38bdf8" />
        <Stat label={t('system.uptime', { defaultValue: 'وقت التشغيل' })} value={perf?.uptime ? `${Math.round(Number(perf.uptime) / 60)}m` : '—'} accent="#22c55e" />
      </StatGrid>
      <Card title={t('systemHub.tabs.monitor')}>
        <pre style={{ margin: 0, fontSize: 12, color: 'var(--t2)', overflow: 'auto' }}>{JSON.stringify(perf, null, 2)}</pre>
      </Card>
    </Panel>
  );
}
