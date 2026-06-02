import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ArticleFull } from '../types';
import { articleExcerpt, formatArticleDate } from '../lib/format';
import { StatusChip } from './ui/StatusChip';
import { SentimentChip } from './ui/SentimentChip';
import { QuickShareBar } from '../../../../../domains/social';

type Props = {
  article: ArticleFull;
  onClose: () => void;
  onDelete: () => void;
};

const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconExternalLink = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);



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

export function DetailPanel({ article, onClose, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const initial = (article.title || '?').trim()[0]?.toUpperCase() ?? '?';
  const excerpt = articleExcerpt(article, 320);

  return (
    <>
      <button
        type="button"
        className="ax-detail-backdrop"
        onClick={onClose}
        aria-label={t('common.cancel')}
      />
      <aside className="ax-detail" role="dialog" aria-modal="true" aria-labelledby="ax-detail-title">
        <div className="ax-detail-visual">
          {article.image_url ? (
            <img src={article.image_url} alt="" />
          ) : (
            <span className="ax-detail-letter">{initial}</span>
          )}
          {article.image_url && <div className="ax-detail-visual-shade" />}
          <button type="button" className="ax-detail-close" onClick={onClose} aria-label={t('common.cancel')}>
            <IconClose />
          </button>
        </div>

        <div className="ax-detail-scroll">
          <p className="ax-detail-kicker">Article #{article.id}</p>
          <h2 id="ax-detail-title">{article.title || t('articles.untitled')}</h2>

          <div className="ax-detail-chips">
            <StatusChip status={article.status} />
            <SentimentChip sentiment={article.sentiment} />
            {article.processing_status && (
              <span className="ax-chip ax-chip--pipe">{article.processing_status}</span>
            )}
          </div>

          <dl className="ax-detail-stats">
            <dt>{t('articles.colCategory')}</dt>
            <dd>{article.category || '—'}</dd>
            <dt>{t('articles.fieldSource')}</dt>
            <dd>{article.source || '—'}</dd>
            <dt>{t('articles.colWords')}</dt>
            <dd>{(article.word_count ?? 0).toLocaleString()}</dd>
            <dt>{t('articles.colUpdated')}</dt>
            <dd>{formatArticleDate(article.updated_at, i18n.language)}</dd>
            <dt>{t('articles.sortCreated')}</dt>
            <dd>{formatArticleDate(article.created_at, i18n.language)}</dd>
          </dl>

          {excerpt && (
            <section className="ax-detail-section">
              <h3>{t('articles.fieldSummary')}</h3>
              <p>{excerpt}</p>
            </section>
          )}

          {article.link && (
            <a className="ax-detail-link" href={article.link} target="_blank" rel="noreferrer">
              <IconExternalLink />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {article.link}
              </span>
            </a>
          )}

          <div className="ax-detail-actions">
            <Link to={`/articles/${article.id}`} className="ax-btn ax-btn--primary ax-btn--block">
              <IconEdit />
              {t('articles.openInEditor')}
            </Link>
            <QuickShareBar
              articleId={article.id}
              title={article.title ?? ''}
              summary={article.summary ?? ''}
              content={article.content ?? ''}
              sourceUrl={article.link ?? ''}
              imageUrl={article.image_url ?? ''}
            />
            <button type="button" className="ax-btn ax-btn--danger ax-btn--block" onClick={onDelete}>
              <IconTrash />
              {t('articles.delete')}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
