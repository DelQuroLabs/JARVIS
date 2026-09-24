import { useMemo, useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Btn, Card, Field, Pill, SectionTitle, Select, Sheet, Toggle, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { SELECTABLE, hasCredential, specOf } from '../../core/providers.ts';
import { connectedServices } from '../../core/services.ts';
import { navigate } from '../router.tsx';
import { Icon } from '../icons.tsx';
import { levelBlurb } from '../../core/privacy.ts';
import { exportAll, importAll, resetAll, storageUsage } from '../../core/store.ts';
import type { PrivacyLevel } from '../../core/types.ts';

const ACCENTS = [
  { id: 'aqua', label: 'Aqua' },
  { id: 'violet', label: 'Violet' },
  { id: 'amber', label: 'Amber' },
  { id: 'rose', label: 'Rose' },
  { id: 'lime', label: 'Lime' },
];

export default function Settings() {
  const app = useApp();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [confirmNode, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = specOf(app.settings.provider.id);
  const configured = SELECTABLE.filter((p) => hasCredential(p.id, app.settings.keyring ?? {})).length;
  const connected = connectedServices(app.settings.serviceKeys ?? {});
  const usage = useMemo(() => storageUsage(), [app.conversations, app.memory, app.traces]);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    // Walking the whole chain can take ten seconds or more. Show each hop as it
    // happens rather than leaving a spinner with nothing to say.
    const log: string[] = [];
    const r = await app.ask('Reply with exactly: connection ok', undefined, (note) => {
      log.push(note);
      setTestResult(log.join('\n'));
    });
    log.push(r.ok ? `\nAnswered by ${r.via}: ${r.text.slice(0, 120)}` : `\n${r.text}`);
    setTestResult(log.join('\n'));
    setTesting(false);
  };

  const download = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    app.toast('Exported. Credentials are deliberately excluded.', 'ok');
  };

  return (
    <Shell title="Settings" sub="Everything here is stored on this device">
      {/* ---------------- model ---------------- */}
      <SectionTitle>Model provider</SectionTitle>
      <Card>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
          <span className="tile-ic">
            <Icon name="spark" size={16} />
          </span>
          <div className="grow">
            <b>{spec.label}</b>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.82rem', lineHeight: 1.45 }}>
              {app.settings.provider.model ?? spec.model}
            </p>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          <Pill tone={hasCredential(spec.id, app.settings.keyring ?? {}) ? 'ok' : 'warn'}>
            {hasCredential(spec.id, app.settings.keyring ?? {}) ? 'configured' : 'not configured'}
          </Pill>
          <Pill>{configured} of {SELECTABLE.length} providers connected</Pill>
          {connected.length > 0 && <Pill tone="ok">{connected.length} tool key{connected.length === 1 ? '' : 's'}</Pill>}
        </div>
        <Btn block variant="primary" icon="key" onClick={() => navigate('/app/providers')}>
          Providers &amp; keys
        </Btn>
        <div style={{ marginTop: 10 }}>
          <Btn block icon="pulse" onClick={() => void test()} disabled={testing}>
            {testing ? 'Testing\u2026' : 'Test the current setup'}
          </Btn>
        </div>
        {testResult && (
          <pre className="md-code" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
            {testResult}
          </pre>
        )}
      </Card>

      {/* ---------------- privacy ---------------- */}
      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <Field label="Level" hint={levelBlurb(app.settings.privacy)}>
          <Select
            value={app.settings.privacy}
            onChange={(v) => app.setSettings({ privacy: v as PrivacyLevel })}
            options={[
              { value: 'STRICT', label: 'Strict \u2014 no network tools, maximum redaction' },
              { value: 'GUARDED', label: 'Guarded \u2014 network tools on, credentials redacted' },
              { value: 'OPEN', label: 'Open \u2014 credentials still redacted, nothing else' },
            ]}
          />
        </Field>
        <Toggle
          checked={app.settings.autoApprove}
          onChange={(v) =>
            v
              ? confirm({
                  title: 'Auto-approve every tool?',
                  body: 'File writes, deletions, sandboxed code execution and arbitrary HTTP requests will run without asking you first. Code still runs in an isolated Worker with no network, and there is still no access to your real filesystem.',
                  danger: true,
                  onYes: () => app.setSettings({ autoApprove: true }),
                })
              : app.setSettings({ autoApprove: false })
          }
          label="Auto-approve tools"
          hint="Off by default. Five tools are approval-gated: fs_write, fs_delete, code_run, http_request and anything else marked class B or C."
        />
      </Card>

      {/* ---------------- appearance ---------------- */}
      <SectionTitle>Appearance</SectionTitle>
      <Card>
        <Field label="Theme">
          <Select
            value={app.settings.theme}
            onChange={(v) => app.setSettings({ theme: v as 'dark' | 'light' | 'system' })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Match system' },
            ]}
          />
        </Field>
        <Field label="Accent">
          <div className="row wrap" style={{ gap: 8 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${app.settings.accent === a.id ? ' on' : ''}`}
                onClick={() => app.setSettings({ accent: a.id })}
                aria-pressed={app.settings.accent === a.id}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Text size \u2014 ${Math.round(app.settings.fontScale * 100)}%`} hint="Scales the whole interface. Layouts are tested up to 130%.">
          <input
            type="range"
            min={0.85}
            max={1.4}
            step={0.05}
            value={app.settings.fontScale}
            onChange={(e) => app.setSettings({ fontScale: Number(e.target.value) })}
            style={{ width: '100%', minHeight: 44 }}
            aria-label="Text size"
          />
        </Field>
        <Toggle checked={app.settings.reduceMotion} onChange={(v) => app.setSettings({ reduceMotion: v })} label="Reduce motion" hint="Also honours your system setting automatically." />
        <Toggle checked={app.settings.sendOnEnter} onChange={(v) => app.setSettings({ sendOnEnter: v })} label="Enter sends" hint="Off: Enter adds a newline and Cmd/Ctrl+Enter sends. Better on phones." />
      </Card>

      {/* ---------------- memory ---------------- */}
      <SectionTitle>Memory</SectionTitle>
      <Card>
        <Field label="Learn from chats" hint="Every reply already sees what JARVIS remembers about you. This controls what it adds on its own. Private mode never learns or recalls.">
          <Select
            value={app.settings.autoLearn}
            onChange={(v) => app.setSettings({ autoLearn: v as 'off' | 'rules' | 'full' })}
            options={[
              { value: 'full', label: 'Rules + model pass (best memory; one small extra call per turn)' },
              { value: 'rules', label: 'Rules only (on device, no extra model calls)' },
              { value: 'off', label: 'Off (only what you save by hand or with /remember)' },
            ]}
          />
        </Field>
        <p className="dim" style={{ fontSize: '0.78rem', margin: '8px 0 0', lineHeight: 1.5 }}>
          {app.serverFacts.length > 0
            ? `${app.serverFacts.length} fact(s) learned by the Telegram assistant are merged into recall here, and what the web chat learns is mirrored back to it.`
            : 'Sign in under Cloud sync to share one memory between this app, other devices and the Telegram assistant.'}
          {' '}Review or delete anything on the Memory screen.
        </p>
      </Card>

      {/* ---------------- weather ---------------- */}
      <SectionTitle>Weather</SectionTitle>
      <Card>
        <Field label="Units">
          <Select
            value={app.settings.units}
            onChange={(v) => app.setSettings({ units: v as 'imperial' | 'metric' })}
            options={[
              { value: 'imperial', label: 'Imperial \u2014 \u00b0F, mph' },
              { value: 'metric', label: 'Metric \u2014 \u00b0C, km/h' },
            ]}
          />
        </Field>
        <Field label="Location" hint={app.settings.weatherPlace ? 'Stored on this device only, never synced to a server.' : 'Not set. The dashboard card will offer to set one.'}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Pill tone={app.settings.weatherPlace ? 'ok' : 'default'}>
              <Icon name="target" size={12} />
              {app.settings.weatherPlace
                ? [app.settings.weatherPlace.name, app.settings.weatherPlace.admin].filter(Boolean).join(', ')
                : 'no place set'}
            </Pill>
            {app.settings.weatherPlace && (
              <Btn
                size="sm"
                icon="trash"
                onClick={() => {
                  app.setSettings({ weatherPlace: null });
                  app.toast('Weather location cleared', 'ok');
                }}
              >
                Clear
              </Btn>
            )}
          </div>
        </Field>
        <Toggle
          checked={app.settings.weatherOn}
          onChange={(v) => app.setSettings({ weatherOn: v })}
          label="Show weather on the dashboard"
          hint="Open-Meteo, no key and no account. Refreshes when you open the app, then every 30 minutes while the tab is visible."
        />
      </Card>

      {/* ---------------- data ---------------- */}
      <SectionTitle>Your data</SectionTitle>
      <Card>
        <div className="stack sm" style={{ marginBottom: 14 }}>
          {usage.perKey
            .filter((k) => k.bytes > 0)
            .slice(0, 6)
            .map((k) => (
              <div className="row between" key={k.key}>
                <small className="mono">{k.key.replace('jarvis.', '')}</small>
                <small className="dim">{(k.bytes / 1024).toFixed(1)} kB</small>
              </div>
            ))}
          <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <small>
              <b>Total</b>
            </small>
            <small className="dim">{(usage.bytes / 1024).toFixed(1)} kB of roughly 5 MB</small>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Btn icon="download" onClick={download}>
            Export
          </Btn>
          <Btn icon="upload" onClick={() => setImportOpen(true)}>
            Import
          </Btn>
          <Btn
            variant="danger"
            icon="trash"
            onClick={() =>
              confirm({
                title: 'Erase everything on this device?',
                body: 'Conversations, memory, workflows, skills, routines, ideas, traces and settings are all deleted, then the built-in examples are restored as if the app were new. If cloud sync is on, the copies on your server are not touched.',
                danger: true,
                onYes: () => {
                  resetAll();
                  globalThis.location.reload();
                },
              })
            }
          >
            Erase all
          </Btn>
        </div>
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card tight>
        <div className="row between" style={{ minHeight: 34 }}>
          <small className="muted">Version</small>
          <small className="mono">1.0.0</small>
        </div>
        <div className="row between" style={{ minHeight: 34 }}>
          <small className="muted">Storage</small>
          <small className="mono">local, this browser</small>
        </div>
        <div className="row between" style={{ minHeight: 34 }}>
          <small className="muted">Telemetry</small>
          <small className="mono">none</small>
        </div>
      </Card>

      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title="Import data" sub="Paste an export, or choose a file. Settings and credentials are never imported.">
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ marginBottom: 12 }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then(setImportText);
          }}
        />
        <Field label="Or paste JSON">
          <textarea className="textarea code" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} />
        </Field>
        <Btn
          block
          variant="primary"
          icon="upload"
          disabled={!importText.trim()}
          onClick={() => {
            const r = importAll(importText);
            if (!r.ok) {
              app.toast(`Import failed: ${r.error}`, 'err');
              return;
            }
            app.toast(`Imported ${r.imported.length} collections. Reloading.`, 'ok');
            setTimeout(() => globalThis.location.reload(), 800);
          }}
        >
          Import
        </Btn>
      </Sheet>
      {confirmNode}
    </Shell>
  );
}
