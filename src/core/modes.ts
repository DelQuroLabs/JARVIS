// Agent modes. Each mode is a budget plus a posture; both are enforced by loop.ts.

import type { AgentMode } from './types.ts';

export const MODES: AgentMode[] = [
  {
    id: 'agent',
    when: 'Default. Anything with more than one step, or where you want it to check its own work.',
    name: 'Agent',
    blurb: 'Plans, uses any tool, verifies its own work, then reports what it actually did.',
    icon: 'agent',
    maxSteps: 8,
    toolBudget: 14,
    temperature: 0.35,
    groups: [],
    system:
      'You are JARVIS running as an autonomous agent. Work the task rather than describing how you would work it. ' +
      'Plan in one short line, then act: call tools to gather facts, compute results and check your own output. ' +
      'Prefer a tool over a guess whenever a tool can settle the question. ' +
      'When a tool fails, say what failed and continue with what you can. ' +
      'Finish with the answer first, then a one-line note of what you verified and what you did not. ' +
      'Never claim you ran, fetched or checked something you did not.',
  },
  {
    id: 'assist',
    when: 'Quick questions where a long plan would be overkill. Cheapest of the tool-using modes.',
    name: 'Assist',
    blurb: 'Balanced everyday help. Uses tools when they clearly help.',
    icon: 'spark',
    maxSteps: 3,
    toolBudget: 4,
    temperature: 0.6,
    groups: [],
    system:
      'You are JARVIS, a concise, capable assistant. Prefer direct answers. Use a tool only when it materially improves accuracy. Never claim a tool result you did not receive.',
  },
  {
    id: 'build',
    when: 'Writing or changing code in the sandbox, where the work must be verified rather than described.',
    name: 'Builder',
    blurb: 'Writes and verifies code in the sandbox. Plans before it edits.',
    icon: 'code',
    maxSteps: 6,
    toolBudget: 10,
    temperature: 0.3,
    groups: ['code', 'files', 'text', 'agent', 'compute'],
    system:
      'You are JARVIS in builder mode: an autonomous coding agent. Given a task, plan briefly, write the change into the sandbox workspace with fs_write, run or review it, then report exactly what you verified and what you did not. Never report a test as passing unless you ran it.',
  },
  {
    id: 'research',
    when: 'Questions that need sources. It retrieves before it asserts and cites what it actually fetched.',
    name: 'Research',
    blurb: 'Searches, reads and synthesises. Cites what it actually retrieved.',
    icon: 'search',
    maxSteps: 5,
    toolBudget: 8,
    temperature: 0.4,
    groups: ['network', 'text', 'memory', 'agent'],
    system:
      'You are JARVIS in research mode. Retrieve before you assert. Cite the source of every retrieved fact. If retrieval fails, say so plainly and answer from general knowledge with that caveat stated.',
  },
  {
    id: 'analyst',
    when: 'Numbers, CSVs and comparisons. Leans on the compute and data tools rather than prose.',
    name: 'Analyst',
    blurb: 'Numbers, tables and data hygiene. Shows the arithmetic.',
    icon: 'chart',
    maxSteps: 4,
    toolBudget: 8,
    temperature: 0.2,
    groups: ['compute', 'data', 'text', 'code'],
    system:
      'You are JARVIS in analyst mode. Compute with the calculator or code tools rather than doing arithmetic in your head. Show the figures you used. Flag any assumption you had to invent.',
  },
  {
    id: 'writer',
    when: 'Drafting and editing, where tool calls would only get in the way.',
    name: 'Writer',
    blurb: 'Drafting and editing. Tools off by default.',
    icon: 'pen',
    maxSteps: 2,
    toolBudget: 1,
    temperature: 0.8,
    groups: ['text'],
    system:
      'You are JARVIS in writing mode. Produce clean, specific prose in the register the user asks for. No filler, no throat-clearing, no restating the prompt.',
  },
  {
    id: 'brief',
    when: 'One short answer, no tools, no network. The fastest path when you already know what you want.',
    name: 'Brief',
    blurb: 'One tight paragraph, maximum. No tools.',
    icon: 'bolt',
    maxSteps: 1,
    toolBudget: 0,
    temperature: 0.4,
    groups: [],
    system: 'You are JARVIS in brief mode. Answer in at most three sentences. No preamble, no lists, no tools.',
  },
  {
    id: 'deep',
    when: 'Hard problems worth the time and tokens: the largest budget of any mode.',
    name: 'Deep work',
    blurb: 'Long-horizon reasoning with the widest budget.',
    icon: 'layers',
    maxSteps: 8,
    toolBudget: 14,
    temperature: 0.5,
    groups: [],
    system:
      'You are JARVIS in deep-work mode. Decompose the problem, work through it step by step, use tools freely, and finish with a clear summary of conclusions, evidence and open questions.',
  },
  {
    id: 'private',
    when: 'Anything that must not leave the device. Never touches the network, whatever the privacy setting says.',
    name: 'Private',
    blurb: 'On-device only. No network tools, strict redaction.',
    icon: 'shield',
    maxSteps: 2,
    toolBudget: 3,
    temperature: 0.5,
    groups: ['compute', 'text', 'data', 'memory', 'files'],
    system:
      'You are JARVIS in private mode. Network tools are disabled. Work from what is in front of you and state clearly when an answer would need external data you cannot reach.',
  },
];

export const MODE_MAP: Record<string, AgentMode> = Object.fromEntries(MODES.map((m) => [m.id, m]));

export const modeOf = (id: string): AgentMode => MODE_MAP[id] ?? MODES[0];
