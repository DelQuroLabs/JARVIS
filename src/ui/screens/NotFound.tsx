import { Shell } from '../Shell.tsx';
import { navigate, useRoute } from '../router.tsx';
import { Icon } from '../icons.tsx';

export default function NotFound() {
  const route = useRoute();
  const from = route.replace('/app/not-found', '') || route;

  return (
    <Shell title="Page not found" sub={route !== '/app/not-found' ? `No page at ${route}` : undefined}>
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
          <span className="ico" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'color-mix(in oklab, var(--warn) 18%, transparent)', color: 'var(--warn)' }}>
            <Icon name="search" size={18} />
          </span>
          <div className="grow">
            <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>That link doesn't exist</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              The page <code className="inline">{from || route}</code> isn't a known JARVIS destination. It may have moved, or you followed an old bookmark.
            </p>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={() => navigate('/app')}>
            <Icon name="home" size={14} /> Go to Overview
          </button>
          <button
            className="btn"
            onClick={() => {
              globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}
          >
            <Icon name="command" size={14} /> Open palette (⌘K)
          </button>
          <button className="btn ghost" onClick={() => navigate('/app/help')}>
            <Icon name="book" size={14} /> Help
          </button>
        </div>

        <div className="card tight" style={{ marginTop: 18, background: 'color-mix(in oklab, var(--bg-2) 80%, transparent)' }}>
          <div className="section-title" style={{ marginTop: 0 }}>Try</div>
          <ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7, fontSize: '0.9rem' }}>
            <li>Search for the screen in the command palette — every route is indexed there.</li>
            <li>Check the Overview dashboard — every destination is a tile, even if hidden in the rail.</li>
            <li>If you were deep-linked from another app, go to Overview and continue from there.</li>
          </ul>
        </div>
      </div>
    </Shell>
  );
}
