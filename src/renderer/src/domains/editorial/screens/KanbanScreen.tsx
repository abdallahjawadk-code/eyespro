import { KanbanBoard } from '../workspace';
import '../workspace/articles/kanban.css';

export function KanbanScreen() {
  return (
    <div className="ep-panel--embedded">
      <KanbanBoard />
    </div>
  );
}
