import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ArticleFull } from '../types';
import { articleExcerpt, formatArticleDate } from '../lib/format';
import { StatusChip } from './ui/StatusChip';
import { SentimentChip } from './ui/SentimentChip';
import type { useArticles } from '../useArticles';

import type { ArticleRobotDragProps } from '../../../../articles/components/ArticleRobotAssistant';

type Store = ReturnType<typeof useArticles>;

type Props = {
  article: ArticleFull;
  index: number;
  store: Store;
  onArticleFocus?: (id: number) => void;
  focusArticleId?: number | null;
  onSendToPipeline?: (id: number) => void;
  robotDrag?: ArticleRobotDragProps;
};

const STATUS_ACCENT: Record<string, string> = {
  draft: '#64748b',
  pending: '#f59e0b',
  published: '#22c55e',
  archived: '#94a3b8',
};

function SentimentMeter({ score }: { score: number | null | undefined }) {
  if (score == null || Number.isNaN(score)) return null;
  const pct = Math.round(((score + 1) / 2) * 100);
  const tone = score > 0.15 ? 'pos' : score < -0.15 ? 'neg' : 'neu';
  return (
    <div className="ax-card-sent" title={`${score.toFixed(2)}`}>
      <div className="ax-card-sent-track">
        <div className={`ax-card-sent-fill ax-card-sent-fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ArticleTile({
  article,
  index,
  store,
  onArticleFocus,
  focusArticleId,
  onSendToPipeline,
  robotDrag,
}: Props) {
  const { t, i18n } = useTranslation();
  const {
    selected,
    toggleRow,
    previewId,
    setPreviewId,
    deleteArticle,
    downloadArticle,
    downloadingId,
  } = store;

  const isSelected = selected.has(article.id);
  const isFocused = (focusArticleId ?? previewId) === article.id;
  const statusKey = article.status in STATUS_ACCENT ? article.status : 'draft';
  const accent = STATUS_ACCENT[statusKey] ?? STATUS_ACCENT.draft;

  const openArticle = () => {
    if (onArticleFocus) onArticleFocus(article.id);
    else setPreviewId(article.id);
  };

  const initial = (article.title || '?').trim()[0]?.toUpperCase() ?? '?';
  const excerpt = articleExcerpt(article);
  const readingMins = article.word_count ? Math.max(1, Math.round(article.word_count / 200)) : null;
  const hasVideo = Boolean((article.video_url ?? '').trim());
  const isRobotDragging = robotDrag?.draggingId === article.id;

  function onDragStart(e: React.DragEvent) {
    if (!robotDrag) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('articleId', String(article.id));
    robotDrag.onDragStart(article.id);
  }

  function onDragEnd() {
    robotDrag?.onDragEnd();
  }

  return (
    <article
      className={[
        'ax-card',
        isSelected ? 'is-selected' : '',
        isFocused ? 'is-focused' : '',
        article.status === 'pending' ? 'is-live' : '',
        isRobotDragging ? 'is-robot-dragging' : '',
      ].filter(Boolean).join(' ')}
      draggable={Boolean(robotDrag)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        '--ax-card-delay': `${Math.min(index, 16) * 40}ms`,
        '--ax-card-accent': accent,
      } as CSSProperties}
    >
      <div className="ax-card-glow" aria-hidden />

      <label className="ax-card-select" title={t('common.selectAll')}>
        <input type="checkbox" checked={isSelected} onChange={() => toggleRow(article.id)} />
        <span className="ax-card-select-box" aria-hidden />
      </label>

      <div className="ax-card-media">
        {article.image_url ? (
          <img src={article.image_url} alt="" loading="lazy" />
        ) : (
          <div className="ax-card-placeholder">
            <span className="ax-card-letter">{initial}</span>
            <span className="ax-card-placeholder-pattern" aria-hidden />
          </div>
        )}

        <div className="ax-card-media-shade" />

        <div className="ax-card-badges ax-card-badges--top">
          {article.category && <span className="ax-card-badge">{article.category}</span>}
          {hasVideo && <span className="ax-card-badge ax-card-badge--video">🎥</span>}
        </div>

        <div className="ax-card-badges ax-card-badges--bottom">
          <StatusChip status={article.status} />
          {readingMins != null && (
            <span className="ax-card-badge ax-card-badge--muted">{readingMins} min</span>
          )}
        </div>

        <SentimentMeter score={article.sentiment_score} />

        <div className="ax-card-overlay">
          {onArticleFocus && (
            <button type="button" className="ax-card-overlay-btn" onClick={openArticle} title={t('publish.preview')}>
              👁 {t('nav.preview', { defaultValue: 'معاينة' })}
            </button>
          )}
          <Link to={`/articles/${article.id}`} className="ax-card-overlay-btn" title={t('common.edit')}>
            ✏️ {t('common.edit')}
          </Link>
          {onSendToPipeline && (
            <button
              type="button"
              className="ax-card-overlay-btn ax-card-overlay-btn--accent"
              onClick={() => onSendToPipeline(article.id)}
            >
              ⚙️ {t('nav.productionLine')}
            </button>
          )}
        </div>
      </div>

      <div className="ax-card-body ax-card-body--static">
        <div className="ax-card-meta">
          <span className="ax-card-id">#{article.id}</span>
          {article.source && (
            <>
              <span className="ax-card-dot" aria-hidden />
              <span className="ax-card-source">{article.source}</span>
            </>
          )}
          <span className="ax-card-date">{formatArticleDate(article.updated_at, i18n.language)}</span>
        </div>

        <h3 className="ax-card-title">{article.title || t('articles.untitled')}</h3>

        {excerpt && <p className="ax-card-excerpt">{excerpt}</p>}

        <div className="ax-card-stats">
          <span className="ax-card-stat">
            {(article.word_count ?? 0).toLocaleString()} {t('articles.words')}
          </span>
          <SentimentChip sentiment={article.sentiment} />
        </div>
      </div>

      <div className="ax-card-toolbar">
        <Link to={`/articles/${article.id}`} className="ax-card-tool" title={t('common.edit')}>
          ✏️
        </Link>

        <button
          type="button"
          className="ax-card-tool"
          disabled={downloadingId === article.id}
          onClick={() => void downloadArticle(article.id)}
          title={t('download.downloadBtn', { defaultValue: 'تحميل كـ Word' })}
        >
          {downloadingId === article.id ? '⏳' : '⬇'}
        </button>

        {onSendToPipeline && (
          <button
            type="button"
            className="ax-card-tool"
            onClick={() => onSendToPipeline(article.id)}
            title={t('nav.productionLine')}
          >
            ⚙️
          </button>
        )}

        <button
          type="button"
          className="ax-card-tool ax-card-tool--danger"
          onClick={() => void deleteArticle(article.id)}
          title={t('common.delete', { defaultValue: 'حذف' })}
        >
          🗑
        </button>
      </div>
    </article>
  );
}
