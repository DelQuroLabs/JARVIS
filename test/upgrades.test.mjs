import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

/* ------------------------------------------------------------------ */
describe('slash commands', () => {
  const ctx = () => {
    const mem = [];
    const ideas = [];
    let mode = 'assist';
    const routes = [];
    return {
      mem,
      ideas,
      routes,
      get mode() {
        return mode;
      },
      remember: (text, kind) => mem.push({ id: String(mem.length), text, kind, tags: [], created: 1 }),
      recall: (q, n) => mem.filter((m) => m.text.toLowerCase().includes(q.toLowerCase())).slice(0, n),
      capture: (title, body) => ideas.push({ title, body }),
      toolNames: () => C.toolNames(),
      setMode: (id) => {
        if (!C.MODES.some((m) => m.id === id)) return false;
        mode = id;
        return true;
      },
      modeIds: () => C.MODES.map((m) => m.id),
      go: (r) => routes.push(r),
    };
  };

  test('every command is documented and unique', () => {
    const names = C.COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    assert.equal(new Set(names).size, names.length, 'duplicate command name or alias');
    for (const c of C.COMMANDS) {
      assert.ok(c.desc.length > 12, `${c.name} is underdescribed`);
      assert.ok(['memory', 'compute', 'navigate', 'system'].includes(c.group));
    }
  });

  test('matchCommand resolves names, aliases and the argument', () => {
    assert.equal(C.matchCommand('/calc 2+2').spec.name, 'calc');
    assert.equal(C.matchCommand('/math 2+2').spec.name, 'calc');
    assert.equal(C.matchCommand('/remember  the sky is blue').arg, 'the sky is blue');
    assert.equal(C.matchCommand('/help').arg, '');
  });

  test('plain text is not a command', () => {
    assert.equal(C.matchCommand('calc 2+2'), null);
    assert.equal(C.matchCommand('what is 2+2'), null);
    assert.equal(C.matchCommand('/nonexistent thing'), null);
    assert.equal(C.matchCommand(''), null);
  });

  test('/calc evaluates locally', () => {
    const r = C.matchCommand('/calc 847 * 23');
    const out = r.spec.run(r.arg, ctx());
    assert.equal(out.ok, true);
    assert.match(out.text, /19481/);
  });

  test('/calc refuses an unsafe expression instead of guessing', () => {
    const r = C.matchCommand('/calc fetch("x")');
    const out = r.spec.run(r.arg, ctx());
    assert.equal(out.ok, false);
    assert.equal(out.handled, true, 'a refusal still counts as handled - no model should run');
  });

  test('/remember writes and /recall finds it', () => {
    const c = ctx();
    C.matchCommand('/remember the deploy target is Cloudflare Pages').spec.run('the deploy target is Cloudflare Pages', c);
    assert.equal(c.mem.length, 1);
    const out = C.matchCommand('/recall deploy').spec.run('deploy', c);
    assert.equal(out.ok, true);
    assert.match(out.text, /Cloudflare/);
  });

  test('/recall says nothing matched rather than inventing one', () => {
    const out = C.matchCommand('/recall unicorn').spec.run('unicorn', ctx());
    assert.equal(out.ok, false);
    assert.match(out.text, /Nothing in memory/);
  });

  test('/idea captures with a truncated title', () => {
    const c = ctx();
    const long = 'x'.repeat(90);
    C.matchCommand(`/idea ${long}`).spec.run(long, c);
    assert.equal(c.ideas.length, 1);
    assert.ok(c.ideas[0].title.length <= 48);
    assert.equal(c.ideas[0].body, long);
  });

  test('/mode switches and rejects an unknown mode', () => {
    const c = ctx();
    assert.equal(C.matchCommand('/mode deep').spec.run('deep', c).ok, true);
    assert.equal(c.mode, 'deep');
    const bad = C.matchCommand('/mode banana').spec.run('banana', c);
    assert.equal(bad.ok, false);
    assert.match(bad.text, /not a mode/);
  });

  test('/tools reports the real registry size', () => {
    const out = C.matchCommand('/tools').spec.run('', ctx());
    assert.match(out.text, new RegExp(`\\\\*\\\\*${C.TOOLS.length} tools\\\\*\\\\*`));
  });

  test('/go navigates', () => {
    const c = ctx();
    C.matchCommand('/go workflows').spec.run('workflows', c);
    assert.deepEqual(c.routes, ['/app/workflows']);
  });

  test('/help lists every command', () => {
    const out = C.matchCommand('/help').spec.run('', ctx());
    for (const c of C.COMMANDS) assert.ok(out.text.includes(`/${c.name}`), `${c.name} missing from help`);
  });

  test('a command with no argument explains itself instead of failing blankly', () => {
    for (const name of ['calc', 'remember', 'recall', 'idea', 'go']) {
      const spec = C.COMMANDS.find((c) => c.name === name);
      const out = spec.run('', ctx());
      assert.equal(out.ok, false);
      assert.ok(out.text.length > 25, `${name} gave no guidance`);
    }
  });

  test('autocomplete filters by prefix', () => {
    assert.ok(C.suggestCommands('/').length > 3);
    assert.equal(C.suggestCommands('/rem')[0].name, 'remember');
    assert.deepEqual(C.suggestCommands('/calc 2+2'), [], 'a completed command offers no suggestions');
    assert.deepEqual(C.suggestCommands('hello'), []);
  });
});

/* ------------------------------------------------------------------ */
describe('tolerant tool-call parser', () => {
  const one = (t) => C.parseToolCalls(t);

  test('accepts every key alias models actually emit', () => {
    for (const key of ['tool', 'name', 'tool_name', 'command']) {
      const r = one(`\`\`\`tool\n{"${key}":"calculator","args":{}}\n\`\`\``);
      assert.equal(r.length, 1, `${key} not accepted`);
      assert.equal(r[0].tool, 'calculator');
    }
    for (const key of ['args', 'arguments', 'parameters', 'input']) {
      const r = one(`\`\`\`tool\n{"tool":"calculator","${key}":{"expression":"1+1"}}\n\`\`\``);
      assert.deepEqual(r[0].args, { expression: '1+1' }, `${key} not accepted`);
    }
  });

  test('handles a nested args object', () => {
    const r = one('```tool\n{"tool":"http_request","args":{"headers":{"A":"b"},"body":{"n":[1,2]}}}\n```');
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].args.headers, { A: 'b' });
    assert.deepEqual(r[0].args.body.n, [1, 2]);
  });

  test('a brace inside a string value does not truncate the object', () => {
    const r = one('```tool\n{"tool":"text_transform","args":{"text":"a { b } c"}}\n```');
    assert.equal(r.length, 1);
    assert.equal(r[0].args.text, 'a { b } c');
  });

  test('an escaped quote inside a string is survived', () => {
    const r = one('```tool\n{"tool":"text_stats","args":{"text":"she said \\"hi\\" loudly"}}\n```');
    assert.equal(r.length, 1);
    assert.match(r[0].args.text, /hi/);
  });

  test('de-dupes structurally identical calls regardless of key order', () => {
    const r = one('```tool\n{"tool":"calculator","args":{"a":1,"b":2}}\n```\n```tool\n{"tool":"calculator","args":{"b":2,"a":1}}\n```');
    assert.equal(r.length, 1);
  });

  test('a fenced call is not counted twice when also present bare', () => {
    const body = '{"tool":"calculator","args":{"expression":"2+2"}}';
    assert.equal(one(`\`\`\`tool\n${body}\n\`\`\``).length, 1);
  });

  test('runs several distinct calls from one message', () => {
    const r = one('```tool\n{"tool":"a","args":{}}\n```\ntext\n```tool\n{"tool":"b","args":{"x":1}}\n```');
    assert.deepEqual(r.map((c) => c.tool), ['a', 'b']);
  });

  test('ignores malformed JSON without throwing', () => {
    assert.doesNotThrow(() => one('```tool\n{"tool":"a", oops}\n```'));
    assert.deepEqual(one('```tool\n{"tool":"a", oops}\n```'), []);
  });

  test('ignores objects that are not tool calls', () => {
    assert.deepEqual(one('here is some json {"temperature": 0.7, "top_p": 1}'), []);
  });

  test('rejects a non-object args value', () => {
    assert.deepEqual(one('{"tool":"a","args":"not an object"}'), []);
    assert.deepEqual(one('{"tool":"a","args":[1,2]}'), []);
  });

  test('accepts a bare object with no fence at all', () => {
    const r = one('Sure, let me compute that.\n{"tool":"calculator","args":{"expression":"6*7"}}');
    assert.equal(r.length, 1);
  });
});

/* ------------------------------------------------------------------ */
describe('stream idle timeout', () => {
  test('the ceiling is generous enough not to kill a slow but healthy stream', () => {
    assert.ok(C.STREAM_IDLE_MS >= 15_000, 'too aggressive - slow tiers would false-fail');
    assert.ok(C.STREAM_IDLE_MS <= 45_000, 'too lax - a hung tier would hold the turn');
  });
});

/* ------------------------------------------------------------------ */
describe('crew circuit breaker', () => {
  test('a dead tier skips the remaining roles instead of timing out on each', async () => {
    let asked = 0;
    const r = await C.runCrew('ship it', 'design', {
      ask: async () => {
        asked++;
        throw new Error('ETIMEDOUT');
      },
    });
    assert.equal(asked, 1, 'only the first role should have been attempted');
    assert.ok(r.turns.length > 1);
    assert.equal(r.turns[1].skipped, true);
    assert.match(r.turns[1].error, /failed earlier/);
    assert.equal(r.status, 'failed');
  });

  test('a skipped role is never presented as an answer', async () => {
    const r = await C.runCrew('x', 'design', { ask: async () => ({ ok: false, text: '', via: 'none' }) });
    for (const t of r.turns.slice(1)) {
      assert.equal(t.text, '', 'a skipped role must not carry text');
      assert.equal(t.skipped, true);
    }
  });

  test('a reflex answer is kept, tagged, and stops the rest of the run', async () => {
    let asked = 0;
    const r = await C.runCrew('x', 'design', {
      ask: async () => {
        asked++;
        return { ok: true, text: 'offline answer', via: 'reflex' };
      },
    });
    assert.equal(asked, 1);
    assert.equal(r.turns[0].fellBack, true);
    assert.equal(r.turns[0].text, 'offline answer');
    assert.equal(r.status, 'partial');
  });

  test('a healthy run is untouched by the breaker', async () => {
    const r = await C.runCrew('x', 'design', { ask: async () => ({ ok: true, text: 'considered view', via: 'groq' }) });
    assert.equal(r.status, 'ok');
    assert.equal(r.turns.every((t) => !t.skipped && !t.fellBack), true);
  });
});

/* ------------------------------------------------------------------ */
describe('privacy false positives', () => {
  test('luhn accepts a valid card and rejects a random digit run', () => {
    assert.equal(C.luhn('4242424242424242'), true);
    assert.equal(C.luhn('4242424242424243'), false);
    assert.equal(C.luhn('1234567890123'), false);
  });

  test('an order number is not redacted as a card', () => {
    const t = 'order 1234567890123456 shipped';
    assert.match(C.scan(t, 'STRICT').clean, /1234567890123456/);
  });

  test('a real card number is still redacted', () => {
    const r = C.scan('card 4242 4242 4242 4242', 'STRICT');
    assert.ok(!r.clean.includes('4242 4242 4242 4242'));
    assert.ok(r.findings.some((f) => f.label === 'Credit card'));
  });

  test('a bare commit SHA is left alone', () => {
    const sha = 'a'.repeat(40);
    const t = `deployed commit ${sha} to staging`;
    assert.match(C.scan(t, 'STRICT').clean, new RegExp(sha));
  });

  test('the same hex next to a key label is redacted', () => {
    const hex = 'b'.repeat(40);
    const r = C.scan(`api_key ${hex}`, 'GUARDED');
    assert.ok(!r.clean.includes(hex), 'a labelled hex secret must be redacted');
  });

  test('the label may appear after the value too', () => {
    const hex = 'c'.repeat(32);
    assert.ok(!C.scan(`${hex} is the auth token`, 'GUARDED').clean.includes(hex));
  });

  test('multiple hits in one string are all replaced', () => {
    const r = C.scan('keys gsk_' + 'a'.repeat(40) + ' and gsk_' + 'b'.repeat(40), 'GUARDED');
    assert.equal(r.findings.find((f) => f.label === 'Groq key').count, 2);
    assert.ok(!/gsk_a/.test(r.clean));
    assert.ok(!/gsk_b/.test(r.clean));
  });

  test('replacement does not corrupt surrounding text', () => {
    const r = C.scan('before gsk_' + 'a'.repeat(40) + ' after', 'GUARDED');
    assert.match(r.clean, /^before /);
    assert.match(r.clean, / after$/);
  });
});

/* ------------------------------------------------------------------ */
describe('estimate extras', () => {
  const mk = (over = {}) => C.makeTrace({ kind: 'chat', label: 'x', ms: 10, ok: true, via: 'groq', ...over });

  test('offline share counts only reflex runs', () => {
    const e = C.estimate([mk({ via: 'reflex' }), mk({ via: 'reflex' }), mk({ via: 'groq' }), mk({ via: 'gemini' })]);
    assert.equal(e.offlineRuns, 2);
    assert.equal(e.offlineShare, 0.5);
  });

  test('failures are counted separately from the success rate', () => {
    const e = C.estimate([mk(), mk({ ok: false }), mk({ ok: false })]);
    assert.equal(e.failures, 2);
    assert.equal(e.successRate, 1 / 3);
  });

  test('an empty history reports zero, not NaN', () => {
    const e = C.estimate([]);
    assert.equal(e.offlineShare, 0);
    assert.equal(e.failures, 0);
    assert.equal(Number.isFinite(e.avgMs), true);
  });
});
