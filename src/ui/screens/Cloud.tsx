import { useEffect, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Pill, SectionTitle, Toggle, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import * as api from '../../core/api.ts';
import type { SyncSummary } from '../../core/api.ts';
import { fmtWhen } from '../../core/util.ts';

export default function Cloud() {
  const app = useApp();
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SyncSummary[] | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const connected = app.cloud.enabled && !!app.cloud.serverUrl;

  // Check for stored token on mount
  useEffect(() => {
    if (!connected) return;
    void api.currentUser().then(setUser, () => setUser(null));
  }, [connected]);

  // Also capture token from URL hash (fallback if popup postMessage fails)
  useEffect(() => {
    const hash = globalThis.location.hash;
    const match = hash.match(/[?&]token=([^&]+)/);
    if (match) {
      api.setToken(match[1]);
      // Clean the URL
      globalThis.location.hash = '#/app/cloud';
      void api.currentUser().then(setUser);
    }
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Something failed', 'err');
    } finally {
      setBusy(null);
    }
  };

  const signIn = () =>
    void run('github', async () => {
      const result = await api.signInWithGitHub(app.cloud.serverUrl);
      if (result.ok && result.user) {
        setUser(result.user);
        app.toast(`Signed in as ${result.user.login}`, 'ok');
      } else {
        app.toast(result.error ?? 'Sign-in failed', 'err');
      }
    });

  return (
    <Shell title="Cloud sync" sub={connected ? (user ? `Signed in as ${user.login}` : 'Connected, signed out') : 'Optional \u00b7 off by default'}>
      <Card tight>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon name="shield" size={16} />
          <div className="muted" style={{ fontSize: '0.83rem' }}>
            JARVIS works completely without this. Turning it on syncs your conversations, memory and automations to
            your own JARVIS server. Data is protected by your GitHub account — only you can read and write your rows.
          </div>
        </div>
      </Card>

      <SectionTitle>Server</SectionTitle>
      <Card>
        <div className="field">
          <label className="field-label">Server URL</label>
          <input
            className="input"
            value={app.cloud.serverUrl}
            onChange={(e) => app.setCloud({ ...app.cloud, serverUrl: e.target.value.replace(/\/$/, '') })}
            placeholder="https://jarvis.delquro.com"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="hint">Your self-hosted JARVIS API server URL.</div>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <Btn
            variant="primary"
            icon="link"
            onClick={() => {
              if (!app.cloud.serverUrl.trim()) {
                app.toast('Enter your server URL first', 'err');
                return;
              }
              app.setCloud({ ...app.cloud, enabled: true });
              app.toast('Connected! Sign in to start syncing.', 'ok');
            }}
            disabled={!app.cloud.serverUrl.trim()}
          >
            {connected ? 'Update' : 'Connect'}
          </Btn>
          {connected && (
            <Btn
              icon="close"
              onClick={() => {
                api.signOut();
                app.setCloud({ serverUrl: '', enabled: false });
                setUser(null);
                app.toast('Disconnected. Local data is untouched.', 'ok');
              }}
            >
              Disconnect
            </Btn>
          )}
        </div>
      </Card>

      {connected && (
        <>
          <SectionTitle>Account</SectionTitle>
          <Card>
            {user ? (
              <div className="row between" style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 10 }}>
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: 12, objectFit: 'cover' }}
                    />
                  ) : (
                    <span
                      className="ico"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        display: 'grid',
                        placeItems: 'center',
                        background: 'var(--panel-2)',
                      }}
                    >
                      <Icon name="user" size={16} />
                    </span>
                  )}
                  <div>
                    <b style={{ fontSize: '0.92rem' }}>{user.name ?? user.login}</b>
                    <div className="dim" style={{ fontSize: '0.78rem' }}>@{user.login}</div>
                  </div>
                </div>
                <Btn
                  size="sm"
                  onClick={() => {
                    api.signOut();
                    setUser(null);
                  }}
                >
                  Sign out
                </Btn>
              </div>
            ) : (
              <>
                <Btn block icon="github" onClick={signIn} disabled={busy === 'github'}>
                  {busy === 'github' ? 'Opening GitHub\u2026' : 'Continue with GitHub'}
                </Btn>
                <div className="hint" style={{ marginTop: 10 }}>
                  GitHub sign-in opens in a popup. If popups are blocked, the sign-in page will open in a new tab instead.
                </div>
              </>
            )}
          </Card>

          <SectionTitle>Sync</SectionTitle>
          <Card>
            <Toggle
              checked={app.cloud.enabled}
              onChange={(v) => app.setCloud({ ...app.cloud, enabled: v })}
              label="Cloud sync enabled"
              hint="Last write wins, compared per item by its own updated timestamp."
            />
            <Btn
              block
              variant="primary"
              icon="sync"
              disabled={!user || busy === 'sync'}
              onClick={() =>
                void run('sync', async () => {
                  const out = await api.syncAll({
                    vault: app.settings.syncKeys
                      ? {
                          id: 'vault',
                          updated: Date.now(),
                          keyring: (app.settings.keyring ?? {}) as Record<string, { key?: string; model?: string; baseUrl?: string }>,
                          serviceKeys: (app.settings.serviceKeys ?? {}) as Record<string, string>,
                        }
                      : undefined,
                    conversations: app.conversations,
                    memory: app.memory,
                    workflows: app.workflows,
                    skills: app.skills,
                    routines: app.routines,
                    ideas: app.ideas,
                    traces: app.traces,
                    crewRuns: app.crewRuns,
                    projects: app.projects,
                    expenses: app.expenses,
                    contacts: app.contacts,
                    events: app.events,
                  });
                  setSummaries(out.summaries);
                  app.applySync(out.merged);
                  if (app.settings.syncKeys && out.merged.vault) {
                    app.setSettings({
                      keyring: { ...(out.merged.vault.keyring ?? {}), ...(app.settings.keyring ?? {}) },
                      serviceKeys: { ...(out.merged.vault.serviceKeys ?? {}), ...(app.settings.serviceKeys ?? {}) },
                    });
                  }
                  app.setCloud({ ...app.cloud, lastSync: Date.now() });
                  app.toast(out.ok ? 'Sync complete' : 'Sync finished with errors', out.ok ? 'ok' : 'err');
                })
              }
            >
              {busy === 'sync' ? 'Syncing\u2026' : 'Sync now'}
            </Btn>
            {!user && <div className="hint" style={{ marginTop: 8 }}>Sign in first — your data is keyed to your account.</div>}
            {app.cloud.lastSync && <div className="hint" style={{ marginTop: 8 }}>Last sync {fmtWhen(app.cloud.lastSync)}</div>}

            {summaries && (
              <div className="stack sm" style={{ marginTop: 14 }}>
                {summaries.map((s) => (
                  <div className="row between" key={s.table}>
                    <small className="mono">{s.table}</small>
                    {s.error ? (
                      <Pill tone="bad">{s.error.slice(0, 40)}</Pill>
                    ) : (
                      <small className="dim">{s.pushed} up / {s.pulled} down</small>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <SectionTitle>Danger zone</SectionTitle>
          <Card>
            <Btn
              variant="danger"
              icon="trash"
              disabled={!user}
              onClick={() =>
                confirm({
                  title: 'Delete all cloud data?',
                  body: 'Every row this account owns is deleted from your JARVIS server. The copy on this device is left alone.',
                  danger: true,
                  onYes: () =>
                    void run('purge', async () => {
                      const r = await api.purgeCloud();
                      app.toast(r.ok ? 'Cloud data deleted' : r.error ?? 'Delete failed', r.ok ? 'ok' : 'err');
                    }),
                })
              }
            >
              Delete my cloud data
            </Btn>
          </Card>
        </>
      )}

      {confirmNode}
    </Shell>
  );
}
