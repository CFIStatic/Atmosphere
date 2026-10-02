import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** `page` keeps the sidebar and header; `app` replaces the whole screen. */
  variant?: 'page' | 'app';
}

interface State {
  error: Error | null;
}

/**
 * The app must never go blank. A render error in a page shows a readable
 * message (with the sidebar still usable) instead of unmounting everything.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Atmosphere Analytics render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const app = this.props.variant === 'app';
    return (
      <div role="alert" className={app ? 'mx-auto max-w-xl px-6 py-16' : 'max-w-2xl py-4'}>
        <p className="eyebrow">Atmosphere Analytics</p>
        <h1 className="mt-2 text-[24px] text-ink-900">This page could not be displayed</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-700">
          Something in the page failed while drawing it. The data has not changed. Reload to try again, or open another
          page{app ? ' or sign in again' : ' from the menu'}.
        </p>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap border-l-2 border-line-strong bg-paper-50 px-3 py-2 text-[12px] text-ink-700">
          {error.message || 'Unknown error'}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a className="btn" href="/overview">
            Go to overview
          </a>
          {app && (
            <a className="btn" href="/login">
              Sign in
            </a>
          )}
        </div>
      </div>
    );
  }
}
