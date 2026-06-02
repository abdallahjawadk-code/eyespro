import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './kanban.css';

interface ArticleRow {
  id: number;
  title: string;
  status: string;
  category?: string | null;
  source_name?: string | null;
  created_at?: string;
  sentiment?: string | null;
}

type KanbanStatus = 'draft' | 'pending' | 'published' | 'archived';

const COLUMNS: { key: KanbanStatus; labelKey: string; icon: string; color: string }[] = [
  { key: 'draft',     labelKey: 'articles.statusDraft',     icon: '✏️', color: '#6366f1' },
  { key: 'pending',   labelKey: 'articles.statusPending',   icon: '⏳', color: '#f59e0b' },
  { key: 'published', labelKey: 'articles.statusPublished', icon: '✅', color: '#22c55e' },
  { key: 'archived',  labelKey: 'articles.statusArchived',  icon: '📦', color: '#64748b' },
];

const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral:  '#94a3b8',
};

function KanbanCard({
  article,
  onDragStart,
  onDragEnd,
}: {
  article: ArticleRow;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}) {
  const navigate = useNavigate();
  const sentColor = article.sentiment ? SENTIMENT_COLORS[article.sentiment] ?? '#94a3b8' : '#94a3b8';

  return (
    <div
      className="kb-card"
      draggable
      onDragStart={() => onDragStart(article.id)}
      onDragEnd={onDragEnd}
      onClick={() => navigate(`/articles/${article.id}`)}
    >
      {article.sentiment && (
        <span className="kb-card-sent" style={{ background: sentColor + '22', color: sentColor }}>
          ● {article.sentiment}
        </span>
      )}
      <p className="kb-card-title">{article.title}</p>
      <div className="kb-card-meta">
        {article.category && <span className="kb-tag">{article.category}</span>}
        {article.source_name && <span className="kb-source">{article.source_name}</span>}
      </div>
      {article.created_at && (
        <div className="kb-card-date">
          {new Date(article.created_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  col,
  articles,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  col: typeof COLUMNS[number];
  articles: ArticleRow[];
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (status: KanbanStatus) => void;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`kb-col ${dragOver ? 'drag-over' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop(col.key); }}
    >
      <div className="kb-col-header" style={{ borderTopColor: col.color }}>
        <span className="kb-col-icon">{col.icon}</span>
        <span className="kb-col-title">{t(col.labelKey, { defaultValue: col.key })}</span>
        <span className="kb-col-count" style={{ background: col.color + '22', color: col.color }}>
          {articles.length}
        </span>
      </div>
      <div className="kb-col-body">
        {articles.map(a => (
          <KanbanCard
            key={a.id}
            article={a}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {articles.length === 0 && (
          <div className="kb-col-empty">
            {dragOver
              ? t('kanban.dropHere', { defaultValue: 'إسقط هنا' })
              : t('kanban.empty', { defaultValue: 'لا توجد مقالات' })}
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [_movingId, setMovingId] = useState<number | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.eyespro.articles.list({ limit: 200 });
      if (res.ok && Array.isArray(res.data)) {
        setArticles(res.data as ArticleRow[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDrop = useCallback(async (targetStatus: KanbanStatus) => {
    if (draggingId === null) return;
    const article = articles.find(a => a.id === draggingId);
    if (!article || article.status === targetStatus) return;

    setMovingId(draggingId);
    // Optimistic update
    setArticles(prev => prev.map(a => a.id === draggingId ? { ...a, status: targetStatus } : a));

    try {
      await window.eyespro.articles.update(draggingId, { status: targetStatus });
      showToast(t('kanban.moved', { defaultValue: 'تم نقل المقال' }));
    } catch {
      // Revert
      setArticles(prev => prev.map(a => a.id === draggingId ? { ...a, status: article.status } : a));
      showToast(t('kanban.moveFailed', { defaultValue: 'فشل النقل' }));
    }
    setMovingId(null);
    setDraggingId(null);
  }, [draggingId, articles, t]);

  const byStatus = (status: KanbanStatus) =>
    articles.filter(a => (a.status || 'draft') === status);

  return (
    <div className="kb-root">
      {/* Header */}
      <div className="kb-header">
        <h2 className="kb-title">
          📋 {t('kanban.title', { defaultValue: 'لوحة المقالات' })}
        </h2>
        <button className="kb-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? '⏳' : '↻'} {t('common.refresh', { defaultValue: 'تحديث' })}
        </button>
      </div>

      {loading ? (
        <div className="kb-loading">⏳ {t('common.loading', { defaultValue: 'جاري التحميل…' })}</div>
      ) : (
        <div className="kb-board">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.key}
              col={col}
              articles={byStatus(col.key)}
              onDragStart={id => setDraggingId(id)}
              onDragEnd={() => setDraggingId(null)}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="kb-toast">{toast}</div>
      )}
    </div>
  );
}
