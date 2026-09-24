import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Chips, Field, Input, Pill, SectionTitle, Sheet, Textarea } from '../components.tsx';
import { useApp } from '../state.tsx';
import { TOOLS, TOOL_GROUPS } from '../../core/tools.ts';
import type { ToolCallRecord, ToolSpec } from '../../core/types.ts';
import { networkAllowed } from '../../core/privacy.ts';
import { fmtMs } from '../../core/util.ts';

const GROUP_ICON: Record<string, string> = {
  compute: 'chart', text: 'type', data: 'layers', files: 'file', code: 'code', network: 'link', memory: 'memory', agent: 'agent',
};

export default function Tools() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [open, setOpen] = useState<ToolSpec | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolCallRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const netOk = networkAllowed(app.settings.privacy);
  const shown = useMemo(
    () =>
      TOOLS.filter((t) => (group === 'all' || t.group === group) && (!q.trim() || `${t.name} ${t.desc}`.toLowerCase().includes(q.toLowerCase()))),
    [q, group],
  );

  const openTool = (t: ToolSpec) => {
    setOpen(t);
    setResult(null);
    setArgs(Object.fromEntries(t.params.map((p) => [p.name, ''])));
  };

  const run = async () => {
    if (!open) return;
    setBusy(true);
    const payload: Record<string, unknown> = {};
    for (const p of open.params) {
      const v = args[p.name];
      if (v === undefined || v === '') continue;
      payload[p.name] = p.type === 'number' ? Number(v) : p.type === 'boolean' ? v === 'true' : v;
    }
    const rec = await app.runTool(open.name, payload);
    setResult(rec);
    setBusy(false);
  };

  return (
    <Shell title="Tools" sub={`${TOOLS.length} registered \u00b7 ${TOOL_GROUPS.length} groups`}>
      <Input placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tools" />
      <div style={{ marginTop: 10 }}>
        <Chips
          value={group}
          onChange={setGroup}
          options={[{ value: 'all', label: 'All' }, ...TOOL_GROUPS.map((g) => ({ value: g, label: g }))]}
        />
      </div>

      {!netOk && (
        <Card tight className="">
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon name="shield" size={16} />
            <div className="muted" style={{ fontSize: '0.83rem' }}>
              Strict privacy is on, so the four network tools are blocked. They are listed but will refuse to run and tell you why.
            </div>
          </div>
        </Card>
      )}

      <SectionTitle>{shown.length} tool{shown.length === 1 ? '' : 's'}</SectionTitle>
      <div className="list">
        {shown.map((t) => {
          const blocked = t.network && !netOk;
          return (
            <button key={t.name} type="button" className="item" onClick={() => openTool(t)}>
              <span className={`ico${t.effect === 'A' ? '' : ' alt'}`}>
                <Icon name={(GROUP_ICON[t.group] ?? 'tools') as never} size={16} />
              </span>
              <span className="txt">
                <b className="mono">{t.name}</b>
                <small className="wrap">{t.desc}</small>
              </span>
              {blocked ? <Pill tone="warn">blocked</Pill> : t.approval ? <Pill tone="info">approval</Pill> : <Pill>{t.effect}</Pill>}
            </button>
          );
        })}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} sub={open?.desc}>
        {open && (
          <>
            <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
              <Pill tone="accent">{open.group}</Pill>
              <Pill>effect class {open.effect}</Pill>
              {open.network && <Pill tone={netOk ? 'info' : 'warn'}>network</Pill>}
              {open.approval && <Pill tone="warn">needs approval</Pill>}
            </div>
            {open.params.length === 0 && <p className="muted">This tool takes no arguments.</p>}
            {open.params.map((p) => (
              <Field key={p.name} label={`${p.name}${p.required ? ' *' : ''}`} hint={p.desc}>
                {p.desc.length > 40 || p.name === 'text' || p.name === 'code' || p.name === 'json' || p.name === 'csv' ? (
                  <Textarea
                    value={args[p.name] ?? ''}
                    onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
                    className={p.name === 'code' ? 'code' : ''}
                    rows={3}
                  />
                ) : (
                  <Input
                    type={p.type === 'number' ? 'number' : 'text'}
                    value={args[p.name] ?? ''}
                    onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
            <Btn block variant="primary" icon="play" onClick={() => void run()} disabled={busy}>
              {busy ? 'Running\u2026' : 'Run tool'}
            </Btn>

            {result && (
              <div className="card tight" style={{ marginTop: 14 }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <Pill tone={result.ok ? 'ok' : result.blocked ? 'warn' : 'bad'}>{result.ok ? 'ok' : result.blocked ? result.reason ?? 'blocked' : 'failed'}</Pill>
                  <small className="dim">{fmtMs(result.ms)}</small>
                </div>
                <div style={{ fontSize: '0.88rem', lineHeight: 1.55 }}>{result.summary}</div>
                {result.detail && <pre className="md-code" style={{ maxHeight: 240, overflow: 'auto' }}>{result.detail}</pre>}
              </div>
            )}
          </>
        )}
      </Sheet>
    </Shell>
  );
}
