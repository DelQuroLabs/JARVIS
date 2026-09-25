import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Btn, Card, Field, IconBtn, Input, OpenLink, Pill, SectionTitle, Select, Toggle } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useApp } from '../state.tsx';
import { PROVIDERS, SELECTABLE, hasCredential, specOf, DEFAULT_BASE_URL, OPENAI_MODELS } from '../../core/providers.ts';
import { SERVICES, connectedServices } from '../../core/services.ts';
import type { ProviderId, ProviderSpec, ProviderTier } from '../../core/types.ts';

/** Model dropdown options; OpenAI gets friendly labels with list prices. */
function modelOptions(id: ProviderId, models: readonly string[]) {
  if (id !== 'openai') return models.map((m) => ({ value: m, label: m }));
  return OPENAI_MODELS.map((m) => ({ value: m.id, label: `${m.label}  ·  $${m.in}/$${m.out} per M` }));
}

/** Which modes may run on a different model than the day-to-day one. */
const MODE_MODEL_SLOTS: { tier: string; label: string; hint: string }[] = [
  { tier: 'code', label: 'Build mode', hint: 'writing and fixing code' },
  { tier: 'reasoning', label: 'Deep mode', hint: 'hard multi-step problems' },
  { tier: 'research', label: 'Research mode', hint: 'long reads and sources' },
];

function PerModeModels({ id, cfg, onChange }: { id: ProviderId; cfg: { model?: string; modelByTier?: Partial<Record<string, string>> }; onChange: (m: Partial<Record<string, string>>) => void }) {
  const spec = specOf(id);
  if (spec.models.length < 2) return null;
  const base = cfg.model ?? spec.model;
  const byTier = cfg.modelByTier ?? {};
  return (
    <div style={{ marginTop: 10 }}>
      <div className="dim" style={{ fontSize: '0.78rem', marginBottom: 6 }}>
        Per-mode models · the model above is used day to day; pick a stronger one only where it pays off.
      </div>
      {MODE_MODEL_SLOTS.map((slot) => (
        <Field key={slot.tier} label={`${slot.label} · ${slot.hint}`}>
          <Select
            value={byTier[slot.tier] ?? ''}
            onChange={(v) => { const next = { ...byTier }; if (v) next[slot.tier] = v; else delete next[slot.tier]; onChange(next); }}
            options={[{ value: '', label: `Same as day-to-day (${base})` }, ...modelOptions(id, spec.models)]}
          />
        </Field>
      ))}
    </div>
  );
}

const TIER_LABEL: Record<ProviderTier, string> = {
  free: 'Free tier',
  trial: 'Starter credit',
  paid: 'Paid',
  local: 'Runs on your machine',
  keyless: 'No account needed',
};

const TIER_TONE: Record<ProviderTier, 'ok' | 'warn' | 'accent' | undefined> = {
  free: 'ok',
  trial: 'warn',
  paid: undefined,
  local: 'accent',
  keyless: 'accent',
};

const GROUPS: { tier: ProviderTier; title: string; blurb: string }[] = [
  { tier: 'free', title: 'Free tiers', blurb: 'A standing free allowance. No card, no trial clock.' },
  { tier: 'trial', title: 'Starter credit', blurb: 'Free until the signup credit runs out, then billed.' },
  { tier: 'local', title: 'Your own hardware', blurb: 'Nothing leaves your machine. Enable CORS in the server settings.' },
  { tier: 'paid', title: 'Paid accounts', blurb: 'Billed to you per token. Listed because the keys work, not because you need them.' },
  { tier: 'keyless', title: 'No account', blurb: 'Always there, with real limits.' },
];

const PLACEHOLDER: Partial<Record<ProviderId, string>> = {
  groq: 'gsk_\u2026',
  gemini: 'AIza\u2026',
  cerebras: 'csk-\u2026',
  openai: 'sk-\u2026',
  anthropic: 'sk-ant-\u2026',
  openrouter: 'sk-or-v1-\u2026',
  huggingface: 'hf_\u2026',
  xai: 'xai-\u2026',
  together: '64-char hex\u2026',
};

export default function Providers() {
  const app = useApp();
  const [open, setOpen] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [results, setResults] = useState<Partial<Record<ProviderId, { ok: boolean; detail: string; cors?: boolean }>>>({});

  const keyring = app.settings.keyring ?? {};
  const chain = app.settings.chain ?? [];
  const activeId = app.settings.provider.id;

  const configuredCount = useMemo(
    () => SELECTABLE.filter((p) => hasCredential(p.id, keyring)).length,
    [app, keyring, activeId],
  );

  const setCreds = (id: ProviderId, patch: { key?: string; model?: string; baseUrl?: string; modelByTier?: Partial<Record<string, string>> }) => {
    app.setSettings({ keyring: { ...keyring, [id]: { ...(keyring[id] ?? {}), ...patch } } });
    // Keep the active provider config in step, so nothing depends on load order.
    if (id === activeId) app.setSettings({ provider: { ...app.settings.provider, ...patch } });
  };

  const makeActive = (id: ProviderId) => {
    const creds = keyring[id] ?? {};
    app.setSettings({
      provider: { id, key: creds.key, model: creds.model ?? specOf(id).model, baseUrl: creds.baseUrl ?? DEFAULT_BASE_URL[id], modelByTier: creds.modelByTier },
    });
    app.toast(`${specOf(id).label} is now the main brain.`, 'ok');
  };

  const test = async (id: ProviderId) => {
    setBusy(id);
    setResults((r) => ({ ...r, [id]: undefined }));
    const r = await app.testProvider(id);
    setResults((prev) => ({ ...prev, [id]: { ok: r.ok, detail: r.detail, cors: r.cors } }));
    setBusy(null);
    app.toast(r.ok ? `${specOf(id).label} answered in ${r.ms} ms` : `${specOf(id).label} did not answer`, r.ok ? 'ok' : 'err');
  };

  const moveInChain = (id: ProviderId, dir: -1 | 1) => {
    const list = [...chain];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    app.setSettings({ chain: list });
  };

  const toggleInChain = (id: ProviderId) => {
    const list = chain.includes(id) ? chain.filter((x) => x !== id) : [...chain, id];
    app.setSettings({ chain: list });
  };

  const services = app.settings.serviceKeys ?? {};
  const connected = connectedServices(services);

  return (
    <Shell
      title="Providers &amp; keys"
      sub={`${configuredCount} of ${SELECTABLE.length} connected`}
      back="/app/settings"
    >
      <Card className="accentcard">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="tile-ic">
            <Icon name="key" size={16} />
          </span>
          <div className="grow">
            <b>Keys live in this browser.</b>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.84rem', lineHeight: 1.5 }}>
              They are never bundled, never logged, and never included in an export. Cloud sync only carries them if you turn that on below.
              Every endpoint listed here was checked from a real browser origin, because plenty of APIs refuse web pages outright.
            </p>
          </div>
        </div>
      </Card>

      {/* ---------------- active brain ---------------- */}
      <SectionTitle>Main brain</SectionTitle>
      <Card>
        <Field label="Active provider" hint={specOf(activeId).note}>
          <Select
            value={activeId}
            onChange={(v) => makeActive(v as ProviderId)}
            options={SELECTABLE.map((p) => ({
              value: p.id,
              label: `${p.label} \u00b7 ${TIER_LABEL[p.tier]}${hasCredential(p.id, keyring) ? '' : ' (needs setup)'}`,
            }))}
          />
        </Field>
        <Field label="Model · day to day">
          <Select
            value={app.settings.provider.model ?? specOf(activeId).model}
            onChange={(v) => setCreds(activeId, { model: v })}
            options={modelOptions(activeId, specOf(activeId).models)}
          />
        </Field>
        <PerModeModels id={activeId} cfg={app.settings.provider} onChange={(m) => setCreds(activeId, { modelByTier: m })} />
        <div className="row wrap" style={{ gap: 6 }}>
          <Pill tone={hasCredential(activeId, keyring) ? 'ok' : 'warn'}>
            {hasCredential(activeId, keyring) ? 'ready' : 'needs a key'}
          </Pill>
          <Pill>{specOf(activeId).nativeTools ? 'native tool calls' : 'text tool protocol'}</Pill>
          <Pill>{specOf(activeId).multiTurn ? 'multi-turn' : 'single-turn only'}</Pill>
        </div>
      </Card>

      {/* ---------------- fallback order ---------------- */}
      <SectionTitle>Fallback order</SectionTitle>
      <Card>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.84rem', lineHeight: 1.5 }}>
          When the main brain fails, times out or is rate limited, JARVIS walks this list in order and uses the first one that answers. Unconfigured
          providers are skipped rather than counted as failures, and the answer always says which one replied.
        </p>
        {chain.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.84rem' }}>No fallbacks. A failure will drop straight to the offline core.</p>
        ) : (
          <ol className="chain">
            {chain.map((id, i) => {
              const ready = hasCredential(id, keyring);
              return (
                <li key={id} className="chain-row">
                  <span className="n">{i + 1}</span>
                  <span className="grow">
                    <b>{specOf(id).label}</b>
                    <small className={ready ? 'ok' : 'dim'}>{ready ? 'ready' : 'skipped \u2014 no key saved'}</small>
                  </span>
                  <IconBtn name="up" title={`Move ${specOf(id).label} up`} onClick={() => moveInChain(id, -1)} />
                  <IconBtn name="down" title={`Move ${specOf(id).label} down`} onClick={() => moveInChain(id, 1)} />
                  <IconBtn name="close" title={`Remove ${specOf(id).label} from the chain`} onClick={() => toggleInChain(id)} />
                </li>
              );
            })}
          </ol>
        )}
        <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
          {SELECTABLE.filter((p) => !chain.includes(p.id)).map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => toggleInChain(p.id)}>
              <Icon name="plus" size={12} /> {p.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <Toggle
            checked={app.settings.keylessFallback}
            onChange={(v) => app.setSettings({ keylessFallback: v })}
            label="Then try the keyless endpoint"
            hint="A no-account endpoint used as the last hop before the offline core. Heavily rate limited, single-turn, and it returns 403 from some networks."
          />
        </div>
      </Card>

      {/* ---------------- catalogue ---------------- */}
      <SectionTitle>All providers</SectionTitle>
      {GROUPS.map((g) => {
        const list = PROVIDERS.filter((p) => p.tier === g.tier && p.id !== 'reflex');
        if (!list.length) return null;
        return (
          <div key={g.tier}>
            <div className="grp-head">
              <b>{g.title}</b>
              <small>{g.blurb}</small>
            </div>
            {list.map((p) => (
              <ProviderRow
                key={p.id}
                spec={p}
                open={open === p.id}
                onToggle={() => setOpen(open === p.id ? null : p.id)}
                ready={hasCredential(p.id, keyring)}
                active={p.id === activeId}
                creds={keyring[p.id] ?? {}}
                busy={busy === p.id}
                result={results[p.id]}
                onCreds={(patch) => setCreds(p.id, patch)}
                onTest={() => void test(p.id)}
                onUse={() => makeActive(p.id)}
                onNote={app.toast}
              />
            ))}
          </div>
        );
      })}

      {/* ---------------- service keys ---------------- */}
      <SectionTitle>Tool keys (all optional)</SectionTitle>
      <Card>
        <p className="muted" style={{ margin: '0 0 4px', fontSize: '0.84rem', lineHeight: 1.5 }}>
          These upgrade a tool rather than the model. {connected.length} of {SERVICES.length} connected. Every tool below already works with no key
          at all &mdash; a key just makes it better.
        </p>
      </Card>
      {SERVICES.map((s) => (
        <Card key={s.id}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <b className="grow">{s.label}</b>
            <Pill tone={(services[s.id] ?? '').trim() ? 'ok' : undefined}>{(services[s.id] ?? '').trim() ? 'connected' : 'not set'}</Pill>
          </div>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.82rem', lineHeight: 1.5 }}>
            <b style={{ color: 'var(--ink-2)' }}>With a key:</b> {s.unlocks}
            <br />
            <b style={{ color: 'var(--ink-2)' }}>Without one:</b> {s.withoutKey}
          </p>
          <Field label={`${s.label} key`}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="paste here"
              value={services[s.id] ?? ''}
              onChange={(e) => app.setSettings({ serviceKeys: { ...services, [s.id]: e.target.value.trim() } })}
            />
          </Field>
          <div className="row wrap" style={{ gap: 6 }}>
            {s.tools.map((t) => (
              <span className="toolchip" key={t}>
                {t}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <OpenLink url={s.keyUrl} icon="key" variant="quiet" size="sm" onNote={app.toast}>
              Get a free {s.label} key
            </OpenLink>
          </div>
        </Card>
      ))}

      {/* ---------------- sync ---------------- */}
      <SectionTitle>Key sync</SectionTitle>
      <Card>
        <Toggle
          checked={app.settings.syncKeys}
          onChange={(v) => app.setSettings({ syncKeys: v })}
          label="Include keys in cloud sync"
          hint="Off: keys never leave this device, and a new device needs them pasted again. On: they ride along in your cloud sync so every device you sign into is ready. Anyone with your GitHub account access could read them, so leave this off on a shared machine."
        />
        {app.settings.syncKeys && !app.cloud.serverUrl && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.82rem' }}>
            No sync server is connected yet, so nothing is being synced regardless of this switch.
          </p>
        )}
      </Card>

      <p className="muted" style={{ fontSize: '0.78rem', lineHeight: 1.6, margin: '18px 0 0' }}>
        Not listed on purpose: GitHub Models returned HTTP 410 (retirement brownout) when probed, and Brave Search, NewsAPI, NVIDIA NIM and
        SambaNova send no CORS headers, so a browser cannot read their replies whatever key you hold. Reaching those needs a server proxy.
      </p>
    </Shell>
  );
}

function ProviderRow({
  spec, open, onToggle, ready, active, creds, busy, result, onCreds, onTest, onUse, onNote,
}: {
  spec: ProviderSpec;
  open: boolean;
  onToggle: () => void;
  ready: boolean;
  active: boolean;
  creds: { key?: string; model?: string; baseUrl?: string; modelByTier?: Partial<Record<string, string>> };
  busy: boolean;
  result?: { ok: boolean; detail: string; cors?: boolean };
  onCreds: (patch: { key?: string; model?: string; baseUrl?: string; modelByTier?: Partial<Record<string, string>> }) => void;
  onTest: () => void;
  onUse: () => void;
  onNote: (text: string, tone?: 'ok' | 'err' | 'info') => void;
}) {
  const needsUrl = spec.id === 'ollama' || spec.id === 'lmstudio' || spec.id === 'edge' || spec.id === 'custom';
  return (
    <Card className={`prov${active ? ' on' : ''}`}>
      <button type="button" className="prov-head" onClick={onToggle} aria-expanded={open}>
        <span className={`dot ${ready ? 'ok' : 'off'}`} />
        <span className="grow">
          <b>
            {spec.label}
            {active && <span className="tag">main</span>}
          </b>
          <small>{spec.allowance ?? spec.note}</small>
        </span>
        <Pill tone={TIER_TONE[spec.tier]}>{TIER_LABEL[spec.tier]}</Pill>
        <Icon name={open ? 'up' : 'down'} size={15} />
      </button>

      {open && (
        <div className="prov-body">
          <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.82rem', lineHeight: 1.5 }}>{spec.note}</p>

          {spec.needsKey && (
            <Field label="API key" hint="Stored in this browser. Never exported.">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={PLACEHOLDER[spec.id] ?? 'paste your key'}
                value={creds.key ?? ''}
                onChange={(e) => onCreds({ key: e.target.value.trim() })}
              />
            </Field>
          )}

          {needsUrl && (
            <Field
              label="Base URL"
              hint={
                spec.id === 'edge'
                  ? 'Your deployed Edge Function URL.'
                  : spec.id === 'custom'
                    ? 'Any host speaking /v1/chat/completions.'
                    : `Default ${DEFAULT_BASE_URL[spec.id] ?? ''}. The server must allow this origin.`
              }
            >
              <Input
                placeholder={DEFAULT_BASE_URL[spec.id] ?? 'https://\u2026'}
                value={creds.baseUrl ?? ''}
                onChange={(e) => onCreds({ baseUrl: e.target.value.trim() })}
              />
            </Field>
          )}

          {spec.id === 'custom' && (
            <Field label="Model id">
              <Input placeholder="model name the server expects" value={creds.model ?? ''} onChange={(e) => onCreds({ model: e.target.value.trim() })} />
            </Field>
          )}

          {spec.models.length > 1 && (
            <Field label="Model">
              <Select
                value={creds.model ?? spec.model}
                onChange={(v) => onCreds({ model: v })}
                options={modelOptions(spec.id, spec.models)}
              />
            </Field>
          )}

          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            <Pill tone={ready ? 'ok' : 'warn'}>{ready ? 'configured' : spec.needsKey ? 'no key' : 'no URL'}</Pill>
            {spec.cors === 'verified' && <Pill tone="ok">browser-checked {spec.probed}</Pill>}
            {spec.cors === 'unverified' && <Pill tone="warn">CORS depends on your host</Pill>}
            <Pill>{spec.nativeTools ? 'native tools' : 'text protocol'}</Pill>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Btn block icon="pulse" onClick={onTest} disabled={busy || !ready}>
              {busy ? 'Testing\u2026' : 'Test'}
            </Btn>
            {!active && (
              <Btn block variant="primary" icon="spark" onClick={onUse} disabled={!ready}>
                Use as main
              </Btn>
            )}
          </div>

          {result && (
            <div className={`callout ${result.ok ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>
              <Icon name={result.ok ? 'check' : 'warn'} size={14} />
              <span>{result.detail}</span>
            </div>
          )}

          {spec.keyUrl && (
            <div style={{ marginTop: 10 }}>
              <OpenLink url={spec.keyUrl} icon="key" variant="quiet" size="sm" onNote={onNote}>
                Get a {spec.tier === 'free' ? 'free ' : ''}
                {spec.label} key
              </OpenLink>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
