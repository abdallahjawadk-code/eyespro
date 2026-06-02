import { useCallback, useMemo } from 'react';
import '../articles/articles.css';
import type { useArticles } from '../articles/useArticles';
import type { ArticleRobotDragProps } from '../../../articles/components/ArticleRobotAssistant';
import { InsightsBar } from '../articles/components/InsightsBar';
import { CommandBar } from '../articles/components/CommandBar';
import { FilterBar } from '../articles/components/FilterBar';
import { ArticleTile } from '../articles/components/ArticleTile';
import { ArticleTable } from '../articles/components/ArticleTable';
import { EmptyState } from '../articles/components/EmptyState';
import { LoadingState } from '../articles/components/LoadingState';
import { PageNav } from '../articles/components/PageNav';

type Store = ReturnType<typeof useArticles>;

type Props = {
  store: Store;
  focusId?: number | null;
  onFocus?: (id: number) => void;
  onSendToPipeline?: (id: number) => void;
  robotDrag?: ArticleRobotDragProps;
};

export function LibraryPane({ store, focusId, onFocus, onSendToPipeline, robotDrag }: Props) {
  const { rows, loading, viewMode, filters } = store;

  const isFiltered = useMemo(
    () =>
      filters.status !== 'all' ||
      filters.category !== 'all' ||
      filters.source !== 'all' ||
      filters.search.trim() !== '',
    [filters]
  );

  const handleFocus = useCallback(
    (id: number) => {
      store.setPreviewId(id);
      onFocus?.(id);
    },
    [onFocus, store]
  );

  return (
    <div className="ed-library ax-compact">
      <InsightsBar store={store} />
      <CommandBar store={store} />
      <FilterBar store={store} />

      <div className="ed-library-stream">
        {loading ? (
          <LoadingState mode={viewMode} />
        ) : rows.length === 0 ? (
          <EmptyState filtered={isFiltered} />
        ) : viewMode === 'grid' ? (
          <div className="ax-grid ax-grid--cards">
            {rows.map((article, index) => (
              <ArticleTile
                key={article.id}
                article={article}
                index={index}
                store={store}
                onArticleFocus={onFocus ? handleFocus : undefined}
                focusArticleId={focusId}
                onSendToPipeline={onSendToPipeline}
                robotDrag={robotDrag}
              />
            ))}
          </div>
        ) : (
          <ArticleTable rows={rows} store={store} robotDrag={robotDrag} />
        )}

        {!loading && rows.length > 0 && <PageNav store={store} />}
      </div>
    </div>
  );
}
