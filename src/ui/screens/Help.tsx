/**
 * Help: the immersive how-to.
 *
 * This replaces the old marketing landing page. Every number on this screen is
 * counted from the live registries at render time, so it cannot drift when
 * features are added -- add a tool and the tour says so on the next reload.
 */

import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { Btn, Card, OpenLink, Pill, SectionTitle } from '../components.tsx';
import { navigate } from '../router.tsx';
import { useApp } from '../state.tsx';
import { haptic } from '../fx.tsx';
import { TOOLS, TOOL_GROUPS } from '../../core/tools.ts';
import { MODES } from '../../core/modes.ts';
import { ROLES, PRESETS } from '../../core/crew.ts';
import { NODE_KIND_COUNT } from '../../core/workflow.ts';
import { INTENTS } from '../../core/intents.ts';
import { PATTERNS } from '../../core/privacy.ts';
import { PROVIDERS, SELECTABLE } from '../../core/providers.ts';
import { COMMANDS } from '../../core/commands.ts';

interface Chapter {
  id: string;
  title: string;
  icon: IconName;
  blurb: string;
  /** Where the reader should go to actually do it. */
  to?: string;
  cta?: string;
  body: { h: string; p: string }[];
}

export default function Help() {
  const app = useApp();
  const [open, setOpen] = useState<string>('start');

  // Counted live. Nothing on this screen is a hardcoded claim.
  const facts = useMemo(() => {
    const free = PROVIDERS.filter((p) => p.tier === 'free' && p.id !== 'reflex').length;
    const netTools = TOOLS.filter((t) => t.network).length;
    const gated = TOOLS.filter((t) => t.approval).length;
    const refusals = INTENTS.filter((i) => i.kind === 'unsupported').length;
    return {
      tools: TOOLS.length,
      groups: TOOL_GROUPS.length,
      netTools,
      offlineTools: TOOLS.length - netTools,
      gated,
      modes: MODES.length,
      roles: ROLES.length,
      presets: PRESETS.length,
      nodes: NODE_KIND_COUNT,
      intents: INTENTS.length,
      refusals,
      patterns: PATTERNS.length,
      providers: SELECTABLE.length,
      free,
      commands: COMMANDS.length,
    };
  }, []);

  const chapters: Chapter[] = [
    {
      id: 'start',
      title: 'Start here',
      icon: 'rocket',
      blurb: 'What this is, and the shortest path to something useful.',
      to: '/app/chat',
      cta: 'Open chat',
      body: [
        {
          h: 'It is a home base, not a chat box',
          p: `JARVIS runs entirely in this browser. It holds your projects, your automations and your notes, and it can reach ${facts.tools} tools across ${facts.groups} groups. The dashboard is the launcher: every destination is a button on it.`,
        },
        {
          h: 'It works before you connect anything',
          p: `${facts.offlineTools} of the ${facts.tools} tools need no network at all, and the offline reflex core answers simple questions with no model. Nothing is stubbed: if a button is there, it does the thing.`,
        },
        {
          h: 'Add a brain when you want reasoning',
          p: `Settings has ${facts.providers} selectable providers, ${facts.free} of them on genuinely free tiers. Paste a key and the agent starts planning and using tools. Without one it still runs, and it tells you it is running offline instead of pretending.`,
        },
      ],
    },
    {
      id: 'agent',
      title: 'How the agent thinks',
      icon: 'agent',
      blurb: 'Plan, act, verify - inside a budget it cannot exceed.',
      to: '/app/modes',
      cta: 'See the modes',
      body: [
        {
          h: 'Budgets are enforced, not suggested',
          p: `Each of the ${facts.modes} modes carries a step budget and a tool budget. Agent mode, the default, gets 8 steps and 14 tool calls. When a budget runs out the loop stops and says so rather than quietly truncating.`,
        },
        {
          h: 'Every answer carries a receipt',
          p: 'Under each reply you get elapsed time, the mode, how many steps and tools it used, token counts, and whether it ever touched the network. If it answered offline, the receipt says so.',
        },
        {
          h: 'Tool calls are visible',
          p: `Each call shows its name, arguments and result. ${facts.gated} tools are approval-gated: writing files, deleting files, running code and raw HTTP requests all stop and ask, showing the exact arguments before anything happens.`,
        },
      ],
    },
    {
      id: 'library',
      title: 'The project library',
      icon: 'boxes',
      blurb: 'One card per project: launch it, or rebuild it from the spec.',
      to: '/app/library',
      cta: 'Open the library',
      body: [
        {
          h: 'Cards open into the whole record',
          p: 'A card shows the name, tagline and status. Tap it and you get the about text, the full rebuild spec, every link, and any screenshots or attachments you added.',
        },
        {
          h: 'The spec is the point',
          p: 'The rebuild spec field is meant to be complete enough that a fresh agent session could reconstruct the project from that text alone. "Copy dump" puts the whole record on your clipboard as Markdown.',
        },
        {
          h: 'Attachments live in this browser',
          p: 'Screenshots are stored inline, which is why there is a size budget shown at the bottom of the library. It is a real constraint of browser storage, not an arbitrary limit.',
        },
      ],
    },
    {
      id: 'automate',
      title: 'Automate it',
      icon: 'flow',
      blurb: 'Skills, workflows, routines and a crew of reviewers.',
      to: '/app/build',
      cta: 'Open build',
      body: [
        {
          h: 'Skills are deterministic',
          p: 'A skill is a fixed chain of tool calls with no model in the loop. Give it a trigger and typing /trigger in chat runs it. Same input, same output, every time, and it costs nothing.',
        },
        {
          h: 'Workflows are graphs',
          p: `${facts.nodes} node kinds, wired visually. Cycles are detected before anything runs. Nodes that were never reached are reported as skipped rather than failed, because those are different things.`,
        },
        {
          h: 'Crew reviews are sequential',
          p: `${facts.roles} roles across ${facts.presets} presets share one transcript, each seeing what came before. If a role fails or falls back to the offline core, the rest are marked skipped instead of pretending to have reviewed.`,
        },
        {
          h: 'Routines need the app open',
          p: 'A routine fires on a schedule while this tab is open. A browser tab cannot wake itself, so that is the honest limit, and the Routines screen says it plainly rather than implying background execution.',
        },
      ],
    },
    {
      id: 'privacy',
      title: 'What leaves the device',
      icon: 'shield',
      blurb: 'Three privacy levels and a redactor that runs before transport.',
      to: '/app/settings',
      cta: 'Open settings',
      body: [
        {
          h: 'Everything is local by default',
          p: 'Conversations, memory, projects, keys and settings live in this browser. There is no server unless you connect your own sync server on the Cloud screen.',
        },
        {
          h: 'Redaction happens before the request',
          p: `${facts.patterns} credential patterns are scanned out of anything heading to a model. Card numbers are Luhn-checked so real ones are caught and order numbers are not.`,
        },
        {
          h: 'STRICT means STRICT',
          p: `On the strict level, all ${facts.netTools} network tools are blocked outright, and the two most private modes never touch the network at all.`,
        },
      ],
    },
    {
      id: 'limits',
      title: 'What it cannot do',
      icon: 'warn',
      blurb: 'The honest list. A browser tab has hard edges.',
      body: [
        {
          h: 'No OS control, no wake word',
          p: `A web page cannot launch applications, read your battery or listen for a wake word. ${facts.refusals} of the ${facts.intents} intent rules exist purely to recognise those requests and explain why they cannot run here, then offer the nearest real substitute.`,
        },
        {
          h: 'No in-app web browser',
          p: 'DuckDuckGo and almost every major site send x-frame-options headers that forbid being embedded. The ddg_answer tool gets instant answers, and links open in a real browser tab. Anything claiming to embed a full browser in a page is lying to you.',
        },
        {
          h: 'Routines and sync need the tab open',
          p: 'Scheduling and cloud sync both run in this page. Close it and they stop until you come back. No service worker trickery changes that for scheduled work.',
        },
      ],
    },
  ];

  return (
    <Shell title="Help" sub="How this works, and what it will not pretend to do">
      <div className="dash">
        <Card className="hero-card">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="hero-ic"><Icon name="book" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: '1.05rem' }}>Home base for everything you run</b>
              <p className="muted" style={{ fontSize: '0.86rem', margin: '5px 0 0', lineHeight: 1.55 }}>
                A tour of the whole app, written against the live registries. Every number below is
                counted when this page renders, so it stays true as features are added.
              </p>
            </div>
          </div>
        </Card>

        <div className="help-stats">
          {[
            [facts.tools, 'tools'],
            [facts.modes, 'modes'],
            [facts.nodes, 'node kinds'],
            [facts.roles, 'crew roles'],
            [facts.providers, 'providers'],
            [facts.commands, 'slash commands'],
          ].map(([n, label]) => (
            <div className="help-stat" key={String(label)}>
              <b>{n}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <SectionTitle>The tour</SectionTitle>
        <div className="help-chapters">
          {chapters.map((c) => {
            const isOpen = open === c.id;
            return (
              <div className={`help-ch${isOpen ? ' on' : ''}`} key={c.id}>
                <button
                  type="button"
                  className="help-ch-head"
                  aria-expanded={isOpen}
                  onClick={() => {
                    haptic.light();
                    setOpen(isOpen ? '' : c.id);
                  }}
                >
                  <span className="hi"><Icon name={c.icon} size={18} /></span>
                  <span className="grow">
                    <b>{c.title}</b>
                    <span className="hb">{c.blurb}</span>
                  </span>
                  <Icon name={isOpen ? 'up' : 'down'} size={16} />
                </button>
                {isOpen && (
                  <div className="help-ch-body">
                    {c.body.map((b) => (
                      <div className="help-para" key={b.h}>
                        <b>{b.h}</b>
                        <p>{b.p}</p>
                      </div>
                    ))}
                    {c.to && (
                      <Btn icon="chevron" onClick={() => navigate(c.to!)}>
                        {c.cta ?? 'Go there'}
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <SectionTitle>Reference</SectionTitle>
        <div className="launch-mini" style={{ marginBottom: 14 }}>
          {([
            ['/app/tools', 'tools', 'Tools'],
            ['/app/modes', 'mode', 'Modes'],
            ['/app/providers', 'key', 'Providers'],
            ['/app/diagnostics', 'pulse', 'Diagnostics'],
            ['/guide', 'file', 'Guide'],
            ['/privacy', 'shield', 'Privacy'],
          ] as [string, IconName, string][]).map(([to, icon, label]) => (
            <button
              key={to}
              type="button"
              className="mini-btn"
              onClick={() => {
                haptic.light();
                navigate(to);
              }}
            >
              <span className="mi"><Icon name={icon} size={20} /></span>
              {label}
            </button>
          ))}
        </div>

        <Card tight>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <Pill tone={app.providerReady ? 'ok' : 'warn'}>
              <Icon name={app.providerReady ? 'check' : 'warn'} size={12} />
              {app.providerReady ? 'model connected' : 'no model key yet'}
            </Pill>
            <span className="grow" />
            <OpenLink url="https://github.com" size="sm" variant="quiet" icon="github">
              Source
            </OpenLink>
            <Btn size="sm" variant="quiet" icon="spark" onClick={() => navigate('/former-landing')}>
              Former landing page
            </Btn>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
