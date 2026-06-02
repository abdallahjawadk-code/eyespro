import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './editorial.css';
import { parseEditorialPhase, type EditorialPhase } from './types';
import { useArticles } from './articles/useArticles';
import { usePipeline } from './pipeline/usePipeline';
import { useAiTools } from './useAiTools';
import { WorkflowRail } from './components/WorkflowRail';
import { EditorialTopBar } from './components/EditorialTopBar';
import { LibraryPane } from './components/LibraryPane';
import { ProcessPane } from './components/ProcessPane';
import { DownloadPane } from './components/DownloadPane';
import { ContextDock } from './components/ContextDock';
import { MergedToasts } from './components/MergedToasts';
import { SelectionDock } from './articles/components/SelectionDock';

export type EditorialPageVariant = 'full' | 'production';

type Props = {
  variant?: EditorialPageVariant;
};

export function EditorialPage({ variant = 'full' }: Props) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isProduction = variant === 'production';
  const defaultPhase: EditorialPhase = isProduction ? 'process' : 'collect';
  const articles = useArticles(t);
  const pipeline = usePipeline(t);
  const ai = useAiTools(t);

  const phase = parseEditorialPhase(searchParams.get('phase'), defaultPhase);
  const importedArticles = useRef(false);

  useEffect(() => {
    if (importedArticles.current) return;
    const raw = searchParams.get('articles');
    if (!raw?.trim()) return;
    importedArticles.current = true;
    pipeline.setProcessInput(raw);
    if (isProduction && !searchParams.get('phase')) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('phase', 'process');
        return p;
      }, { replace: true });
    }
  }, [searchParams, pipeline, articles, isProduction, setSearchParams]);

  useEffect(() => {
    if (!isProduction || phase === 'collect') return;
    setSearchParams((prev) => {
      if (prev.get('phase') !== 'collect') return prev;
      const p = new URLSearchParams(prev);
      p.set('phase', 'process');
      return p;
    }, { replace: true });
  }, [isProduction, phase, setSearchParams]);

  const focusId = useMemo(() => {
    const fromUrl = searchParams.get('article');
    if (fromUrl) {
      const n = Number(fromUrl);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return articles.previewId ?? pipeline.drawerArticleId;
  }, [searchParams, articles.previewId, pipeline.drawerArticleId]);

  const setPhase = useCallback(
    (next: EditorialPhase) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('phase', next);
        return p;
      });
    },
    [setSearchParams]
  );

  const setFocus = useCallback(
    (id: number | null) => {
      if (id == null) {
        articles.setPreviewId(null);
        pipeline.closeArticleDrawer();
        setSearchParams((prev) => {
          const p = new URLSearchParams(prev);
          p.delete('article');
          return p;
        });
        return;
      }
      articles.setPreviewId(id);
      void pipeline.openArticleDrawer(id);
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('article', String(id));
        return p;
      });
    },
    [articles, pipeline, setSearchParams]
  );

  useEffect(() => {
    const fromUrl = searchParams.get('article');
    if (!fromUrl) return;
    const n = Number(fromUrl);
    if (!Number.isFinite(n) || n <= 0) return;
    if (articles.previewId !== n) articles.setPreviewId(n);
    if (pipeline.drawerArticleId !== n) void pipeline.openArticleDrawer(n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const downloadFilterInit = useRef(false);
  useEffect(() => {
    if (phase !== 'download') {
      downloadFilterInit.current = false;
      return;
    }
    if (downloadFilterInit.current) return;
    downloadFilterInit.current = true;
   
  }, [phase]);

  const sendSelectedToPipeline = useCallback(() => {
    const ids = [...articles.selected];
    if (!ids.length) return;
    pipeline.setProcessInput(ids.join(', '));
    articles.clearSelection();
    setPhase('process');
  }, [articles, pipeline, setPhase]);

  const hiddenPhases: EditorialPhase[] = isProduction ? ['collect'] : [];

  const refreshAll = useCallback(() => {
    articles.refresh();
    pipeline.refresh();
  }, [articles, pipeline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [articles, setFocus]);

  return (
    <div className="page-content ed-root">
      <div className="ed-layout">
        <WorkflowRail
          phase={phase}
          onPhase={setPhase}
          articles={articles}
          pipeline={pipeline}
          hiddenPhases={hiddenPhases}
        />

        <div className="ed-main">
          <EditorialTopBar
            phase={phase}
            articles={articles}
            pipeline={pipeline}
            onRefresh={refreshAll}
          />

          <div className={`ed-stage${focusId != null ? ' has-context' : ''}`}>
            <div className="ed-canvas">
              {phase === 'collect' && !isProduction && (
                <LibraryPane
                  store={articles}
                  focusId={focusId}
                  onFocus={(id) => setFocus(id)}
                />
              )}
              {phase === 'process' && (
                <ProcessPane
                  store={pipeline}
                  ai={ai}
                  focusId={focusId}
                  selectedIds={[...articles.selected]}
                  onArticleOpen={(id) => setFocus(id)}
                />
              )}
              {phase === 'download' && <DownloadPane store={articles} onFocus={(id) => setFocus(id)} />}
            </div>

            {focusId != null && (
              <ContextDock
                focusId={focusId}
                articles={articles}
                pipeline={pipeline}
                ai={ai}
                onClose={() => setFocus(null)}
                onGoProcess={() => {
                  pipeline.setProcessInput(String(focusId));
                  setPhase('process');
                }}
              />
            )}
          </div>
        </div>
      </div>

      {phase === 'collect' && !isProduction && (
        <SelectionDock store={articles} onSendToPipeline={sendSelectedToPipeline} />
      )}
      <MergedToasts articles={articles} pipeline={pipeline} />
    </div>
  );
}
