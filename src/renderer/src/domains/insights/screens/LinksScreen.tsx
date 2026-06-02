import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Field, Input, Loading, Msg, Panel } from '../../../ui';

type ScanResult = { risk?: string; flags?: string[]; sanitized?: string; riskLevel?: string; riskScore?: number };
type HealthResult = { state?: string; statusCode?: number; ok?: boolean };
type HealthLogRow = { id: number; url: string; status_code: number; health_state: string; checked_at: string };

export function LinksScreen() {
  const { t } = useTranslation();
  const [url, setUrl]         = useState('');
  const [result, setResult]   = useState<ScanResult | null>(null);
  const [health, setHealth]   = useState<HealthResult | null>(null);
  const [healthLog, setHealthLog] = useState<HealthLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [error, setError]     = useState('');

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    const res = await window.eyespro.links.healthLog().catch(() => ({ ok: false, data: [] }));
    if (res.ok && Array.isArray(res.data)) setHealthLog(res.data as HealthLogRow[]);
    setLogLoading(false);
  }, []);

  useEffect(() => { void loadLog(); }, [loadLog]);

  const scan = useCallback(async () => {
    if (!url.trim()) return;
    setScanning(true);
    setError('');
    setResult(null);
    setHealth(null);
    const res = await window.eyespro.links.scan(url.trim()).catch(() => ({ ok: false, data: undefined }));
    if (res.ok && res.data) {
      const d = res.data as ScanResult & { riskLevel?: string; sanitizedUrl?: string };
      setResult({
        risk: d.risk ?? d.riskLevel,
        flags: d.flags,
        sanitized: d.sanitized ?? d.sanitizedUrl,
        riskLevel: d.riskLevel,
        riskScore: d.riskScore
      });
    } else {
      setError(t('linkScan.failed'));
    }
    setScanning(false);
  }, [url, t]);

  const checkHealth = useCallback(async () => {
    if (!url.trim()) return;
    setCheckingHealth(true);
    setError('');
    const res = await window.eyespro.links.health(url.trim()).catch(() => ({ ok: false, data: undefined }));
    if (res.ok && res.data) {
      setHealth(res.data as HealthResult);
      void loadLog();
    } else {
      setError(t('linkScan.failed'));
    }
    setCheckingHealth(false);
  }, [url, t]);

  const riskTone = (risk?: string) => {
    if (risk === 'high')   return 'err';
    if (risk === 'medium') return 'warn';
    return 'ok';
  };

  return (
    <Panel>
      <Card title={t('nav.linkScan')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
          <Field label="URL">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                onKeyDown={(e) => { if (e.key === 'Enter') void scan(); }}
              />
              <Btn variant="primary" onClick={() => void scan()} disabled={scanning || !url.trim()}>
                {scanning ? '…' : t('linkScan.scan')}
              </Btn>
              <Btn variant="ghost" onClick={() => void checkHealth()} disabled={checkingHealth || !url.trim()}>
                {checkingHealth ? '…' : t('linkScan.health', { defaultValue: 'Health' })}
              </Btn>
            </div>
          </Field>

          {error && <Msg tone="err">{error}</Msg>}

          {health && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone={health.state === 'healthy' ? 'ok' : health.state === 'broken' ? 'err' : 'warn'}>
                {t('linkScan.healthState', { defaultValue: 'Health' })}: {health.state ?? 'unknown'}
                {health.statusCode ? ` (${health.statusCode})` : ''}
              </Badge>
            </div>
          )}

          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge tone={riskTone(result.risk)}>
                  {t('linkScan.risk', { defaultValue: 'Risk' })}: {result.risk ?? t('linkScan.none', { defaultValue: 'none' })}
                </Badge>
              </div>
              {result.sanitized && (
                <p style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--t2)', margin: 0 }}>
                  {t('linkScan.sanitized')}: {result.sanitized}
                </p>
              )}
              {(result.flags ?? []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(result.flags ?? []).map((f) => (
                    <Badge key={f} tone="warn">{f}</Badge>
                  ))}
                </div>
              )}
              {(result.flags ?? []).length === 0 && !result.risk && (
                <Msg tone="info">{t('linkScan.clean', { defaultValue: 'URL appears clean' })}</Msg>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title={t('linkScan.recentHealth', { defaultValue: 'Recent link health checks' })} style={{ marginTop: 16 }}>
        {logLoading ? <Loading /> : healthLog.length === 0 ? (
          <Msg tone="info">{t('linkScan.noHealthLog', { defaultValue: 'No health checks yet — runs automatically every 6 hours' })}</Msg>
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>{t('linkScan.healthState', { defaultValue: 'State' })}</th>
                  <th>HTTP</th>
                  <th>{t('common.date', { defaultValue: 'Date' })}</th>
                </tr>
              </thead>
              <tbody>
                {healthLog.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} dir="ltr" title={row.url}>{row.url}</td>
                    <td>
                      <Badge tone={row.health_state === 'healthy' ? 'ok' : row.health_state === 'broken' ? 'err' : 'warn'}>
                        {row.health_state}
                      </Badge>
                    </td>
                    <td>{row.status_code || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--t3)' }}>{row.checked_at?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Panel>
  );
}
