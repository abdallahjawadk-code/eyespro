import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { useArticles } from '../articles/useArticles';
import type { DocxGroupBy } from '../articles/useArticles';
import { StatusChip } from '../articles/components/ui/StatusChip';
import { formatArticleDate } from '../articles/lib/format';

type Store = ReturnType<typeof useArticles>;

type Props = {
  store: Store;
  onFocus: (id: number) => void;
};

const GROUP_OPTIONS: { value: DocxGroupBy; label: string; desc: string }[] = [
  { value: 'source',   label: 'حسب المصدر',   desc: 'تجميع المقالات في فصول بحسب مصدرها' },
  { value: 'category', label: 'حسب الفئة',    desc: 'تجميع المقالات في فصول بحسب تصنيفها' },
  { value: 'status',   label: 'حسب الحالة',   desc: 'تجميع المقالات في فصول بحسب حالتها' },
  { value: 'none',     label: 'بدون تجميع',   desc: 'المقالات بالترتيب بدون فصول' },
];

export function DownloadPane({ store, onFocus }: Props) {
  const { t, i18n } = useTranslation();
  const [groupBy, setGroupBy] = useState<DocxGroupBy>('source');

  const {
    rows,
    stats,
    filters,
    patchFilters,
    downloadingBulk,
    downloadAllFiltered,
    selected,
    bulkDownload,
  } = store;

  const pending = rows.filter((a) => a.status === 'pending');
  const draft   = rows.filter((a) => a.status === 'draft');

  const hasSelection = selected.size > 0;

  return (
    <div className="ed-publish">
      {/* Stats cards */}
      <div className="ed-publish-cards">
        <div className="ed-publish-card ed-publish-card--warn">
          <strong>{stats.pending}</strong>
          <span>{t('articles.statusPending')}</span>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => patchFilters({ status: 'pending', page: 1 })}
          >
            {t('editorial.showPending')}
          </button>
        </div>
        <div className="ed-publish-card ed-publish-card--ok">
          <strong>{stats.published}</strong>
          <span>{t('articles.statusPublished')}</span>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => patchFilters({ status: 'published', page: 1 })}
          >
            {t('editorial.showPublished')}
          </button>
        </div>
        <div className="ed-publish-card">
          <strong>{stats.draft}</strong>
          <span>{t('articles.statusDraft')}</span>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => patchFilters({ status: 'draft', page: 1 })}
          >
            {t('editorial.showDraft', { defaultValue: 'عرض المسودات' })}
          </button>
        </div>
      </div>

      {/* Download options */}
      <section className="ed-publish-section">
        <header className="ed-publish-section-hdr">
          <div>
            <h2>{t('download.sectionTitle', { defaultValue: 'تحميل المقالات كـ Word (.docx)' })}</h2>
            <p>{t('download.sectionHint', { defaultValue: 'اختر طريقة التجميع ثم حمّل المقالات المعروضة أو المحددة' })}</p>
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>
            {t('download.groupByLabel', { defaultValue: 'ترتيب المقالات في الملف حسب:' })}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {GROUP_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1.5px solid ${groupBy === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: groupBy === opt.value ? 'var(--accent-soft, rgba(37,99,235,.08))' : 'transparent',
                  transition: 'border-color .15s, background .15s',
                }}
              >
                <input
                  type="radio"
                  name="groupBy"
                  value={opt.value}
                  checked={groupBy === opt.value}
                  onChange={() => setGroupBy(opt.value)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 13, display: 'block' }}>{opt.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {hasSelection ? (
            <button
              type="button"
              className="ed-btn ed-btn--accent"
              disabled={downloadingBulk}
              onClick={() => void bulkDownload(groupBy)}
            >
              {downloadingBulk
                ? t('common.loading', { defaultValue: 'جاري التحميل…' })
                : t('download.downloadSelected', { defaultValue: `⬇ تحميل المحدد (${selected.size})` }).replace('(', `(${selected.size})`)}
            </button>
          ) : null}
          <button
            type="button"
            className="ed-btn ed-btn--accent"
            disabled={downloadingBulk}
            onClick={() => void downloadAllFiltered(groupBy)}
          >
            {downloadingBulk
              ? t('common.loading', { defaultValue: 'جاري التحميل…' })
              : filters.status !== 'all' || filters.category !== 'all' || filters.source !== 'all' || filters.search
              ? t('download.downloadFiltered', { defaultValue: '⬇ تحميل النتائج المُصفَّاة' })
              : t('download.downloadAll', { defaultValue: '⬇ تحميل جميع المقالات' })}
          </button>
        </div>
      </section>

      {/* Pending articles quick list */}
      {pending.length > 0 && (
        <section className="ed-publish-section">
          <header className="ed-publish-section-hdr">
            <div>
              <h2>{t('editorial.publishQueue', { defaultValue: 'مقالات معلّقة' })}</h2>
              <p>{t('editorial.publishQueueHint', { defaultValue: 'مقالات جاهزة للمعالجة أو التحميل' })}</p>
            </div>
          </header>
          <ul className="ed-publish-list">
            {pending.slice(0, 10).map((a) => (
              <li key={a.id}>
                <button type="button" className="ed-publish-row" onClick={() => onFocus(a.id)}>
                  <span className="ed-publish-row-title">{a.title || t('articles.untitled')}</span>
                  <StatusChip status={a.status} />
                  <span className="ed-muted">{formatArticleDate(a.updated_at, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Draft articles quick list */}
      {draft.length > 0 && (
        <section className="ed-publish-section">
          <header>
            <h2>{t('articles.statusDraft', { defaultValue: 'مسودات' })}</h2>
          </header>
          <ul className="ed-publish-list ed-publish-list--compact">
            {draft.slice(0, 8).map((a) => (
              <li key={a.id}>
                <button type="button" className="ed-publish-row" onClick={() => onFocus(a.id)}>
                  <span className="ed-publish-row-title">{a.title || t('articles.untitled')}</span>
                  <span className="ed-muted">{formatArticleDate(a.updated_at, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
