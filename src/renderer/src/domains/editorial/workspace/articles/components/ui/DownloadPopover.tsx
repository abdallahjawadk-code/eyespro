import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocxGroupBy } from '../../useArticles';

type Props = {
  busy: boolean;
  groupBy: DocxGroupBy;
  onGroupByChange: (g: DocxGroupBy) => void;
  onDownload: () => void;
  onClose: () => void;
};

const GROUP_OPTIONS: { value: DocxGroupBy; labelKey: string }[] = [
  { value: 'source',   labelKey: 'download.groupBySource' },
  { value: 'category', labelKey: 'download.groupByCategory' },
  { value: 'status',   labelKey: 'download.groupByStatus' },
  { value: 'none',     labelKey: 'download.groupByNone' },
];

export function DownloadPopover({ busy, groupBy, onGroupByChange, onDownload, onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div className="ax-popover" ref={ref} role="dialog" onClick={(e) => e.stopPropagation()}>
      <p className="ax-popover-title">
        {t('download.popoverTitle', { defaultValue: 'تحميل كـ Word (.docx)' })}
      </p>

      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6 }}>
          {t('download.groupByLabel', { defaultValue: 'ترتيب المقالات حسب:' })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {GROUP_OPTIONS.map((opt) => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="groupBy"
                value={opt.value}
                checked={groupBy === opt.value}
                onChange={() => onGroupByChange(opt.value)}
              />
              <span>
                {t(opt.labelKey, {
                  defaultValue: {
                    source: 'المصدر',
                    category: 'الفئة',
                    status: 'الحالة',
                    none: 'بدون تجميع',
                  }[opt.value],
                })}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="ax-popover-actions">
        <button
          type="button"
          className="ax-btn ax-btn--primary"
          disabled={busy}
          onClick={onDownload}
        >
          {busy
            ? t('common.loading', { defaultValue: 'جاري التحميل…' })
            : t('download.downloadBtn', { defaultValue: '⬇ تحميل' })}
        </button>
        <button type="button" className="ax-btn ax-btn--ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
