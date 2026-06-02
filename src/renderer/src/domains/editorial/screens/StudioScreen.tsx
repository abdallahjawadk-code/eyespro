import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleRow } from '../../../../../shared/api-types';
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Panel, Select, Toolbar } from '../../../ui';

type GroupBy = 'source' | 'category' | 'status' | 'none';

export function StudioScreen() {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [articleId, setArticleId] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const a = await window.eyespro.articles.list({ status: 'pending', limit: 100 });
    if (a.ok && a.data) setArticles(a.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function downloadOne() {
    if (!articleId) return;
    setMsg(null);
    setDownloading(true);
    try {
      const r = await window.eyespro.articles.downloadDocx([Number(articleId)], { groupBy, toDesktop: false });
      setMsg({ ok: r.ok, text: r.ok ? t('download.successOne') : (r.error ?? t('download.failed')) });
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Panel>
      <Toolbar>
        <span style={{ fontSize: 13, color: 'var(--t2)' }}>{t('editorialPublishHub.tabs.studio')}</span>
        <div style={{ flex: 1 }} />
        <Btn onClick={() => void load()}>↻</Btn>
      </Toolbar>
      <Card title={t('download.sectionTitle')}>
        {articles.length === 0 ? (
          <Empty title={t('dash.emptyPending')} icon="📄" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
            <Field label={t('download.selectArticles')}>
              <Select value={articleId} onChange={(e) => setArticleId(e.target.value)}>
                <option value="">—</option>
                {articles.map((a) => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('download.groupByLabel')}>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="none">{t('download.groupByNone')}</option>
                <option value="source">{t('download.groupBySource')}</option>
                <option value="category">{t('download.groupByCategory')}</option>
                <option value="status">{t('download.groupByStatus')}</option>
              </Select>
            </Field>
            {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}
            <Btn variant="primary" disabled={!articleId || downloading} onClick={() => void downloadOne()}>
              {downloading ? '…' : t('download.downloadBtn')}
            </Btn>
          </div>
        )}
      </Card>
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {articles.slice(0, 8).map((a) => (
          <Badge key={a.id} tone="warn">{a.title.slice(0, 40)}{a.title.length > 40 ? '…' : ''}</Badge>
        ))}
      </div>
    </Panel>
  );
}
