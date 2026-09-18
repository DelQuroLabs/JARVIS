import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

const n = (id, kind, config = {}) => ({ id, kind, x: 0, y: 0, config });
const e = (from, fromPort, to) => ({ id: `${from}-${fromPort}-${to}`, from, fromPort, to });
const wf = (nodes, edges, extra = {}) => ({ id: 'w', name: 'w', desc: '', nodes, edges, updated: 0, ...extra });

/* ------------------------------------------------------------------ */
describe('workflow graph', () => {
  test('node catalog is coherent', () => {
    const kinds = C.NODE_KINDS.map((k) => k.kind);
    assert.equal(new Set(kinds).size, kinds.length, 'duplicate node kind');
    assert.equal(C.NODE_KIND_COUNT, C.NODE_KINDS.length);
    for (const k of C.NODE_KINDS) {
      assert.ok(k.label && k.desc.length > 10, `${k.kind} is underdescribed`);
      assert.ok(['trigger', 'io', 'logic', 'data', 'action', 'agent'].includes(k.group));
    }
  });

  test('topoSort orders a chain', () => {
    const r = C.topoSort([n('a', 'start'), n('b', 'log'), n('c', 'output')], [e('a', 'out', 'b'), e('b', 'out', 'c')]);
    assert.equal(r.cycle, null);
    assert.deepEqual(r.order, ['a', 'b', 'c']);
  });

  test('topoSort detects a cycle', () => {
    const r = C.topoSort([n('a', 'log'), n('b', 'log')], [e('a', 'out', 'b'), e('b', 'out', 'a')]);
    assert.notEqual(r.cycle, null);
    assert.equal(r.cycle.length, 2);
  });

  test('wouldCycle refuses self-links and back-links', () => {
    const nodes = [n('a', 'start'), n('b', 'log')];
    const edges = [e('a', 'out', 'b')];
    assert.equal(C.wouldCycle(nodes, edges, 'a', 'a'), true);
    assert.equal(C.wouldCycle(nodes, edges, 'b', 'a'), true);
    assert.equal(C.wouldCycle(nodes, edges, 'a', 'b'), false);
  });

  test('validateWorkflow flags cycles, empty graphs and unset tool nodes', () => {
    assert.ok(C.validateWorkflow(wf([], [])).some((i) => i.level === 'error'));
    assert.ok(C.validateWorkflow(wf([n('a', 'log'), n('b', 'log')], [e('a', 'out', 'b'), e('b', 'out', 'a')])).some((i) => /Cycle/.test(i.message)));
    assert.ok(C.validateWorkflow(wf([n('s', 'start'), n('t', 'tool')], [e('s', 'out', 't')])).some((i) => /no tool selected/.test(i.message)));
  });

  test('seeded templates all validate without errors', () => {
    for (const t of C.seedWorkflows()) {
      const errs = C.validateWorkflow(t).filter((i) => i.level === 'error');
      assert.equal(errs.length, 0, `${t.name}: ${errs.map((x) => x.message).join('; ')}`);
    }
  });

  test('blankWorkflow is immediately valid', () => {
    assert.equal(C.validateWorkflow(C.blankWorkflow()).filter((i) => i.level === 'error').length, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('workflow runner', () => {
  test('runs a linear graph and reports ok', async () => {
    const g = wf([n('s', 'start'), n('t', 'template', { template: 'hello {{input}}' }), n('o', 'output', { label: 'r' })], [e('s', 'out', 't'), e('t', 'out', 'o')]);
    const r = await C.runWorkflow(g, { input: 'world' });
    assert.equal(r.status, 'ok');
    assert.equal(r.nodes.find((x) => x.nodeId === 't').output, 'hello world');
  });

  test('refuses to run a cyclic graph', async () => {
    const g = wf([n('a', 'log'), n('b', 'log')], [e('a', 'out', 'b'), e('b', 'out', 'a')]);
    const r = await C.runWorkflow(g);
    assert.equal(r.status, 'blocked');
    assert.match(r.log[0], /cycle/i);
  });

  test('the untaken branch is skipped, not failed', async () => {
    const g = wf(
      [n('s', 'start'), n('i', 'if', { left: 'a', op: '==', right: 'b' }), n('y', 'log', { message: 'yes' }), n('no', 'log', { message: 'no' })],
      [e('s', 'out', 'i'), e('i', 'true', 'y'), e('i', 'false', 'no')],
    );
    const r = await C.runWorkflow(g);
    assert.equal(r.nodes.find((x) => x.nodeId === 'y').status, 'skipped');
    assert.equal(r.nodes.find((x) => x.nodeId === 'no').status, 'ok');
    assert.equal(r.status, 'ok');
  });

  test('loop iterations are capped', async () => {
    const g = wf([n('s', 'start'), n('l', 'loop', { count: '99999' })], [e('s', 'out', 'l')]);
    const r = await C.runWorkflow(g);
    assert.equal(r.nodes.find((x) => x.nodeId === 'l').output, String(C.LOOP_CAP));
    assert.ok(r.log.some((l) => /clamped/.test(l)));
  });

  test('delay is clamped and does not stall the run', async () => {
    let slept = -1;
    const g = wf([n('s', 'start'), n('d', 'delay', { ms: '999999' })], [e('s', 'out', 'd')]);
    await C.runWorkflow(g, { sleep: async (ms) => { slept = ms; } });
    assert.equal(slept, C.DELAY_CAP_MS);
  });

  test('a tool node without a runner is blocked, never a fake pass', async () => {
    const g = wf([n('s', 'start'), n('t', 'tool', { tool: 'calculator', args: '{}' })], [e('s', 'out', 't')]);
    const r = await C.runWorkflow(g);
    assert.equal(r.nodes.find((x) => x.nodeId === 't').status, 'blocked');
    assert.equal(r.status, 'blocked');
  });

  test('a tool node calls the injected runner', async () => {
    const calls = [];
    const g = wf([n('s', 'start'), n('t', 'tool', { tool: 'calculator', args: '{"expression":"2+2"}' })], [e('s', 'out', 't')]);
    const r = await C.runWorkflow(g, {
      runTool: async (tool, args) => {
        calls.push([tool, args]);
        return { ok: true, summary: '4' };
      },
    });
    assert.deepEqual(calls, [['calculator', { expression: '2+2' }]]);
    assert.equal(r.status, 'ok');
  });

  test('malformed tool arguments fail the node with a reason', async () => {
    const g = wf([n('s', 'start'), n('t', 'tool', { tool: 'calculator', args: '{not json' })], [e('s', 'out', 't')]);
    const r = await C.runWorkflow(g, { runTool: async () => ({ ok: true, summary: '' }) });
    assert.equal(r.nodes.find((x) => x.nodeId === 't').status, 'failed');
    assert.match(r.nodes.find((x) => x.nodeId === 't').reason, /valid JSON/);
  });

  test('stop halts the run and skips the rest', async () => {
    const g = wf([n('s', 'start'), n('x', 'stop', { status: 'ok' }), n('l', 'log', { message: 'never' })], [e('s', 'out', 'x'), e('x', 'out', 'l')]);
    const r = await C.runWorkflow(g);
    assert.equal(r.nodes.find((x) => x.nodeId === 'l').status, 'skipped');
  });

  test('variables set upstream interpolate downstream', async () => {
    const g = wf(
      [n('s', 'start'), n('v', 'set_var', { name: 'who' }), n('t', 'template', { template: 'hi {{who}}' }), n('o', 'output', {})],
      [e('s', 'out', 'v'), e('v', 'out', 't'), e('t', 'out', 'o')],
    );
    const r = await C.runWorkflow(g, { input: 'Ada' });
    assert.equal(r.nodes.find((x) => x.nodeId === 't').output, 'hi Ada');
  });

  test('math node evaluates and reports a bad expression', async () => {
    const good = await C.runWorkflow(wf([n('s', 'start'), n('m', 'math', { expression: '3*3' })], [e('s', 'out', 'm')]));
    assert.equal(good.nodes.find((x) => x.nodeId === 'm').output, '9');
    const bad = await C.runWorkflow(wf([n('s', 'start'), n('m', 'math', { expression: 'window' })], [e('s', 'out', 'm')]));
    assert.equal(bad.nodes.find((x) => x.nodeId === 'm').status, 'failed');
  });

  test('json_parse routes to the error port on bad input', async () => {
    const g = wf([n('s', 'start'), n('j', 'json_parse', {}), n('ok', 'log', { message: 'ok' }), n('err', 'log', { message: 'err' })],
      [e('s', 'out', 'j'), e('j', 'out', 'ok'), e('j', 'error', 'err')]);
    const r = await C.runWorkflow(g, { input: '{oops' });
    assert.equal(r.nodes.find((x) => x.nodeId === 'err').status, 'ok');
    assert.equal(r.nodes.find((x) => x.nodeId === 'ok').status, 'skipped');
  });

  test('classify picks a port without a model call', async () => {
    const g = wf([n('s', 'start'), n('c', 'classify', { labels: 'bug, feature, question' })], [e('s', 'out', 'c')]);
    const r = await C.runWorkflow(g, { input: 'this is a feature request' });
    assert.equal(r.nodes.find((x) => x.nodeId === 'c').output, 'feature');
  });

  test('a failed model call is reported failed, never ok with an error string', async () => {
    const g = wf([n('s', 'start'), n('q', 'ai_prompt', { prompt: 'hi' }), n('o', 'output', {})], [e('s', 'out', 'q'), e('q', 'out', 'o')]);
    const r = await C.runWorkflow(g, { ask: async () => ({ ok: false, text: 'rate limited', error: 'HTTP 429' }) });
    const node = r.nodes.find((x) => x.nodeId === 'q');
    assert.equal(node.status, 'failed');
    assert.equal(node.reason, 'HTTP 429');
    assert.notEqual(node.output, 'rate limited', 'an error string must not become node output');
    assert.equal(r.status, 'failed');
  });

  test('an unconfigured provider blocks the node rather than failing it', async () => {
    const g = wf([n('s', 'start'), n('q', 'ai_prompt', { prompt: 'hi' })], [e('s', 'out', 'q')]);
    const r = await C.runWorkflow(g, { ask: async () => ({ ok: false, text: '', blocked: true, error: 'No model provider is configured.' }) });
    assert.equal(r.nodes.find((x) => x.nodeId === 'q').status, 'blocked');
    assert.equal(r.status, 'blocked');
  });

  test('an ai_prompt node with no runner at all is blocked', async () => {
    const g = wf([n('s', 'start'), n('q', 'ai_prompt', { prompt: 'hi' })], [e('s', 'out', 'q')]);
    const r = await C.runWorkflow(g);
    assert.equal(r.nodes.find((x) => x.nodeId === 'q').status, 'blocked');
  });

  test('a comment node never executes', async () => {
    const r = await C.runWorkflow(wf([n('c', 'comment', { text: 'note' })], []));
    assert.equal(r.nodes[0].status, 'skipped');
  });

  test('an orphan node with inputs is skipped with a reason', async () => {
    const r = await C.runWorkflow(wf([n('s', 'start'), n('o', 'log', { message: 'x' })], []));
    assert.match(r.nodes.find((x) => x.nodeId === 'o').reason, /no incoming/);
  });
});

/* ------------------------------------------------------------------ */
describe('skills', () => {
  test('built-ins reference only registered tools', () => {
    const names = C.toolNames();
    for (const s of C.builtinSkills()) {
      const issues = C.validateSkill(s, names);
      assert.equal(issues.length, 0, `${s.name}: ${issues.map((i) => i.message).join('; ')}`);
    }
  });

  test('validation catches unknown tools and unbound references', () => {
    const bad = { id: 'x', name: 'x', desc: '', trigger: '', updated: 0, steps: [{ tool: 'nope', args: {} }] };
    assert.ok(C.validateSkill(bad, C.toolNames()).some((i) => /Unknown tool/.test(i.message)));
    const unbound = { id: 'x', name: 'x', desc: '', trigger: '', updated: 0, steps: [{ tool: 'calculator', args: { expression: '{{later}}' } }] };
    assert.ok(C.validateSkill(unbound, C.toolNames()).some((i) => /before anything binds/.test(i.message)));
  });

  test('validation rejects a duplicate binding', () => {
    const dupe = {
      id: 'x', name: 'x', desc: '', trigger: '', updated: 0,
      steps: [{ tool: 'calculator', args: { expression: '1+1' }, as: 'v' }, { tool: 'calculator', args: { expression: '2+2' }, as: 'v' }],
    };
    assert.ok(C.validateSkill(dupe, C.toolNames()).some((i) => /already bound/.test(i.message)));
  });

  test('runSkill threads bindings between steps', async () => {
    const seen = [];
    const skill = {
      id: 's', name: 's', desc: '', trigger: '', updated: 0,
      steps: [
        { tool: 'a', args: { x: '{{input}}' }, as: 'first' },
        { tool: 'b', args: { y: '{{first}}' } },
      ],
    };
    const r = await C.runSkill(skill, 'seed', {
      runTool: async (tool, args) => {
        seen.push([tool, args]);
        return { id: tool, tool, args, ok: true, summary: `${tool}-out`, ms: 1 };
      },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(seen[0], ['a', { x: 'seed' }]);
    assert.deepEqual(seen[1], ['b', { y: 'a-out' }]);
  });

  test('runSkill stops at the first failure and says which step', async () => {
    const skill = { id: 's', name: 's', desc: '', trigger: '', updated: 0, steps: [{ tool: 'a', args: {} }, { tool: 'b', args: {} }] };
    const r = await C.runSkill(skill, '', { runTool: async (tool) => ({ id: tool, tool, args: {}, ok: tool !== 'a', summary: 'boom', ms: 1 }) });
    assert.equal(r.ok, false);
    assert.equal(r.steps.length, 1);
    assert.match(r.output, /Step 1 \(a\) failed/);
  });

  test('matchSkill resolves a slash trigger and its input', () => {
    const skills = C.builtinSkills();
    const hit = C.matchSkill('/clean   some   text', skills);
    assert.equal(hit.skill.trigger, 'clean');
    assert.equal(hit.input, 'some   text');
    assert.equal(C.matchSkill('clean this up', skills), null);
  });
});

/* ------------------------------------------------------------------ */
describe('crew', () => {
  test('no role advertises a tool that does not exist', () => {
    assert.deepEqual(C.missingTools(C.toolNames()), []);
  });

  test('every preset resolves to real roles', () => {
    for (const p of C.PRESETS) {
      assert.equal(C.rolesOf(p.id).length, p.roles.length, `${p.id} has a dangling role id`);
    }
  });

  test('roles cover every declared department', () => {
    for (const d of C.DEPARTMENTS) assert.ok(C.ROLES.some((r) => r.dept === d), `no role in ${d}`);
  });

  test('the prompt carries the full prior transcript', () => {
    const prompt = C.crewPrompt(C.ROLES[0], 'brief text', [{ roleId: 'x', roleName: 'Architect', text: 'earlier point', ms: 1, via: 'test' }]);
    assert.match(prompt, /Architect/);
    assert.match(prompt, /earlier point/);
    assert.match(prompt, /brief text/);
  });

  test('runCrew runs roles in order and each sees what came before', async () => {
    const prompts = [];
    const r = await C.runCrew('ship it', 'design', {
      ask: async (p) => {
        prompts.push(p);
        return { ok: true, text: `answer ${prompts.length}`, via: 'test' };
      },
    });
    assert.equal(r.turns.length, C.rolesOf('design').length);
    assert.equal(r.status, 'ok');
    assert.ok(prompts[1].includes('answer 1'));
  });

  test('a partial failure is reported as partial, not ok', async () => {
    let i = 0;
    const r = await C.runCrew('x', 'design', { ask: async () => ({ ok: ++i !== 2, text: 't', via: 'test' }) });
    assert.equal(r.status, 'partial');
  });

  test('a total failure is reported as failed', async () => {
    const r = await C.runCrew('x', 'design', { ask: async () => { throw new Error('rate limited'); } });
    assert.equal(r.status, 'failed');
    assert.match(r.turns[0].error, /rate limited/);
  });
});

/* ------------------------------------------------------------------ */
describe('routines', () => {
  const base = { id: 'r', name: 'r', action: { type: 'skill', ref: 's' }, runs: 0 };

  test('disabled routines are never due', () => {
    assert.equal(C.isDue({ ...base, when: 'interval', everyMin: 1, enabled: false }, Date.now()), false);
  });

  test('manual routines are never automatically due', () => {
    assert.equal(C.isDue({ ...base, when: 'manual', enabled: true }, Date.now()), false);
  });

  test('interval respects the elapsed window', () => {
    const now = Date.now();
    assert.equal(C.isDue({ ...base, when: 'interval', everyMin: 60, enabled: true, lastRun: now - 30 * 60_000 }, now), false);
    assert.equal(C.isDue({ ...base, when: 'interval', everyMin: 60, enabled: true, lastRun: now - 61 * 60_000 }, now), true);
  });

  test('daily fires once per day after the hour', () => {
    const at3pm = new Date(2026, 0, 2, 15, 0, 0).getTime();
    const yesterday = new Date(2026, 0, 1, 15, 0, 0).getTime();
    assert.equal(C.isDue({ ...base, when: 'daily', atHour: 8, enabled: true, lastRun: yesterday }, at3pm), true);
    assert.equal(C.isDue({ ...base, when: 'daily', atHour: 8, enabled: true, lastRun: at3pm }, at3pm), false);
    const at6am = new Date(2026, 0, 2, 6, 0, 0).getTime();
    assert.equal(C.isDue({ ...base, when: 'daily', atHour: 8, enabled: true, lastRun: yesterday }, at6am), false);
  });

  test('startup fires only when it has never run', () => {
    assert.equal(C.isDue({ ...base, when: 'startup', enabled: true }, Date.now()), true);
    assert.equal(C.isDue({ ...base, when: 'startup', enabled: true, lastRun: 1 }, Date.now()), false);
  });

  test('every schedule describes itself honestly', () => {
    for (const when of ['manual', 'startup', 'interval', 'daily']) {
      const text = C.describeSchedule({ ...base, when, enabled: true });
      assert.ok(text.length > 10);
      if (when === 'interval' || when === 'daily') assert.match(text, /open/, 'must disclose the app must be open');
    }
  });
});

/* ------------------------------------------------------------------ */
describe('traces and estimates', () => {
  const mk = (over = {}) => C.makeTrace({ kind: 'chat', label: 'x', ms: 100, ok: true, via: 'groq', tokensIn: 100, tokensOut: 50, ...over });

  test('the ring buffer is bounded', () => {
    let list = [];
    for (let i = 0; i < C.MAX_TRACES + 50; i++) list = C.pushTrace(list, mk());
    assert.equal(list.length, C.MAX_TRACES);
  });

  test('free providers estimate to zero cost', () => {
    const est = C.estimate([mk({ via: 'groq' }), mk({ via: 'gemini' }), mk({ via: 'reflex' })]);
    assert.equal(est.costUsd, 0);
    assert.equal(est.runs, 3);
  });

  test('paid providers estimate above zero', () => {
    assert.ok(C.estimate([mk({ via: 'openai', tokensOut: 1_000_000 })]).costUsd > 0);
  });

  test('success rate reflects failures', () => {
    assert.equal(C.estimate([mk(), mk({ ok: false })]).successRate, 0.5);
  });

  test('activity always returns 24 buckets', () => {
    assert.equal(C.activity([]).length, 24);
  });

  test('patterns stay quiet on a small sample', () => {
    assert.deepEqual(C.discoverPatterns([mk(), mk()]), []);
  });

  test('a reflex-heavy history is surfaced as a pattern', () => {
    const traces = Array.from({ length: 10 }, () => mk({ via: 'reflex' }));
    assert.ok(C.discoverPatterns(traces).some((p) => p.id === 'reflex'));
  });

  test('a failure-heavy history is surfaced as a pattern', () => {
    const traces = Array.from({ length: 10 }, (_, i) => mk({ ok: i < 3 }));
    assert.ok(C.discoverPatterns(traces).some((p) => p.id === 'failures'));
  });
});

/* ------------------------------------------------------------------ */
describe('providers', () => {
  test('every provider declares its capabilities', () => {
    for (const p of C.PROVIDERS) {
      assert.ok(p.label && p.note.length > 15, `${p.id} underdescribed`);
      assert.ok(p.models.includes(p.model), `${p.id} default model is not in its list`);
      assert.equal(typeof p.nativeTools, 'boolean');
    }
  });

  test('the keyless provider declares its real limits', () => {
    const p = C.specOf('pollinations');
    assert.equal(p.multiTurn, false);
    assert.equal(p.systemRole, false);
    assert.equal(p.nativeTools, false);
    assert.equal(p.needsKey, false);
  });

  test('isConfigured requires a key where one is needed', () => {
    assert.equal(C.isConfigured({ id: 'groq' }), false);
    assert.equal(C.isConfigured({ id: 'groq', key: 'gsk_' + 'x'.repeat(40) }), true);
    assert.equal(C.isConfigured({ id: 'pollinations' }), true);
    assert.equal(C.isConfigured({ id: 'ollama' }), false);
    assert.equal(C.isConfigured({ id: 'ollama', baseUrl: 'http://localhost:11434' }), true);
  });

  test('parseToolCalls reads a fenced tool block', () => {
    const calls = C.parseToolCalls('sure\n```tool\n{"tool":"calculator","args":{"expression":"2+2"}}\n```');
    assert.deepEqual(calls, [{ tool: 'calculator', args: { expression: '2+2' } }]);
  });

  test('parseToolCalls reads several blocks and deduplicates', () => {
    const text = '```tool\n{"tool":"a","args":{}}\n```\n```tool\n{"tool":"b","args":{}}\n```\n```tool\n{"tool":"a","args":{}}\n```';
    assert.equal(C.parseToolCalls(text).length, 2);
  });

  test('parseToolCalls tolerates a json fence and a bare object', () => {
    assert.equal(C.parseToolCalls('```json\n{"tool":"x","args":{}}\n```')[0].tool, 'x');
    assert.equal(C.parseToolCalls('{"tool":"y","args":{"a":1}}')[0].tool, 'y');
  });

  test('parseToolCalls ignores malformed JSON instead of throwing', () => {
    assert.deepEqual(C.parseToolCalls('```tool\n{oops\n```'), []);
  });

  test('stripToolBlocks leaves prose only', () => {
    const out = C.stripToolBlocks('Here you go.\n```tool\n{"tool":"a","args":{}}\n```\nDone.');
    assert.equal(out.includes('tool'), false);
    assert.match(out, /Here you go/);
    assert.match(out, /Done/);
  });

  test('the tool protocol prompt lists the offered tools', () => {
    const p = C.toolProtocolPrompt([C.TOOL_MAP.calculator]);
    assert.match(p, /calculator/);
    assert.match(p, /```tool/);
  });
});

/* ------------------------------------------------------------------ */
describe('modes and ideas', () => {
  test('mode ids are unique and budgets are enforceable', () => {
    const ids = C.MODES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of C.MODES) {
      assert.ok(m.maxSteps >= 1, `${m.id} maxSteps`);
      assert.ok(m.toolBudget >= 0, `${m.id} toolBudget`);
      assert.ok(m.system.length > 40, `${m.id} system prompt`);
    }
  });

  test('brief mode really has no tool budget', () => {
    assert.equal(C.modeOf('brief').toolBudget, 0);
  });

  test('private mode excludes the network group', () => {
    assert.equal(C.modeOf('private').groups.includes('network'), false);
  });

  test('modeOf falls back rather than throwing', () => {
    assert.equal(C.modeOf('nonexistent').id, C.MODES[0].id);
  });

  test('seeded ideas are searchable', () => {
    const ideas = C.seedIdeas();
    assert.ok(ideas.length >= 6);
    assert.ok(C.searchIdeas(ideas, 'privacy').length >= 1);
    assert.equal(C.searchIdeas(ideas, '').length, ideas.length);
  });
});
