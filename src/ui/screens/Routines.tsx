import { useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Empty, Field, IconBtn, Input, Pill, SectionTitle, Select, Sheet } from '../components.tsx';
import { useApp } from '../state.tsx';
import { blankRoutine, describeSchedule, isDue } from '../../core/routines.ts';
import type { Routine } from '../../core/types.ts';
import { fmtWhen } from '../../core/util.ts';

export default function Routines() {
  const app = useApp();
  const [edit, setEdit] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const targets = (type: Routine['action']['type']) =>
    type === 'skill'
      ? app.skills.map((s) => ({ value: s.id, label: s.name }))
      : type === 'workflow'
        ? app.workflows.map((w) => ({ value: w.id, label: w.name }))
        : [{ value: 'prompt', label: 'Free-text prompt' }];

  const runNow = async (r: Routine) => {
    setBusy(r.id);
    const out = await app.runRoutine(r);
    app.toast(`${r.name}: ${out.note || (out.ok ? 'done' : 'failed')}`, out.ok ? 'ok' : 'err');
    setBusy(null);
  };

  return (
    <Shell title="Routines" sub={`${app.routines.length} defined`} actions={<IconBtn name="plus" title="New routine" onClick={() => setEdit(blankRoutine())} />}>
      <Card tight>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon name="info" size={16} />
          <div className="muted" style={{ fontSize: '0.83rem' }}>
            A web page cannot wake itself up. While this app is open it checks every 30 seconds and runs anything that is due; scheduled routines
            otherwise wait until the next time you open the app, and interval routines only tick while it is
            open. That is a real limitation of the platform, not a setting you can turn off &mdash; so nothing here pretends to run in the background.
          </div>
        </div>
      </Card>

      {app.routines.length === 0 ? (
        <Empty icon="routine" title="No routines" action={<Btn variant="primary" icon="plus" onClick={() => setEdit(blankRoutine())}>Create one</Btn>}>
          Point a routine at a skill or workflow, and it becomes one tap &mdash; or fires automatically when you next open the app.
        </Empty>
      ) : (
        <>
          <SectionTitle>Your routines</SectionTitle>
          <div className="list">
            {app.routines.map((r) => {
              const due = isDue(r, Date.now());
              return (
                <div className="item" key={r.id} style={{ alignItems: 'flex-start' }}>
                  <span className={`ico${r.enabled ? '' : ' alt'}`}>
                    <Icon name="routine" size={15} />
                  </span>
                  <span className="txt">
                    <b>
                      {r.name} {due && <Pill tone="accent">due</Pill>}
                    </b>
                    <small className="wrap">
                      {describeSchedule(r)} &middot; {r.action.type}: {r.action.ref || 'not set'}
                      {r.lastRun ? ` \u00b7 last ${fmtWhen(r.lastRun)}` : ''}
                      {r.runs ? ` \u00b7 ${r.runs} runs` : ''}
                    </small>
                  </span>
                  <IconBtn name={busy === r.id || app.routineBusy.includes(r.id) ? 'pause' : 'play'} title={`Run ${r.name}`} onClick={() => void runNow(r)} />
                  <IconBtn name="edit" title={`Edit ${r.name}`} onClick={() => setEdit({ ...r })} />
                </div>
              );
            })}
          </div>
        </>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Routine" sub="Runs on this device only.">
        {edit && (
          <>
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="When">
              <Select
                value={edit.when}
                onChange={(v) => setEdit({ ...edit, when: v as Routine['when'] })}
                options={[
                  { value: 'manual', label: 'Manual \u2014 only when I tap it' },
                  { value: 'startup', label: 'On app open' },
                  { value: 'interval', label: 'Every N minutes while open' },
                  { value: 'daily', label: 'Daily, next time the app is open' },
                ]}
              />
            </Field>
            {edit.when === 'interval' && (
              <Field label="Every (minutes)">
                <Input type="number" min={1} value={edit.everyMin ?? 60} onChange={(e) => setEdit({ ...edit, everyMin: Number(e.target.value) })} />
              </Field>
            )}
            {edit.when === 'daily' && (
              <Field label="Hour (0-23)">
                <Input type="number" min={0} max={23} value={edit.atHour ?? 8} onChange={(e) => setEdit({ ...edit, atHour: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Action type">
              <Select
                value={edit.action.type}
                onChange={(v) => setEdit({ ...edit, action: { type: v as Routine['action']['type'], ref: '' } })}
                options={[
                  { value: 'skill', label: 'Run a skill' },
                  { value: 'workflow', label: 'Run a workflow' },
                  { value: 'prompt', label: 'Send a prompt' },
                ]}
              />
            </Field>
            {edit.action.type === 'prompt' ? (
              <Field label="Prompt">
                <Input value={edit.action.ref} onChange={(e) => setEdit({ ...edit, action: { ...edit.action, ref: e.target.value } })} />
              </Field>
            ) : (
              <Field label="Target">
                <Select
                  value={edit.action.ref}
                  onChange={(v) => setEdit({ ...edit, action: { ...edit.action, ref: v } })}
                  options={[{ value: '', label: 'Choose\u2026' }, ...targets(edit.action.type)]}
                />
              </Field>
            )}
            <div className="switchrow">
              <div className="t">
                <b>Enabled</b>
                <small>Disabled routines never fire automatically, but you can still run them by hand.</small>
              </div>
              <button type="button" role="switch" aria-checked={edit.enabled} aria-label="Enabled" className="switch" onClick={() => setEdit({ ...edit, enabled: !edit.enabled })} />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {app.routines.some((r) => r.id === edit.id) && (
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => {
                    app.deleteRoutine(edit.id);
                    setEdit(null);
                  }}
                >
                  Delete
                </Btn>
              )}
              <Btn
                block
                variant="primary"
                icon="check"
                disabled={!edit.name.trim() || (edit.action.type !== 'prompt' && !edit.action.ref)}
                onClick={() => {
                  app.saveRoutine(edit);
                  setEdit(null);
                  app.toast('Routine saved', 'ok');
                }}
              >
                Save
              </Btn>
            </div>
          </>
        )}
      </Sheet>
    </Shell>
  );
}
