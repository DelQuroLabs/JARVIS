// Workflow engine: node catalog, cycle-safe topological ordering, and a runner.
// Unreached branches report `skipped`, never `failed`. Cycles are refused at edit
// time and at run time. Loops are capped and delays clamped.
//
// This module is imported by store.ts, so it MUST NOT read TOOL_MAP at module
// evaluation time - tool options are resolved lazily via toolOptions().

import type { NodeKind, NodeRun, WFEdge, WFNode, Workflow, WorkflowRun } from './types.ts';
import { interpolate, safeMath, uid } from './util.ts';

export const LOOP_CAP = 100;
export const DELAY_CAP_MS = 10_000;

const f = (name: string, label: string, type: 'text' | 'number' | 'select' | 'textarea' = 'text', options?: string[]) => ({ name, label, type, options });

export const NODE_KINDS: NodeKind[] = [
  /* triggers */
  { kind: 'start', group: 'trigger', label: 'Start', desc: 'Entry point. Every run begins here.', fields: [], inputs: 0, outputs: ['out'] },
  { kind: 'trigger_schedule', group: 'trigger', label: 'Schedule', desc: 'Marks the workflow as intended for a routine. Runs immediately when triggered manually.', fields: [f('every', 'Every (minutes)', 'number')], inputs: 0, outputs: ['out'] },
  { kind: 'trigger_message', group: 'trigger', label: 'On message', desc: 'Entry point fed by a chat message.', fields: [f('match', 'Contains text')], inputs: 0, outputs: ['out'] },
  { kind: 'trigger_manual', group: 'trigger', label: 'Manual button', desc: 'Entry point exposed as a run button.', fields: [f('label', 'Button label')], inputs: 0, outputs: ['out'] },

  /* input / output */
  { kind: 'input_text', group: 'io', label: 'Text input', desc: 'A fixed string, with {{variable}} interpolation.', fields: [f('value', 'Value', 'textarea')], inputs: 1, outputs: ['out'] },
  { kind: 'input_number', group: 'io', label: 'Number input', desc: 'A fixed number.', fields: [f('value', 'Value', 'number')], inputs: 1, outputs: ['out'] },
  { kind: 'input_run', group: 'io', label: 'Run input', desc: 'The text supplied when the run was started.', fields: [], inputs: 1, outputs: ['out'] },
  { kind: 'output', group: 'io', label: 'Output', desc: 'Marks a value as a result of the run.', fields: [f('label', 'Label')], inputs: 1, outputs: [] },
  { kind: 'log', group: 'io', label: 'Log', desc: 'Append a line to the run log.', fields: [f('message', 'Message', 'textarea')], inputs: 1, outputs: ['out'] },
  { kind: 'comment', group: 'io', label: 'Note', desc: 'Documentation only. Never executes.', fields: [f('text', 'Note', 'textarea')], inputs: 0, outputs: [] },

  /* logic */
  { kind: 'if', group: 'logic', label: 'If', desc: 'Branch on a comparison.', fields: [f('left', 'Left'), f('op', 'Operator', 'select', ['==', '!=', 'contains', '>', '<', 'empty', 'not empty']), f('right', 'Right')], inputs: 1, outputs: ['true', 'false'] },
  { kind: 'switch', group: 'logic', label: 'Switch', desc: 'Route to the first matching case.', fields: [f('value', 'Value'), f('cases', 'Cases (comma separated)')], inputs: 1, outputs: ['a', 'b', 'c', 'default'] },
  { kind: 'loop', group: 'logic', label: 'Loop', desc: `Repeat the downstream branch N times (capped at ${LOOP_CAP}).`, fields: [f('count', 'Iterations', 'number')], inputs: 1, outputs: ['each', 'done'] },
  { kind: 'delay', group: 'logic', label: 'Delay', desc: `Pause before continuing (clamped to ${DELAY_CAP_MS / 1000}s).`, fields: [f('ms', 'Milliseconds', 'number')], inputs: 1, outputs: ['out'] },
  { kind: 'merge', group: 'logic', label: 'Merge', desc: 'Join branches; passes the first value that arrives.', fields: [], inputs: 2, outputs: ['out'] },
  { kind: 'filter', group: 'logic', label: 'Filter', desc: 'Continue only when the input matches.', fields: [f('contains', 'Must contain')], inputs: 1, outputs: ['pass', 'block'] },
  { kind: 'stop', group: 'logic', label: 'Stop', desc: 'End the run here with a status.', fields: [f('status', 'Status', 'select', ['ok', 'failed'])], inputs: 1, outputs: [] },
  { kind: 'try', group: 'logic', label: 'Try', desc: 'Route on whether the incoming value looks like an error.', fields: [], inputs: 1, outputs: ['ok', 'error'] },

  /* data */
  { kind: 'set_var', group: 'data', label: 'Set variable', desc: 'Store the input under a name for {{interpolation}}.', fields: [f('name', 'Variable name')], inputs: 1, outputs: ['out'] },
  { kind: 'get_var', group: 'data', label: 'Get variable', desc: 'Read a stored variable.', fields: [f('name', 'Variable name')], inputs: 1, outputs: ['out'] },
  { kind: 'template', group: 'data', label: 'Template', desc: 'Compose text from variables. {{input}} is the incoming value.', fields: [f('template', 'Template', 'textarea')], inputs: 1, outputs: ['out'] },
  { kind: 'math', group: 'data', label: 'Math', desc: 'Evaluate an arithmetic expression.', fields: [f('expression', 'Expression')], inputs: 1, outputs: ['out'] },
  { kind: 'json_parse', group: 'data', label: 'Parse JSON', desc: 'Parse the input and read an optional dot path.', fields: [f('path', 'Path (optional)')], inputs: 1, outputs: ['out', 'error'] },
  { kind: 'json_stringify', group: 'data', label: 'To JSON', desc: 'Serialise the input value.', fields: [], inputs: 1, outputs: ['out'] },
  { kind: 'regex', group: 'data', label: 'Regex', desc: 'Extract matches from the input.', fields: [f('pattern', 'Pattern'), f('flags', 'Flags')], inputs: 1, outputs: ['out', 'none'] },
  { kind: 'replace', group: 'data', label: 'Replace', desc: 'Find and replace within the input.', fields: [f('find', 'Find'), f('replace', 'Replace with')], inputs: 1, outputs: ['out'] },
  { kind: 'split', group: 'data', label: 'Split', desc: 'Split the input into lines or on a separator.', fields: [f('separator', 'Separator')], inputs: 1, outputs: ['out'] },
  { kind: 'join', group: 'data', label: 'Join', desc: 'Join a list back into text.', fields: [f('separator', 'Separator')], inputs: 1, outputs: ['out'] },
  { kind: 'slice', group: 'data', label: 'Slice', desc: 'Take the first N characters or items.', fields: [f('count', 'Count', 'number')], inputs: 1, outputs: ['out'] },
  { kind: 'sort', group: 'data', label: 'Sort', desc: 'Sort lines alphabetically.', fields: [f('direction', 'Direction', 'select', ['asc', 'desc'])], inputs: 1, outputs: ['out'] },
  { kind: 'count', group: 'data', label: 'Count', desc: 'Count characters, words or lines.', fields: [f('unit', 'Unit', 'select', ['characters', 'words', 'lines'])], inputs: 1, outputs: ['out'] },

  /* actions */
  { kind: 'tool', group: 'action', label: 'Run tool', desc: 'Invoke a registered tool. Approval-gated tools still require approval.', fields: [f('tool', 'Tool', 'select', []), f('args', 'Arguments (JSON)', 'textarea')], inputs: 1, outputs: ['out', 'error'] },
  { kind: 'memory_write', group: 'action', label: 'Save to memory', desc: 'Write the input into long-term memory.', fields: [f('kind', 'Kind', 'select', ['fact', 'preference', 'decision', 'task', 'note'])], inputs: 1, outputs: ['out'] },
  { kind: 'memory_search', group: 'action', label: 'Search memory', desc: 'Look up saved memory items.', fields: [f('limit', 'Limit', 'number')], inputs: 1, outputs: ['out', 'none'] },
  { kind: 'notify', group: 'action', label: 'Notify', desc: 'Raise an in-app notification when the run reaches this node.', fields: [f('message', 'Message')], inputs: 1, outputs: ['out'] },

  /* agent */
  { kind: 'ai_prompt', group: 'agent', label: 'Ask the model', desc: 'Send a prompt through the configured provider.', fields: [f('prompt', 'Prompt', 'textarea')], inputs: 1, outputs: ['out', 'error'] },
  { kind: 'agent_run', group: 'agent', label: 'Agent task', desc: 'Run the full agent loop, tools included, on a task.', fields: [f('task', 'Task', 'textarea'), f('mode', 'Mode', 'select', ['assist', 'build', 'research', 'analyst', 'brief'])], inputs: 1, outputs: ['out', 'error'] },
  { kind: 'classify', group: 'agent', label: 'Classify', desc: 'Route the input into one of up to three labels using keyword scoring (no model call).', fields: [f('labels', 'Labels (comma separated)')], inputs: 1, outputs: ['a', 'b', 'c'] },
];

export const NODE_MAP: Record<string, NodeKind> = Object.fromEntries(NODE_KINDS.map((n) => [n.kind, n]));
export const NODE_KIND_COUNT = NODE_KINDS.length;

/** Resolved lazily by pages inside an effect - never at module scope. */
export function toolOptions(): string[] {
  // Local import keeps tools.ts out of this module's evaluation-time graph.
  return TOOL_OPTION_CACHE.slice();
}
let TOOL_OPTION_CACHE: string[] = [];
export function primeToolOptions(names: string[]): void {
  TOOL_OPTION_CACHE = names.slice();
  const node = NODE_MAP.tool;
  const field = node?.fields.find((x) => x.name === 'tool');
  if (field) field.options = names.slice();
}

/* ------------------------------------------------------------------ */
/* Graph analysis                                                      */
/* ------------------------------------------------------------------ */

export interface SortResult {
  order: string[];
  cycle: string[] | null;
}

export function topoSort(nodes: WFNode[], edges: WFEdge[]): SortResult {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nxt of out.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  if (order.length !== nodes.length) {
    return { order, cycle: nodes.map((n) => n.id).filter((id) => !order.includes(id)) };
  }
  return { order, cycle: null };
}

/** True when adding from->to would create a cycle. Used to refuse bad edges in the editor. */
export function wouldCycle(nodes: WFNode[], edges: WFEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const probe: WFEdge = { id: 'probe', from, fromPort: 'out', to };
  return topoSort(nodes, [...edges, probe]).cycle !== null;
}

export interface ValidationIssue {
  nodeId?: string;
  level: 'error' | 'warn';
  message: string;
}

export function validateWorkflow(wf: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!wf.nodes.length) issues.push({ level: 'error', message: 'Workflow has no nodes.' });
  const { cycle } = topoSort(wf.nodes, wf.edges);
  if (cycle) issues.push({ level: 'error', message: `Cycle detected across ${cycle.length} node(s). Workflows must be acyclic.` });
  const targets = new Set(wf.edges.map((e) => e.to));
  for (const n of wf.nodes) {
    const kind = NODE_MAP[n.kind];
    if (!kind) {
      issues.push({ nodeId: n.id, level: 'error', message: `Unknown node kind "${n.kind}".` });
      continue;
    }
    if (kind.inputs > 0 && !targets.has(n.id) && kind.group !== 'trigger') {
      issues.push({ nodeId: n.id, level: 'warn', message: `${kind.label} has no incoming connection and will be skipped.` });
    }
    if (n.kind === 'tool' && !n.config.tool) issues.push({ nodeId: n.id, level: 'error', message: 'Run tool node has no tool selected.' });
    if (n.kind === 'set_var' && !n.config.name) issues.push({ nodeId: n.id, level: 'error', message: 'Set variable node needs a name.' });
  }
  if (!wf.nodes.some((n) => NODE_MAP[n.kind]?.group === 'trigger')) {
    issues.push({ level: 'warn', message: 'No trigger node; the run will start from every node that has no inputs.' });
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface RunHooks {
  /** Execute a registered tool. Injected so this module never imports tools.ts. */
  runTool?: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; detail?: string }>;
  /** Ask the configured model. Injected for the same reason. */
  /**
   * `blocked` means the call could not be attempted at all (no provider
   * configured). `ok: false` without it means the call was attempted and
   * failed. The two are reported differently and never as a pass.
   */
  ask?: (prompt: string, mode?: string) => Promise<{ ok: boolean; text: string; error?: string; blocked?: boolean }>;
  memoryWrite?: (text: string, kind: string) => void;
  memorySearch?: (q: string, limit: number) => string[];
  notify?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  onNode?: (r: NodeRun) => void;
  input?: string;
  signal?: AbortSignal;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

export async function runWorkflow(wf: Workflow, hooks: RunHooks = {}): Promise<WorkflowRun> {
  const started = Date.now();
  const log: string[] = [];
  const nodeRuns: NodeRun[] = [];
  const vars: Record<string, unknown> = { input: hooks.input ?? '' };
  const values = new Map<string, unknown>();
  const activePort = new Map<string, string>();
  const reached = new Set<string>();
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const { order, cycle } = topoSort(wf.nodes, wf.edges);
  if (cycle) {
    return {
      id: uid('run'),
      workflowId: wf.id,
      started,
      finished: Date.now(),
      status: 'blocked',
      nodes: [],
      log: [`Refused to run: the graph contains a cycle involving ${cycle.length} node(s).`],
    };
  }

  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const incoming = (id: string) => wf.edges.filter((e) => e.to === id);
  let stopped: 'ok' | 'failed' | null = null;

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const kind = NODE_MAP[node.kind];
    const t0 = Date.now();
    const emit = (r: NodeRun) => {
      nodeRuns.push(r);
      hooks.onNode?.(r);
    };

    if (!kind) {
      emit({ nodeId: id, kind: node.kind, status: 'failed', output: '', ms: 0, reason: 'unknown node kind' });
      continue;
    }
    if (node.kind === 'comment') {
      emit({ nodeId: id, kind: node.kind, status: 'skipped', output: '', ms: 0, reason: 'documentation node' });
      continue;
    }
    if (stopped) {
      emit({ nodeId: id, kind: node.kind, status: 'skipped', output: '', ms: 0, reason: 'run already stopped' });
      continue;
    }
    if (hooks.signal?.aborted) {
      emit({ nodeId: id, kind: node.kind, status: 'skipped', output: '', ms: 0, reason: 'cancelled' });
      continue;
    }

    const ins = incoming(id);
    let inputValue: unknown = hooks.input ?? '';
    if (ins.length) {
      const live = ins.filter((e) => reached.has(e.from) && activePort.get(e.from) === e.fromPort);
      if (!live.length) {
        emit({ nodeId: id, kind: node.kind, status: 'skipped', output: '', ms: 0, reason: 'branch not taken' });
        continue;
      }
      inputValue = values.get(live[0].from);
    } else if (kind.group !== 'trigger' && kind.inputs > 0) {
      emit({ nodeId: id, kind: node.kind, status: 'skipped', output: '', ms: 0, reason: 'no incoming connection' });
      continue;
    }

    const cfg = (k: string, d = ''): string => interpolate(node.config[k] ?? d, { ...vars, input: asText(inputValue) });
    let port = kind.outputs[0] ?? 'out';
    let value: unknown = inputValue;
    let status: NodeRun['status'] = 'ok';
    let reason: string | undefined;

    try {
      switch (node.kind) {
        case 'start':
        case 'trigger_manual':
        case 'trigger_schedule':
        case 'trigger_message':
          value = hooks.input ?? '';
          break;
        case 'input_text':
          value = cfg('value');
          break;
        case 'input_number':
          value = Number(cfg('value', '0')) || 0;
          break;
        case 'input_run':
          value = hooks.input ?? '';
          break;
        case 'output':
          value = inputValue;
          vars[`output.${cfg('label', 'result')}`] = value;
          break;
        case 'log':
          log.push(cfg('message') || asText(inputValue));
          break;
        case 'if': {
          const l = cfg('left') || asText(inputValue);
          const r = cfg('right');
          const op = node.config.op ?? '==';
          const truth =
            op === '==' ? l === r :
            op === '!=' ? l !== r :
            op === 'contains' ? l.includes(r) :
            op === '>' ? Number(l) > Number(r) :
            op === '<' ? Number(l) < Number(r) :
            op === 'empty' ? !l.trim() :
            !!l.trim();
          port = truth ? 'true' : 'false';
          break;
        }
        case 'switch': {
          const v = cfg('value') || asText(inputValue);
          const cases = cfg('cases').split(',').map((c) => c.trim()).filter(Boolean);
          const idx = cases.findIndex((c) => v.toLowerCase().includes(c.toLowerCase()));
          port = idx === 0 ? 'a' : idx === 1 ? 'b' : idx === 2 ? 'c' : 'default';
          break;
        }
        case 'loop': {
          const want = Number(cfg('count', '1')) || 1;
          const n = Math.min(LOOP_CAP, Math.max(0, Math.floor(want)));
          if (want > LOOP_CAP) log.push(`Loop requested ${want} iterations; clamped to ${LOOP_CAP}.`);
          vars[`loop.${id}`] = n;
          value = n;
          port = n > 0 ? 'each' : 'done';
          break;
        }
        case 'delay': {
          const want = Number(cfg('ms', '0')) || 0;
          const ms = Math.min(DELAY_CAP_MS, Math.max(0, want));
          if (want > DELAY_CAP_MS) log.push(`Delay requested ${want}ms; clamped to ${DELAY_CAP_MS}ms.`);
          await sleep(ms);
          break;
        }
        case 'merge':
          value = inputValue;
          break;
        case 'filter':
          port = asText(inputValue).includes(cfg('contains')) ? 'pass' : 'block';
          break;
        case 'stop':
          stopped = (node.config.status as 'ok' | 'failed') === 'failed' ? 'failed' : 'ok';
          log.push(`Run stopped by node ${id} with status ${stopped}.`);
          break;
        case 'try':
          port = /error|failed|exception|cannot/i.test(asText(inputValue)) ? 'error' : 'ok';
          break;
        case 'set_var':
          vars[cfg('name', 'value')] = inputValue;
          break;
        case 'get_var':
          value = vars[cfg('name')] ?? '';
          break;
        case 'template':
          value = cfg('template');
          break;
        case 'math': {
          const r = safeMath(cfg('expression') || asText(inputValue));
          if (!r.ok) {
            status = 'failed';
            reason = r.error;
          } else value = r.value;
          break;
        }
        case 'json_parse':
          try {
            let cur: unknown = JSON.parse(asText(inputValue));
            for (const seg of cfg('path').split('.').filter(Boolean)) cur = (cur as Record<string, unknown>)?.[seg];
            value = cur;
          } catch (e) {
            port = 'error';
            value = e instanceof Error ? e.message : 'parse error';
          }
          break;
        case 'json_stringify':
          value = JSON.stringify(inputValue, null, 2);
          break;
        case 'regex': {
          try {
            const re = new RegExp(cfg('pattern'), cfg('flags', 'g') || 'g');
            const m = [...asText(inputValue).matchAll(re)].map((x) => x[0]);
            value = m;
            port = m.length ? 'out' : 'none';
          } catch (e) {
            status = 'failed';
            reason = e instanceof Error ? e.message : 'bad regex';
          }
          break;
        }
        case 'replace':
          value = asText(inputValue).split(cfg('find')).join(cfg('replace'));
          break;
        case 'split':
          value = asText(inputValue).split(cfg('separator', '\n') || '\n');
          break;
        case 'join':
          value = Array.isArray(inputValue) ? inputValue.join(cfg('separator', '\n') || '\n') : asText(inputValue);
          break;
        case 'slice': {
          const n = Number(cfg('count', '10')) || 10;
          value = Array.isArray(inputValue) ? inputValue.slice(0, n) : asText(inputValue).slice(0, n);
          break;
        }
        case 'sort': {
          const arr = Array.isArray(inputValue) ? [...inputValue].map(asText) : asText(inputValue).split('\n');
          arr.sort();
          if (cfg('direction', 'asc') === 'desc') arr.reverse();
          value = arr;
          break;
        }
        case 'count': {
          const t = Array.isArray(inputValue) ? inputValue.join('\n') : asText(inputValue);
          const unit = cfg('unit', 'characters');
          value = unit === 'words' ? t.split(/\s+/).filter(Boolean).length : unit === 'lines' ? t.split('\n').length : t.length;
          break;
        }
        case 'tool': {
          if (!hooks.runTool) {
            status = 'blocked';
            reason = 'no tool runner supplied to this run';
            break;
          }
          let args: Record<string, unknown> = {};
          const raw = cfg('args');
          if (raw.trim()) {
            try {
              args = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              status = 'failed';
              reason = 'arguments are not valid JSON';
              break;
            }
          }
          const r = await hooks.runTool(node.config.tool ?? '', args);
          value = r.detail ?? r.summary;
          if (!r.ok) {
            port = 'error';
            reason = r.summary;
          }
          break;
        }
        case 'memory_write':
          hooks.memoryWrite?.(asText(inputValue), node.config.kind ?? 'note');
          value = inputValue;
          break;
        case 'memory_search': {
          const hits = hooks.memorySearch?.(asText(inputValue), Number(cfg('limit', '5')) || 5) ?? [];
          value = hits;
          port = hits.length ? 'out' : 'none';
          break;
        }
        case 'notify':
          hooks.notify?.(cfg('message') || asText(inputValue));
          break;
        case 'ai_prompt':
        case 'agent_run': {
          if (!hooks.ask) {
            status = 'blocked';
            reason = 'no model runner supplied to this run';
            break;
          }
          const prompt = node.kind === 'ai_prompt' ? cfg('prompt') || asText(inputValue) : cfg('task') || asText(inputValue);
          const r = await hooks.ask(prompt, node.config.mode);
          if (!r.ok) {
            // A node that produced no model output is never reported as ok -
            // downstream nodes would otherwise consume an error string as data.
            status = r.blocked ? 'blocked' : 'failed';
            reason = r.error || r.text || 'the model call returned no answer';
            port = 'error';
            break;
          }
          value = r.text;
          break;
        }
        case 'classify': {
          const labels = cfg('labels').split(',').map((s) => s.trim()).filter(Boolean);
          const t = asText(inputValue).toLowerCase();
          let best = 0;
          let bestScore = -1;
          labels.slice(0, 3).forEach((lab, i) => {
            const score = lab.toLowerCase().split(/\s+/).reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
            if (score > bestScore) {
              bestScore = score;
              best = i;
            }
          });
          value = labels[best] ?? '';
          port = (['a', 'b', 'c'][best] ?? 'a') as string;
          break;
        }
        default:
          status = 'failed';
          reason = `no implementation for "${node.kind}"`;
      }
    } catch (e) {
      status = 'failed';
      reason = e instanceof Error ? e.message : String(e);
    }

    values.set(id, value);
    if (status === 'ok') {
      reached.add(id);
      activePort.set(id, port);
    }
    emit({ nodeId: id, kind: node.kind, status, output: asText(value).slice(0, 500), ms: Date.now() - t0, reason });
  }

  const anyFailed = nodeRuns.some((n) => n.status === 'failed');
  const anyBlocked = nodeRuns.some((n) => n.status === 'blocked');
  return {
    id: uid('run'),
    workflowId: wf.id,
    started,
    finished: Date.now(),
    status: stopped === 'failed' || anyFailed ? 'failed' : anyBlocked ? 'blocked' : 'ok',
    nodes: nodeRuns,
    log,
  };
}

/* ------------------------------------------------------------------ */
/* Seeded templates                                                    */
/* ------------------------------------------------------------------ */

const n = (id: string, kind: string, x: number, y: number, config: Record<string, string> = {}): WFNode => ({ id, kind, x, y, config });
const e = (from: string, fromPort: string, to: string): WFEdge => ({ id: `${from}-${fromPort}-${to}`, from, fromPort, to });

export function seedWorkflows(): Workflow[] {
  return [
    {
      id: 'wf_triage',
      name: 'Message triage',
      desc: 'Classify an incoming message, then either answer it or file it to memory.',
      updated: Date.now(),
      nodes: [
        n('t', 'start', 40, 40),
        n('c', 'classify', 40, 160, { labels: 'question, task, note' }),
        n('q', 'ai_prompt', 240, 100, { prompt: 'Answer concisely: {{input}}' }),
        n('k', 'memory_write', 240, 220, { kind: 'task' }),
        n('m', 'memory_write', 240, 320, { kind: 'note' }),
        n('o', 'output', 460, 160, { label: 'result' }),
      ],
      edges: [e('t', 'out', 'c'), e('c', 'a', 'q'), e('c', 'b', 'k'), e('c', 'c', 'm'), e('q', 'out', 'o'), e('k', 'out', 'o')],
    },
    {
      id: 'wf_daily',
      name: 'Morning briefing',
      desc: 'Date, weather and a look at what you asked to be reminded about.',
      updated: Date.now(),
      nodes: [
        n('s', 'trigger_schedule', 40, 40, { every: '1440' }),
        n('d', 'tool', 40, 160, { tool: 'datetime', args: '{}' }),
        n('w', 'tool', 240, 160, { tool: 'weather', args: '{"location":"Jersey City"}' }),
        n('mm', 'memory_search', 440, 160, { limit: '5' }),
        n('tpl', 'template', 640, 160, { template: 'Briefing\n\n{{input}}' }),
        n('o', 'output', 840, 160, { label: 'briefing' }),
      ],
      edges: [e('s', 'out', 'd'), e('d', 'out', 'w'), e('w', 'out', 'mm'), e('mm', 'out', 'tpl'), e('tpl', 'out', 'o')],
    },
    {
      id: 'wf_review',
      name: 'Code review pass',
      desc: 'Static review of a snippet, then a model summary of the findings.',
      updated: Date.now(),
      nodes: [
        n('s', 'start', 40, 40),
        n('v', 'set_var', 40, 150, { name: 'code' }),
        n('r', 'tool', 240, 150, { tool: 'code_review', args: '{"code":"{{code}}"}' }),
        n('f', 'try', 440, 150),
        n('a', 'ai_prompt', 640, 90, { prompt: 'Summarise these static-analysis findings and rank them by risk:\n{{input}}' }),
        n('l', 'log', 640, 230, { message: 'Review produced no findings.' }),
        n('o', 'output', 860, 150, { label: 'review' }),
      ],
      edges: [e('s', 'out', 'v'), e('v', 'out', 'r'), e('r', 'out', 'f'), e('f', 'ok', 'a'), e('f', 'error', 'l'), e('a', 'out', 'o'), e('l', 'out', 'o')],
    },
  ];
}

export function blankWorkflow(name = 'Untitled workflow'): Workflow {
  return {
    id: uid('wf'),
    name,
    desc: '',
    updated: Date.now(),
    nodes: [n(uid('n'), 'start', 40, 40), n(uid('n'), 'output', 300, 40, { label: 'result' })],
    edges: [],
  };
}
