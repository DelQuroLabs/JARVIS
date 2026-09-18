import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

/* ------------------------------------------------------------------ */
describe('util', () => {
  test('safeMath evaluates arithmetic', () => {
    assert.equal(C.safeMath('(847 * 23) / 4').value, 4870.25);
    assert.equal(C.safeMath('2^10').value, 1024);
    assert.equal(C.safeMath('100 % 7').value, 2);
  });

  test('safeMath refuses identifiers and calls', () => {
    for (const bad of ['fetch("x")', 'process.exit(1)', 'globalThis', 'alert(1)', '[].constructor']) {
      assert.equal(C.safeMath(bad).ok, false, `should refuse: ${bad}`);
    }
  });

  test('safeMath refuses an over-long expression', () => {
    assert.equal(C.safeMath('1+'.repeat(200) + '1').ok, false);
  });

  test('interpolate substitutes and leaves unknown keys intact', () => {
    assert.equal(C.interpolate('hi {{name}} {{nope}}', { name: 'Ada' }), 'hi Ada {{nope}}');
  });

  test('estTokens is monotonic', () => {
    assert.ok(C.estTokens('a'.repeat(400)) > C.estTokens('a'.repeat(100)));
  });

  test('titleFrom truncates with an ellipsis', () => {
    assert.ok(C.titleFrom('x'.repeat(80)).length <= 42);
    assert.equal(C.titleFrom(''), 'New conversation');
  });

  test('hash32 is stable and differs for different inputs', () => {
    assert.equal(C.hash32('jarvis'), C.hash32('jarvis'));
    assert.notEqual(C.hash32('jarvis'), C.hash32('jarvi5'));
  });
});

/* ------------------------------------------------------------------ */
describe('privacy', () => {
  test('redacts credentials at every level, including OPEN', () => {
    const secret = 'key sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    for (const level of ['STRICT', 'GUARDED', 'OPEN']) {
      const r = C.scan(secret, level);
      assert.ok(!r.clean.includes('sk-proj-abcdefghijklmnopqrstuvwxyz123456'), `leaked at ${level}`);
    }
  });

  test('catches each credential family', () => {
    const cases = [
      ['gsk_' + 'a'.repeat(40), 'Groq key'],
      ['AIza' + 'b'.repeat(35), 'Google API key'],
      ['ghp_' + 'c'.repeat(36), 'GitHub token'],
      ['AKIAIOSFODNN7EXAMPLE', 'AWS access key'],
      ['sk-ant-' + 'd'.repeat(30), 'Anthropic key'],
      ['postgresql://u:p@db.example.com:5432/x', 'Connection string'],
    ];
    for (const [sample, label] of cases) {
      const r = C.scan(`value ${sample}`, 'GUARDED');
      assert.ok(r.findings.some((f) => f.label === label), `missed ${label}`);
    }
  });

  test('GUARDED keeps ordinary contact details, STRICT removes them', () => {
    const t = 'mail me at person@example.com';
    assert.ok(C.scan(t, 'GUARDED').clean.includes('person@example.com'));
    assert.ok(!C.scan(t, 'STRICT').clean.includes('person@example.com'));
  });

  test('networkAllowed gates only STRICT', () => {
    assert.equal(C.networkAllowed('STRICT'), false);
    assert.equal(C.networkAllowed('GUARDED'), true);
    assert.equal(C.networkAllowed('OPEN'), true);
  });

  test('clean text produces no findings', () => {
    assert.equal(C.scan('a perfectly ordinary sentence', 'STRICT').findings.length, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('intents', () => {
  test('"who are you" matches identity, not search', () => {
    const m = C.matchIntent('who are you');
    assert.equal(m.intent.id, 'identity');
    assert.equal(m.canned, true);
  });

  test('canned replies never leak their marker id', () => {
    for (const q of ['who are you', 'what can you do', 'hi', 'thanks']) {
      const m = C.matchIntent(q);
      assert.equal(m.canned, true);
      // The bar is prose rather than the rule id - some replies are legitimately terse.
      assert.ok(m.text.length > 4, `${q} returned a marker, not prose`);
      assert.notEqual(m.text, m.intent.id);
    }
  });

  test('arithmetic dispatches to the calculator', () => {
    const m = C.matchIntent('what is 12 * 9');
    assert.equal(m.call.tool, 'calculator');
    assert.equal(m.canned, false);
  });

  test('unit conversion parses value and both units', () => {
    const m = C.matchIntent('convert 10 km to mi');
    assert.deepEqual(m.call.args, { value: 10, from: 'km', to: 'mi' });
  });

  test('weather extracts the place', () => {
    assert.equal(C.matchIntent('weather in Jersey City').call.args.location, 'Jersey City');
  });

  test('search ignores self-referential pronouns', () => {
    assert.equal(C.matchIntent('look up you'), null);
    assert.equal(C.matchIntent('search for the boiling point of mercury').call.tool, 'web_search');
  });

  test('remember writes to memory', () => {
    assert.equal(C.matchIntent('remember that my stack is React and Postgres').call.tool, 'memory_write');
  });

  test('unsupported intents explain themselves instead of failing', () => {
    const m = C.matchIntent('open spotify');
    assert.equal(m.intent.kind, 'unsupported');
    assert.ok(m.reason.length > 40);
    assert.equal(m.canned, true);
  });

  test('every unsupported rule carries a reason', () => {
    for (const i of C.unsupportedIntents()) assert.ok(i.reason && i.reason.length > 30, `${i.id} has no reason`);
  });

  test('no rule matches empty or oversized input', () => {
    assert.equal(C.matchIntent(''), null);
    assert.equal(C.matchIntent('x'.repeat(700)), null);
  });
});

/* ------------------------------------------------------------------ */
describe('tool registry', () => {
  test('names are unique', () => {
    const names = C.TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });

  test('every tool declares an effect class and a description', () => {
    for (const t of C.TOOLS) {
      assert.ok(['A', 'B', 'C', 'D'].includes(t.effect), `${t.name} effect`);
      assert.ok(t.desc.length > 15, `${t.name} desc`);
      assert.ok(typeof t.run === 'function');
    }
  });

  test('mutating and network-writing tools are approval-gated', () => {
    for (const n of ['fs_write', 'fs_delete', 'code_run', 'http_request']) {
      assert.equal(C.TOOL_MAP[n].approval, true, `${n} is not gated`);
    }
  });

  test('network tools are flagged so STRICT can block them', () => {
    for (const n of ['web_search', 'fetch_url', 'weather', 'http_request']) {
      assert.equal(C.TOOL_MAP[n].network, true, `${n} is not flagged`);
    }
  });

  test('selectTools ranks a relevant tool first', () => {
    assert.equal(C.selectTools('what is 4 times 19', [], 5)[0].group, 'compute');
    assert.ok(C.selectTools('search the web for tide tables', [], 5).some((t) => t.name === 'web_search'));
  });

  test('selectTools honours group restriction', () => {
    for (const t of C.selectTools('anything at all', ['text'], 8)) assert.equal(t.group, 'text');
  });
});

/* ------------------------------------------------------------------ */
const ctx = () =>
  C.makeCtx({
    fs: {},
    memory: C.memoryStoreFrom(
      () => store,
      (v) => {
        store = v;
      },
    ),
    approve: async () => true,
  });
let store = [];

describe('tool execution', () => {
  test('calculator returns a value', async () => {
    const r = await C.TOOL_MAP.calculator.run({ expression: '6*7' }, ctx());
    assert.equal(r.ok, true);
    assert.equal(r.data, 42);
  });

  test('calculator refuses an unsafe expression', async () => {
    const r = await C.TOOL_MAP.calculator.run({ expression: 'fetch(1)' }, ctx());
    assert.equal(r.ok, false);
  });

  test('unit_convert handles temperature and length', async () => {
    const c = ctx();
    assert.match((await C.TOOL_MAP.unit_convert.run({ value: 100, from: 'c', to: 'f' }, c)).summary, /212/);
    assert.equal((await C.TOOL_MAP.unit_convert.run({ value: 1, from: 'km', to: 'm' }, c)).data, 1000);
  });

  test('unit_convert reports an unknown unit', async () => {
    const r = await C.TOOL_MAP.unit_convert.run({ value: 1, from: 'parsec', to: 'm' }, ctx());
    assert.equal(r.ok, false);
    assert.match(r.summary, /Unknown unit/);
  });

  test('text_transform slug and dedupe', async () => {
    const c = ctx();
    assert.equal((await C.TOOL_MAP.text_transform.run({ text: 'Hello, World!', op: 'slug' }, c)).data, 'hello-world');
    assert.equal((await C.TOOL_MAP.text_transform.run({ text: 'a\na\nb', op: 'dedupe-lines' }, c)).data, 'a\nb');
  });

  test('text_stats counts words', async () => {
    const r = await C.TOOL_MAP.text_stats.run({ text: 'one two three' }, ctx());
    assert.equal(r.data.words, 3);
  });

  test('json_tool validates, queries and reports parse errors', async () => {
    const c = ctx();
    assert.equal((await C.TOOL_MAP.json_tool.run({ json: '{"a":1}', op: 'validate' }, c)).ok, true);
    assert.equal((await C.TOOL_MAP.json_tool.run({ json: '{"a":{"b":7}}', op: 'query', path: 'a.b' }, c)).data, 7);
    assert.equal((await C.TOOL_MAP.json_tool.run({ json: '{oops', op: 'format' }, c)).ok, false);
  });

  test('regex_extract returns matches and rejects a bad pattern', async () => {
    const c = ctx();
    assert.deepEqual((await C.TOOL_MAP.regex_extract.run({ text: 'a1 b2 c3', pattern: '\\d' }, c)).data, ['1', '2', '3']);
    assert.equal((await C.TOOL_MAP.regex_extract.run({ text: 'x', pattern: '([' }, c)).ok, false);
  });

  test('csv_summary computes numeric statistics', async () => {
    const r = await C.TOOL_MAP.csv_summary.run({ csv: 'name,score\na,10\nb,20' }, ctx());
    const score = r.data.stats.find((s) => s.column === 'score');
    assert.equal(score.mean, 15);
    assert.equal(score.sum, 30);
  });

  test('csv_summary refuses a header-only file', async () => {
    assert.equal((await C.TOOL_MAP.csv_summary.run({ csv: 'a,b' }, ctx())).ok, false);
  });

  test('encode round-trips base64', async () => {
    const c = ctx();
    const enc = await C.TOOL_MAP.encode.run({ text: 'jarvis', op: 'base64-encode' }, c);
    const dec = await C.TOOL_MAP.encode.run({ text: enc.data, op: 'base64-decode' }, c);
    assert.equal(dec.data, 'jarvis');
  });

  test('diff_text counts added and removed lines', async () => {
    const r = await C.TOOL_MAP.diff_text.run({ a: 'one\ntwo', b: 'one\nthree' }, ctx());
    assert.deepEqual(r.data, { added: 1, removed: 1 });
  });

  test('code_review finds risky patterns', async () => {
    const r = await C.TOOL_MAP.code_review.run({ code: 'eval(x)\nel.innerHTML = y\nvar apiKey = "abcdef1234"' }, ctx());
    assert.ok(r.data.length >= 3);
  });

  test('virtual filesystem writes, reads, lists and deletes', async () => {
    const c = ctx();
    await C.TOOL_MAP.fs_write.run({ path: 'a.txt', content: 'hello' }, c);
    assert.equal((await C.TOOL_MAP.fs_read.run({ path: 'a.txt' }, c)).data, 'hello');
    assert.deepEqual((await C.TOOL_MAP.fs_list.run({}, c)).data, ['a.txt']);
    await C.TOOL_MAP.fs_delete.run({ path: 'a.txt' }, c);
    assert.equal((await C.TOOL_MAP.fs_read.run({ path: 'a.txt' }, c)).ok, false);
  });

  test('fs_write refuses path traversal', async () => {
    const r = await C.TOOL_MAP.fs_write.run({ path: '../../etc/passwd', content: 'x' }, ctx());
    assert.equal(r.ok, false);
    assert.match(r.summary, /traversal/i);
  });

  test('memory tools write and search', async () => {
    store = [];
    const c = ctx();
    await C.TOOL_MAP.memory_write.run({ text: 'the deploy target is Cloudflare Pages', kind: 'decision' }, c);
    const found = await C.TOOL_MAP.memory_search.run({ query: 'deploy target' }, c);
    assert.equal(found.ok, true);
    assert.equal(found.data.length, 1);
  });

  test('plan_outline is bounded', async () => {
    const r = await C.TOOL_MAP.plan_outline.run({ goal: 'ship the beta', steps: 99 }, ctx());
    assert.equal(r.data.length, 10);
  });

  test('run_skill refuses direct invocation', async () => {
    assert.equal((await C.TOOL_MAP.run_skill.run({ name: 'x' }, ctx())).ok, false);
  });

  test('code_run reports blocked where Workers are unavailable', async () => {
    const r = await C.TOOL_MAP.code_run.run({ code: 'return 1' }, ctx());
    // Node has no DOM Worker: the honest result is a refusal, never a fake pass.
    assert.equal(r.ok, false);
    assert.match(r.summary, /Worker|unavailable|isolate/i);
  });
});

/* ------------------------------------------------------------------ */
describe('loop guards', () => {
  const base = {
    ctx: ctx(),
    privacy: 'GUARDED',
    provider: { id: 'reflex' },
    onStep: () => {},
  };

  test('canned intents answer with zero model calls', async () => {
    const r = await C.runAgent([{ id: '1', role: 'user', content: 'who are you', ts: Date.now() }], { ...base, mode: C.modeOf('assist') });
    assert.match(r.text, /JARVIS/);
    assert.equal(r.calls.length, 0);
    assert.equal(r.tokensIn, 0);
  });

  test('a tool intent runs the tool and returns its result', async () => {
    const r = await C.runAgent([{ id: '1', role: 'user', content: 'what is 8 * 8', ts: Date.now() }], { ...base, mode: C.modeOf('assist') });
    assert.equal(r.calls.length, 1);
    assert.match(r.text, /64/);
  });

  test('a zero tool budget executes zero tools', async () => {
    const r = await C.runAgent([{ id: '1', role: 'user', content: 'what is 8 * 8', ts: Date.now() }], { ...base, mode: C.modeOf('brief') });
    assert.equal(C.modeOf('brief').toolBudget, 0);
    assert.equal(r.calls.length, 0);
  });

  test('STRICT privacy blocks a network tool with a reason', async () => {
    const r = await C.executeTool({ tool: 'weather', args: { location: 'Oslo' } }, { ctx: ctx(), privacy: 'STRICT' });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'privacy');
  });

  test('a denied approval is recorded as blocked, not failed silently', async () => {
    const denying = C.makeCtx({ fs: {}, memory: C.memoryStoreFrom(() => [], () => {}), approve: async () => false });
    const r = await C.executeTool({ tool: 'fs_write', args: { path: 'x', content: 'y' } }, { ctx: denying, privacy: 'GUARDED' });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'denied');
  });

  test('an unknown tool is refused, not invented', async () => {
    const r = await C.executeTool({ tool: 'summon_daemon', args: {} }, { ctx: ctx(), privacy: 'OPEN' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-registered');
  });

  test('the reflex provider never claims to be a model', async () => {
    const r = await C.runAgent([{ id: '1', role: 'user', content: 'explain quantum tunnelling', ts: Date.now() }], { ...base, mode: C.modeOf('assist') });
    assert.equal(r.via, 'reflex');
    assert.equal(r.degraded, true);
  });
});

/* ------------------------------------------------------------------ */
describe('reflex core', () => {
  test('answers a known intent from rules', () => {
    const r = C.reflex([{ id: '1', role: 'user', content: 'who are you', ts: 1 }]);
    assert.equal(r.rule, 'intent:identity');
  });

  test('surfaces relevant memory', () => {
    const r = C.reflex([{ id: '1', role: 'user', content: 'what is my deployment target', ts: 1 }], [
      { id: 'm', kind: 'decision', text: 'deployment target is Cloudflare Pages', tags: [], created: 1 },
    ]);
    assert.equal(r.rule, 'memory-recall');
    assert.match(r.text, /Cloudflare/);
  });

  test('summarises long pasted text extractively', () => {
    const body = 'The service degraded at noon. Latency rose sharply across every region. '.repeat(12);
    const r = C.reflex([{ id: '1', role: 'user', content: body, ts: 1 }]);
    assert.equal(r.rule, 'extractive-summary');
  });

  test('declines to guess at a question it cannot answer', () => {
    const r = C.reflex([{ id: '1', role: 'user', content: 'who won the 2031 world cup?', ts: 1 }]);
    assert.equal(r.rule, 'question-no-model');
    assert.match(r.text, /guessing is worse than nothing/);
  });

  test('always marks itself offline', () => {
    assert.equal(C.reflex([{ id: '1', role: 'user', content: 'hello there', ts: 1 }]).offline, true);
  });
});
