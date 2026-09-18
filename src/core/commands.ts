/**
 * Slash commands: things that should never cost a model round-trip.
 *
 * Framework-free and pure, so the same table drives the composer autocomplete,
 * the help output, and the unit tests. A command that cannot do its job says
 * so and returns `ok: false` - it never returns a plausible-looking guess.
 */

import { safeMath } from './util.ts';
import type { MemoryItem } from './types.ts';

export interface CommandCtx {
  /** Write a memory item. Returns the stored text. */
  remember: (text: string, kind: MemoryItem['kind']) => void;
  /** Search memory, most relevant first. */
  recall: (query: string, limit: number) => MemoryItem[];
  /** Capture an idea. */
  capture: (title: string, body: string) => void;
  /** Names of every registered tool, for /tools. */
  toolNames: () => string[];
  /** Switch agent mode. Returns false when the id is unknown. */
  setMode: (id: string) => boolean;
  /** Valid mode ids, for the error message and autocomplete. */
  modeIds: () => string[];
  /** Navigate somewhere in the app. */
  go: (route: string) => void;
}

export interface CommandResult {
  ok: boolean;
  /** Markdown shown as the assistant's reply. */
  text: string;
  /** True when the command handled the input and no model should run. */
  handled: boolean;
}

export interface CommandSpec {
  name: string;
  /** Extra names that resolve to the same command. */
  aliases?: string[];
  arg: string;
  desc: string;
  group: 'memory' | 'compute' | 'navigate' | 'system';
  run: (arg: string, ctx: CommandCtx) => CommandResult;
}

const ok = (text: string): CommandResult => ({ ok: true, text, handled: true });
const fail = (text: string): CommandResult => ({ ok: false, text, handled: true });

export const COMMANDS: CommandSpec[] = [
  {
    name: 'calc',
    aliases: ['math', '='],
    arg: '<expression>',
    desc: 'Evaluate arithmetic locally, with no model call',
    group: 'compute',
    run: (arg) => {
      if (!arg.trim()) return fail('Give me something to evaluate, for example `/calc (18% of 2340) + 12`.');
      const r = safeMath(arg);
      if (!r.ok) return fail(`I could not evaluate that. ${r.error}`);
      return ok(`\`${arg.trim()}\` = **${r.value}**`);
    },
  },
  {
    name: 'remember',
    aliases: ['r'],
    arg: '<fact>',
    desc: 'Store a fact in local memory',
    group: 'memory',
    run: (arg, ctx) => {
      const text = arg.trim();
      if (!text) return fail('Tell me what to remember, for example `/remember the deploy target is Cloudflare Pages`.');
      ctx.remember(text, 'fact');
      return ok(`Remembered: *${text}*\n\nIt is stored in this browser only. Find it under Memory.`);
    },
  },
  {
    name: 'recall',
    aliases: ['?'],
    arg: '<query>',
    desc: 'Search local memory',
    group: 'memory',
    run: (arg, ctx) => {
      const q = arg.trim();
      if (!q) return fail('What should I look for? For example `/recall deploy`.');
      const hits = ctx.recall(q, 5);
      if (!hits.length) return fail(`Nothing in memory matches **${q}**. Memory holds only what you have told me.`);
      return ok(`**${hits.length}** match${hits.length === 1 ? '' : 'es'} for *${q}*:\n\n${hits.map((h) => `- ${h.text}`).join('\n')}`);
    },
  },
  {
    name: 'idea',
    arg: '<idea>',
    desc: 'Capture an idea to the Ideas board',
    group: 'memory',
    run: (arg, ctx) => {
      const body = arg.trim();
      if (!body) return fail('What is the idea? For example `/idea offline queue for tool calls`.');
      const title = body.length > 48 ? `${body.slice(0, 47)}\u2026` : body;
      ctx.capture(title, body);
      return ok(`Captured to Ideas: **${title}**`);
    },
  },
  {
    name: 'mode',
    arg: '<mode>',
    desc: 'Switch the agent mode',
    group: 'system',
    run: (arg, ctx) => {
      const id = arg.trim().toLowerCase();
      if (!id) return fail(`Available modes: ${ctx.modeIds().join(', ')}.`);
      if (!ctx.setMode(id)) return fail(`**${id}** is not a mode. Available: ${ctx.modeIds().join(', ')}.`);
      return ok(`Switched to **${id}** mode.`);
    },
  },
  {
    name: 'tools',
    arg: '',
    desc: 'List every registered tool',
    group: 'system',
    run: (_arg, ctx) => {
      const names = ctx.toolNames();
      return ok(`**${names.length} tools** are registered:\n\n${names.map((n) => `\`${n}\``).join(' \u00b7 ')}`);
    },
  },
  {
    name: 'go',
    arg: '<screen>',
    desc: 'Jump to a screen',
    group: 'navigate',
    run: (arg, ctx) => {
      const target = arg.trim().toLowerCase().replace(/^\/+/, '');
      if (!target) return fail('Where to? For example `/go workflows`.');
      ctx.go(`/app/${target}`);
      return ok(`Opening **${target}**.`);
    },
  },
  {
    name: 'help',
    aliases: ['h'],
    arg: '',
    desc: 'Show every slash command',
    group: 'system',
    run: () =>
      ok(
        `**Slash commands** run instantly, on device, with no model call.\n\n${COMMANDS.map(
          (c) => `- \`/${c.name}${c.arg ? ` ${c.arg}` : ''}\` \u2014 ${c.desc}`,
        ).join('\n')}\n\nAnything else you type goes to the agent.`,
      ),
  },
];

const BY_NAME = new Map<string, CommandSpec>();
for (const c of COMMANDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases ?? []) BY_NAME.set(a, c);
}

export const COMMAND_COUNT = COMMANDS.length;

/** Resolves `/name rest`. Returns null when the text is not a slash command. */
export function matchCommand(text: string): { spec: CommandSpec; arg: string } | null {
  const m = /^\s*\/([a-z?=]+)\b\s*([\s\S]*)$/i.exec(text);
  if (!m) return null;
  const spec = BY_NAME.get(m[1].toLowerCase());
  return spec ? { spec, arg: m[2] } : null;
}

/**
 * Autocomplete for the composer. An empty query after `/` lists everything;
 * a partial name filters by prefix first, then by substring.
 */
export function suggestCommands(text: string, limit = 6): CommandSpec[] {
  const m = /^\s*\/([a-z?=]*)$/i.exec(text);
  if (!m) return [];
  const q = m[1].toLowerCase();
  if (!q) return COMMANDS.slice(0, limit);
  const starts = COMMANDS.filter((c) => c.name.startsWith(q) || (c.aliases ?? []).some((a) => a.startsWith(q)));
  const contains = COMMANDS.filter((c) => !starts.includes(c) && c.name.includes(q));
  return [...starts, ...contains].slice(0, limit);
}
