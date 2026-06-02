import '../pipeline/pipeline.css';
import { ProcessPane as NewProcessPane } from '../pipeline/components/ProcessPane';
import { AiToolsPanel } from './AiToolsPanel';
import type { usePipeline } from '../pipeline/usePipeline';
import type { useAiTools } from '../useAiTools';

type Store = ReturnType<typeof usePipeline>;
type AiStore = ReturnType<typeof useAiTools>;

type Props = {
  store: Store;
  ai: AiStore;
  focusId: number | null;
  selectedIds: number[];
  onArticleOpen: (id: number) => void;
};

export function ProcessPane({ store, ai, focusId, selectedIds, onArticleOpen }: Props) {
  return (
    <div className="ed-process">
      <AiToolsPanel ai={ai} focusId={focusId} selectedIds={selectedIds} />
      <NewProcessPane store={store} focusId={focusId} selectedIds={selectedIds} onArticleOpen={onArticleOpen} />
    </div>
  );
}
