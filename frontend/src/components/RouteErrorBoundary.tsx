import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '../lib/chunkReload';

type Props = {
  children: ReactNode;
  /** Changing this (e.g. the pathname) clears the error so nav keeps working. */
  resetKey?: string;
  /** Full-screen layout for the top-level boundary; inline inside the shell. */
  fullScreen?: boolean;
};
type State = { error: unknown };

/**
 * Catches a page that failed to load or crashed while rendering, so the user
 * sees a message with Try again instead of a blank screen.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return;
    console.error('Page failed to render', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = isChunkLoadError(this.state.error);
    return (
      <div
        role="alert"
        className={
          this.props.fullScreen
            ? 'grid min-h-screen place-items-center bg-paper-100 px-6'
            : 'grid min-h-[50vh] place-items-center px-6'
        }
      >
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold text-ink-900">
            {stale ? 'A new version is available' : 'This page didn’t load'}
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            {stale
              ? 'Reload to get the latest version of Atmosphere.'
              : 'Something went wrong showing this page. Try again, or reload if it keeps happening.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {!stale ? (
              <button
                type="button"
                className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-ink-50"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
