import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleRow } from '../../../../../shared/api-types';
import { Btn, Card, Field, Loading, Msg, Panel, Select, Toolbar } from '../../../ui';

type GroupBy = 'source' | 'category' | 'status' | 'none';

const GROUP_OPTION_KEYS: { value: GroupBy; labelKey: string }[] = [
  { value: 'source',   labelKey: 'download.groupBySource' },
  { value: 'category', labelKey: 'download.groupByCategory' },
  { value: 'status',   labelKey: 'download.groupByStatus' },
  { value: 'none',     labelKey: 'download.groupByNone' },
];

export function PublishNowScreen() {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>('source');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const a = await window.eyespro.articles.list({ pageSize: 200 });
    if (a.ok && a.data) setArticles(a.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleArticle(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function selectAll() {
    setSelected(new Set(articles.map((a) => a.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function onDownload() {
    if (!selected.size) return;
    setMsg(null);
    setDownloading(true);
    try {
      const r = await window.eyespro.articles.downloadDocx([...selected], {
        groupBy,
        title: t('download.batchTitle'),
        toDesktop: false,
      });
      if (r.ok) {
        const count = (r.data as { count: number })?.count ?? selected.size;
        setMsg({ ok: true, text: t('download.success', { count }) });
      } else if (r.error !== 'cancelled') {
        setMsg({ ok: false, text: r.error ?? t('download.failed') });
      }
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻ {t('common.refresh')}</Btn>
      </Toolbar>

      <div className="ui-grid ui-grid--2">
        <Card title={t('download.sectionTitle')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <Field label={t('download.groupByLabel')}>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                {GROUP_OPTION_KEYS.map((o) => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </Select>
            </Field>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('download.selectArticles')}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--accent)' }} onClick={selectAll}>
                    {t('common.selectAll')}
                  </button>
                  <button type="button" style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--t3)' }} onClick={clearAll}>
                    {t('common.cancel')}
                  </button>
                </span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0' }}>
                {articles.length === 0 ? (
                  <p style={{ padding: '12px 16px', color: 'var(--t3)', fontSize: 13 }}>
                    {t('articles.empty')}
                  </p>
                ) : (
                  articles.map((a) => (
                    <label
                      key={a.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 14px',
                        cursor: 'pointer',
                        fontSize: 13,
                        background: selected.has(a.id) ? 'var(--accent-soft, rgba(37,99,235,.06))' : 'transparent',
                        borderLeft: selected.has(a.id) ? '3px solid var(--accent)' : '3px solid transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleArticle(a.id)}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.title || t('articles.untitled')}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
                {selected.size} {t('download.selectedCount')}
              </p>
            </div>

            {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}

            <Btn
              variant="primary"
              disabled={!selected.size || downloading}
              onClick={() => void onDownload()}
            >
              {downloading ? '…' : `${t('download.downloadBtn')} (${selected.size})`}
            </Btn>
          </div>
        </Card>

        <Card title={t('download.tipTitle')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--t2)' }}>
            <p>{t('download.tip1')}</p>
            <p>{t('download.tip2')}</p>
            <p>{t('download.tip3')}</p>
            <p>{t('download.tip4')}</p>
          </div>
        </Card>
      </div>
    </Panel>
  );
}
