import type { Toast } from '../../types';

export function ToastLayer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="ax-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ax-toast${toast.ok ? ' is-ok' : ' is-err'}`}>
          <i className="ax-toast-icon" aria-hidden>{toast.ok ? '✓' : '✕'}</i>
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
