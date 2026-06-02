import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <style>{`
            .error-boundary {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 24px;
              text-align: center;
              background: var(--bg0, #0a0f22);
              color: var(--t1, #f4f6ff);
            }
            .error-boundary h1 {
              font-size: 1.5rem;
              margin-bottom: 16px;
              color: var(--err, #f87171);
            }
            .error-boundary p {
              margin-bottom: 24px;
              color: var(--t2, #9aa3c7);
            }
            .error-boundary .actions {
              display: flex;
              gap: 12px;
            }
            .error-boundary button {
              padding: 10px 20px;
              border: 1px solid var(--border, #2a3568);
              border-radius: 8px;
              background: var(--bg2, #172040);
              color: var(--t1, #f4f6ff);
              cursor: pointer;
              font-size: 0.9rem;
              transition: background 0.15s ease;
            }
            .error-boundary button:hover {
              background: var(--bg3, #1f2a52);
            }
            .error-boundary .details {
              margin-top: 24px;
              padding: 16px;
              border-radius: 8px;
              background: var(--bg1, #10172e);
              font-family: monospace;
              font-size: 0.75rem;
              color: var(--err, #f87171);
              max-width: 600px;
              overflow-x: auto;
            }
          `}</style>
          <h1>⚠️ {i18n.t('errorBoundary.title', { defaultValue: 'حدث خطأ في التطبيق' })}</h1>
          <p>{i18n.t('errorBoundary.message', { defaultValue: 'نأسف للإزعاج. يمكنك محاولة إعادة تحميل الصفحة أو العودة للصفحة الرئيسية.' })}</p>
          <div className="actions">
            <button onClick={this.handleReload}>{i18n.t('errorBoundary.reload', { defaultValue: 'إعادة التحميل' })}</button>
            <button onClick={this.handleGoHome}>{i18n.t('errorBoundary.goHome', { defaultValue: 'الصفحة الرئيسية' })}</button>
          </div>
          {this.state.error && (
            <div className="details">
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
