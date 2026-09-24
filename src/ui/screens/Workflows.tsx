import { useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Empty, IconBtn, Pill, SectionTitle, Sheet, Field, Textarea } from '../components.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import { NODE_KIND_COUNT, blankWorkflow, runWorkflow, seedWorkflows, validateWorkflow } from '../../core/workflow.ts';
import type { Workflow, WorkflowRun } from '../../core/types.ts';
import { fmtMs, fmtWhen } from '../../core/util.ts';

export default function Workflows() {
  const app = useApp();
  const [runFor, setRunFor] = useState<Workflow | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<WorkflowRun | null>(null);

  const create = () => {
    const wf = blankWorkflow();
    app.saveWorkflow(wf);
    navigate(`/app/workflows/${wf.id}`);
  };

  const run = async () => {
    if (!runFor) return;
    setBusy(true);
    setLast(null);
    const r = await runWorkflow(runFor, {
      input,
      runTool: async (tool, args) => {
        const rec = await app.runTool(tool, args);
        return { ok: rec.ok, summary: rec.summary, detail: rec.detail };
      },
      ask: async (prompt, mode) => {
        const res = await app.ask(prompt, mode);
        return { ok: res.ok, text: res.text, error: res.error, blocked: res.blocked };
      },
      memoryWrite: (text, kind) => app.addMemory({ text, kind: kind as never, tags: ['workflow'], source: 'workflow' }),
      memorySearch: (q, limit) => app.memory.filter((m) => m.text.toLowerCase().includes(q.toLowerCase())).slice(0, limit).map((m) => m.text),
      notify: (msg) => app.toast(msg, 'info'),
    });
    setLast(r);
    app.addRun(r);
    app.addTrace({ kind: 'workflow', label: runFor.name, ms: r.finished - r.started, ok: r.status === 'ok', toolCount: r.nodes.filter((n) => n.kind === 'tool').length });
    setBusy(false);
  };

  return (
    <Shell
      title="Workflows"
      sub={`${app.workflows.length} saved \u00b7 ${NODE_KIND_COUNT} node kinds`}
      actions={<IconBtn name="plus" title="New workflow" onClick={create} />}
    >
      {app.workflows.length === 0 ? (
        <Empty
          icon="flow"
          title="No workflows"
          action={
            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              <Btn variant="primary" icon="plus" onClick={create}>
                Blank workflow
              </Btn>
              <Btn
                onClick={() => {
                  for (const w of seedWorkflows()) app.saveWorkflow(w);
                  app.toast('Added 3 templates', 'ok');
                }}
              >
                Add templates
              </Btn>
            </div>
          }
        >
          A workflow wires tools, logic and model calls into a graph that runs the same way every time.
        </Empty>
      ) : (
        <>
          <SectionTitle>Your workflows</SectionTitle>
          <div className="list">
            {app.workflows.map((w) => {
              const issues = validateWorkflow(w);
              const errs = issues.filter((i) => i.level === 'error').length;
              return (
                <div className="item" key={w.id}>
                  <button
                    type="button"
                    className="grow row"
                    style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
                    onClick={() => navigate(`/app/workflows/${w.id}`)}
                  >
                    <span className="ico">
                      <Icon name="flow" size={16} />
                    </span>
                    <span className="txt">
                      <b>{w.name}</b>
                      <small>
                        {w.nodes.length} nodes &middot; {w.edges.length} links &middot; {fmtWhen(w.updated)}
                      </small>
                    </span>
                  </button>
                  {errs > 0 && <Pill tone="bad">{errs}</Pill>}
                  <IconBtn
                    name="play"
                    title={`Run ${w.name}`}
                    onClick={() => {
                      setRunFor(w);
                      setInput('');
                      setLast(null);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {app.runs.length > 0 && (
        <>
          <SectionTitle>Recent runs</SectionTitle>
          <div className="list">
            {app.runs.slice(0, 6).map((r) => {
              const wf = app.workflows.find((w) => w.id === r.workflowId);
              return (
                <div className="item" key={r.id} style={{ cursor: 'default' }}>
                  <span className={`ico${r.status === 'ok' ? '' : ' alt'}`}>
                    <Icon name={r.status === 'ok' ? 'check' : r.status === 'blocked' ? 'shield' : 'warn'} size={15} />
                  </span>
                  <span className="txt">
                    <b>{wf?.name ?? r.workflowId}</b>
                    <small>
                      {r.nodes.filter((n) => n.status === 'ok').length}/{r.nodes.length} nodes ok &middot; {fmtMs(r.finished - r.started)} &middot; {fmtWhen(r.started)}
                    </small>
                  </span>
                  <Pill tone={r.status === 'ok' ? 'ok' : r.status === 'blocked' ? 'warn' : 'bad'}>{r.status}</Pill>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Sheet open={!!runFor} onClose={() => setRunFor(null)} title={runFor?.name ?? ''} sub={runFor?.desc || 'Runs on this device.'}>
        <Field label="Run input" hint="Available to every node as {{input}}.">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
        </Field>
        <Btn block variant="primary" icon="play" onClick={() => void run()} disabled={busy}>
          {busy ? 'Running\u2026' : 'Run workflow'}
        </Btn>
        {last && (
          <Card tight className="" >
            <div className="row between" style={{ marginBottom: 10 }}>
              <Pill tone={last.status === 'ok' ? 'ok' : last.status === 'blocked' ? 'warn' : 'bad'}>{last.status}</Pill>
              <small className="dim">{fmtMs(last.finished - last.started)}</small>
            </div>
            <div className="stack sm">
              {last.nodes.map((n) => (
                <div className="row" key={n.nodeId} style={{ gap: 8, fontSize: '0.8rem', alignItems: 'flex-start' }}>
                  <Pill tone={n.status === 'ok' ? 'ok' : n.status === 'failed' ? 'bad' : n.status === 'blocked' ? 'warn' : 'default'}>{n.status}</Pill>
                  <span className="mono">{n.kind}</span>
                  <span className="grow dim" style={{ wordBreak: 'break-word' }}>{n.reason ?? n.output.slice(0, 120)}</span>
                </div>
              ))}
            </div>
            {last.log.length > 0 && <pre className="md-code" style={{ marginTop: 10 }}>{last.log.join('\n')}</pre>}
          </Card>
        )}
      </Sheet>
    </Shell>
  );
}
