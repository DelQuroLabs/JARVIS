import { useCallback, useMemo, useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Field, IconBtn, Input, Pill, SectionTitle, Select, Sheet, Textarea, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import {
  NODE_KINDS, NODE_MAP, runWorkflow, toolOptions, validateWorkflow, wouldCycle,
} from '../../core/workflow.ts';
import type { NodeRun, WFNode, Workflow, WorkflowRun } from '../../core/types.ts';
import { fmtMs, uid } from '../../core/util.ts';

const NODE_W = 168;
const NODE_H = 84;

export default function WorkflowEditor({ id }: { id: string }) {
  const app = useApp();
  const stored = app.workflows.find((w) => w.id === id);
  const [wf, setWf] = useState<Workflow | null>(stored ? structuredClone(stored) : null);
  const [sel, setSel] = useState<string | null>(null);
  const [armed, setArmed] = useState<{ from: string; port: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [input, setInput] = useState('');
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const planeRef = useRef<HTMLDivElement>(null);

  const tools = useMemo(() => toolOptions(), []);
  const issues = useMemo(() => (wf ? validateWorkflow(wf) : []), [wf]);
  const statuses = useMemo(() => {
    const m = new Map<string, NodeRun>();
    for (const n of run?.nodes ?? []) m.set(n.nodeId, n);
    return m;
  }, [run]);

  const commit = useCallback(
    (next: Workflow) => {
      setWf(next);
      app.saveWorkflow({ ...next, updated: Date.now() });
    },
    [app],
  );

  if (!wf) {
    return (
      <Shell title="Workflow" back="/app/workflows">
        <Card>
          <p className="muted">That workflow no longer exists on this device.</p>
          <Btn variant="primary" onClick={() => navigate('/app/workflows')}>
            Back to workflows
          </Btn>
        </Card>
      </Shell>
    );
  }

  const node = wf.nodes.find((n) => n.id === sel) ?? null;
  const kindOf = (n: WFNode) => NODE_MAP[n.kind];

  const onPointerDown = (e: React.PointerEvent, n: WFNode) => {
    if ((e.target as HTMLElement).closest('.wf-port, .wf-in')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = planeRef.current?.getBoundingClientRect();
    drag.current = { id: n.id, dx: e.clientX - (rect?.left ?? 0) - n.x, dy: e.clientY - (rect?.top ?? 0) - n.y };
    setSel(n.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const rect = planeRef.current?.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - (rect?.left ?? 0) - d.dx));
    const y = Math.max(0, Math.round(e.clientY - (rect?.top ?? 0) - d.dy));
    setWf((w) => (w ? { ...w, nodes: w.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) } : w));
  };

  const onPointerUp = () => {
    if (drag.current && wf) app.saveWorkflow({ ...wf, updated: Date.now() });
    drag.current = null;
  };

  const connect = (to: string) => {
    if (!armed) return;
    if (armed.from === to) {
      setArmed(null);
      return;
    }
    if (wouldCycle(wf.nodes, wf.edges, armed.from, to)) {
      app.toast('Refused: that link would create a cycle. Workflows must be acyclic.', 'err');
      setArmed(null);
      return;
    }
    const dupe = wf.edges.find((e) => e.from === armed.from && e.fromPort === armed.port && e.to === to);
    if (dupe) {
      setArmed(null);
      return;
    }
    commit({ ...wf, edges: [...wf.edges, { id: uid('e'), from: armed.from, fromPort: armed.port, to }] });
    setArmed(null);
  };

  const addNode = (kind: string) => {
    const n: WFNode = { id: uid('n'), kind, x: 60 + wf.nodes.length * 18, y: 60 + wf.nodes.length * 26, config: {} };
    commit({ ...wf, nodes: [...wf.nodes, n] });
    setSel(n.id);
    setAdding(false);
  };

  const removeNode = (nid: string) => {
    commit({ ...wf, nodes: wf.nodes.filter((n) => n.id !== nid), edges: wf.edges.filter((e) => e.from !== nid && e.to !== nid) });
    setSel(null);
  };

  const doRun = async () => {
    setBusy(true);
    setRun(null);
    const r = await runWorkflow(wf, {
      input,
      runTool: async (tool, args) => {
        const rec = await app.runTool(tool, args);
        return { ok: rec.ok, summary: rec.summary, detail: rec.detail };
      },
      ask: async (prompt, mode) => {
        const res = await app.ask(prompt, mode);
        return { ok: res.ok, text: res.text };
      },
      memoryWrite: (text, kind) => app.addMemory({ text, kind: kind as never, tags: ['workflow'], source: 'workflow' }),
      memorySearch: (q, limit) => app.memory.filter((m) => m.text.toLowerCase().includes(q.toLowerCase())).slice(0, limit).map((m) => m.text),
      notify: (msg) => app.toast(msg, 'info'),
    });
    setRun(r);
    app.addRun(r);
    app.addTrace({ kind: 'workflow', label: wf.name, ms: r.finished - r.started, ok: r.status === 'ok', toolCount: r.nodes.filter((n) => n.kind === 'tool').length });
    setBusy(false);
  };

  const wire = (fromId: string, port: string, toId: string) => {
    const a = wf.nodes.find((n) => n.id === fromId);
    const b = wf.nodes.find((n) => n.id === toId);
    if (!a || !b) return null;
    const k = kindOf(a);
    const idx = Math.max(0, k?.outputs.indexOf(port) ?? 0);
    const x1 = a.x + NODE_W;
    const y1 = a.y + 30 + idx * 12;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  };

  return (
    <Shell
      title={wf.name}
      sub={`${wf.nodes.length} nodes \u00b7 ${wf.edges.length} links`}
      back="/app/workflows"
      wide
      actions={
        <>
          <IconBtn name="plus" title="Add node" onClick={() => setAdding(true)} />
          <IconBtn name="play" title="Run workflow" onClick={() => setRunOpen(true)} />
        </>
      }
    >
      {armed && (
        <Card tight className="">
          <div className="row" style={{ gap: 10 }}>
            <Icon name="link" size={16} />
            <span className="grow" style={{ fontSize: '0.85rem' }}>
              Connecting from <b className="mono">{armed.port}</b>. Tap the round input on the target node.
            </span>
            <Btn size="sm" onClick={() => setArmed(null)}>
              Cancel
            </Btn>
          </div>
        </Card>
      )}

      <div className="canvas-wrap">
        <div className="canvas">
          <div className="plane" ref={planeRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
            <svg className="wires" width="1600" height="1200" aria-hidden="true">
              {wf.edges.map((e) => {
                const d = wire(e.from, e.fromPort, e.to);
                const st = statuses.get(e.from);
                return d ? <path key={e.id} d={d} className={st?.status === 'ok' ? 'live' : ''} /> : null;
              })}
            </svg>
            {wf.nodes.map((n) => {
              const k = kindOf(n);
              const st = statuses.get(n.id);
              return (
                <div
                  key={n.id}
                  className={`wf-node${sel === n.id ? ' sel' : ''}${st ? ` ${st.status}` : ''}`}
                  style={{ left: n.x, top: n.y }}
                  onPointerDown={(e) => onPointerDown(e, n)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${k?.label ?? n.kind} node`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSel(n.id);
                    }
                  }}
                >
                  {(k?.inputs ?? 0) > 0 && (
                    <button
                      type="button"
                      className={`wf-in${armed ? ' armed' : ''}`}
                      aria-label={`Input of ${k?.label}`}
                      title="Input"
                      onClick={(e) => {
                        e.stopPropagation();
                        connect(n.id);
                      }}
                    />
                  )}
                  <div className="k">{k?.group ?? '?'}</div>
                  <div className="n">{k?.label ?? n.kind}</div>
                  <div className="c">{Object.values(n.config).filter(Boolean)[0]?.slice(0, 24) || (st?.reason ?? '\u2014')}</div>
                  <div className="wf-ports">
                    {(k?.outputs ?? []).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`wf-port${armed?.from === n.id && armed.port === p ? ' armed' : ''}`}
                        title={`Connect from ${p}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setArmed({ from: n.id, port: p });
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <Btn size="sm" icon="plus" onClick={() => setAdding(true)}>
          Add node
        </Btn>
        <Btn size="sm" icon="play" variant="primary" onClick={() => setRunOpen(true)}>
          Run
        </Btn>
        {sel && (
          <Btn size="sm" variant="danger" icon="trash" onClick={() => confirm({ title: 'Delete node?', body: 'Its connections are removed too.', danger: true, onYes: () => removeNode(sel) })}>
            Delete node
          </Btn>
        )}
      </div>

      {issues.length > 0 && (
        <>
          <SectionTitle>Validation</SectionTitle>
          <Card tight>
            <div className="stack sm">
              {issues.map((iss, i) => (
                <div className="row" key={i} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Pill tone={iss.level === 'error' ? 'bad' : 'warn'}>{iss.level}</Pill>
                  <span style={{ fontSize: '0.84rem' }}>{iss.message}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {node && (
        <>
          <SectionTitle>Inspector</SectionTitle>
          <Card title={kindOf(node)?.label ?? node.kind} icon="layers">
            <p className="muted" style={{ fontSize: '0.84rem' }}>{kindOf(node)?.desc}</p>
            {(kindOf(node)?.fields ?? []).map((f) => (
              <Field key={f.name} label={f.label}>
                {f.type === 'select' ? (
                  <Select
                    value={node.config[f.name] ?? ''}
                    onChange={(v) => commit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, [f.name]: v } } : x)) })}
                    options={[{ value: '', label: 'Choose\u2026' }, ...(node.kind === 'tool' && f.name === 'tool' ? tools : f.options ?? []).map((o) => ({ value: o, label: o }))]}
                  />
                ) : f.type === 'textarea' ? (
                  <Textarea
                    rows={3}
                    value={node.config[f.name] ?? ''}
                    onChange={(e) => commit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, [f.name]: e.target.value } } : x)) })}
                  />
                ) : (
                  <Input
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={node.config[f.name] ?? ''}
                    onChange={(e) => commit({ ...wf, nodes: wf.nodes.map((x) => (x.id === node.id ? { ...x, config: { ...x.config, [f.name]: e.target.value } } : x)) })}
                  />
                )}
              </Field>
            ))}
            {wf.edges.filter((e) => e.from === node.id || e.to === node.id).length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>Links</div>
                {wf.edges
                  .filter((e) => e.from === node.id || e.to === node.id)
                  .map((e) => (
                    <div className="row between" key={e.id} style={{ minHeight: 38 }}>
                      <small className="mono">
                        {wf.nodes.find((n) => n.id === e.from)?.kind}.{e.fromPort} &rarr; {wf.nodes.find((n) => n.id === e.to)?.kind}
                      </small>
                      <IconBtn name="close" title="Remove link" onClick={() => commit({ ...wf, edges: wf.edges.filter((x) => x.id !== e.id) })} />
                    </div>
                  ))}
              </>
            )}
          </Card>
        </>
      )}

      <SectionTitle>Workflow</SectionTitle>
      <Card>
        <Field label="Name">
          <Input value={wf.name} onChange={(e) => commit({ ...wf, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Input value={wf.desc} onChange={(e) => commit({ ...wf, desc: e.target.value })} />
        </Field>
        <Btn
          variant="danger"
          icon="trash"
          onClick={() =>
            confirm({
              title: `Delete "${wf.name}"?`,
              body: 'The workflow and its graph are removed from this device.',
              danger: true,
              onYes: () => {
                app.deleteWorkflow(wf.id);
                navigate('/app/workflows');
              },
            })
          }
        >
          Delete workflow
        </Btn>
      </Card>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a node" sub={`${NODE_KINDS.length} kinds available`}>
        {(['trigger', 'io', 'logic', 'data', 'action', 'agent'] as const).map((g) => (
          <div key={g}>
            <div className="section-title">{g}</div>
            <div className="list">
              {NODE_KINDS.filter((k) => k.group === g).map((k) => (
                <button key={k.kind} type="button" className="item" onClick={() => addNode(k.kind)}>
                  <span className="txt">
                    <b>{k.label}</b>
                    <small className="wrap">{k.desc}</small>
                  </span>
                  <Icon name="plus" size={16} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </Sheet>

      <Sheet open={runOpen} onClose={() => setRunOpen(false)} title={`Run ${wf.name}`} sub="Node borders on the canvas show the result of the last run.">
        <Field label="Run input" hint="Available to every node as {{input}}.">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
        </Field>
        <Btn block variant="primary" icon="play" onClick={() => void doRun()} disabled={busy || issues.some((i) => i.level === 'error')}>
          {busy ? 'Running\u2026' : 'Run'}
        </Btn>
        {issues.some((i) => i.level === 'error') && <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>Fix the validation errors first.</div>}
        {run && (
          <div className="card tight" style={{ marginTop: 14 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <Pill tone={run.status === 'ok' ? 'ok' : run.status === 'blocked' ? 'warn' : 'bad'}>{run.status}</Pill>
              <small className="dim">{fmtMs(run.finished - run.started)}</small>
            </div>
            <div className="stack sm">
              {run.nodes.map((n) => (
                <div className="row" key={n.nodeId} style={{ gap: 8, fontSize: '0.8rem', alignItems: 'flex-start' }}>
                  <Pill tone={n.status === 'ok' ? 'ok' : n.status === 'failed' ? 'bad' : n.status === 'blocked' ? 'warn' : 'default'}>{n.status}</Pill>
                  <span className="mono">{n.kind}</span>
                  <span className="grow dim" style={{ wordBreak: 'break-word' }}>{n.reason ?? n.output.slice(0, 140)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Sheet>
      {confirmNode}
    </Shell>
  );
}
