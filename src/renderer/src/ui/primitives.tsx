import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Btn({
  variant = 'ghost',
  size,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm';
}) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--${variant}${size === 'sm' ? ' ui-btn--sm' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = '', style }: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`ui-card ${className}`.trim()} style={style}>
      {title && (
        <div className="ui-card-hdr">
          <span>{title}</span>
          {actions}
        </div>
      )}
      <div className="ui-card-body">{children}</div>
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="ui-stat" style={accent ? { '--ui-accent': accent } as React.CSSProperties : undefined}>
      <div className="ui-stat-val">{value}</div>
      <div className="ui-stat-lbl">{label}</div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

export function Badge({ tone = 'muted', children, style }: { tone?: 'ok' | 'warn' | 'err' | 'muted'; children: ReactNode; style?: CSSProperties }) {
  return <span className={`ui-badge ui-badge--${tone}`} style={style}>{children}</span>;
}

export function Empty({ icon = '📭', title, desc }: { icon?: string; title: string; desc?: string }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">{icon}</span>
      <span className="ui-empty-title">{title}</span>
      {desc && <span className="ui-empty-desc">{desc}</span>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="ui-loading">
      <div className="ui-spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Toolbar({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="ui-toolbar" style={style}>{children}</div>;
}

export function ToolbarSpacer() {
  return <div className="ui-toolbar-spacer" />;
}

export function Field({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ui-field" style={style}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => <input className="ui-input" ref={ref} {...props} />
);
Input.displayName = 'Input';

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ui-select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="ui-textarea" {...props} />;
}

export function Msg({ tone, children, style }: { tone: 'ok' | 'err' | 'info' | 'warn'; children: ReactNode; style?: CSSProperties }) {
  return <div className={`ui-msg ui-msg--${tone}`} style={style}>{children}</div>;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ui-panel ${className}`.trim()}>{children}</div>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="ui-modal-backdrop" onClick={onClose} role="presentation">
      <div className="ui-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ui-modal-hdr">
          <strong>{title}</strong>
          <button type="button" className="ui-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>
  );
}
