import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from './lazyScreen.ts';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence. A render crash used to blank the whole app with no
 * explanation; now it shows what broke and offers the two recoveries that
 * actually work, without pretending the app is fine.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept visible in the console for anyone debugging a real device.
    console.error('JARVIS crashed while rendering', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A stale chunk is not a crash: it means this tab is running an older build
    // than the server. Saying "crashed" for that is both wrong and alarming.
    const stale = isChunkLoadError(error);

    return (
      <div className="crash">
        <div className="crash-card">
          <div className="crash-badge">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {stale ? (
                <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
              ) : (
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              )}
            </svg>
          </div>
          <h1>{stale ? 'The app was updated while this tab was open.' : 'Something in the interface crashed.'}</h1>
          <p>
            {stale ? (
              <>
                A newer version was published, so the screen this tab tried to load no longer exists under that name.
                Reloading picks up the current build. Your saved data has not been touched.
              </>
            ) : (
              <>
                This is a bug in the app, not something you did. Your saved data has not been touched &mdash; it is still
                in this browser.
              </>
            )}
          </p>
          <pre>{error.message || String(error)}</pre>
          <div className="crash-actions">
            <button type="button" className="btn primary" onClick={() => globalThis.location.reload()}>
              Reload the app
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                globalThis.location.hash = '#/app';
                this.setState({ error: null });
              }}
            >
              Back to the dashboard
            </button>
          </div>
          <p className="crash-note">
            {stale
              ? 'This tab already tried reloading once. If it keeps happening, the build on the server may be incomplete.'
              : 'If reloading keeps landing here, open Settings \u2192 Data and export your data before erasing it.'}
          </p>
        </div>
      </div>
    );
  }
}
