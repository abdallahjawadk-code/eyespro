import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  platforms: string[];
  selected: Set<string>;
  busy: boolean;
  onToggle: (platform: string, on: boolean) => void;
  onPublish: () => void;
  onClose: () => void;
};

export function PublishPopover({ platforms, selected, busy, onToggle, onPublish, onClose }: Props) {
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
      <p className="ax-popover-title">{t('articles.selectPlatforms')}</p>
      {platforms.length === 0 ? (
        <p className="ax-muted">{t('articles.noPlatforms')}</p>
      ) : (
        <ul className="ax-popover-list">
          {platforms.map((p) => (
            <li key={p}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(p)}
                  onChange={(e) => onToggle(p, e.target.checked)}
                />
                <span>{p}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="ax-popover-actions">
        <button type="button" className="ax-btn ax-btn--primary" disabled={!selected.size || busy} onClick={onPublish}>
          {t('articles.publishNow')}
        </button>
        <button type="button" className="ax-btn ax-btn--ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
