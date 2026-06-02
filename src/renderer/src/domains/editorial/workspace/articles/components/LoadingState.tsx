export function LoadingState({ mode }: { mode: 'grid' | 'list' }) {
  if (mode === 'list') {
    return (
      <div className="ax-skel-table">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="ax-skel-row" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="ax-skel-grid">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="ax-skel-tile" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}
