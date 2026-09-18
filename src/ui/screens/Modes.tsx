import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Card, Pill, SectionTitle } from '../components.tsx';
import { useApp } from '../state.tsx';
import { MODES } from '../../core/modes.ts';
import { TOOLS } from '../../core/tools.ts';

export default function Modes() {
  const app = useApp();
  const current = app.settings.mode;

  return (
    <Shell title="Modes" sub={`${MODES.length} postures \u00b7 budgets are enforced, not suggested`}>
      <Card tight>
        <div className="muted" style={{ fontSize: '0.84rem', lineHeight: 1.62 }}>
          <p style={{ margin: '0 0 9px' }}>
            A <b>mode</b> is the posture the agent takes. Picking one changes four things at once:
          </p>
          <ul style={{ margin: '0 0 9px', paddingLeft: 18, display: 'grid', gap: 5 }}>
            <li><b>Instructions</b> &mdash; the system prompt it works under, shown in full at the bottom of this screen.</li>
            <li><b>Step budget</b> &mdash; how many times the plan-act-observe loop may go round.</li>
            <li><b>Tool budget</b> &mdash; how many tool calls it may spend in total.</li>
            <li><b>Tool access</b> &mdash; which groups of tools it is allowed to touch at all.</li>
          </ul>
          <p style={{ margin: 0 }}>
            Budgets are enforced rather than suggested: when one runs out the loop stops and says so instead of quietly
            continuing. The mode applies to the current conversation and can be switched from the chat composer at any time.
          </p>
        </div>
      </Card>

      <SectionTitle>Choose a mode</SectionTitle>
      <div className="stack sm">
        {MODES.map((m) => {
          const on = m.id === current;
          const toolCount = m.groups.length ? TOOLS.filter((t) => m.groups.includes(t.group)).length : TOOLS.length;
          return (
            <button
              key={m.id}
              type="button"
              className="item"
              style={{ alignItems: 'flex-start', borderColor: on ? 'var(--accent)' : undefined }}
              onClick={() => {
                app.setSettings({ mode: m.id });
                app.toast(`${m.name} mode selected`, 'ok');
              }}
              aria-pressed={on}
            >
              <span className="ico">
                <Icon name={m.icon as never} size={16} />
              </span>
              <span className="txt">
                <b>
                  {m.name} {on && <Pill tone="accent">active</Pill>}
                </b>
                <small className="wrap">{m.blurb}</small>
                <small className="wrap mode-when"><b>Reach for it:</b> {m.when}</small>
                <span className="row wrap" style={{ gap: 5, marginTop: 8 }}>
                  <Pill>{m.maxSteps} steps</Pill>
                  <Pill>{m.toolBudget} tool budget</Pill>
                  <Pill>temp {m.temperature}</Pill>
                  <Pill>{m.groups.length ? `${toolCount} tools` : 'all tools'}</Pill>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <SectionTitle>System prompt for the active mode</SectionTitle>
      <Card tight>
        <pre className="md-code" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {MODES.find((m) => m.id === current)?.system}
        </pre>
      </Card>
    </Shell>
  );
}
