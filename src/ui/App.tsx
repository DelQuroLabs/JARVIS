import { Suspense, useEffect, useState } from 'react';
import { match, useRoute } from './router.tsx';
import { AppProvider, useApp } from './state.tsx';
import { Btn, Pill, Sheet } from './components.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { lazyScreen } from './lazyScreen.ts';
import { Palette, usePaletteShortcut } from './Palette.tsx';
import { Icon } from './icons.tsx';
import { TOOL_MAP } from '../core/tools.ts';

import Home from './screens/Home.tsx';
import Chat from './screens/Chat.tsx';
import { Landing, Guide, Privacy } from './screens/Site.tsx';
import Login from './screens/Login.tsx';
import * as api from '../core/api.ts';

const Agent = lazyScreen('Agent', () => import('./screens/Agent.tsx'));
const Tools = lazyScreen('Tools', () => import('./screens/Tools.tsx'));
const Skills = lazyScreen('Skills', () => import('./screens/Skills.tsx'));
const Workflows = lazyScreen('Workflows', () => import('./screens/Workflows.tsx'));
const WorkflowEditor = lazyScreen('WorkflowEditor', () => import('./screens/WorkflowEditor.tsx'));
const Crew = lazyScreen('Crew', () => import('./screens/Crew.tsx'));
const Routines = lazyScreen('Routines', () => import('./screens/Routines.tsx'));
const Memory = lazyScreen('Memory', () => import('./screens/Memory.tsx'));
const Traces = lazyScreen('Traces', () => import('./screens/Traces.tsx'));
const Modes = lazyScreen('Modes', () => import('./screens/Modes.tsx'));
const Ideas = lazyScreen('Ideas', () => import('./screens/Ideas.tsx'));
const Cloud = lazyScreen('Cloud', () => import('./screens/Cloud.tsx'));
const Assistant = lazyScreen('Assistant', () => import('./screens/Assistant.tsx'));
const SettingsScreen = lazyScreen('SettingsScreen', () => import('./screens/Settings.tsx'));
const Providers = lazyScreen('Providers', () => import('./screens/Providers.tsx'));
const Diagnostics = lazyScreen('Diagnostics', () => import('./screens/Diagnostics.tsx'));
const Library = lazyScreen('Library', () => import('./screens/Library.tsx'));
const Help = lazyScreen('Help', () => import('./screens/Help.tsx'));
const WeatherScreen = lazyScreen('WeatherScreen', () => import('./screens/WeatherScreen.tsx'));
const Calendar = lazyScreen('Calendar', () => import('./screens/Calendar.tsx'));
const Hubs = lazyScreen('Hubs', async () => ({ default: (await import('./screens/Hubs.tsx')).Build }));
const MoreHub = lazyScreen('MoreHub', async () => ({ default: (await import('./screens/Hubs.tsx')).More }));

function Loading() {
  return (
    <div className="app">
      <div className="main">
        <div className="content" style={{ display: 'grid', placeItems: 'center', minHeight: '60dvh' }}>
          <span className="spinner" />
        </div>
      </div>
    </div>
  );
}

function Approval() {
  const app = useApp();
  const req = app.approval;
  const spec = req ? TOOL_MAP[req.tool] : null;
  return (
    <Sheet open={!!req} onClose={() => app.answerApproval(false)} title="Approve this action?" sub={spec?.desc}>
      {req && (
        <>
          <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
            <Pill tone="accent">{req.tool}</Pill>
            <Pill>effect class {spec?.effect ?? '?'}</Pill>
            {spec?.network && <Pill tone="warn">network</Pill>}
          </div>
          <div className="section-title" style={{ marginTop: 0 }}>Exact arguments</div>
          <pre className="md-code" style={{ maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(req.args, null, 2)}</pre>
          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            <Btn block onClick={() => app.answerApproval(false)}>
              Deny
            </Btn>
            <Btn block variant="primary" icon="check" onClick={() => app.answerApproval(true)}>
              Approve
            </Btn>
          </div>
          <p className="dim" style={{ fontSize: '0.76rem', marginTop: 12, lineHeight: 1.55 }}>
            Denying is recorded as a blocked tool call with the reason, so the agent knows it did not run.
          </p>
        </>
      )}
    </Sheet>
  );
}

function Toasts() {
  const app = useApp();
  if (!app.toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {app.toasts.map((t) => (
        <div className={`toast${t.tone === 'err' ? ' err' : t.tone === 'ok' ? ' ok' : ''}`} key={t.id}>
          <Icon name={t.tone === 'err' ? 'warn' : t.tone === 'ok' ? 'check' : 'info'} size={16} />
          <span className="grow">{t.text}</span>
          <button type="button" className="iconbtn" style={{ width: 28, height: 28 }} onClick={() => app.dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Router() {
  const route = useRoute();

  // The app opens straight onto the dashboard. The marketing landing page is
  // not deleted -- it is parked at /former-landing and simply not linked from
  // anywhere. Restore it by pointing '/' back at <Landing /> here.
  if (route === '/former-landing') return <Landing />;
  if (route === '/guide') return <Guide />;
  if (route === '/privacy') return <Privacy />;

  const wfEdit = match('/app/workflows/:id', route);
  const screen = (() => {
    if (wfEdit) return <WorkflowEditor id={wfEdit.id} />;
    switch (route.replace(/\/$/, '')) {
      case '/app':
        return <Home />;
      case '/app/chat':
        return <Chat />;
      case '/app/agent':
        return <Agent />;
      case '/app/build':
        return <Hubs />;
      case '/app/more':
        return <MoreHub />;
      case '/app/tools':
        return <Tools />;
      case '/app/skills':
        return <Skills />;
      case '/app/workflows':
        return <Workflows />;
      case '/app/crew':
        return <Crew />;
      case '/app/routines':
        return <Routines />;
      case '/app/memory':
        return <Memory />;
      case '/app/traces':
        return <Traces />;
      case '/app/modes':
        return <Modes />;
      case '/app/ideas':
        return <Ideas />;
      case '/app/cloud':
        return <Cloud />;
      case '/app/assistant':
        return <Assistant />;
      case '/app/settings':
        return <SettingsScreen />;
      case '/app/providers':
        return <Providers />;
      case '/app/diagnostics':
        return <Diagnostics />;
      case '/app/library':
        return <Library />;
      case '/app/help':
        return <Help />;
      case '/app/weather':
        return <WeatherScreen />;
      case '/app/calendar':
        return <Calendar />;
      default:
        return <Home />;
    }
  })();

  return <Suspense fallback={<Loading />}>{screen}</Suspense>;
}

/**
 * Login wall. Asks the server once whether it requires login; if so and the
 * stored token is missing or rejected, nothing else renders until sign-in.
 * With no server (static hosting, offline first run) it resolves to "open".
 */
function Gate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'open' | 'locked'>('checking');
  const [config, setConfig] = useState<api.AuthConfig | null>(null);
  const [returnError, setReturnError] = useState('');
  const app = useApp();
  useEffect(() => {
    let alive = true;
    (async () => {
      // Back from GitHub? The token (or the refusal) rides in the URL fragment.
      const ret = api.consumeAuthReturn();
      if (ret?.error) setReturnError(ret.error);
      const cfg = await api.authConfig();
      if (!alive) return;
      setConfig(cfg);
      if (!cfg?.requireLogin) { setState('open'); return; }
      const me = api.isSignedIn() ? await api.currentUser() : null;
      if (!alive) return;
      if (me) {
        if (ret?.token && !app.cloud.enabled) app.setCloud({ ...app.cloud, enabled: true, serverUrl: app.cloud.serverUrl || globalThis.location.origin });
        if (ret?.token) void app.refreshServerFacts();
        setState('open');
        return;
      }
      api.signOut();
      setState('locked');
    })();
    return () => { alive = false; };
  }, []);
  if (state === 'checking') return <Loading />;
  if (state === 'locked' && config) {
    return (
      <Login
        config={config}
        initialError={returnError}
        onSignedIn={() => {
          if (!app.cloud.enabled) app.setCloud({ ...app.cloud, enabled: true, serverUrl: app.cloud.serverUrl || globalThis.location.origin });
          void app.refreshServerFacts();
          setState('open');
        }}
      />
    );
  }
  return <>{children}</>;
}

function Chrome() {
  const [palette, setPalette] = useState(false);
  usePaletteShortcut(setPalette);
  return (
    <>
      <Router />
      <Approval />
      <Toasts />
      <Palette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Gate>
          <Chrome />
        </Gate>
      </AppProvider>
    </ErrorBoundary>
  );
}
