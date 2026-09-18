// Crew: a sequential, role-based review. Each role sees the full prior transcript,
// so it is a conversation rather than parallel answers stapled together.

import type { CrewPreset, CrewRole, CrewRun, CrewTurn } from './types.ts';
import { uid } from './util.ts';

export const DEPARTMENTS = ['Product', 'Engineering', 'Design', 'Quality', 'Security', 'Operations'] as const;

export const ROLES: CrewRole[] = [
  { id: 'pm', name: 'Product manager', dept: 'Product', icon: 'target', tools: ['plan_outline', 'memory_search'], brief: 'Clarify the user problem, the smallest complete outcome, and explicit non-goals. Push back on scope that does not serve the outcome.' },
  { id: 'researcher', name: 'Researcher', dept: 'Product', icon: 'search', tools: ['web_search', 'fetch_url'], brief: 'Gather what is actually known. Separate retrieved fact from inference, and say when you could not retrieve something.' },
  { id: 'analyst', name: 'Data analyst', dept: 'Product', icon: 'chart', tools: ['calculator', 'csv_summary'], brief: 'Quantify the claims. Compute the numbers rather than estimating them, and state every assumption you had to invent.' },

  { id: 'architect', name: 'Architect', dept: 'Engineering', icon: 'layers', tools: ['plan_outline'], brief: 'Choose the structure: boundaries, data flow, and the one or two decisions that will be expensive to reverse.' },
  { id: 'backend', name: 'Backend engineer', dept: 'Engineering', icon: 'server', tools: ['code_run', 'fs_write'], brief: 'Design the data model, the API surface, and the failure modes. Be concrete about types and error paths.' },
  { id: 'frontend', name: 'Frontend engineer', dept: 'Engineering', icon: 'code', tools: ['code_run', 'fs_write'], brief: 'Design the interface states: loading, empty, error, offline, success. Every control must do something real.' },
  { id: 'mobile', name: 'Mobile engineer', dept: 'Engineering', icon: 'phone', tools: ['code_review'], brief: 'Judge it as a phone experience: thumb reach, tap targets, safe areas, offline behaviour, and what happens on a slow network.' },

  { id: 'designer', name: 'Product designer', dept: 'Design', icon: 'pen', tools: [], brief: 'Shape the flow and hierarchy. Cut steps. Name things in the user\u2019s language, not the system\u2019s.' },
  { id: 'writer', name: 'Content designer', dept: 'Design', icon: 'type', tools: ['text_stats'], brief: 'Write the actual words: labels, empty states, errors. Specific, short, never cute at the cost of clarity.' },
  { id: 'a11y', name: 'Accessibility lead', dept: 'Design', icon: 'eye', tools: [], brief: 'Check names on controls, contrast, focus order, target size, motion sensitivity, and screen-reader semantics.' },

  { id: 'qa', name: 'QA lead', dept: 'Quality', icon: 'check', tools: ['code_review'], brief: 'Write the test cases that would actually catch a regression, including the ugly edge cases nobody wants to think about.' },
  { id: 'perf', name: 'Performance engineer', dept: 'Quality', icon: 'gauge', tools: ['calculator'], brief: 'Find what gets slow at scale: payload size, render cost, round trips, and anything quadratic.' },

  { id: 'security', name: 'Security reviewer', dept: 'Security', icon: 'shield', tools: ['code_review'], brief: 'Threat-model it. Trust boundaries, secret handling, injection, authorization, and what an attacker gets from the client bundle.' },
  { id: 'privacy', name: 'Privacy reviewer', dept: 'Security', icon: 'lock', tools: [], brief: 'What personal data is collected, why, where it goes, how long it lives, and whether the user can see and delete it.' },

  { id: 'sre', name: 'Reliability engineer', dept: 'Operations', icon: 'activity', tools: ['http_request'], brief: 'Assume it breaks. Rollback, retries, idempotency, quota exhaustion, and what the user sees while it is broken.' },
  { id: 'critic', name: 'Devil\u2019s advocate', dept: 'Operations', icon: 'flame', tools: [], brief: 'Argue the strongest case against everything above. Name the single most likely reason this fails in the real world.' },
];

export const ROLE_MAP: Record<string, CrewRole> = Object.fromEntries(ROLES.map((r) => [r.id, r]));

export const PRESETS: CrewPreset[] = [
  { id: 'ship', name: 'Ship review', desc: 'The default pre-release pass.', roles: ['pm', 'architect', 'frontend', 'qa', 'security', 'critic'] },
  { id: 'design', name: 'Design critique', desc: 'Flow, words and accessibility.', roles: ['designer', 'writer', 'a11y', 'mobile'] },
  { id: 'threat', name: 'Threat model', desc: 'Security and privacy deep pass.', roles: ['security', 'privacy', 'backend', 'sre'] },
  { id: 'discovery', name: 'Discovery', desc: 'Is this even the right thing to build?', roles: ['pm', 'researcher', 'analyst', 'critic'] },
  { id: 'perf', name: 'Performance audit', desc: 'Where it gets slow and why.', roles: ['perf', 'frontend', 'backend', 'sre'] },
];

/** Cross-check: a role must never advertise a tool that does not exist. */
export function missingTools(known: string[]): { roleId: string; tool: string }[] {
  const set = new Set(known);
  const out: { roleId: string; tool: string }[] = [];
  for (const r of ROLES) for (const t of r.tools) if (!set.has(t)) out.push({ roleId: r.id, tool: t });
  return out;
}

export function rolesOf(presetId: string): CrewRole[] {
  const p = PRESETS.find((x) => x.id === presetId);
  return (p?.roles ?? []).map((id) => ROLE_MAP[id]).filter(Boolean);
}

export function crewPrompt(role: CrewRole, brief: string, transcript: CrewTurn[]): string {
  const prior = transcript.length
    ? `\n\nWhat the crew has said so far:\n${transcript.map((t) => `### ${t.roleName}\n${t.text}`).join('\n\n')}`
    : '';
  return [
    `You are the ${role.name} on a review crew. ${role.brief}`,
    `The brief under review:\n${brief}`,
    prior,
    '',
    'Give your section only. Be specific and short - at most six bullets or one tight paragraph. Do not repeat points already made; build on them or disagree with them by name.',
  ].join('\n');
}

export interface CrewHooks {
  ask: (prompt: string) => Promise<{ ok: boolean; text: string; via?: string }>;
  onTurn?: (t: CrewTurn) => void;
  signal?: AbortSignal;
  /** Pause between roles so a rate-limited free tier is not hammered. */
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function runCrew(brief: string, presetId: string, hooks: CrewHooks): Promise<CrewRun> {
  const started = Date.now();
  const roles = rolesOf(presetId);
  const turns: CrewTurn[] = [];
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let failures = 0;
  // Circuit breaker. Once the model tier is down, every remaining role would
  // burn its own timeout to reach the same conclusion. Skip fast and say why,
  // rather than presenting an offline answer as a specialist's considered view.
  let tierDown = false;

  for (let i = 0; i < roles.length; i++) {
    if (hooks.signal?.aborted) break;
    const role = roles[i];
    const t0 = Date.now();

    if (tierDown) {
      const turn: CrewTurn = {
        roleId: role.id,
        roleName: role.name,
        text: '',
        ms: 0,
        via: 'none',
        skipped: true,
        error: 'Skipped: the model tier failed earlier in this run, so this role never ran.',
      };
      turns.push(turn);
      hooks.onTurn?.(turn);
      continue;
    }

    try {
      const res = await hooks.ask(crewPrompt(role, brief, turns));
      // A reflex answer means every keyed tier already failed. It is a real
      // answer, so it is kept and tagged - but the rest of the run is stopped.
      const fellBack = res.via === 'reflex';
      const turn: CrewTurn = {
        roleId: role.id,
        roleName: role.name,
        text: res.text,
        ms: Date.now() - t0,
        via: res.via ?? 'unknown',
        fellBack,
        error: res.ok ? undefined : 'provider failed',
      };
      if (!res.ok) {
        failures++;
        tierDown = true;
      } else if (fellBack) {
        tierDown = true;
      }
      turns.push(turn);
      hooks.onTurn?.(turn);
    } catch (err) {
      failures++;
      tierDown = true;
      const turn: CrewTurn = {
        roleId: role.id,
        roleName: role.name,
        text: '',
        ms: Date.now() - t0,
        via: 'none',
        error: err instanceof Error ? err.message : String(err),
      };
      turns.push(turn);
      hooks.onTurn?.(turn);
    }
    if (i < roles.length - 1 && hooks.gapMs) await sleep(hooks.gapMs);
  }

  return {
    id: uid('crew'),
    brief,
    presetId,
    turns,
    started,
    finished: Date.now(),
    // A skipped role is not a success. A run where nothing actually produced
    // an answer is 'failed', not 'partial'.
    status:
      failures === 0 && turns.every((t) => !t.skipped)
        ? 'ok'
        : turns.every((t) => t.skipped || t.error)
          ? 'failed'
          : 'partial',
  };
}
