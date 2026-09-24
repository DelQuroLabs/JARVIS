// Tests for the expanded provider list, the ranked fallback chain, the optional
// service keys and the new keyless data tools.
//
// The point of the registry tests is to make a lie impossible to ship: a
// provider cannot appear in the UI without an adapter behind it, a probed CORS
// date, and an honest cost tier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, SELECTABLE, specOf, isConfigured, hasCredential, buildChain, DEFAULT_BASE_URL,
  SERVICES, connectedServices, serviceOf,
  TOOLS, TOOL_MAP, makeCtx, memoryStoreFrom, scan, detect, DEFAULT_SETTINGS,
} from './.build/core.mjs';

const ctxWith = (overrides = {}) =>
  makeCtx({
    fs: {},
    memory: memoryStoreFrom([], () => {}),
    ...overrides,
  });

describe('provider registry', () => {
  test('every provider declares a cost tier and a CORS verdict', () => {
    for (const p of PROVIDERS) {
      assert.ok(['free', 'trial', 'paid', 'local', 'keyless'].includes(p.tier), `${p.id} has no tier`);
      assert.ok(['verified', 'unverified', 'local'].includes(p.cors), `${p.id} has no cors verdict`);
    }
  });

  test('any provider claiming a browser-verified endpoint carries the probe date', () => {
    for (const p of PROVIDERS.filter((x) => x.cors === 'verified')) {
      assert.match(p.probed ?? '', /^\d{4}-\d{2}-\d{2}$/, `${p.id} claims verified with no probe date`);
    }
  });

  test('tier and the free flag never contradict each other', () => {
    for (const p of PROVIDERS) {
      if (p.tier === 'paid' || p.tier === 'trial') {
        assert.equal(p.free, false, `${p.id} is ${p.tier} but flagged free`);
      }
      if (p.tier === 'free') assert.equal(p.free, true, `${p.id} is a free tier but not flagged free`);
    }
  });

  test('every key-needing provider offers a link to get one', () => {
    for (const p of PROVIDERS.filter((x) => x.needsKey)) {
      assert.match(p.keyUrl ?? '', /^https:\/\//, `${p.id} needs a key but has no keyUrl`);
    }
  });

  test('ids are unique and every spec has at least one model', () => {
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PROVIDERS) {
      assert.ok(p.models.length > 0, `${p.id} lists no models`);
      assert.ok(p.models.includes(p.model), `${p.id} default model is not in its own list`);
    }
  });

  test('the retired and CORS-blocked candidates are not listed', () => {
    const ids = PROVIDERS.map((p) => p.id);
    // GitHub Models returned HTTP 410 and NVIDIA/SambaNova send no CORS header.
    for (const banned of ['github', 'githubmodels', 'nvidia', 'sambanova']) {
      assert.ok(!ids.includes(banned), `${banned} must not be offered as a model provider`);
    }
  });

  test('SELECTABLE hides the two providers a user cannot choose', () => {
    assert.ok(!SELECTABLE.some((p) => p.id === 'reflex'));
    assert.ok(!SELECTABLE.some((p) => p.id === 'pollinations'));
    assert.ok(SELECTABLE.length >= 10, 'expected a meaningfully wider provider list');
  });

  test('at least four providers are genuinely free to use', () => {
    const free = PROVIDERS.filter((p) => p.tier === 'free');
    assert.ok(free.length >= 4, `only ${free.length} free tiers`);
  });

  test('local providers ship a default base URL so setup is one tap', () => {
    assert.equal(DEFAULT_BASE_URL.ollama, 'http://localhost:11434');
    assert.equal(DEFAULT_BASE_URL.lmstudio, 'http://localhost:1234');
  });

  test('specOf falls back rather than throwing on an unknown id', () => {
    assert.equal(specOf('nonsense').id, 'reflex');
  });
});

describe('configuration checks', () => {
  test('a key-needing provider is not configured until a plausible key exists', () => {
    assert.equal(isConfigured({ id: 'cerebras' }), false);
    assert.equal(isConfigured({ id: 'cerebras', key: 'short' }), false);
    assert.equal(isConfigured({ id: 'cerebras', key: 'csk-abcdefghijklmnop' }), true);
  });

  test('URL-based providers need a URL, not a key', () => {
    assert.equal(isConfigured({ id: 'lmstudio' }), false);
    assert.equal(isConfigured({ id: 'lmstudio', baseUrl: 'http://localhost:1234' }), true);
    assert.equal(isConfigured({ id: 'custom', baseUrl: 'https://my.host/v1' }), true);
    assert.equal(isConfigured({ id: 'custom', key: 'sk-whatever-长' }), false);
  });

  // Regression: the Providers header once read "2 of 18 connected" on a fresh
  // install, because resolveProvider merges a default localhost URL into the
  // local providers and isConfigured accepts it. A default URL is not a
  // connection -- nothing need be listening on that port.
  test('hasCredential is stricter than isConfigured for local providers', () => {
    assert.equal(isConfigured({ id: 'ollama', baseUrl: DEFAULT_BASE_URL.ollama }), true);
    assert.equal(hasCredential('ollama', {}), false);
    assert.equal(hasCredential('ollama', { ollama: {} }), false);
    assert.equal(hasCredential('ollama', { ollama: { baseUrl: 'http://localhost:11434' } }), true);
  });

  test('a fresh install claims zero connected providers', () => {
    const count = SELECTABLE.filter((p) => hasCredential(p.id, DEFAULT_SETTINGS.keyring ?? {})).length;
    assert.equal(count, 0, 'a new user has connected nothing, and the UI must say so');
  });

  test('hasCredential needs a real key, not a placeholder', () => {
    assert.equal(hasCredential('groq', { groq: { key: '   ' } }), false);
    assert.equal(hasCredential('groq', { groq: { key: 'gsk_abcdefghijklmnop' } }), true);
  });
});

describe('ranked fallback chain', () => {
  const groq = { id: 'groq', key: 'gsk_' + 'a'.repeat(40) };
  const cerebras = { id: 'cerebras', key: 'csk-' + 'b'.repeat(30) };
  const mistral = { id: 'mistral', key: 'm'.repeat(32) };

  test('the active provider is always attempted first', () => {
    const chain = buildChain(groq, [cerebras, mistral]);
    assert.equal(chain[0].id, 'groq');
  });

  test('ranked order is preserved after the active provider', () => {
    const chain = buildChain(groq, [mistral, cerebras], { allowKeyless: false });
    assert.deepEqual(chain.map((c) => c.id), ['groq', 'mistral', 'cerebras']);
  });

  test('unconfigured providers are dropped, not attempted', () => {
    const chain = buildChain(groq, [{ id: 'openai' }, cerebras], { allowKeyless: false });
    assert.deepEqual(chain.map((c) => c.id), ['groq', 'cerebras']);
  });

  test('a duplicate in the chain is only tried once', () => {
    const chain = buildChain(groq, [groq, cerebras], { allowKeyless: false });
    assert.deepEqual(chain.map((c) => c.id), ['groq', 'cerebras']);
  });

  test('the keyless endpoint is appended last when allowed', () => {
    const chain = buildChain(groq, [cerebras], { allowKeyless: true });
    assert.equal(chain[chain.length - 1].id, 'pollinations');
  });

  test('the keyless endpoint is absent when the user turned it off', () => {
    const chain = buildChain(groq, [cerebras], { allowKeyless: false });
    assert.ok(!chain.some((c) => c.id === 'pollinations'));
  });

  test('the reflex core is never put in the network chain', () => {
    const chain = buildChain(groq, [{ id: 'reflex' }], { allowKeyless: false });
    assert.ok(!chain.some((c) => c.id === 'reflex'));
  });

  test('an unconfigured primary is still reported so the user learns why', () => {
    const chain = buildChain({ id: 'openai' }, [], { allowKeyless: false });
    assert.deepEqual(chain.map((c) => c.id), ['openai']);
  });

  test('the default chain ships free tiers only', () => {
    for (const id of DEFAULT_SETTINGS.chain) {
      assert.equal(specOf(id).tier, 'free', `${id} is in the default chain but is not a free tier`);
    }
  });
});

describe('optional service keys', () => {
  test('every service documents both what a key unlocks and what works without one', () => {
    for (const s of SERVICES) {
      assert.ok(s.unlocks.length > 10, `${s.id} does not say what the key unlocks`);
      assert.ok(s.withoutKey.length > 10, `${s.id} does not say what works keyless`);
      assert.match(s.keyUrl, /^https:\/\//);
      assert.ok(s.tools.length > 0);
    }
  });

  test('every service names tools that actually exist', () => {
    for (const s of SERVICES) {
      for (const t of s.tools) assert.ok(TOOL_MAP[t], `${s.id} claims to upgrade missing tool ${t}`);
    }
  });

  test('connectedServices ignores blank and stub values', () => {
    assert.deepEqual(connectedServices({}), []);
    assert.deepEqual(connectedServices({ tavily: '   ' }), []);
    assert.deepEqual(connectedServices({ tavily: 'tvly-abcdef123456' }), ['tavily']);
  });

  test('serviceOf resolves a known id and returns undefined otherwise', () => {
    assert.equal(serviceOf('github')?.label, 'GitHub');
    assert.equal(serviceOf('nope'), undefined);
  });

  test('a context with no keys reports empty strings, never undefined', () => {
    const ctx = ctxWith();
    assert.equal(ctx.serviceKey('tavily'), '');
    assert.equal(ctx.serviceKey('github'), '');
  });

  test('a context passes through the keys it was given, trimmed', () => {
    const ctx = ctxWith({ serviceKeys: { github: '  ghp_token  ' } });
    assert.equal(ctx.serviceKey('github'), 'ghp_token');
  });
});

describe('new keyless tools', () => {
  const names = ['currency_convert', 'crypto_price', 'earthquakes', 'hn_search', 'geocode', 'word_lookup', 'book_search', 'tv_search', 'space_news', 'github_repo', 'nasa_apod'];

  test('all eleven are registered', () => {
    for (const n of names) assert.ok(TOOL_MAP[n], `${n} is missing from the registry`);
  });

  test('each one is declared as network egress, so STRICT privacy blocks it', () => {
    for (const n of names) assert.equal(TOOL_MAP[n].network, true, `${n} does not declare network`);
  });

  test('none of them requires approval, because all are read-only lookups', () => {
    for (const n of names) assert.ok(!TOOL_MAP[n].approval, `${n} should not be approval-gated`);
  });

  test('every tool in the whole registry has a description and typed params', () => {
    for (const t of TOOLS) {
      assert.ok(t.desc.length > 10, `${t.name} has a thin description`);
      for (const p of t.params) {
        assert.ok(['string', 'number', 'boolean'].includes(p.type), `${t.name}.${p.name} has a bad type`);
        assert.ok(p.desc.length > 0, `${t.name}.${p.name} has no description`);
      }
    }
  });

  test('currency_convert short-circuits an identical pair with no network call', async () => {
    let called = false;
    const ctx = ctxWith({});
    ctx.fetchJson = async () => {
      called = true;
      return {};
    };
    const r = await TOOL_MAP.currency_convert.run({ amount: 10, from: 'USD', to: 'usd' }, ctx);
    assert.equal(r.ok, true);
    assert.equal(called, false);
    assert.match(r.summary, /10 USD = 10 USD/);
  });

  test('currency_convert rejects a malformed code instead of calling out', async () => {
    const ctx = ctxWith();
    ctx.fetchJson = async () => assert.fail('should not have called the network');
    const r = await TOOL_MAP.currency_convert.run({ amount: 1, from: 'dollars', to: 'EUR' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.summary, /three letters/);
  });

  test('currency_convert converts using the published rate', async () => {
    const ctx = ctxWith();
    ctx.fetchJson = async () => ({ date: '2026-09-04', rates: { EUR: 0.5 } });
    const r = await TOOL_MAP.currency_convert.run({ amount: 10, from: 'USD', to: 'EUR' }, ctx);
    assert.equal(r.ok, true);
    assert.match(r.summary, /5\.00 EUR/);
  });

  test('crypto_price maps a common symbol to its coin id', async () => {
    let seen = '';
    const ctx = ctxWith();
    ctx.fetchJson = async (url) => {
      seen = url;
      return { bitcoin: { usd: 1000, usd_24h_change: -2.5 } };
    };
    const r = await TOOL_MAP.crypto_price.run({ coin: 'BTC' }, ctx);
    assert.match(seen, /ids=bitcoin/);
    assert.equal(r.ok, true);
    assert.match(r.summary, /-2\.50% in 24h/);
  });

  test('crypto_price fails honestly on an unknown coin rather than inventing a price', async () => {
    const ctx = ctxWith();
    ctx.fetchJson = async () => ({});
    const r = await TOOL_MAP.crypto_price.run({ coin: 'notacoin' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.summary, /No price found/);
  });

  test('github_repo runs anonymously and says so', async () => {
    let auth;
    const ctx = ctxWith();
    ctx.fetchJson = async (_url, init) => {
      auth = init?.headers?.Authorization;
      return { full_name: 'a/b', stargazers_count: 5, forks_count: 1, open_issues_count: 0, pushed_at: '2026-01-01' };
    };
    const r = await TOOL_MAP.github_repo.run({ repo: 'a/b' }, ctx);
    assert.equal(auth, undefined);
    assert.equal(r.ok, true);
    assert.match(r.detail, /60 requests an hour/);
  });

  test('github_repo uses a token when one is saved, and drops the nag', async () => {
    let auth;
    const ctx = ctxWith({ serviceKeys: { github: 'ghp_realtoken' } });
    ctx.fetchJson = async (_url, init) => {
      auth = init?.headers?.Authorization;
      return { full_name: 'a/b', stargazers_count: 5, forks_count: 1, open_issues_count: 0, pushed_at: '2026-01-01' };
    };
    const r = await TOOL_MAP.github_repo.run({ repo: 'a/b' }, ctx);
    assert.equal(auth, 'Bearer ghp_realtoken');
    assert.ok(!/60 requests an hour/.test(r.detail ?? ''));
  });

  test('github_repo rejects a non owner/name string', async () => {
    const ctx = ctxWith();
    ctx.fetchJson = async () => assert.fail('should not have called the network');
    const r = await TOOL_MAP.github_repo.run({ repo: 'just-a-name' }, ctx);
    assert.equal(r.ok, false);
  });

  test('nasa_apod falls back to the shared demo key and discloses it', async () => {
    let seen = '';
    const ctx = ctxWith();
    ctx.fetchJson = async (url) => {
      seen = url;
      return { title: 'A galaxy', date: '2026-09-04', explanation: 'text', url: 'https://x', media_type: 'image' };
    };
    const r = await TOOL_MAP.nasa_apod.run({}, ctx);
    assert.match(seen, /api_key=DEMO_KEY/);
    assert.match(r.detail, /DEMO_KEY/);
  });

  test('nasa_apod validates the date format before calling out', async () => {
    const ctx = ctxWith();
    ctx.fetchJson = async () => assert.fail('should not have called the network');
    const r = await TOOL_MAP.nasa_apod.run({ date: 'yesterday' }, ctx);
    assert.equal(r.ok, false);
  });

  test('web_search prefers Tavily when a key is present', async () => {
    let seen = '';
    const ctx = ctxWith({ serviceKeys: { tavily: 'tvly-key123456789' } });
    ctx.fetchJson = async (url) => {
      seen = url;
      return { answer: 'the answer', results: [{ title: 'T', url: 'u', content: 'c' }] };
    };
    const r = await TOOL_MAP.web_search.run({ query: 'test' }, ctx);
    assert.match(seen, /tavily/);
    assert.equal(r.ok, true);
    assert.match(r.summary, /the answer/);
  });

  test('web_search falls back to the keyless path when Tavily errors', async () => {
    const ctx = ctxWith({ serviceKeys: { tavily: 'tvly-key123456789' } });
    let calls = 0;
    ctx.fetchJson = async (url) => {
      calls++;
      if (url.includes('tavily')) throw new Error('HTTP 401');
      return { AbstractText: 'keyless answer', AbstractURL: 'https://ddg' };
    };
    const r = await TOOL_MAP.web_search.run({ query: 'test' }, ctx);
    assert.ok(calls >= 2, 'expected a fallback call after the Tavily failure');
    assert.equal(r.ok, true);
    assert.match(r.summary, /keyless answer/);
  });

  test('word_lookup picks the right Datamuse parameter per kind', async () => {
    const ctx = ctxWith();
    let seen = '';
    ctx.fetchJson = async (url) => {
      seen = url;
      return [{ word: 'glad' }];
    };
    await TOOL_MAP.word_lookup.run({ word: 'happy', kind: 'rhymes' }, ctx);
    assert.match(seen, /rel_rhy=happy/);
  });

  test('earthquakes clamps a silly limit instead of hammering the feed', async () => {
    const ctx = ctxWith();
    let seen = '';
    ctx.fetchJson = async (url) => {
      seen = url;
      return { features: [] };
    };
    await TOOL_MAP.earthquakes.run({ limit: 9999 }, ctx);
    assert.match(seen, /limit=20/);
  });
});

describe('credential redaction covers the new key shapes', () => {
  const cases = [
    ['csk-' + 'a'.repeat(30), 'cerebras-key'],
    ['hf_' + 'b'.repeat(30), 'huggingface-token'],
    ['xai-' + 'c'.repeat(30), 'xai-key'],
    ['pplx-' + 'd'.repeat(30), 'perplexity-key'],
    ['nvapi-' + 'e'.repeat(30), 'nvidia-key'],
    ['tvly-' + 'f'.repeat(20), 'tavily-key'],
  ];

  for (const [key, mask] of cases) {
    test(`${mask} is redacted`, () => {
      const out = scan(`my key is ${key} ok`);
      assert.match(out.clean, new RegExp(`REDACTED:${mask}`));
      assert.ok(!out.clean.includes(key));
    });
  }

  test('an OpenRouter key is labelled OpenRouter, not OpenAI', () => {
    const found = detect('sk-or-v1-' + 'a'.repeat(40));
    assert.ok(found.some((f) => f.label === 'OpenRouter key'), JSON.stringify(found));
    assert.ok(!found.some((f) => f.label === 'OpenAI key'));
  });

  test('a plain OpenAI key is still caught after the reorder', () => {
    const found = detect('sk-' + 'a'.repeat(40));
    assert.ok(found.some((f) => f.label === 'OpenAI key'));
  });
});
