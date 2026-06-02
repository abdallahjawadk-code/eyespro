import type { useArticles } from '../articles/useArticles';
import type { usePipeline } from '../pipeline/usePipeline';
import { ToastLayer } from '../articles/components/ui/ToastLayer';

type Props = {
  articles: ReturnType<typeof useArticles>;
  pipeline: ReturnType<typeof usePipeline>;
};

export function MergedToasts({ articles, pipeline }: Props) {
  const merged = [...articles.toasts, ...pipeline.toasts].sort((a, b) => a.id - b.id);
  return <ToastLayer toasts={merged} />;
}
