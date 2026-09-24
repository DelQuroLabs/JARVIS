import { useMemo, useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Empty, Field, IconBtn, Pill, SectionTitle, Sheet, Textarea } from '../components.tsx';
import Markdown from '../components.tsx';
import { useApp } from '../state.tsx';
import { DEPARTMENTS, PRESETS, ROLES, missingTools, rolesOf, runCrew } from '../../core/crew.ts';
import { toolNames } from '../../core/tools.ts';
import type { CrewRun } from '../../core/types.ts';
import { fmtMs, fmtWhen } from '../../core/util.ts';

export default function Crew() {
  const app = useApp();
  const [preset, setPreset] = useState('ship');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<CrewRun | null>(null);
  const [openRun, setOpenRun] = useState<CrewRun | null>(null);
  const [roster, setRoster] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const roles = rolesOf(preset);
  const gaps = useMemo(() => missingTools(toolNames()), []);

  const run = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    const t0 = Date.now();
    setLive({ id: 'live', brief, presetId: preset, turns: [], started: t0, finished: 0, status: 'ok' });
    const result = await runCrew(brief.trim(), preset, {
      ask: async (prompt) => {
        const r = await app.ask(prompt);
        return { ok: r.ok, text: r.text, via: r.via };
      },
      onTurn: (t) => setLive((prev) => (prev ? { ...prev, turns: [...prev.turns, t] } : prev)),
      signal: ac.signal,
      gapMs: 900,
    });
    setLive(null);
    app.addCrewRun(result);
    setOpenRun(result);
    app.addTrace({ kind: 'crew', label: brief.slice(0, 50), ms: Date.now() - t0, ok: result.status === 'ok', toolCount: 0 });
    setBusy(false);
    abort.current = null;
  };

  const showing = live ?? openRun;

  return (
    <Shell
      title="Crew"
      sub={`${ROLES.length} roles \u00b7 ${DEPARTMENTS.length} departments \u00b7 ${PRESETS.length} presets`}
      actions={busy ? <IconBtn name="stop" title="Stop" onClick={() => abort.current?.abort()} /> : <IconBtn name="crew" title="Roster" onClick={() => setRoster(true)} />}
    >
      <Card tight>
        <div className="muted" style={{ fontSize: '0.84rem' }}>
          Roles run in sequence and each one sees the whole prior transcript, so it is a conversation rather than parallel answers stapled together.
          On a free provider that means one model call per role &mdash; expect rate limits on the longer presets.
        </div>
      </Card>

      <SectionTitle>Preset</SectionTitle>
      <div className="stack sm">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="item" style={{ borderColor: p.id === preset ? 'var(--accent)' : undefined }} onClick={() => setPreset(p.id)} aria-pressed={p.id === preset}>
            <span className="ico">
              <Icon name="crew" size={16} />
            </span>
            <span className="txt">
              <b>{p.name}</b>
              <small className="wrap">{p.desc} &middot; {p.roles.length} roles</small>
            </span>
            {p.id === preset && <Icon name="check" size={16} />}
          </button>
        ))}
      </div>

      <Card title="Brief" icon="pen">
        <Field label="What should the crew review?" hint="One paragraph is plenty. Be concrete about the decision you are trying to make.">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="e.g. We want to add offline queueing to the mobile app so actions taken on the subway sync when the user resurfaces." />
        </Field>
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {roles.map((r) => (
            <Pill key={r.id}>{r.name}</Pill>
          ))}
        </div>
        <Btn block variant="primary" icon="play" onClick={() => void run()} disabled={busy || !brief.trim()}>
          {busy ? `Running \u2014 ${live?.turns.length ?? 0}/${roles.length}` : `Run ${roles.length} roles`}
        </Btn>
        {!app.providerReady && <div className="hint" style={{ color: 'var(--warn)', marginTop: 8 }}>Crew needs a model. Without a key every role falls back to the offline core, which cannot hold a critique.</div>}
      </Card>

      {showing && showing.turns.length > 0 && (
        <>
          <SectionTitle>Transcript</SectionTitle>
          <div className="stack">
            {showing.turns.map((t, i) => (
              <Card key={i} tight>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <b style={{ fontSize: '0.92rem' }}>{t.roleName}</b>
                  <div className="row" style={{ gap: 6 }}>
                    {t.error ? <Pill tone="bad">{t.error}</Pill> : <Pill tone="ok">{t.via}</Pill>}
                    <small className="dim">{fmtMs(t.ms)}</small>
                  </div>
                </div>
                {t.text ? <Markdown text={t.text} /> : <span className="dim">No output returned for this role.</span>}
              </Card>
            ))}
            {busy && (
              <div className="row" style={{ gap: 10, padding: 12 }}>
                <span className="spinner" />
                <small className="dim">{roles[showing.turns.length]?.name ?? 'finishing'}&hellip;</small>
              </div>
            )}
          </div>
        </>
      )}

      {app.crewRuns.length > 0 && (
        <>
          <SectionTitle>Past reviews</SectionTitle>
          <div className="list">
            {app.crewRuns.slice(0, 8).map((r) => (
              <button key={r.id} type="button" className="item" onClick={() => setOpenRun(r)}>
                <span className={`ico${r.status === 'ok' ? '' : ' alt'}`}>
                  <Icon name="crew" size={15} />
                </span>
                <span className="txt">
                  <b>{r.brief.slice(0, 60)}</b>
                  <small>
                    {PRESETS.find((p) => p.id === r.presetId)?.name} &middot; {r.turns.length} turns &middot; {fmtWhen(r.started)}
                  </small>
                </span>
                <Pill tone={r.status === 'ok' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'}>{r.status}</Pill>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={roster} onClose={() => setRoster(false)} title="Roster" sub={`${ROLES.length} roles across ${DEPARTMENTS.length} departments`}>
        {gaps.length > 0 && (
          <div className="card tight" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
            <b style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Integrity problem</b>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              {gaps.map((g) => `${g.roleId} references a tool "${g.tool}" that is not registered`).join('; ')}.
            </div>
          </div>
        )}
        {DEPARTMENTS.map((d) => (
          <div key={d}>
            <div className="section-title">{d}</div>
            <div className="list">
              {ROLES.filter((r) => r.dept === d).map((r) => (
                <div className="item" key={r.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <span className="ico">
                    <Icon name={r.icon as never} size={15} />
                  </span>
                  <span className="txt">
                    <b>{r.name}</b>
                    <small className="wrap">{r.brief}</small>
                    {r.tools.length > 0 && (
                      <span className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                        {r.tools.map((t) => (
                          <Pill key={t}>{t}</Pill>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Sheet>

      {app.crewRuns.length === 0 && !showing && (
        <Empty icon="crew" title="No reviews yet">
          Write a brief above and the crew will work through it in order, each role building on what came before.
        </Empty>
      )}
    </Shell>
  );
}
