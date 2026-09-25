// App shell: bottom tab bar on phones, a grouped rail on desktop.
// One route table drives both, so navigation can never drift between them.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { navigate, useRoute } from './router.tsx';
import { useApp } from './state.tsx';
import { IconBtn, Sheet } from './components.tsx';
import { Reactor, haptic } from './fx.tsx';
import { explainerFor } from '../core/explain.ts';

export interface RouteDef {
  path: string;
  title: string;
  short: string;
  icon: IconName;
  group: 'Workspace' | 'Automate' | 'Knowledge' | 'System';
  tab?: boolean;
  hideInRail?: boolean;
}

export const ROUTES: RouteDef[] = [
  { path: '/app', title: 'Overview', short: 'Home', icon: 'home', group: 'Workspace', tab: true },
  { path: '/app/chat', title: 'Chat', short: 'Chat', icon: 'chat', group: 'Workspace', tab: true },
  { path: '/app/agent', title: 'Agent console', short: 'Agent', icon: 'agent', group: 'Workspace' },
  { path: '/app/library', title: 'Library', short: 'Library', icon: 'boxes', group: 'Workspace' },
  { path: '/app/weather', title: 'Weather', short: 'Weather', icon: 'cloud-sun', group: 'Workspace' },
  { path: '/app/calendar', title: 'Calendar', short: 'Calendar', icon: 'clock', group: 'Workspace' },
  { path: '/app/build', title: 'Build', short: 'Build', icon: 'grid', group: 'Automate', tab: true },
  { path: '/app/more', title: 'More', short: 'More', icon: 'more', group: 'System', tab: true },

  { path: '/app/workflows', title: 'Workflows', short: 'Flows', icon: 'flow', group: 'Automate' },
  { path: '/app/skills', title: 'Skills', short: 'Skills', icon: 'skills', group: 'Automate' },
  { path: '/app/routines', title: 'Routines', short: 'Routines', icon: 'routine', group: 'Automate' },
  { path: '/app/crew', title: 'Crew', short: 'Crew', icon: 'crew', group: 'Automate' },
  { path: '/app/tools', title: 'Tools', short: 'Tools', icon: 'tools', group: 'Automate' },

  { path: '/app/memory', title: 'Memory', short: 'Memory', icon: 'memory', group: 'Knowledge' },
  { path: '/app/ideas', title: 'Ideas', short: 'Ideas', icon: 'idea', group: 'Knowledge' },
  { path: '/app/traces', title: 'Activity', short: 'Activity', icon: 'trace', group: 'Knowledge' },
  { path: '/app/modes', title: 'Modes', short: 'Modes', icon: 'mode', group: 'Knowledge' },

  { path: '/app/assistant', title: 'Assistant', short: 'Assistant', icon: 'assistant', group: 'System' },
  { path: '/app/cloud', title: 'Cloud sync', short: 'Cloud', icon: 'cloud', group: 'System' },
  { path: '/app/settings', title: 'Settings', short: 'Settings', icon: 'settings', group: 'System' },
  { path: '/app/providers', title: 'Providers & keys', short: 'Keys', icon: 'key', group: 'System' },
  { path: '/app/diagnostics', title: 'Diagnostics', short: 'Checks', icon: 'pulse', group: 'System' },
  { path: '/app/help', title: 'Help', short: 'Help', icon: 'book', group: 'System' },
];

export const TABS = ROUTES.filter((r) => r.tab);
export const APP_ROUTE_COUNT = ROUTES.length + 1; // + the workflow editor at /app/workflows/:id

const isActive = (path: string, route: string): boolean => {
  if (path === '/app') return route === '/app' || route === '/app/';
  if (path === '/app/workflows') return route.startsWith('/app/workflows');
  if (path === '/app/build') return ['/app/build', '/app/workflows', '/app/skills', '/app/routines', '/app/crew', '/app/tools'].some((p) => route.startsWith(p));
  if (path === '/app/more') return ['/app/more', '/app/memory', '/app/ideas', '/app/traces', '/app/modes', '/app/assistant', '/app/cloud', '/app/settings', '/app/providers', '/app/diagnostics', '/app/help'].some((p) => route.startsWith(p));
  return route.startsWith(path);
};



/**
 * The "what is this?" strip. Collapsed by default so it never gets in the way,
 * and driven by one registry so a screen cannot quietly ship without an
 * explanation. The state is per route and remembered for the session.
 */
function ScreenExplainer({ route }: { route: string }) {
  const info = explainerFor(route);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);
  if (!info) return null;
  return (
    <div className={`explainer${open ? ' on' : ''}`}>
      <button
        type="button"
        className="explainer-toggle"
        aria-expanded={open}
        onClick={() => {
          haptic.light();
          setOpen((v) => !v);
        }}
      >
        <Icon name="info" size={14} />
        <span className="grow">{open ? 'What this screen is' : 'What is this screen?'}</span>
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {open && (
        <div className="explainer-body">
          <p>{info.what}</p>
          <p><b>When to use it.</b> {info.when}</p>
          <p className="lim"><b>What it will not do.</b> {info.limit}</p>
          {info.next && (
            <p>
              <b>Try next:</b>{' '}
              <button type="button" className="link" onClick={() => navigate(info.next!.path)}>
                {info.next!.label}
              </button>
            </p>
          )}
          {info.related && info.related.length > 0 && (
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Related:</span>
              {info.related.map((r) => (
                <button key={r.path} type="button" className="chip" onClick={() => navigate(r.path)} style={{ fontSize: '0.78rem', padding: '2px 8px' }}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The one rail. Shared by every shell so navigation cannot drift between them. */
function Rail({ route }: { route: string }) {
  return (
    <nav className="rail icons" aria-label="Primary">
      {/* The inner panel is what widens on hover. The <nav> keeps its 72px
          footprint so expanding never reflows the page behind it. */}
      <div className="railinner">
        <div className="brand">
          <Reactor size={26} />
          <span>JARVIS</span>
        </div>
        {(['Workspace', 'Automate', 'Knowledge', 'System'] as const).map((g, gi) => (
          <div key={g} style={{ display: 'contents' }}>
            {gi > 0 && <div className="railsep" aria-hidden="true" />}
            {ROUTES.filter((r) => r.group === g && !r.hideInRail).map((r) => (
              <button
                key={r.path}
                type="button"
                className="raillink"
                title={r.title}
                aria-label={r.title}
                aria-current={isActive(r.path, route) ? 'page' : undefined}
                onClick={() => navigate(r.path)}
              >
                <Icon name={r.icon} size={19} />
                <span>{r.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function Shell({ title, sub, actions, children, flush, wide, back }: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  wide?: boolean;
  back?: string;
}) {
  const route = useRoute();
  const app = useApp();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <Rail route={route} />

      <div className="main">
        {/* Every screen gets the dashboard's backdrop from here, so the look
            cannot drift between pages and no screen has to remember it. */}
        <div className="aurora" aria-hidden="true" />
        <header className="appbar">
          {back && <IconBtn name="back" title="Back" onClick={() => navigate(back)} />}
          <div className="grow">
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {!app.online && (
            <span className="pill warn" title="No network connection">
              <Icon name="warn" size={12} />
              Offline
            </span>
          )}
          {actions}
          <button
            type="button"
            className="cmdk"
            title="Command palette"
            aria-label="Open the command palette"
            onPointerDown={() => haptic.light()}
            onClick={() => {
              globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}
          >
            <Icon name="command" size={15} />
            <span className="cmdk-hint">K</span>
          </button>
        </header>

        {!flush && <ScreenExplainer route={route} />}
        <div ref={contentRef} className={`content${wide ? ' wide' : ''}${flush ? ' flush' : ''}`}>
          {children}
        </div>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {TABS.slice(0, 2).map((t) => (
          <button
            key={t.path}
            type="button"
            className="tab"
            aria-current={isActive(t.path, route) ? 'page' : undefined}
            onClick={() => navigate(t.path)}
          >
            <Icon name={t.icon} size={21} />
            {t.short}
          </button>
        ))}
        <QuickFab />
        {TABS.slice(2).map((t) => (
          <button
            key={t.path}
            type="button"
            className="tab"
            aria-current={isActive(t.path, route) ? 'page' : undefined}
            onClick={() => navigate(t.path)}
          >
            <Icon name={t.icon} size={21} />
            {t.short}
          </button>
        ))}
      </nav>
    </div>
  );
}


/**
 * The centre action button. One thumb-reachable entry point to the things you
 * start rather than browse: ask, run the agent, fire a routine, capture an idea.
 */
function QuickFab() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const due = app.routines.filter((r) => r.enabled && r.when !== 'manual').length;

  const go = (fn: () => void) => {
    haptic.medium();
    setOpen(false);
    fn();
  };

  return (
    <>
      <div className="fab-slot">
        <button
          type="button"
          className={`fab${open ? ' on' : ''}`}
          aria-label="Quick actions"
          aria-expanded={open}
          onPointerDown={() => haptic.light()}
          onClick={() => setOpen(true)}
        >
          <Icon name="bolt" size={22} />
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Quick actions" sub="Start something, without hunting for the screen.">
        <div className="list">
          <button type="button" className="list-row" onClick={() => go(() => { app.newConversation(); navigate('/app/chat'); })}>
            <span className="ico"><Icon name="chat" size={15} /></span>
            <span className="txt"><b>New conversation</b><small>A clean thread in the current mode.</small></span>
            <Icon name="chevron" size={15} />
          </button>
          <button type="button" className="list-row" onClick={() => go(() => navigate('/app/agent'))}>
            <span className="ico"><Icon name="agent" size={15} /></span>
            <span className="txt"><b>Agent console</b><small>Give it a task and watch every step.</small></span>
            <Icon name="chevron" size={15} />
          </button>
          <button type="button" className="list-row" onClick={() => go(() => navigate('/app/routines'))}>
            <span className="ico"><Icon name="routine" size={15} /></span>
            <span className="txt"><b>Routines</b><small>{due ? `${due} scheduled while the app is open` : 'Nothing scheduled yet'}</small></span>
            <Icon name="chevron" size={15} />
          </button>
          <button type="button" className="list-row" onClick={() => go(() => navigate('/app/ideas'))}>
            <span className="ico"><Icon name="idea" size={15} /></span>
            <span className="txt"><b>Capture an idea</b><small>Park a thought before it evaporates.</small></span>
            <Icon name="chevron" size={15} />
          </button>
          <button
            type="button"
            className="list-row"
            onClick={() => go(() => globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })))}
          >
            <span className="ico"><Icon name="command" size={15} /></span>
            <span className="txt"><b>Search everything</b><small>Screens, modes, tools and commands.</small></span>
            <Icon name="chevron" size={15} />
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Full-bleed shell used by Chat, which manages its own scrolling. 
 *  Fixed: now reuses shared header controls (offline pill, palette) so Chat doesn't feel like a different app.
 */
export function ChatShell({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  const route = useRoute();
  const app = useApp();
  return (
    <div className="app">
      <Rail route={route} />
      <div className="main">
        <div className="aurora" aria-hidden="true" />
        <div className="chatwrap">
          <header className="appbar">
            <div className="grow">
              <h1>{title}</h1>
              {sub && <div className="sub">{sub}</div>}
            </div>
            {!app.online && (
              <span className="pill warn" title="No network connection">
                <Icon name="warn" size={12} />
                Offline
              </span>
            )}
            {actions}
            <button
              type="button"
              className="cmdk"
              title="Command palette"
              aria-label="Open the command palette"
              onPointerDown={() => haptic.light()}
              onClick={() => {
                globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
              }}
            >
              <Icon name="command" size={15} />
              <span className="cmdk-hint">K</span>
            </button>
          </header>
          {children}
        </div>
      </div>
      <nav className="tabbar" aria-label="Primary">
        {TABS.slice(0, 2).map((t) => (
          <button
            key={t.path}
            type="button"
            className="tab"
            aria-current={isActive(t.path, route) ? 'page' : undefined}
            onClick={() => navigate(t.path)}
          >
            <Icon name={t.icon} size={21} />
            {t.short}
          </button>
        ))}
        <QuickFab />
        {TABS.slice(2).map((t) => (
          <button
            key={t.path}
            type="button"
            className="tab"
            aria-current={isActive(t.path, route) ? 'page' : undefined}
            onClick={() => navigate(t.path)}
          >
            <Icon name={t.icon} size={21} />
            {t.short}
          </button>
        ))}
      </nav>
    </div>
  );
}
