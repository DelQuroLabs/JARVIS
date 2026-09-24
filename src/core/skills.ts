// Skills: saved, deterministic multi-step tool sequences. No model call required.
// Step outputs can be bound to a name and referenced later with {{name}}.

import type { Skill, SkillResult, SkillStep, ToolCallRecord } from './types.ts';
import { interpolate, uid } from './util.ts';

export interface SkillIssue {
  step: number;
  message: string;
}

export function validateSkill(skill: Skill, knownTools: string[]): SkillIssue[] {
  const issues: SkillIssue[] = [];
  if (!skill.name.trim()) issues.push({ step: -1, message: 'Skill needs a name.' });
  if (!skill.steps.length) issues.push({ step: -1, message: 'Skill needs at least one step.' });
  const known = new Set(knownTools);
  const bound = new Set<string>(['input']);
  skill.steps.forEach((s, i) => {
    if (!known.has(s.tool)) issues.push({ step: i, message: `Unknown tool "${s.tool}".` });
    for (const v of Object.values(s.args)) {
      for (const m of v.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        if (!bound.has(m[1])) issues.push({ step: i, message: `References {{${m[1]}}} before anything binds it.` });
      }
    }
    if (s.as) {
      if (bound.has(s.as)) issues.push({ step: i, message: `"${s.as}" is already bound by an earlier step.` });
      bound.add(s.as);
    }
  });
  return issues;
}

export interface SkillRunner {
  runTool: (tool: string, args: Record<string, unknown>) => Promise<ToolCallRecord>;
  signal?: AbortSignal;
  onStep?: (i: number, rec: ToolCallRecord) => void;
}

export async function runSkill(skill: Skill, input: string, runner: SkillRunner): Promise<SkillResult> {
  const bag: Record<string, unknown> = { input };
  const steps: SkillResult['steps'] = [];
  let last = '';
  for (let i = 0; i < skill.steps.length; i++) {
    if (runner.signal?.aborted) {
      steps.push({ tool: skill.steps[i].tool, ok: false, summary: 'cancelled', ms: 0 });
      break;
    }
    const s = skill.steps[i];
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.args)) args[k] = interpolate(v, bag);
    const rec = await runner.runTool(s.tool, args);
    runner.onStep?.(i, rec);
    steps.push({ tool: s.tool, ok: rec.ok, summary: rec.summary, ms: rec.ms });
    last = rec.detail ?? rec.summary;
    if (s.as) bag[s.as] = last;
    bag.last = last;
    if (!rec.ok) {
      return { ok: false, steps, output: `Step ${i + 1} (${s.tool}) failed: ${rec.summary}` };
    }
  }
  return { ok: true, steps, output: last };
}

const step = (tool: string, args: Record<string, string>, as?: string): SkillStep => ({ tool, args, as });

export function builtinSkills(): Skill[] {
  const now = Date.now();
  return [
    {
      id: 'sk_brief',
      name: 'Daily brief',
      desc: 'Date, then weather for a place you name, then anything tagged as a task in memory.',
      trigger: 'brief',
      builtin: true,
      updated: now,
      steps: [step('datetime', {}, 'today'), step('weather', { location: '{{input}}' }, 'wx'), step('memory_search', { query: 'task', limit: '5' })],
    },
    {
      id: 'sk_clean',
      name: 'Clean up text',
      desc: 'Trim every line, drop duplicates, then report the resulting size.',
      trigger: 'clean',
      builtin: true,
      updated: now,
      steps: [step('text_transform', { text: '{{input}}', op: 'trim' }, 'trimmed'), step('text_transform', { text: '{{trimmed}}', op: 'dedupe-lines' }, 'deduped'), step('text_stats', { text: '{{deduped}}' })],
    },
    {
      id: 'sk_audit',
      name: 'Snippet audit',
      desc: 'Static review of a code snippet, then a hash so you can pin the exact version reviewed.',
      trigger: 'audit',
      builtin: true,
      updated: now,
      steps: [step('code_review', { code: '{{input}}' }, 'findings'), step('hash_text', { text: '{{input}}' })],
    },
    {
      id: 'sk_research',
      name: 'Quick research',
      desc: 'Search, then save the result to memory so it survives the conversation.',
      trigger: 'research',
      builtin: true,
      updated: now,
      steps: [step('web_search', { query: '{{input}}' }, 'found'), step('memory_write', { text: 'Research on {{input}}: {{found}}', kind: 'note', tags: 'research' })],
    },
    {
      id: 'sk_json',
      name: 'JSON tidy',
      desc: 'Validate, then pretty-print, then count what came out.',
      trigger: 'json',
      builtin: true,
      updated: now,
      steps: [step('json_tool', { json: '{{input}}', op: 'validate' }), step('json_tool', { json: '{{input}}', op: 'format' }, 'pretty'), step('text_stats', { text: '{{pretty}}' })],
    },
    {
      id: 'sk_scratch',
      name: 'Scratch file',
      desc: 'Write the input into the sandbox workspace and list what is there now.',
      trigger: 'scratch',
      builtin: true,
      updated: now,
      steps: [step('fs_write', { path: 'scratch.txt', content: '{{input}}' }), step('fs_list', {})],
    },
  ];
}

export function blankSkill(): Skill {
  return { id: uid('sk'), name: 'New skill', desc: '', trigger: '', steps: [], updated: Date.now() };
}

/** Resolve a chat message to a skill by trigger word or name. */
export function matchSkill(text: string, skills: Skill[]): { skill: Skill; input: string } | null {
  const t = text.trim();
  const slash = t.match(/^\/(\w[\w-]*)\s*([\s\S]*)$/);
  if (slash) {
    const s = skills.find((x) => x.trigger.toLowerCase() === slash[1].toLowerCase() || x.name.toLowerCase() === slash[1].toLowerCase());
    if (s) return { skill: s, input: slash[2].trim() };
  }
  return null;
}
