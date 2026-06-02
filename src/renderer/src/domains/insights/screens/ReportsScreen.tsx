import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Card, Msg, Panel, Toolbar } from '../../../ui';

export function ReportsScreen() {
  const { t } = useTranslation();
  const [html, setHtml]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async (period: 'weekly' | 'monthly') => {
    setLoading(true);
    setError('');
    setHtml('');
    try {
      const res = await window.eyespro.reports.html(period);
      if (res.ok && res.data?.html) {
        setHtml(res.data.html);
      } else {
        setError(t('reports.loadError', { defaultValue: 'Failed to generate report' }));
      }
    } catch {
      setError(t('reports.loadError', { defaultValue: 'Failed to generate report' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load('weekly')}  disabled={loading}>{t('reports.weekly')}</Btn>
        <Btn onClick={() => void load('monthly')} disabled={loading}>{t('reports.monthly')}</Btn>
      </Toolbar>

      {error && <Msg tone="err" style={{ marginBottom: 12 }}>{error}</Msg>}

      <Card title={t('nav.reports')}>
        {loading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            {t('reports.generating', { defaultValue: 'Generating…' })}
          </div>
        ) : html ? (
          <iframe
            title="report"
            srcDoc={html}
            sandbox="allow-same-origin"
            style={{
              width: '100%', minHeight: 480,
              border: '1px solid var(--border)', borderRadius: 12,
            }}
          />
        ) : (
          <p style={{ color: 'var(--t2)', fontSize: 13 }}>
            {t('reports.pickPeriod')}
          </p>
        )}
      </Card>
    </Panel>
  );
}
