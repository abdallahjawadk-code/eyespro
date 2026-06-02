import { EditorialPage } from '../workspace';

/** Full editorial workspace: collect → pipeline → publish */
export function ProductionScreen() {
  return (
    <div className="ep-panel--embedded ep-panel--editorial">
      <EditorialPage />
    </div>
  );
}
