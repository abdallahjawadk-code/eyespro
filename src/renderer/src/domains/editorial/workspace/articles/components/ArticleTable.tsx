import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ArticleFull } from '../types';
import { formatArticleDate } from '../lib/format';
import { StatusChip } from './ui/StatusChip';
import { SentimentChip } from './ui/SentimentChip';
import type { useArticles } from '../useArticles';

import type { ArticleRobotDragProps } from '../../../../articles/components/ArticleRobotAssistant';

type Store = ReturnType<typeof useArticles>;

type Props = {
  rows: ArticleFull[];
  store: Store;
  robotDrag?: ArticleRobotDragProps;
};

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export function ArticleTable({ rows, store, robotDrag }: Props) {
  const { t, i18n } = useTranslation();
  const { selected, toggleRow, toggleAllOnPage, deleteArticle, downloadArticle, downloadingId } = store;

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="ax-table-wrap ax-table-wrap--compact">
      <table className="ax-table ax-table--compact">
        <thead>
          <tr>
            <th className="ax-col-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAllOnPage}
                aria-label={t('common.selectAll')}
              />
            </th>
            <th className="ax-col-title">{t('articles.colTitle')}</th>
            <th className="ax-col-status">{t('articles.colStatus')}</th>
            <th className="ax-col-date">{t('articles.colUpdated')}</th>
            <th className="ax-col-actions">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((article) => {
            const initial = (article.title || '?').trim()[0]?.toUpperCase() ?? '?';
            const isRowSelected = selected.has(article.id);
            const isRobotDragging = robotDrag?.draggingId === article.id;
            return (
              <tr
                key={article.id}
                className={[
                  isRowSelected ? 'is-selected' : '',
                  isRobotDragging ? 'is-robot-dragging' : '',
                ].filter(Boolean).join(' ') || undefined}
                draggable={Boolean(robotDrag)}
                onDragStart={(e) => {
                  if (!robotDrag) return;
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('articleId', String(article.id));
                  robotDrag.onDragStart(article.id);
                }}
                onDragEnd={() => robotDrag?.onDragEnd()}
              >
                <td className="ax-col-check">
                  <input
                    type="checkbox"
                    checked={isRowSelected}
                    onChange={() => toggleRow(article.id)}
                  />
                </td>
                <td className="ax-col-title">
                  <div className="ax-table-cell-title">
                    <div className="ax-table-thumb ax-table-thumb--static" aria-hidden>
                      {article.image_url ? (
                        <img src={article.image_url} alt="" />
                      ) : (
                        initial
                      )}
                    </div>
                    <div className="ax-table-title ax-table-title--static">
                      <span>{article.title || t('articles.untitled')}</span>
                      <small className="ax-table-meta">
                        #{article.id}
                        {article.category ? ` · ${article.category}` : ''}
                        {' · '}{(article.word_count ?? 0).toLocaleString()} {t('articles.words')}
                      </small>
                    </div>
                  </div>
                </td>
                <td className="ax-col-status">
                  <div className="ax-table-status-col">
                    <StatusChip status={article.status} />
                    <SentimentChip sentiment={article.sentiment} />
                  </div>
                </td>
                <td className="ax-col-date ax-muted">
                  {formatArticleDate(article.updated_at, i18n.language)}
                </td>
                <td className="ax-col-actions">
                  <div className="ax-table-actions">
                    <Link
                      to={`/articles/${article.id}`}
                      className="ax-table-icon-btn"
                      title={t('common.edit')}
                    >
                      <IconEdit />
                    </Link>
                    <button
                      type="button"
                      className="ax-table-icon-btn"
                      disabled={downloadingId === article.id}
                      onClick={() => void downloadArticle(article.id)}
                      title={t('download.downloadBtn', { defaultValue: 'تحميل كـ Word' })}
                    >
                      <IconDownload />
                    </button>
                    <button
                      type="button"
                      className="ax-table-icon-btn ax-table-icon-btn--danger"
                      onClick={() => void deleteArticle(article.id)}
                      title={t('common.delete')}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
