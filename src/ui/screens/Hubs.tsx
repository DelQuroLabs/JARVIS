import { Shell } from '../Shell.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { Card, Pill, SectionTitle } from '../components.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import { TOOLS } from '../../core/tools.ts';
import { NODE_KIND_COUNT } from '../../core/workflow.ts';
import { ROLES } from '../../core/crew.ts';

interface Tile {
  to: string;
  icon: IconName;
  title: string;
  sub: string;
}

function Tiles({ items }: { items: Tile[] }) {
  return (
    <div className="list">
      {items.map((t) => (
        <button key={t.to} type="button" className="item" onClick={() => navigate(t.to)}>
          <span className="ico">
            <Icon name={t.icon} size={16} />
          </span>
          <span className="txt">
            <b>{t.title}</b>
            <small className="wrap">{t.sub}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      ))}
    </div>
  );
}

export function Build() {
  const app = useApp();
  return (
    <Shell title="Build" sub="Automations that run the same way every time">
      <SectionTitle>Compose</SectionTitle>
      <Tiles
        items={[
          { to: '/app/workflows', icon: 'flow', title: 'Workflows', sub: `${app.workflows.length} saved \u00b7 ${NODE_KIND_COUNT} node kinds \u00b7 visual graph` },
          { to: '/app/skills', icon: 'skills', title: 'Skills', sub: `${app.skills.length} saved \u00b7 tool sequences with no model call` },
          { to: '/app/routines', icon: 'routine', title: 'Routines', sub: `${app.routines.length} defined \u00b7 run on open or on a schedule` },
        ]}
      />
      <SectionTitle>Review</SectionTitle>
      <Tiles
        items={[
          { to: '/app/crew', icon: 'crew', title: 'Crew', sub: `${ROLES.length} roles \u00b7 sequential critique with a shared transcript` },
          { to: '/app/tools', icon: 'tools', title: 'Tools', sub: `${TOOLS.length} registered \u00b7 run any of them by hand` },
        ]}
      />
      <Card tight>
        <div className="muted" style={{ fontSize: '0.83rem' }}>
          Rule of thumb: a <b>skill</b> is a straight line, a <b>workflow</b> branches, and a <b>routine</b> is either of those on a trigger.
          Reach for the crew when the question is &ldquo;is this a good idea&rdquo; rather than &ldquo;do this&rdquo;.
        </div>
      </Card>
    </Shell>
  );
}

export function More() {
  const app = useApp();
  return (
    <Shell title="More" sub="Knowledge, sync and system">
      <SectionTitle>Knowledge</SectionTitle>
      <Tiles
        items={[
          { to: '/app/memory', icon: 'memory', title: 'Memory', sub: `${app.memory.length} items the agent can search` },
          { to: '/app/ideas', icon: 'idea', title: 'Ideas', sub: `${app.ideas.length} saved prompts and patterns` },
          { to: '/app/traces', icon: 'trace', title: 'Activity', sub: `${app.traces.length} local run records` },
          { to: '/app/modes', icon: 'mode', title: 'Modes', sub: 'Budgets, temperature and system prompts' },
        ]}
      />
      <SectionTitle>System</SectionTitle>
      <Tiles
        items={[
          { to: '/app/cloud', icon: 'cloud', title: 'Cloud sync', sub: app.cloud.enabled ? 'Connected to your sync server' : 'Off \u00b7 everything is local' },
          { to: '/app/settings', icon: 'settings', title: 'Settings', sub: 'Provider, privacy, appearance, your data' },
          { to: '/app/diagnostics', icon: 'pulse', title: 'Diagnostics', sub: 'Live self-checks with honest result states' },
        ]}
      />
      <SectionTitle>About</SectionTitle>
      <Tiles
        items={[
          { to: '/former-landing', icon: 'spark', title: 'Former landing page', sub: 'The old marketing page. Kept, but nothing links to it any more' },
          { to: '/guide', icon: 'file', title: 'Guide', sub: 'How the loop, tools and workflows fit together' },
          { to: '/privacy', icon: 'shield', title: 'Privacy', sub: 'What is stored, where, and how to delete it' },
        ]}
      />
      <div className="row wrap" style={{ gap: 6, marginTop: 16 }}>
        <Pill>v1.0.0</Pill>
        <Pill tone={app.online ? 'ok' : 'warn'}>{app.online ? 'online' : 'offline'}</Pill>
        <Pill>{app.settings.privacy.toLowerCase()}</Pill>
      </div>
    </Shell>
  );
}
