/**
 * The login wall. Shown before anything else when the server says
 * requireLogin. It exists to protect the server's resources (the OpenAI key,
 * the Telegram bridge, synced data) - the on-device app itself has nothing to
 * hide from its own user, which is why a server-less deployment never shows it.
 */

import { useState } from 'react';
import { Reactor } from '../fx.tsx';
import { Btn } from '../components.tsx';
import { Icon } from '../icons.tsx';
import * as api from '../../core/api.ts';

export default function Login({ config, initialError = '' }: { config: api.AuthConfig; initialError?: string; onSignedIn?: (u: api.AuthUser) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const go = () => {
    setBusy(true);
    setError('');
    // Full-page redirect: GitHub -> back here with the result in the URL fragment.
    api.signInWithGitHub();
  };
  return (
    <div className="app">
      <div className="main">
        <div className="content" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
          <div className="card" style={{ maxWidth: 380, width: '100%', textAlign: 'center', padding: '28px 22px' }}>
            <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}><Reactor size={56} /></div>
            <h1 style={{ margin: '0 0 6px', fontSize: '1.4rem' }}>JARVIS</h1>
            <p className="muted" style={{ margin: '0 0 20px', fontSize: '0.9rem', lineHeight: 1.5 }}>
              This is a private instance. Sign in to continue.
            </p>
            {config.configured ? (
              <Btn block variant="primary" icon="github" onClick={go} disabled={busy}>
                {busy ? 'Taking you to GitHub\u2026' : 'Sign in with GitHub'}
              </Btn>
            ) : (
              <p className="dim" style={{ fontSize: '0.82rem' }}>
                The server requires login but GitHub sign-in is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or REQUIRE_LOGIN=false.
              </p>
            )}
            {error && (
              <p style={{ color: 'var(--warn)', fontSize: '0.84rem', marginTop: 14, lineHeight: 1.5 }}>
                <Icon name="warn" size={14} /> {error}
              </p>
            )}
            <p className="dim" style={{ fontSize: '0.74rem', marginTop: 18, lineHeight: 1.5 }}>
              {config.gate === 'allowlist' && 'Access is limited to the GitHub accounts on the owner\u2019s allow list.'}
              {config.gate === 'owner' && 'Access is limited to the owner\u2019s GitHub account.'}
              {config.gate === 'first-user-claims' && 'No owner yet: the first account to sign in becomes the owner.'}
              {' '}You will be sent to GitHub and straight back; no pop-ups involved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
