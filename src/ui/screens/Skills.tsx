import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Empty, Field, IconBtn, Input, Pill, SectionTitle, Select, Sheet, Textarea, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { blankSkill, matchSkill, runSkill, validateSkill } from '../../core/skills.ts';
import { toolNames } from '../../core/tools.ts';
import type { Skill, SkillResult } from '../../core/types.ts';
import { fmtMs } from '../../core/util.ts';

export default function Skills() {
  const app = useApp();
  const [edit, setEdit] = useState<Skill | null>(null);
  const [runFor, setRunFor] = useState<Skill | null>(null);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<SkillResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const names = useMemo(() => toolNames(), []);
  const issues = useMemo(() => (edit ? validateSkill(edit, names) : []), [edit, names]);

  const run = async () => {
    if (!runFor) return;
    setBusy(true);
    setResult(null);
    const t0 = Date.now();
    const r = await runSkill(runFor, input, { runTool: app.runTool });
    setResult(r);
    app.addTrace({ kind: 'skill', label: runFor.name, ms: Date.now() - t0, ok: r.ok, toolCount: r.steps.length });
    setBusy(false);
  };

  return (
    <Shell
      title="Skills"
      sub={`${app.skills.length} saved \u00b7 deterministic, no model call`}
      actions={<IconBtn name="plus" title="New skill" onClick={() => setEdit(blankSkill())} />}
    >
      <Card tight>
        <div className="muted" style={{ fontSize: '0.84rem' }}>
          A skill is a fixed sequence of tool calls. Bind a step&rsquo;s output with <code className="inline">as</code>, then reference it later as{' '}
          <code className="inline">{'{{name}}'}</code>. <code className="inline">{'{{input}}'}</code> is whatever you pass in. Run one from chat by typing{' '}
          <code className="inline">/trigger</code>.
        </div>
      </Card>

      {app.skills.length === 0 ? (
        <Empty icon="skills" title="No skills yet" action={<Btn variant="primary" icon="plus" onClick={() => setEdit(blankSkill())}>Create a skill</Btn>}>
          Skills turn a repeated sequence into one tap, with no latency and no token cost.
        </Empty>
      ) : (
        <>
          <SectionTitle>Your skills</SectionTitle>
          <div className="list">
            {app.skills.map((s) => (
              <div className="item" key={s.id}>
                <button
                  type="button"
                  className="grow row"
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
                  onClick={() => {
                    setRunFor(s);
                    setInput('');
                    setResult(null);
                  }}
                >
                  <span className="ico">
                    <Icon name="skills" size={16} />
                  </span>
                  <span className="txt">
                    <b>{s.name}</b>
                    <small className="wrap">{s.desc || `${s.steps.length} steps`}</small>
                  </span>
                </button>
                {s.trigger && <Pill tone="accent">/{s.trigger}</Pill>}
                <IconBtn name="edit" title={`Edit ${s.name}`} onClick={() => setEdit(structuredClone(s))} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- run sheet ---------- */}
      <Sheet open={!!runFor} onClose={() => setRunFor(null)} title={runFor?.name ?? ''} sub={runFor?.desc}>
        {runFor && (
          <>
            <div className="stack sm" style={{ marginBottom: 14 }}>
              {runFor.steps.map((st, i) => (
                <div className="row" key={i} style={{ gap: 8, fontSize: '0.82rem' }}>
                  <Pill>{i + 1}</Pill>
                  <span className="mono grow">{st.tool}</span>
                  {st.as && <Pill tone="info">{`\u2192 ${st.as}`}</Pill>}
                </div>
              ))}
            </div>
            <Field label="Input" hint="Available to every step as {{input}}.">
              <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
            </Field>
            <Btn block variant="primary" icon="play" onClick={() => void run()} disabled={busy}>
              {busy ? 'Running\u2026' : 'Run skill'}
            </Btn>
            {result && (
              <div className="card tight" style={{ marginTop: 14 }}>
                <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
                  <Pill tone={result.ok ? 'ok' : 'bad'}>{result.ok ? 'completed' : 'stopped'}</Pill>
                  {result.steps.map((s, i) => (
                    <Pill key={i} tone={s.ok ? 'ok' : 'bad'}>
                      {s.tool} {fmtMs(s.ms)}
                    </Pill>
                  ))}
                </div>
                <pre className="md-code" style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{result.output}</pre>
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* ---------- editor sheet ---------- */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.builtin ? 'Edit built-in skill' : 'Skill editor'} sub="Steps run top to bottom and stop on the first failure.">
        {edit && (
          <>
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={edit.desc} onChange={(e) => setEdit({ ...edit, desc: e.target.value })} />
            </Field>
            <Field label="Chat trigger" hint="Typing /trigger in chat runs this skill with the rest of the line as input.">
              <Input value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value.replace(/[^\w-]/g, '') })} />
            </Field>

            <SectionTitle>Steps</SectionTitle>
            {edit.steps.map((st, i) => (
              <div className="card tight" key={i} style={{ marginBottom: 8 }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <Pill>step {i + 1}</Pill>
                  <IconBtn
                    name="trash"
                    title={`Remove step ${i + 1}`}
                    onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, n) => n !== i) })}
                  />
                </div>
                <Field label="Tool">
                  <Select
                    value={st.tool}
                    onChange={(v) => setEdit({ ...edit, steps: edit.steps.map((x, n) => (n === i ? { ...x, tool: v, args: {} } : x)) })}
                    options={names.map((n) => ({ value: n, label: n }))}
                  />
                </Field>
                <Field label="Arguments (JSON)" hint="Values may use {{input}} and any earlier binding.">
                  <Textarea
                    className="code"
                    rows={2}
                    value={JSON.stringify(st.args)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value) as Record<string, string>;
                        setEdit({ ...edit, steps: edit.steps.map((x, n) => (n === i ? { ...x, args: parsed } : x)) });
                      } catch {
                        /* keep the last valid value; the field shows what was typed until it parses */
                      }
                    }}
                  />
                </Field>
                <Field label="Bind result as" hint="Optional. Referenced later as {{name}}.">
                  <Input value={st.as ?? ''} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x, n) => (n === i ? { ...x, as: e.target.value || undefined } : x)) })} />
                </Field>
              </div>
            ))}
            <Btn block icon="plus" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { tool: names[0], args: {} }] })}>
              Add step
            </Btn>

            {issues.length > 0 && (
              <div className="card tight" style={{ marginTop: 12, borderColor: 'color-mix(in oklab, var(--danger) 40%, transparent)' }}>
                {issues.map((iss, i) => (
                  <div key={i} style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>
                    {iss.step >= 0 ? `Step ${iss.step + 1}: ` : ''}
                    {iss.message}
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {!edit.builtin && (
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() =>
                    confirm({
                      title: `Delete "${edit.name}"?`,
                      body: 'This removes the skill from this device. It cannot be undone.',
                      danger: true,
                      onYes: () => {
                        app.deleteSkill(edit.id);
                        setEdit(null);
                      },
                    })
                  }
                >
                  Delete
                </Btn>
              )}
              <Btn
                block
                variant="primary"
                icon="check"
                disabled={issues.some((i) => i.step === -1) || issues.length > 0}
                onClick={() => {
                  app.saveSkill({ ...edit, updated: Date.now() });
                  app.toast(`Saved "${edit.name}"`, 'ok');
                  setEdit(null);
                }}
              >
                Save skill
              </Btn>
            </div>
          </>
        )}
      </Sheet>
      {confirmNode}
    </Shell>
  );
}

export { matchSkill };
