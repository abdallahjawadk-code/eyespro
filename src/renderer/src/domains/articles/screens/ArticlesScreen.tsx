import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../editorial/workspace/articles/articles.css';
import { useArticles } from '../../editorial/workspace/articles/useArticles';
import { LibraryPane } from '../../editorial/workspace/components/LibraryPane';
import { MergedToasts } from '../../editorial/workspace/components/MergedToasts';
import { SelectionDock } from '../../editorial/workspace/articles/components/SelectionDock';
import { usePipeline } from '../../editorial/workspace/pipeline/usePipeline';
import { ArticleRobotAssistant } from '../components/ArticleRobotAssistant';
import { Btn } from '../../../ui';
import '../articles-page.css';

export function ArticlesScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const articles = useArticles(t);
  const pipeline = usePipeline(t);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const robotDrag = {
    draggingId,
    onDragStart: (id: number) => setDraggingId(id),
    onDragEnd: () => setDraggingId(null),
  };

  return (
    <div className="articles-full-page">
      <header className="articles-full-page__hdr">
        <div>
          <p className="articles-full-page__eyebrow">{t('nav.groupWorkflow')}</p>
          <h1 className="articles-full-page__title">{t('nav.articlesContent')}</h1>
          <p className="articles-full-page__desc">{t('articlesPage.description')}</p>
        </div>
        <div className="articles-full-page__actions">
          <Btn variant="primary" onClick={() => navigate('/articles/new')}>
            + {t('articles.new')}
          </Btn>
        </div>
      </header>

      <div className="ed-root articles-full-page__body">
        <div className="ed-layout ed-layout--articles">
          <div className="ed-main ed-main--full">
            <div className="ed-stage">
              <div className="ed-canvas">
                <LibraryPane store={articles} robotDrag={robotDrag} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <SelectionDock store={articles} />
      <MergedToasts articles={articles} pipeline={pipeline} />

      <ArticleRobotAssistant
        articles={articles.rows}
        onRefresh={articles.refresh}
        drag={robotDrag}
      />
    </div>
  );
}
