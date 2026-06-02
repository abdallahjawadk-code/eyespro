import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Card, Empty, Loading, Panel, Toolbar } from '../../../ui';
import type { ArticleRow } from '../../../../../shared/api-types';

type GroupBy = 'source' | 'category' | 'status' | 'none';

export function CalendarScreen() {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('source');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [listRes, catRes] = await Promise.all([
      window.eyespro.articles.list({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        pageSize: 200,
      }),
      window.eyespro.articles.categories(),
    ]);
    if (listRes.ok && listRes.data) setArticles(listRes.data);
    if (catRes.ok && catRes.data) setCategories(catRes.data as string[]);
    setLoading(false);
  }, [categoryFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  async function download() {
    if (!articles.length) return;
    setMsg(null);
    setDownloading(true);
    try {
      const ids = articles.map((a) => a.id);
      const r = await window.eyespro.articles.downloadDocx(ids, {
        groupBy,
        title: buildTitle(statusFilter, categoryFilter, groupBy),
        toDesktop: false,
      });
      if (r.ok) {
        const count = (r.data as { count: number })?.count ?? ids.length;
        setMsg(t('download.success', { count, defaultValue: `✓ Downloaded ${count} articles` }));
      } else if (r.error !== 'cancelled') {
        setMsg(r.error ?? t('download.failed', { defaultValue: 'Download failed' }));
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻ {t('common.refresh')}</Btn>
      </Toolbar>

      <div className="ui-grid ui-grid--2">
        <Card title={t('download.filterTitle', { defaultValue: 'Filter & download' })}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                {t('articles.colStatus', { defaultValue: 'Status' })}
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--border)' }}
              >
                <option value="all">{t('common.all', { defaultValue: 'All' })}</option>
                <option value="draft">{t('articles.statusDraft', { defaultValue: 'Draft' })}</option>
                <option value="pending">{t('articles.statusPending', { defaultValue: 'Pending' })}</option>
                <option value="published">{t('articles.statusPublished', { defaultValue: 'Published' })}</option>
                <option value="archived">{t('articles.statusArchived', { defaultValue: 'Archived' })}</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                {t('articles.colCategory', { defaultValue: 'Category' })}
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--border)' }}
              >
                <option value="all">{t('common.all', { defaultValue: 'All' })}</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                {t('download.groupByLabel', { defaultValue: 'Order articles in the file by:' })}
              </label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--border)' }}
              >
                <option value="source">{t('download.groupBySource', { defaultValue: 'Source' })}</option>
                <option value="category">{t('download.groupByCategory', { defaultValue: 'Category' })}</option>
                <option value="status">{t('download.groupByStatus', { defaultValue: 'Status' })}</option>
                <option value="none">{t('download.groupByNone', { defaultValue: 'No grouping' })}</option>
              </select>
            </div>

            {msg && (
              <p style={{ fontSize: 13, color: msg.startsWith('✓') ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)', padding: '8px 12px', borderRadius: 6, background: 'var(--bg2)' }}>
                {msg}
              </p>
            )}

            <Btn
              variant="primary"
              disabled={!articles.length || downloading}
              onClick={() => void download()}
            >
              {downloading
                ? t('common.loading', { defaultValue: 'Loading…' })
                : `⬇ ${t('download.downloadBtn', { defaultValue: 'Download' })} ${articles.length} ${t('download.articles', { defaultValue: 'articles' })}`}
            </Btn>
          </div>
        </Card>

        <Card title={t('download.previewTitle', { defaultValue: 'Selected articles' })}>
          {loading ? (
            <Loading />
          ) : articles.length === 0 ? (
            <Empty title={t('articles.empty', { defaultValue: 'No articles' })} icon="📄" />
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
                {articles.length} {t('download.articles', { defaultValue: 'articles' })}
              </p>
              {articles.slice(0, 30).map((a) => (
                <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{a.title || t('articles.untitled')}</span>
                  {a.category && (
                    <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 8 }}>• {a.category}</span>
                  )}
                </div>
              ))}
              {articles.length > 30 && (
                <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8 }}>
                  +{articles.length - 30} {t('download.more', { defaultValue: 'more…' })}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </Panel>
  );
}

function buildTitle(status: string, category: string, groupBy: GroupBy): string {
  const parts: string[] = [];
  if (status !== 'all') parts.push(status === 'published' ? 'Published' : status === 'pending' ? 'Pending' : status === 'draft' ? 'Draft' : status);
  if (category !== 'all') parts.push(category);
  const base = parts.length ? parts.join(' — ') : 'All articles';
  const g = groupBy === 'source' ? 'Grouped by source' : groupBy === 'category' ? 'Grouped by category' : groupBy === 'status' ? 'Grouped by status' : '';
  return g ? `${base} (${g})` : base;
}
