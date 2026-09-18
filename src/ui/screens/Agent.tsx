import { useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Empty, Field, IconBtn, Pill, SectionTitle, Select, Sheet, Textarea } from '../components.tsx';
import Markdown from '../components.tsx';
import { useApp } from '../state.tsx';
import { MODES, modeOf } from '../../core/modes.ts';
import type { LoopStep, RunResult } from '../../core/types.ts';
import { fmtMs } from '../../core/util.ts';

const KIND_ICON: Record<LoopStep['kind'], string> = {
  think: 'spark',
  route: 'link',
  act: 'bolt',
  observe: 'eye',
  respond: 'check',
  error: 'warn',
  budget: 'gauge',
};

export default function Agent() {
  const app = useApp();
  const [task, setTask] = useState('');
  const [modeId, setModeId] = useState('build');
  const [steps, setSteps] = useState<LoopStep[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileOpen, setFileOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mode = modeOf(modeId);

  const run = async () => {
    if (!task.trim() || busy) return;
    setBusy(true);
    setSteps([]);
    setResult(null);
    const ac = new AbortController();
    abort.current = ac;
    const t0 = Date.now();
    try {
      const r = await app.runTask([{ id: 'task', role: 'user', content: task.trim(), ts: Date.now() }], {
        mode,
        provider: app.settings.provider,
        privacy: app.settings.privacy,
        ctx: app.makeToolCtx(),
        signal: ac.signal,
        onStep: (s) => setSteps((prev) => [...prev, s]),
      });
      setResult(r);
      app.addTrace({
        kind: 'agent',
        label: task.slice(0, 60),
        ms: Date.now() - t0,
        ok: !r.degraded,
        via: r.via,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        toolCount: r.calls.length,
      });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Run failed', 'err');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const files = Object.keys(app.sandbox).sort();

  return (
    <Shell
      title="Agent console"
      sub={`${mode.name} \u00b7 max ${mode.maxSteps} steps \u00b7 ${mode.toolBudget} tool budget`}
      actions={busy ? <IconBtn name="stop" title="Stop" onClick={() => abort.current?.abort()} /> : undefined}
    >
      <Card>
        <Field label="Task" hint="Describe the outcome, not the steps. The agent plans, acts, and reports what it actually verified.">
          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={'e.g. Write a function that formats a duration in ms as "2m 14s", save it to the sandbox, then run it against 134000.'}
            rows={4}
          />
        </Field>
        <Field label="Mode">
          <Select value={modeId} onChange={setModeId} options={MODES.map((m) => ({ value: m.id, label: `${m.name} \u2014 ${m.blurb}` }))} />
        </Field>
        <Btn block variant="primary" icon={busy ? 'pause' : 'play'} onClick={() => void run()} disabled={busy || !task.trim()}>
          {busy ? 'Running\u2026' : 'Run task'}
        </Btn>
        {!app.providerReady && (
          <div className="hint" style={{ marginTop: 10, color: 'var(--warn)' }}>
            No model key configured. The loop will still run deterministic intents and tools, then fall back to the offline reflex core.
          </div>
        )}
      </Card>

      {(steps.length > 0 || busy) && (
        <>
          <SectionTitle>Loop</SectionTitle>
          <Card tight>
            <div className="stack sm">
              {steps.map((s, i) => (
                <div className="row" key={i} style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span className="ico" style={{ width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', flex: 'none', background: 'var(--panel-2)', color: s.kind === 'error' ? 'var(--danger)' : s.kind === 'budget' ? 'var(--warn)' : 'var(--accent)' }}>
                    <Icon name={KIND_ICON[s.kind] as never} size={13} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.86rem' }}>{s.label}</div>
                    {s.detail && <div className="dim" style={{ fontSize: '0.75rem', wordBreak: 'break-word' }}>{s.detail}</div>}
                  </div>
                  <small className="dim nowrap">{fmtMs(s.ms ?? 0)}</small>
                </div>
              ))}
              {busy && (
                <div className="row" style={{ gap: 10 }}>
                  <span className="spinner" />
                  <small className="dim">working&hellip;</small>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {result && (
        <>
          <SectionTitle>Result</SectionTitle>
          <Card>
            <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
              <Pill tone={result.degraded ? 'warn' : 'ok'}>{result.via}</Pill>
              <Pill>{result.calls.length} tool calls</Pill>
              <Pill>~{result.tokensIn + result.tokensOut} tokens</Pill>
              <Pill>{result.steps.length} loop steps</Pill>
            </div>
            <Markdown text={result.text} />
          </Card>
          {result.calls.length > 0 && (
            <Card title="Tool calls" icon="tools">
              <div className="stack sm">
                {result.calls.map((c) => (
                  <details className="toolcall" key={c.id}>
                    <summary>
                      <Icon name={c.ok ? 'check' : 'warn'} size={14} />
                      <span className="grow mono">{c.tool}</span>
                      <Pill tone={c.ok ? 'ok' : c.blocked ? 'warn' : 'bad'}>{c.ok ? fmtMs(c.ms) : c.reason ?? 'failed'}</Pill>
                    </summary>
                    <pre>{`${JSON.stringify(c.args, null, 2)}\n\n${c.summary}${c.detail ? `\n\n${c.detail.slice(0, 1200)}` : ''}`}</pre>
                  </details>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <SectionTitle>Sandbox workspace</SectionTitle>
      <Card tight>
        <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 10 }}>
          A virtual, in-memory filesystem. The agent can read and write here; it has no access to your real files, and code runs in a Worker with networking removed.
        </div>
        {files.length === 0 ? (
          <Empty icon="file" title="Empty">Ask the agent to write a file and it will appear here.</Empty>
        ) : (
          <div className="list">
            {files.map((f) => (
              <div className="item" key={f}>
                <button
                  type="button"
                  className="grow row"
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
                  onClick={() => setFileOpen(f)}
                >
                  <span className="ico alt">
                    <Icon name="file" size={15} />
                  </span>
                  <span className="txt">
                    <b className="mono">{f}</b>
                    <small>{app.sandbox[f].length} chars</small>
                  </span>
                </button>
                <IconBtn
                  name="trash"
                  title={`Delete ${f}`}
                  onClick={() => {
                    const next = { ...app.sandbox };
                    delete next[f];
                    app.setSandbox(next);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Sheet open={!!fileOpen} onClose={() => setFileOpen(null)} title={fileOpen ?? ''} sub="Sandbox file">
        <pre className="md-code" style={{ maxHeight: '50dvh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {fileOpen ? app.sandbox[fileOpen] : ''}
        </pre>
      </Sheet>
    </Shell>
  );
}
