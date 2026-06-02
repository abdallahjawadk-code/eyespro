import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublishLogRow } from '../../../../../shared/api-types';
import { Badge, Btn, Empty, Loading, Msg, Panel, Stat, StatGrid, Toolbar } from '../../../ui';

export function TrackerScreen() {
  const { t } = useTranslation();
  const [rows, setRows]     = useState<PublishLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await window.eyespro.analytics.publishLogs().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) {
      setRows(res.data as PublishLogRow[]);
    } else {
      setError(t('publish.tracker.loadError', { defaultValue: 'Failed to load publish log' }));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const total   = rows.length;
  const success = rows.filter((r) => r.success === 1).length;
  const failed  = rows.filter((r) => r.success === 0).length;

  // Per-platform summary
  const byPlatform = rows.reduce<Record<string, { ok: number; fail: number }>>((acc, r) => {
    const p = acc[r.platform] ?? { ok: 0, fail: 0 };
    if (r.success === 1) p.ok++;
    else p.fail++;
    acc[r.platform] = p;
    return acc;
  }, {});

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻</Btn>
      </Toolbar>

      {error && <Msg tone="err" style={{ marginBottom: 12 }}>{error}</Msg>}

      <StatGrid>
        <Stat label={t('publish.tracker.total',   { defaultValue: 'Total publishes' })} value={total}   accent="var(--acc)" />
        <Stat label={t('publish.tracker.success', { defaultValue: 'Succeeded' })}       value={success} accent="#22c55e" />
        <Stat label={t('publish.tracker.failed',  { defaultValue: 'Failed' })}          value={failed}  accent="#ef4444" />
      </StatGrid>

      {/* Per-platform bar summary */}
      {Object.keys(byPlatform).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {Object.entries(byPlatform).map(([platform, stat]) => {
            const rate = stat.ok + stat.fail > 0
              ? Math.round((stat.ok / (stat.ok + stat.fail)) * 100)
              : 0;
            return (
              <div key={platform} style={{
                background: 'var(--bg2)', borderRadius: 10, padding: '10px 14px',
                minWidth: 120, display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{platform}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {stat.ok} ✓ · {stat.fail} ✗
                </span>
                <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 99, marginTop: 2 }}>
                  <div style={{
                    height: '100%', width: `${rate}%`,
                    background: rate >= 80 ? '#22c55e' : rate >= 50 ? '#f59e0b' : '#ef4444',
                    borderRadius: 99, transition: 'width .3s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty
          icon="📤"
          title={t('publish.tracker.emptyTitle', { defaultValue: 'No publish activity yet' })}
          desc={t('publish.tracker.emptyDesc',  { defaultValue: 'Publish an article to a platform and the log will appear here' })}
        />
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>{t('articles.colTitle')}</th>
                <th>{t('publish.tracker.platform', { defaultValue: 'Platform' })}</th>
                <th>{t('articles.colStatus')}</th>
                <th>{t('publish.tracker.date', { defaultValue: 'Date' })}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.article_title ?? `#${row.article_id}`}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{row.platform}</td>
                  <td>
                    <Badge tone={row.success === 1 ? 'ok' : 'err'}>
                      {row.success === 1
                        ? t('publish.tracker.statusOk',   { defaultValue: 'Published' })
                        : t('publish.tracker.statusFail', { defaultValue: 'Failed' })}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--t3)' }}>
                    {formatDate(row.created_at)}
                  </td>
                  <td>
                    {row.post_url && (
                      <a
                        href={row.post_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: 'var(--acc)' }}
                      >
                        ↗
                      </a>
                    )}
                    {row.success === 0 && row.error && (
                      <span
                        title={row.error}
                        style={{ fontSize: 12, color: '#ef4444', cursor: 'help' }}
                      >
                        ⚠ {row.error.slice(0, 40)}{row.error.length > 40 ? '…' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
