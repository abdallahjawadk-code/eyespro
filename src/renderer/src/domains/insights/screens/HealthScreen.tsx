import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Empty, Loading, Msg, Panel, Stat, StatGrid, Toolbar } from '../../../ui';

type SourceHealth = {
  id: number;
  name: string;
  url: string | null;
  enabled: number;
  trust_score: number;
  fetch_interval_min: number | null;
  next_fetch_at: string | null;
  circuit: { mode: string; shieldScore: number } | null;
  health: { total: number; ok: number; fail: number; avgMs?: number; lastError?: string | null };
};

type ShieldData = {
  overview: { totalHosts: number; openCount: number; feedOnlyCount: number; avgScore: number };
  circuits: Array<{ host: string; mode: string; failureCount: number; shieldScore: number; openUntil: string | null }>;
};

type TierStats = { tiers: Record<string, number>; linkHealth: Record<string, number> };

type SortKey = 'uptime' | 'speed' | 'trust' | 'name';

function trustTone(score: number): 'ok' | 'warn' | 'err' | 'muted' {
  if (score >= 70) return 'ok';
  if (score >= 40) return 'warn';
  return 'err';
}

function circuitTone(mode: string): 'ok' | 'warn' | 'err' | 'muted' {
  if (mode === 'normal') return 'ok';
  if (mode === 'feed_only') return 'warn';
  if (mode === 'open') return 'err';
  return 'muted';
}

export function HealthScreen() {
  const { t } = useTranslation();
  const [rows, setRows]       = useState<SourceHealth[]>([]);
  const [shield, setShield]   = useState<ShieldData | null>(null);
  const [tiers, setTiers]     = useState<TierStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [sort, setSort]       = useState<SortKey>('uptime');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [healthRes, shieldRes, tierRes] = await Promise.all([
      window.eyespro.sources.healthAll().catch(() => ({ ok: false, data: [] })),
      window.eyespro.fetch.shieldOverview().catch(() => ({ ok: false, data: null })),
      window.eyespro.fetch.qualityTiers().catch(() => ({ ok: false, data: null })),
    ]);
    if (healthRes.ok && healthRes.data) {
      setRows(healthRes.data as SourceHealth[]);
    } else {
      setError(t('common.loadError', { defaultValue: 'Failed to load data' }));
    }
    if (shieldRes.ok && shieldRes.data) setShield(shieldRes.data as ShieldData);
    if (tierRes.ok && tierRes.data) setTiers(tierRes.data as TierStats);
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const pct = (s: SourceHealth) =>
    s.health.total > 0 ? Math.round((s.health.ok / s.health.total) * 100) : 0;

  const healthy = rows.filter((s) => s.enabled && s.health.total > 0 && pct(s) >= 90).length;
  const dead    = rows.filter((s) => s.enabled && s.health.total > 0 && pct(s) < 50).length;
  const lowTrust = rows.filter((s) => s.enabled && s.trust_score < 40).length;

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === 'uptime') return pct(b) - pct(a);
      if (sort === 'speed')  return (a.health.avgMs ?? 9999) - (b.health.avgMs ?? 9999);
      if (sort === 'trust')  return b.trust_score - a.trust_score;
      return a.name.localeCompare(b.name);
    });
  }, [rows, sort]);  

  const tierTotal = tiers ? Object.values(tiers.tiers).reduce((a, b) => a + b, 0) : 0;

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻</Btn>
        <Btn variant={sort === 'uptime' ? 'primary' : undefined} onClick={() => setSort('uptime')}>
          {t('health.sortUptime')}
        </Btn>
        <Btn variant={sort === 'speed' ? 'primary' : undefined} onClick={() => setSort('speed')}>
          {t('health.sortSpeed')}
        </Btn>
        <Btn variant={sort === 'trust' ? 'primary' : undefined} onClick={() => setSort('trust')}>
          {t('health.sortTrust', { defaultValue: 'Trust' })}
        </Btn>
      </Toolbar>

      {error && <Msg tone="err" style={{ marginBottom: 12 }}>{error}</Msg>}

      <StatGrid>
        <Stat label={t('health.total')}   value={rows.length} accent="var(--acc)" />
        <Stat label={t('health.healthy')} value={healthy}     accent="#22c55e" />
        <Stat label={t('health.dead')}    value={dead}        accent="#ef4444" />
        <Stat label={t('health.lowTrust', { defaultValue: 'Low trust' })} value={lowTrust} accent="#f59e0b" />
      </StatGrid>

      {shield && (
        <div style={{ marginTop: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {t('health.shieldTitle', { defaultValue: 'Fetch Shield' })}
          </div>
          <StatGrid>
            <Stat label={t('health.shieldHosts', { defaultValue: 'Domains tracked' })} value={shield.overview.totalHosts} accent="var(--acc)" />
            <Stat label={t('health.shieldOpen', { defaultValue: 'Circuit open' })} value={shield.overview.openCount} accent="#ef4444" />
            <Stat label={t('health.shieldFeedOnly', { defaultValue: 'Feed-only' })} value={shield.overview.feedOnlyCount} accent="#f59e0b" />
            <Stat label={t('health.shieldScore', { defaultValue: 'Avg score' })} value={shield.overview.avgScore} accent="#22c55e" />
          </StatGrid>
          {shield.circuits.filter((c) => c.mode !== 'normal').length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {shield.circuits.filter((c) => c.mode !== 'normal').slice(0, 12).map((c) => (
                <Badge key={c.host} tone={circuitTone(c.mode)}>
                  {c.host}: {c.mode} ({c.shieldScore})
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {tiers && tierTotal > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {t('health.qualityTiers', { defaultValue: 'Content quality tiers' })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(tiers.tiers).map(([tier, count]) => (
              <Badge key={tier} tone={tier === 'reject' ? 'err' : tier === 'review' ? 'warn' : 'ok'}>
                {tier}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {loading ? <Loading /> : sorted.length === 0 ? (
        <Empty
          icon="🛰️"
          title={t('health.emptyTitle', { defaultValue: 'No sources found' })}
          desc={t('health.emptyDesc',   { defaultValue: 'Add RSS sources to start monitoring their health' })}
        />
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>{t('sources.name')}</th>
                <th>{t('health.uptime')}</th>
                <th>{t('health.sortTrust', { defaultValue: 'Trust' })}</th>
                <th>{t('health.interval', { defaultValue: 'Interval' })}</th>
                <th>{t('health.shield', { defaultValue: 'Shield' })}</th>
                <th>{t('health.sortSpeed')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const uptime = pct(s);
                const tone   = !s.enabled ? 'muted' : uptime >= 90 ? 'ok' : uptime >= 50 ? 'warn' : 'err';
                return (
                  <tr key={s.id} title={s.health.lastError ?? undefined}>
                    <td>{s.name}</td>
                    <td>
                      <Badge tone={tone}>{s.enabled ? `${uptime}%` : t('common.off')}</Badge>
                    </td>
                    <td>
                      <Badge tone={trustTone(s.trust_score)}>{s.trust_score}</Badge>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--t3)' }}>
                      {s.fetch_interval_min ? `${s.fetch_interval_min}m` : '—'}
                    </td>
                    <td>
                      {s.circuit && s.circuit.mode !== 'normal' ? (
                        <Badge tone={circuitTone(s.circuit.mode)}>{s.circuit.mode}</Badge>
                      ) : (
                        <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--t3)' }}>
                      {s.health.avgMs != null ? `${s.health.avgMs} ms` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
