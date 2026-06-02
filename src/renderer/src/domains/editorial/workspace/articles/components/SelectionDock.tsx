import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { useArticles } from '../useArticles';
import type { DocxGroupBy } from '../useArticles';

type Store = ReturnType<typeof useArticles>;

type Props = {
  store: Store;
  onSendToPipeline?: () => void;
};

export function SelectionDock({ store, onSendToPipeline }: Props) {
  const { t } = useTranslation();

  const GROUP_OPTIONS: { value: DocxGroupBy; label: string }[] = [
    { value: 'source',   label: t('download.groupBySource',   { defaultValue: 'Source'      }) },
    { value: 'category', label: t('download.groupByCategory', { defaultValue: 'Category'    }) },
    { value: 'status',   label: t('download.groupByStatus',   { defaultValue: 'Status'      }) },
    { value: 'none',     label: t('download.groupByNone',     { defaultValue: 'No grouping' }) },
  ];
  const {
    selected,
    clearSelection,
    bulkGroupBy,
    setBulkGroupBy,
    downloadingBulk,
    bulkDownload,
    bulkDelete,
  } = store;

  const [showGroupBy, setShowGroupBy] = useState(false);

  if (!selected.size) return null;

  return (
    <div className="ax-dock" role="region" aria-label={t('articles.bulkSelected', { n: selected.size })}>
      <div className="ax-dock-inner">
        <div className="ax-dock-badge">{selected.size}</div>
        <span className="ax-dock-label">{t('articles.bulkSelected', { n: selected.size })}</span>

        <div className="ax-dock-sep" aria-hidden />

        {showGroupBy && (
          <div className="ax-dock-fields" style={{ alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>
              {t('download.groupByLabel', { defaultValue: 'Group by:' })}
            </span>
            <select
              value={bulkGroupBy}
              onChange={(e) => setBulkGroupBy(e.target.value as DocxGroupBy)}
              style={{ fontSize: 13, padding: '3px 6px', borderRadius: 6 }}
            >
              {GROUP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="ax-dock-actions">
          {onSendToPipeline && (
            <button type="button" className="ax-btn ax-btn--accent" onClick={onSendToPipeline}>
              {t('editorial.sendToKanban', { n: selected.size })}
            </button>
          )}

          <button
            type="button"
            className="ax-btn ax-btn--primary"
            disabled={downloadingBulk}
            onClick={() => {
              if (!showGroupBy) {
                setShowGroupBy(true);
              } else {
                void bulkDownload();
              }
            }}
          >
            {downloadingBulk
              ? t('common.loading', { defaultValue: 'Loading…' })
              : showGroupBy
              ? t('download.downloadBtn', { defaultValue: '⬇ Download Now' })
              : t('download.downloadSelected', { defaultValue: '⬇ Download as Word' })}
          </button>

          {showGroupBy && (
            <button
              type="button"
              className="ax-btn ax-btn--ghost"
              onClick={() => setShowGroupBy(false)}
            >
              {t('common.cancel')}
            </button>
          )}

          <button type="button" className="ax-btn ax-btn--danger" onClick={() => void bulkDelete()}>
            {t('articles.deleteSelected')}
          </button>
          <button type="button" className="ax-btn ax-btn--ghost" onClick={clearSelection}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
