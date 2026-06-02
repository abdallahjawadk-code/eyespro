import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './shortcuts-help.css';

export function ShortcutsHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' || e.key === '?' || e.key === 'Slash') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const list = [
    { keys: ['Ctrl', 'K'], desc: t('shortcuts.palette', { defaultValue: 'فتح لوحة التحكم السريعة' }) },
    { keys: ['?'], desc: t('shortcuts.help', { defaultValue: 'فتح دليل الاختصارات هذا' }) },
    { keys: ['Esc'], desc: t('shortcuts.close', { defaultValue: 'إغلاق النوافذ العائمة' }) },
    { keys: ['Alt', 'N'], desc: t('shortcuts.newArticle', { defaultValue: 'إنشاء مقال جديد' }) },
    { keys: ['Alt', 'S'], desc: t('shortcuts.settings', { defaultValue: 'الذهاب إلى الإعدادات' }) },
    { keys: ['Alt', 'A'], desc: t('shortcuts.analytics', { defaultValue: 'الذهاب إلى التحليلات' }) }
  ];

  return (
    <div className="sh-overlay" onClick={onClose}>
      <div className="sh-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sh-header">
          <h3>⌨️ {t('shortcuts.title', { defaultValue: 'اختصارات لوحة المفاتيح' })}</h3>
          <button type="button" className="sh-close" onClick={onClose}>×</button>
        </div>
        <div className="sh-body">
          <div className="sh-grid">
            {list.map((item, idx) => (
              <div key={idx} className="sh-row">
                <div className="sh-keys">
                  {item.keys.map((k, kidx) => (
                    <span key={kidx} className="sh-key">
                      {k}
                    </span>
                  ))}
                </div>
                <div className="sh-desc">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="sh-footer">
          <span>{t('shortcuts.helper', { defaultValue: 'اضغط على ? أو Esc للإغلاق في أي وقت' })}</span>
        </div>
      </div>
    </div>
  );
}
