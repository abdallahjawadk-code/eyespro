import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { COMMAND_ENTRIES } from '../../core/navigation';
import './command-palette.css';

interface CommandItem {
  icon: string;
  label: string;
  action: () => void;
  category: string;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [articles, setArticles] = useState<{ id: number; title: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setArticles([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Search articles dynamically
  useEffect(() => {
    if (!query.trim()) {
      setArticles([]);
      return;
    }
    const timer = setTimeout(() => {
      window.eyespro.articles
        .search(query, 5)
        .then((res) => {
          if (res.ok && Array.isArray(res.data)) {
            setArticles(res.data.map((a: unknown) => { const r = a as { id: number; title: string }; return { id: r.id, title: r.title }; }));
          }
        })
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const commands: CommandItem[] = COMMAND_ENTRIES.map((entry) => ({
    icon: entry.icon,
    label: t(entry.labelKey, {
      defaultValue:
        entry.labelKey === 'health.title' ? 'صحة المصادر'
        : entry.labelKey === 'kanban.title' ? 'لوحة المقالات'
        : entry.labelKey === 'publish.tracker.title' ? 'تتبع النشر'
        : entry.labelKey === 'theme.toggle' ? 'تبديل المظهر'
        : undefined,
    }),
    category: t(entry.groupKey),
    action: () => {
      if (entry.action === 'theme') {
        toggle();
      } else if (entry.action === 'welcome') {
        navigate('/');
      } else if (entry.to) {
        if (entry.settingsTab) {
          navigate(entry.to, { state: { tab: entry.settingsTab } });
        } else {
          navigate(entry.to);
        }
      }
    },
  }));

  const allItems = useMemo(() => {
    const filtered = commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(query.toLowerCase())
    );
    const artItems: CommandItem[] = articles.map((art) => ({
      icon: '📄',
      label: art.title,
      action: () => navigate(`/articles/${art.id}`),
      category: t('nav.publishArticles')
    }));
    return [...filtered, ...artItems];
  }, [commands, query, articles, navigate, t]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % allItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (allItems[selectedIndex]) {
          allItems[selectedIndex].action();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, allItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-search-header">
          <span className="cmd-search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="cmd-input"
            placeholder={t('cmd.searchPlaceholder', { defaultValue: 'بحث... (Esc للخروج)' })}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>
        <div className="cmd-results">
          {allItems.length === 0 ? (
            <div className="cmd-empty">{t('common.noResults', { defaultValue: 'لا توجد نتائج' })}</div>
          ) : (
            <div>
              {/* Group items by category */}
              {Array.from(new Set(allItems.map((item) => item.category))).map((cat) => (
                <div key={cat} className="cmd-group">
                  <div className="cmd-group-title">{cat}</div>
                  {allItems
                    .map((item, index) => ({ item, index }))
                    .filter(({ item }) => item.category === cat)
                    .map(({ item, index }) => (
                      <div
                        key={index}
                        className={`cmd-item ${index === selectedIndex ? 'active' : ''}`}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                      >
                        <span className="cmd-item-icon">{item.icon}</span>
                        <span className="cmd-item-label">{item.label}</span>
                        {index === selectedIndex && (
                          <span className="cmd-item-hint">⏎</span>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cmd-footer">
          <span>{t('common.navigate', { defaultValue: '↑↓ للتنقل' })}</span>
          <span>{t('common.select', { defaultValue: '⏎ للاختيار' })}</span>
          <span>{t('common.close', { defaultValue: 'Esc للإغلاق' })}</span>
        </div>
      </div>
    </div>
  );
}
