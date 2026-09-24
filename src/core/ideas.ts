// Idea library: prompts worth keeping, seeded with things this build can actually do.

import type { Idea } from './types.ts';
import { uid } from './util.ts';

export function seedIdeas(): Idea[] {
  const t = Date.now();
  const mk = (title: string, body: string, tags: string[], i: number): Idea => ({ id: `idea_${i}`, title, body, tags, created: t - i * 60_000 });
  return [
    mk('Audit a snippet before you paste it', 'Run /audit over any code you are about to paste into a project. Static findings plus a hash so you know which version you reviewed.', ['code', 'skill'], 1),
    mk('Turn a repeated question into a skill', 'If you have asked the same shape of question three times, save it as a skill. It then runs with no model call and no latency.', ['workflow'], 2),
    mk('Use Private mode for anything with a client name in it', 'Private mode disables network tools entirely and redacts contact details from every payload before transport.', ['privacy'], 3),
    mk('Let the crew argue before you commit', 'Run a Ship review over a one-paragraph brief. The Devil\u2019s advocate role exists specifically to find the reason it fails.', ['crew'], 4),
    mk('Give the agent a sandbox file to work in', 'Builder mode writes to a virtual workspace. Ask it to write a function to a file, then run it, then review it.', ['agent', 'code'], 5),
    mk('Pin your working constraints to memory', 'Anything you would otherwise repeat every session - stack, tone, deadlines - belongs in memory as a preference.', ['memory'], 6),
    mk('Chain a workflow off a classification', 'The Classify node needs no model call. Use it to route cheap cases away from the expensive ones.', ['workflow'], 7),
    mk('Check the trace before you blame the model', 'Traces show which provider actually answered. Half of "the model is dumb today" is really "the fallback chain reached the reflex core".', ['ops'], 8),
  ];
}

export function blankIdea(): Idea {
  return { id: uid('idea'), title: '', body: '', tags: [], created: Date.now() };
}

export function searchIdeas(list: Idea[], q: string): Idea[] {
  const t = q.trim().toLowerCase();
  if (!t) return list;
  return list.filter((i) => i.title.toLowerCase().includes(t) || i.body.toLowerCase().includes(t) || i.tags.some((x) => x.includes(t)));
}
