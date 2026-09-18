import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Bars, Btn, Card, Chips, Empty, Meter, Pill, SectionTitle, Stat, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { PRICES, activity, byKind, byProvider, discoverPatterns, estimate } from '../../core/traces.ts';
import { fmtMs, fmtWhen } from '../../core/util.ts';

export default function Traces() {
  const app = useApp();
  const [filter, setFilter] = useState('all');
  const [confirmNode, confirm] = useConfirm();

  const shown = useMemo(() => (filter === 'all' ? app.traces : app.traces.filter((t) => t.kind === filter)), [app.traces, filter]);
  const est = useMemo(() => estimate(app.traces), [app.traces]);
  const kinds = useMemo(() => byKind(app.traces), [app.traces]);
  const providers = useMemo(() => byProvider(app.traces), [app.traces]);
  const hours = useMemo(() => activity(app.traces).map((b) => b.value), [app.traces]);
  const patterns = useMemo(() => discoverPatterns(app.traces), [app.traces]);

  return (
    <Shell
      title="Activity"
      sub={`${app.traces.length} runs recorded on this device`}
      actions={
        app.traces.length > 0 ? (
          <Btn size="sm" icon="trash" onClick={() => confirm({ title: 'Clear activity?', body: 'Deletes every local trace. Your conversations and memory are untouched.', danger: true, onYes: () => app.clearTraces() })}>
            Clear
          </Btn>
        ) : undefined
      }
    >
      {app.traces.length === 0 ? (
        <Empty icon="trace" title="No activity yet">
          Every chat, agent run, workflow, crew review and tool call is logged here &mdash; locally, never sent anywhere.
        </Empty>
      ) : (
        <>
          <div className="grid2">
            <Stat value={est.runs} label="Runs" detail={`${est.toolCalls} tool calls`} />
            <Stat value={`${Math.round(est.successRate * 100)}%`} label="Success" detail={`avg ${fmtMs(est.avgMs)}`} />
            <Stat value={est.tokensIn + est.tokensOut} label="Tokens (est.)" detail={`${est.tokensIn} in / ${est.tokensOut} out`} />
            <Stat value={est.costUsd < 0.005 ? '$0.00' : `$${est.costUsd.toFixed(3)}`} label="Cost (est.)" detail="list prices, free tiers count as zero" />
          </div>

          <Card title="Runs per hour" icon="chart">
            <Bars data={hours} />
            <div className="row between" style={{ marginTop: 8 }}>
              <small className="dim">24h ago</small>
              <small className="dim">now</small>
            </div>
          </Card>

          <Card title="Where answers came from" icon="link">
            <div className="stack sm">
              {providers.map((p) => (
                <div key={p.label}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <small>{p.label === 'reflex' ? 'offline reflex core' : p.label}</small>
                    <small className="dim">
                      {p.value} &middot; {PRICES[p.label]?.note ?? 'unknown pricing'}
                    </small>
                  </div>
                  <Meter value={p.value} max={Math.max(...providers.map((x) => x.value))} />
                </div>
              ))}
            </div>
          </Card>

          {patterns.length > 0 && (
            <>
              <SectionTitle>Patterns</SectionTitle>
              <div className="list">
                {patterns.map((p) => (
                  <div className="item" key={p.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                    <span className={`ico${p.severity === 'warn' ? '' : ' alt'}`}>
                      <Icon name={p.severity === 'warn' ? 'warn' : 'info'} size={15} />
                    </span>
                    <span className="txt">
                      <b style={{ whiteSpace: 'normal' }}>{p.title}</b>
                      <small className="wrap">{p.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle>Log</SectionTitle>
          <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: `All ${app.traces.length}` }, ...kinds.map((k) => ({ value: k.label, label: `${k.label} ${k.value}` }))]} />
          <div className="list" style={{ marginTop: 8 }}>
            {shown.slice(0, 60).map((t) => (
              <div className="item" key={t.id} style={{ cursor: 'default' }}>
                <span className={`ico${t.ok ? '' : ' alt'}`}>
                  <Icon name={t.ok ? 'check' : 'warn'} size={14} />
                </span>
                <span className="txt">
                  <b>{t.label || t.kind}</b>
                  <small>
                    {t.kind} &middot; {fmtMs(t.ms)} &middot; {fmtWhen(t.ts)}
                    {t.toolCount ? ` \u00b7 ${t.toolCount} tools` : ''}
                  </small>
                </span>
                {t.via && <Pill tone={t.via === 'reflex' ? 'warn' : 'default'}>{t.via}</Pill>}
              </div>
            ))}
          </div>
          <p className="dim" style={{ fontSize: '0.76rem', marginTop: 14, lineHeight: 1.6 }}>
            Token counts are estimated at roughly four characters per token, and energy and cost figures are derived from published list prices &mdash;
            they are indicative, not metered. Nothing on this screen leaves your device.
          </p>
        </>
      )}
      {confirmNode}
    </Shell>
  );
}
