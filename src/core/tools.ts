// Tool registry. Pure registry + implementations; this module MUST NOT import
// store.ts (a store -> workflow -> TOOL_MAP cycle blanked the previous build).
// The execution context lives in ctx.ts for the same reason.

import type { ToolOutput, ToolSpec } from './types.ts';
import { safeMath, hash32, estTokens } from './util.ts';

const ok = (summary: string, data?: unknown, detail?: string): ToolOutput => ({ ok: true, summary, data, detail });
const fail = (summary: string, detail?: string): ToolOutput => ({ ok: false, summary, detail });

const str = (a: Record<string, unknown>, k: string, d = ''): string => {
  const v = a[k];
  return v === undefined || v === null ? d : String(v);
};
const num = (a: Record<string, unknown>, k: string, d = 0): number => {
  const v = Number(a[k]);
  return Number.isFinite(v) ? v : d;
};

/* ------------------------------------------------------------------ */
/* Sandboxed JS execution (AGT-001)                                    */
/* ------------------------------------------------------------------ */

const WORKER_SRC = `
self.onmessage = async (e) => {
  const logs = [];
  const console = { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push('ERROR ' + a.map(String).join(' ')), warn: (...a) => logs.push('WARN ' + a.map(String).join(' ')), info: (...a) => logs.push(a.map(String).join(' ')) };
  try {
    const fn = new Function('console', '"use strict";' + e.data.code);
    const value = await fn(console);
    self.postMessage({ ok: true, logs, value: value === undefined ? null : String(value) });
  } catch (err) {
    self.postMessage({ ok: false, logs, error: String(err && err.message ? err.message : err) });
  }
};
`;

export interface SandboxResult {
  ok: boolean;
  logs: string[];
  value?: string | null;
  error?: string;
  blocked?: string;
}

/**
 * Run untrusted JS inside a Worker with network globals removed and a hard
 * timeout. Returns `blocked` (never a fake pass) when Workers are unavailable.
 */
export function runSandboxed(code: string, timeoutMs = 4000): Promise<SandboxResult> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve({ ok: false, logs: [], blocked: 'Web Workers are unavailable in this runtime, so code cannot be isolated. Refusing to run it unsandboxed.' });
  }
  const guard = 'self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;self.indexedDB=undefined;';
  const url = URL.createObjectURL(new Blob([guard + WORKER_SRC], { type: 'text/javascript' }));
  const w = new Worker(url);
  return new Promise<SandboxResult>((resolve) => {
    const done = (r: SandboxResult) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, logs: [], error: `execution exceeded ${timeoutMs}ms and was terminated` }), timeoutMs);
    w.onmessage = (ev: MessageEvent) => done(ev.data as SandboxResult);
    w.onerror = (ev: ErrorEvent) => done({ ok: false, logs: [], error: ev.message || 'worker error' });
    w.postMessage({ code });
  });
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const UNITS: Record<string, number> = {
  mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
  mg: 1e-6, g: 0.001, kg: 1, lb: 0.45359237, oz: 0.028349523125,
  ml: 0.001, l: 1, gal: 3.785411784, cup: 0.2365882365,
};

export const TOOLS: ToolSpec[] = [
  /* ---- compute ---- */
  {
    name: 'calculator',
    group: 'compute',
    desc: 'Evaluate an arithmetic expression (+ - * / % ^ and parentheses).',
    effect: 'A',
    params: [{ name: 'expression', type: 'string', required: true, desc: 'e.g. (847 * 23) / 4' }],
    run: async (a) => {
      const r = safeMath(str(a, 'expression'));
      return r.ok ? ok(`${str(a, 'expression')} = ${r.value}`, r.value) : fail(`Cannot evaluate: ${r.error}`);
    },
  },
  {
    name: 'unit_convert',
    group: 'compute',
    desc: 'Convert between length, mass or volume units, or between C and F.',
    effect: 'A',
    params: [
      { name: 'value', type: 'number', required: true, desc: 'numeric amount' },
      { name: 'from', type: 'string', required: true, desc: 'source unit' },
      { name: 'to', type: 'string', required: true, desc: 'target unit' },
    ],
    run: async (a) => {
      const v = num(a, 'value');
      const f = str(a, 'from').toLowerCase();
      const t = str(a, 'to').toLowerCase();
      const temp = (x: number, from: string, to: string): number | null => {
        if (from === to) return x;
        if (from === 'c' && to === 'f') return x * 9 / 5 + 32;
        if (from === 'f' && to === 'c') return (x - 32) * 5 / 9;
        return null;
      };
      const tv = temp(v, f.replace(/^deg\s*/, ''), t.replace(/^deg\s*/, ''));
      if (tv !== null && ['c', 'f'].includes(f) && ['c', 'f'].includes(t)) {
        return ok(`${v}${f.toUpperCase()} = ${tv.toFixed(2)}${t.toUpperCase()}`, tv);
      }
      if (!(f in UNITS) || !(t in UNITS)) return fail(`Unknown unit pair ${f} -> ${t}. Known: ${Object.keys(UNITS).join(', ')}, c, f`);
      const out = (v * UNITS[f]) / UNITS[t];
      return ok(`${v} ${f} = ${Number(out.toPrecision(8))} ${t}`, out);
    },
  },
  {
    name: 'datetime',
    group: 'compute',
    desc: 'Current date/time, or add/subtract days from today.',
    effect: 'A',
    params: [
      { name: 'offset_days', type: 'number', desc: 'days to add (may be negative)' },
      { name: 'timezone', type: 'string', desc: 'IANA zone, defaults to device zone' },
    ],
    run: async (a, ctx) => {
      const d = new Date(ctx.now() + num(a, 'offset_days') * 86_400_000);
      const tz = str(a, 'timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
      let s: string;
      try {
        s = d.toLocaleString(undefined, { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
      } catch {
        return fail(`Unknown timezone "${tz}"`);
      }
      return ok(s, { iso: d.toISOString(), tz });
    },
  },
  {
    name: 'random',
    group: 'compute',
    desc: 'Random integer in a range, or pick from a comma-separated list.',
    effect: 'A',
    params: [
      { name: 'min', type: 'number', desc: 'lower bound (default 1)' },
      { name: 'max', type: 'number', desc: 'upper bound (default 100)' },
      { name: 'choices', type: 'string', desc: 'comma-separated options; overrides range' },
    ],
    run: async (a) => {
      const choices = str(a, 'choices').split(',').map((s) => s.trim()).filter(Boolean);
      if (choices.length) {
        const pick = choices[Math.floor(Math.random() * choices.length)];
        return ok(`Picked "${pick}" from ${choices.length} options`, pick);
      }
      const lo = a.min === undefined ? 1 : num(a, 'min');
      const hi = a.max === undefined ? 100 : num(a, 'max', 100);
      const v = Math.floor(Math.random() * (hi - lo + 1)) + lo;
      return ok(`${v} (range ${lo}-${hi})`, v);
    },
  },

  /* ---- text ---- */
  {
    name: 'text_transform',
    group: 'text',
    desc: 'Transform text: upper, lower, title, slug, reverse, trim, dedupe-lines, sort-lines.',
    effect: 'A',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'input text' },
      { name: 'op', type: 'string', required: true, desc: 'upper|lower|title|slug|reverse|trim|dedupe-lines|sort-lines' },
    ],
    run: async (a) => {
      const t = str(a, 'text');
      const op = str(a, 'op').toLowerCase();
      const ops: Record<string, () => string> = {
        upper: () => t.toUpperCase(),
        lower: () => t.toLowerCase(),
        title: () => t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        slug: () => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        reverse: () => [...t].reverse().join(''),
        trim: () => t.split('\n').map((l) => l.trim()).join('\n').trim(),
        'dedupe-lines': () => [...new Set(t.split('\n'))].join('\n'),
        'sort-lines': () => t.split('\n').sort().join('\n'),
      };
      const fn = ops[op];
      if (!fn) return fail(`Unknown op "${op}". Try: ${Object.keys(ops).join(', ')}`);
      const out = fn();
      return ok(`${op}: ${out.length} chars`, out, out.length > 200 ? out : undefined);
    },
  },
  {
    name: 'text_stats',
    group: 'text',
    desc: 'Word, character, sentence, line and token counts plus reading time.',
    effect: 'A',
    params: [{ name: 'text', type: 'string', required: true, desc: 'input text' }],
    run: async (a) => {
      const t = str(a, 'text');
      const words = t.split(/\s+/).filter(Boolean).length;
      const stats = {
        characters: t.length,
        words,
        sentences: t.split(/[.!?]+\s/).filter((s) => s.trim()).length,
        lines: t.split('\n').length,
        tokens_estimated: estTokens(t),
        reading_minutes: Math.max(1, Math.round(words / 220)),
      };
      return ok(`${words} words, ${t.length} chars, ~${stats.tokens_estimated} tokens`, stats, JSON.stringify(stats, null, 2));
    },
  },
  {
    name: 'regex_extract',
    group: 'text',
    desc: 'Extract every match of a regular expression from text.',
    effect: 'A',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'input text' },
      { name: 'pattern', type: 'string', required: true, desc: 'JS regex source, no slashes' },
      { name: 'flags', type: 'string', desc: 'regex flags, default "g"' },
    ],
    run: async (a) => {
      const pattern = str(a, 'pattern');
      if (pattern.length > 200) return fail('Pattern too long');
      let re: RegExp;
      try {
        const flags = str(a, 'flags', 'g');
        re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
      } catch (e) {
        return fail(`Invalid regex: ${e instanceof Error ? e.message : 'parse error'}`);
      }
      const matches = [...str(a, 'text').matchAll(re)].slice(0, 500).map((m) => m[0]);
      return ok(`${matches.length} match(es)`, matches, matches.join('\n'));
    },
  },
  {
    name: 'json_tool',
    group: 'text',
    desc: 'Validate, pretty-print, minify or query JSON with a dot path.',
    effect: 'A',
    params: [
      { name: 'json', type: 'string', required: true, desc: 'JSON source' },
      { name: 'op', type: 'string', desc: 'format|minify|validate|query (default format)' },
      { name: 'path', type: 'string', desc: 'dot path for query, e.g. items.0.name' },
    ],
    run: async (a) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(str(a, 'json'));
      } catch (e) {
        return fail(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
      }
      const op = str(a, 'op', 'format');
      if (op === 'validate') return ok('Valid JSON', true);
      if (op === 'minify') {
        const s = JSON.stringify(parsed);
        return ok(`Minified to ${s.length} chars`, s, s);
      }
      if (op === 'query') {
        let cur: unknown = parsed;
        for (const seg of str(a, 'path').split('.').filter(Boolean)) {
          if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
          else return fail(`Path stops at "${seg}"`);
        }
        const s = JSON.stringify(cur, null, 2);
        return ok(`${str(a, 'path')} = ${s.length > 80 ? `${s.slice(0, 80)}...` : s}`, cur, s);
      }
      const s = JSON.stringify(parsed, null, 2);
      return ok(`Formatted, ${s.split('\n').length} lines`, s, s);
    },
  },
  {
    name: 'diff_text',
    group: 'text',
    desc: 'Line-by-line difference between two texts.',
    effect: 'A',
    params: [
      { name: 'a', type: 'string', required: true, desc: 'left text' },
      { name: 'b', type: 'string', required: true, desc: 'right text' },
    ],
    run: async (a) => {
      const L = str(a, 'a').split('\n');
      const R = str(a, 'b').split('\n');
      const out: string[] = [];
      let added = 0;
      let removed = 0;
      for (let i = 0; i < Math.max(L.length, R.length); i++) {
        if (L[i] === R[i]) continue;
        if (L[i] !== undefined) {
          out.push(`- ${L[i]}`);
          removed++;
        }
        if (R[i] !== undefined) {
          out.push(`+ ${R[i]}`);
          added++;
        }
      }
      return ok(out.length ? `${added} added, ${removed} removed` : 'Identical', { added, removed }, out.join('\n') || undefined);
    },
  },

  /* ---- data ---- */
  {
    name: 'csv_summary',
    group: 'data',
    desc: 'Parse CSV and report columns, row count and numeric column statistics.',
    effect: 'A',
    params: [{ name: 'csv', type: 'string', required: true, desc: 'CSV text with a header row' }],
    run: async (a) => {
      const lines = str(a, 'csv').trim().split('\n').filter((l) => l.trim());
      if (lines.length < 2) return fail('Need a header row and at least one data row');
      const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const head = split(lines[0]);
      const rows = lines.slice(1).map(split);
      const stats = head.map((h, i) => {
        const vals = rows.map((r) => Number(r[i])).filter((n) => Number.isFinite(n));
        if (vals.length !== rows.length || !vals.length) return { column: h, type: 'text' as const, distinct: new Set(rows.map((r) => r[i])).size };
        const sum = vals.reduce((x, y) => x + y, 0);
        return { column: h, type: 'number' as const, min: Math.min(...vals), max: Math.max(...vals), mean: Number((sum / vals.length).toFixed(3)), sum };
      });
      return ok(`${rows.length} rows x ${head.length} columns`, { columns: head, rows: rows.length, stats }, JSON.stringify(stats, null, 2));
    },
  },
  {
    name: 'encode',
    group: 'data',
    desc: 'Encode or decode base64, URL components, or HTML entities.',
    effect: 'A',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'input' },
      { name: 'op', type: 'string', required: true, desc: 'base64-encode|base64-decode|url-encode|url-decode|html-escape' },
    ],
    run: async (a) => {
      const t = str(a, 'text');
      const b64e = (s: string) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
      const b64d = (s: string) => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));
      try {
        const ops: Record<string, () => string> = {
          'base64-encode': () => b64e(t),
          'base64-decode': () => b64d(t),
          'url-encode': () => encodeURIComponent(t),
          'url-decode': () => decodeURIComponent(t),
          'html-escape': () => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        };
        const fn = ops[str(a, 'op')];
        if (!fn) return fail(`Unknown op. Try: ${Object.keys(ops).join(', ')}`);
        const out = fn();
        return ok(`${out.length} chars`, out, out.length > 120 ? out : undefined);
      } catch (e) {
        return fail(`Failed: ${e instanceof Error ? e.message : 'bad input'}`);
      }
    },
  },
  {
    name: 'hash_text',
    group: 'data',
    desc: 'SHA-256 (via Web Crypto) or a fast 32-bit fingerprint.',
    effect: 'A',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'input' },
      { name: 'algorithm', type: 'string', desc: 'sha256 (default) or fnv32' },
    ],
    run: async (a) => {
      const t = str(a, 'text');
      if (str(a, 'algorithm', 'sha256') === 'fnv32') return ok(`fnv32: ${hash32(t)}`, hash32(t));
      const c = (globalThis as { crypto?: Crypto }).crypto;
      if (!c?.subtle) return ok(`Web Crypto unavailable; fnv32: ${hash32(t)}`, hash32(t));
      const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(t));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return ok(`sha256: ${hex.slice(0, 16)}...`, hex, hex);
    },
  },

  /* ---- virtual filesystem (sandbox scope only) ---- */
  {
    name: 'fs_list',
    group: 'files',
    desc: 'List files in the agent sandbox workspace.',
    effect: 'A',
    params: [],
    run: async (_a, ctx) => {
      const names = Object.keys(ctx.fs).sort();
      return ok(names.length ? `${names.length} file(s)` : 'Sandbox is empty', names, names.join('\n') || undefined);
    },
  },
  {
    name: 'fs_read',
    group: 'files',
    desc: 'Read a file from the agent sandbox workspace.',
    effect: 'A',
    params: [{ name: 'path', type: 'string', required: true, desc: 'sandbox path' }],
    run: async (a, ctx) => {
      const p = str(a, 'path');
      const c = ctx.fs[p];
      if (c === undefined) return fail(`No such file "${p}". Known: ${Object.keys(ctx.fs).join(', ') || '(empty)'}`);
      return ok(`${p} (${c.length} chars)`, c, c);
    },
  },
  {
    name: 'fs_write',
    group: 'files',
    desc: 'Create or overwrite a file in the agent sandbox workspace.',
    effect: 'B',
    approval: true,
    params: [
      { name: 'path', type: 'string', required: true, desc: 'sandbox path' },
      { name: 'content', type: 'string', required: true, desc: 'file contents' },
    ],
    run: async (a, ctx) => {
      const p = str(a, 'path');
      if (!p || p.includes('..')) return fail('Path traversal refused');
      const content = str(a, 'content');
      if (content.length > 200_000) return fail('File too large for the sandbox (200k char cap)');
      const existed = ctx.fs[p] !== undefined;
      ctx.writeFs(p, content);
      return ok(`${existed ? 'Overwrote' : 'Created'} ${p} (${content.length} chars)`, p);
    },
  },
  {
    name: 'fs_delete',
    group: 'files',
    desc: 'Delete a file from the agent sandbox workspace.',
    effect: 'B',
    approval: true,
    params: [{ name: 'path', type: 'string', required: true, desc: 'sandbox path' }],
    run: async (a, ctx) => {
      const p = str(a, 'path');
      if (ctx.fs[p] === undefined) return fail(`No such file "${p}"`);
      ctx.deleteFs(p);
      return ok(`Deleted ${p}`, p);
    },
  },
  {
    name: 'code_run',
    group: 'code',
    desc: 'Run JavaScript inside an isolated Worker with no network access and a 4s timeout.',
    effect: 'B',
    approval: true,
    params: [{ name: 'code', type: 'string', required: true, desc: 'JS body; return a value or console.log' }],
    run: async (a) => {
      const code = str(a, 'code');
      if (code.length > 20_000) return fail('Code too long (20k char cap)');
      const r = await runSandboxed(code);
      if (r.blocked) return fail(r.blocked);
      const body = [r.logs.join('\n'), r.value != null ? `=> ${r.value}` : '', r.error ? `Error: ${r.error}` : ''].filter(Boolean).join('\n');
      return r.ok
        ? ok(r.value != null ? `Returned ${r.value}` : `${r.logs.length} log line(s)`, r.value, body || '(no output)')
        : fail(`Threw: ${r.error}`, body);
    },
  },
  {
    name: 'code_review',
    group: 'code',
    desc: 'Static checks on a code snippet: risky calls, TODOs, long lines, complexity hints.',
    effect: 'A',
    params: [{ name: 'code', type: 'string', required: true, desc: 'source to review' }],
    run: async (a) => {
      const code = str(a, 'code');
      const lines = code.split('\n');
      const findings: string[] = [];
      const rules: [RegExp, string][] = [
        [/\beval\s*\(/, 'eval() executes arbitrary code'],
        [/innerHTML\s*=/, 'innerHTML assignment is an XSS vector'],
        [/document\.write/, 'document.write blocks parsing and is XSS-prone'],
        [/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{6,}/i, 'hardcoded credential'],
        [/console\.log/, 'debug logging left in place'],
        [/TODO|FIXME|XXX/, 'unresolved TODO marker'],
        [/catch\s*\([^)]*\)\s*\{\s*\}/, 'empty catch swallows errors'],
        [/==(?!=)/, 'loose equality; prefer ==='],
      ];
      lines.forEach((l, i) => {
        for (const [re, msg] of rules) if (re.test(l)) findings.push(`L${i + 1}: ${msg}`);
        if (l.length > 140) findings.push(`L${i + 1}: line is ${l.length} chars`);
      });
      const depth = Math.max(0, ...lines.map((l) => (l.match(/^\s*/)?.[0].length ?? 0) / 2));
      return ok(
        findings.length ? `${findings.length} finding(s), max nesting ~${depth}` : `No findings across ${lines.length} lines`,
        findings,
        findings.join('\n') || undefined,
      );
    },
  },

  /* ---- network ---- */
  {
    name: 'web_search',
    group: 'network',
    desc: 'Web search. Ranked results via Tavily when a key is set, otherwise keyless instant answers.',
    effect: 'C',
    network: true,
    params: [{ name: 'query', type: 'string', required: true, desc: 'search terms' }],
    run: async (a, ctx) => {
      const q = str(a, 'query');
      if (!q) return fail('Empty query');

      // Tier 1: a real ranked index, only if the user supplied a key.
      const tavily = ctx.serviceKey('tavily');
      if (tavily) {
        try {
          const r = (await ctx.fetchJson('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavily}` },
            body: JSON.stringify({ query: q, max_results: 5, search_depth: 'basic' }),
          })) as { answer?: string; results?: { title?: string; url?: string; content?: string }[] };
          const hits = r.results ?? [];
          if (hits.length) {
            const rows = hits.map((h) => `- ${h.title ?? 'Untitled'}\n  ${h.url ?? ''}\n  ${(h.content ?? '').slice(0, 200)}`);
            return ok(
              r.answer ? r.answer.slice(0, 400) : `${hits.length} web result(s) for "${q}"`,
              { via: 'tavily', results: hits },
              `${r.answer ? `${r.answer}\n\n` : ''}${rows.join('\n')}`,
            );
          }
        } catch (e) {
          // Fall through to the keyless path rather than failing the turn, but
          // say so, because a silently ignored key is a debugging nightmare.
          ctx.log(`Tavily failed (${e instanceof Error ? e.message : String(e)}); using the keyless path.`);
        }
      }

      try {
        const dd = (await ctx.fetchJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`)) as {
          AbstractText?: string; AbstractURL?: string; Heading?: string;
          RelatedTopics?: { Text?: string; FirstURL?: string }[];
        };
        if (dd.AbstractText) {
          return ok(dd.AbstractText.slice(0, 400), { source: dd.AbstractURL, heading: dd.Heading }, `${dd.AbstractText}\n\nSource: ${dd.AbstractURL ?? 'duckduckgo'}`);
        }
        const topics = (dd.RelatedTopics ?? []).filter((t) => t.Text).slice(0, 5);
        if (topics.length) {
          const body = topics.map((t) => `- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ''}`).join('\n');
          return ok(`${topics.length} related result(s)`, topics, body);
        }
      } catch {
        /* fall through to wikipedia */
      }
      try {
        const wiki = (await ctx.fetchJson(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=4`,
        )) as { query?: { search?: { title: string; snippet: string }[] } };
        const hits = wiki.query?.search ?? [];
        if (!hits.length) return fail(`No instant answer for "${q}". These keyless endpoints only cover encyclopedic queries.`);
        const body = hits.map((h) => `- ${h.title}: ${h.snippet.replace(/<[^>]+>/g, '')}`).join('\n');
        return ok(`${hits.length} encyclopedia result(s)`, hits, body);
      } catch (e) {
        return fail(`Search unavailable: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
  },
  {
    name: 'fetch_url',
    group: 'network',
    desc: 'Fetch a URL and return readable text. Subject to the target site CORS policy.',
    effect: 'C',
    network: true,
    params: [
      { name: 'url', type: 'string', required: true, desc: 'https URL' },
      { name: 'max_chars', type: 'number', desc: 'truncation limit, default 3000' },
    ],
    run: async (a, ctx) => {
      const url = str(a, 'url');
      if (!/^https?:\/\//.test(url)) return fail('URL must start with http:// or https://');
      try {
        const res = await fetch(url, { headers: { Accept: 'text/html,text/plain,application/json' } });
        if (!res.ok) return fail(`HTTP ${res.status} from ${new URL(url).host}`);
        const raw = await res.text();
        const text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const cap = num(a, 'max_chars', 3000) || 3000;
        ctx.log(`fetched ${url} (${raw.length} bytes)`);
        return ok(`${new URL(url).host}: ${text.length} chars of text`, text.slice(0, cap), text.slice(0, cap));
      } catch (e) {
        return fail(
          `Could not fetch ${url}. Browsers block cross-origin reads unless the site sends CORS headers; this is a real limitation, not a transient error. (${e instanceof Error ? e.message : 'network error'})`,
        );
      }
    },
  },
  {
    name: 'weather',
    group: 'network',
    desc: 'Current conditions and a 3-day outlook for a place (keyless, Open-Meteo).',
    effect: 'C',
    network: true,
    params: [{ name: 'location', type: 'string', required: true, desc: 'city or place name' }],
    run: async (a, ctx) => {
      const place = str(a, 'location');
      try {
        const geo = (await ctx.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`)) as {
          results?: { latitude: number; longitude: number; name: string; country?: string; timezone?: string }[];
        };
        const g = geo.results?.[0];
        if (!g) return fail(`No place found matching "${place}"`);
        const wx = (await ctx.fetchJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto`,
        )) as {
          current?: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number };
          daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
        };
        const CODES: Record<number, string> = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 51: 'light drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 80: 'showers', 95: 'thunderstorms' };
        const c = wx.current;
        if (!c) return fail('Weather service returned no current conditions');
        const label = CODES[c.weather_code] ?? `code ${c.weather_code}`;
        const days = (wx.daily?.time ?? []).map((d, i) => `${d}: ${wx.daily!.temperature_2m_min[i]}-${wx.daily!.temperature_2m_max[i]}C, ${wx.daily!.precipitation_probability_max[i]}% precip`);
        // An OpenWeather key is optional: it only adds a described condition
        // and a feels-like figure on top of the keyless Open-Meteo forecast.
        let extra = '';
        const owm = ctx.serviceKey('openweather');
        if (owm) {
          try {
            const o = (await ctx.fetchJson(
              `https://api.openweathermap.org/data/2.5/weather?lat=${g.latitude}&lon=${g.longitude}&units=metric&appid=${encodeURIComponent(owm)}`,
            )) as { weather?: { description?: string }[]; main?: { feels_like?: number } };
            const desc = o.weather?.[0]?.description;
            const feels = o.main?.feels_like;
            if (desc || feels !== undefined) {
              extra = `\n\nOpenWeather: ${desc ?? 'no description'}${feels !== undefined ? `, feels like ${Math.round(feels)}C` : ''}`;
            }
          } catch (e) {
            ctx.log(`OpenWeather failed (${e instanceof Error ? e.message : String(e)}); the keyless forecast above still stands.`);
          }
        }
        return ok(
          `${g.name}${g.country ? `, ${g.country}` : ''}: ${c.temperature_2m}C, ${label}, ${c.relative_humidity_2m}% humidity, wind ${c.wind_speed_10m} km/h`,
          { current: c, daily: wx.daily },
          `${days.join('\n')}${extra}`,
        );
      } catch (e) {
        return fail(`Weather unavailable: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
  },
  {
    name: 'http_request',
    group: 'network',
    desc: 'Arbitrary HTTP request with method, headers and body. Always requires approval.',
    effect: 'C',
    network: true,
    approval: true,
    params: [
      { name: 'url', type: 'string', required: true, desc: 'https URL' },
      { name: 'method', type: 'string', desc: 'GET (default), POST, PUT, PATCH, DELETE' },
      { name: 'body', type: 'string', desc: 'request body' },
      { name: 'headers', type: 'string', desc: 'JSON object of headers' },
    ],
    run: async (a) => {
      const url = str(a, 'url');
      if (!/^https?:\/\//.test(url)) return fail('URL must start with http:// or https://');
      let headers: Record<string, string> = {};
      const h = str(a, 'headers');
      if (h) {
        try {
          headers = JSON.parse(h) as Record<string, string>;
        } catch {
          return fail('headers must be a JSON object');
        }
      }
      const method = str(a, 'method', 'GET').toUpperCase();
      try {
        const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : str(a, 'body') || undefined });
        const text = (await res.text()).slice(0, 4000);
        return ok(`${method} ${url} -> HTTP ${res.status}`, { status: res.status, body: text }, text);
      } catch (e) {
        return fail(`Request failed (likely CORS): ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
  },

  /* ---- memory & agent ---- */
  {
    name: 'memory_write',
    group: 'memory',
    desc: 'Save a durable fact, preference or decision to long-term memory.',
    effect: 'B',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'what to remember' },
      { name: 'kind', type: 'string', desc: 'fact|preference|decision|task|note' },
      { name: 'tags', type: 'string', desc: 'comma-separated tags' },
    ],
    run: async (a, ctx) => {
      const text = str(a, 'text').trim();
      if (!text) return fail('Nothing to remember');
      const kindRaw = str(a, 'kind', 'fact');
      const kind = (['fact', 'preference', 'decision', 'task', 'note'].includes(kindRaw) ? kindRaw : 'fact') as 'fact';
      const item = ctx.memory.add({ kind, text, tags: str(a, 'tags').split(',').map((s) => s.trim()).filter(Boolean), source: 'agent' });
      return ok(`Remembered (${kind}): ${text.slice(0, 80)}`, item.id);
    },
  },
  {
    name: 'memory_search',
    group: 'memory',
    desc: 'Search long-term memory for relevant saved items.',
    effect: 'A',
    params: [
      { name: 'query', type: 'string', required: true, desc: 'search terms' },
      { name: 'limit', type: 'number', desc: 'max results, default 5' },
    ],
    run: async (a, ctx) => {
      const hits = ctx.memory.search(str(a, 'query'), num(a, 'limit', 5) || 5);
      if (!hits.length) return ok('No matching memories', []);
      return ok(`${hits.length} memory item(s)`, hits, hits.map((h) => `[${h.kind}] ${h.text}`).join('\n'));
    },
  },
  {
    name: 'plan_outline',
    group: 'agent',
    desc: 'Break a goal into an ordered, checkable plan the agent can execute.',
    effect: 'A',
    params: [
      { name: 'goal', type: 'string', required: true, desc: 'the objective' },
      { name: 'steps', type: 'number', desc: 'how many steps, default 5' },
    ],
    run: async (a) => {
      const goal = str(a, 'goal');
      const n = Math.min(10, Math.max(2, num(a, 'steps', 5) || 5));
      const frames = [
        'Clarify the acceptance criteria for',
        'Gather the inputs and constraints for',
        'Draft the smallest complete version of',
        'Verify the result of',
        'Record evidence and remaining risks for',
        'Identify the next increment beyond',
        'Review edge cases in',
        'Document the decision behind',
        'Estimate the cost and limits of',
        'Define the rollback path for',
      ];
      const plan = Array.from({ length: n }, (_, i) => `${i + 1}. ${frames[i % frames.length]} ${goal}`);
      return ok(`${n}-step plan drafted`, plan, plan.join('\n'));
    },
  },
  {
    name: 'run_skill',
    group: 'agent',
    desc: 'Run a saved multi-step skill by name. Resolved by the skill engine, not here.',
    effect: 'B',
    params: [
      { name: 'name', type: 'string', required: true, desc: 'skill name or id' },
      { name: 'input', type: 'string', desc: 'input passed to the skill' },
    ],
    run: async () => fail('run_skill is resolved by the skill engine; it cannot be invoked directly from the tool registry.'),
  },
  /* ---------------------------------------------------------------- */
  /* Keyless public data APIs                                          */
  /*                                                                    */
  /* Every endpoint below was probed from a real browser origin on      */
  /* 2026-09-04 and returns Access-Control-Allow-Origin, so it works    */
  /* from a web page with no proxy and no key. Candidates that failed   */
  /* that probe were dropped, not shipped hopefully: dictionaryapi.dev  */
  /* and worldtimeapi.org were unreachable, and arxiv.org returns no    */
  /* CORS header at all. See docs/providers.md.                         */
  /* ---------------------------------------------------------------- */
  {
    name: 'currency_convert',
    group: 'network',
    desc: 'Convert between currencies at the latest published rate (keyless, Frankfurter/ECB).',
    effect: 'C',
    network: true,
    params: [
      { name: 'amount', type: 'number', required: true, desc: 'how much to convert' },
      { name: 'from', type: 'string', required: true, desc: 'source currency code, e.g. USD' },
      { name: 'to', type: 'string', required: true, desc: 'target currency code, e.g. EUR' },
    ],
    run: async (a, ctx) => {
      const amount = num(a, 'amount', 1);
      // Validate before normalising. Slicing first would turn "dollars" into a
      // plausible-looking "DOL" and send a garbage request.
      const from = str(a, 'from', 'USD').trim().toUpperCase();
      const to = str(a, 'to', 'EUR').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return fail('Currency codes must be three letters, like USD or JPY.');
      if (from === to) return ok(`${amount} ${from} = ${amount} ${to}`, { rate: 1 });
      try {
        const r = (await ctx.fetchJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`)) as {
          date?: string;
          rates?: Record<string, number>;
        };
        const rate = r.rates?.[to];
        if (typeof rate !== 'number') return fail(`No published rate for ${from} to ${to}.`);
        const value = amount * rate;
        return ok(
          `${amount} ${from} = ${value.toFixed(2)} ${to}`,
          { rate, date: r.date, value },
          `Rate ${rate} as published on ${r.date ?? 'the latest working day'}. European Central Bank reference rates; not a dealing rate.`,
        );
      } catch (e) {
        return fail(`Currency lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'crypto_price',
    group: 'network',
    desc: 'Spot price and 24h change for a cryptocurrency (keyless, CoinGecko).',
    effect: 'C',
    network: true,
    params: [
      { name: 'coin', type: 'string', required: true, desc: 'coin id or symbol, e.g. bitcoin' },
      { name: 'currency', type: 'string', desc: 'quote currency, default usd' },
    ],
    run: async (a, ctx) => {
      const raw = str(a, 'coin', 'bitcoin').toLowerCase().trim();
      const vs = str(a, 'currency', 'usd').toLowerCase().slice(0, 5);
      // Symbols people actually type, mapped to CoinGecko ids.
      const ALIAS: Record<string, string> = {
        btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano',
        doge: 'dogecoin', dot: 'polkadot', matic: 'matic-network', ltc: 'litecoin', link: 'chainlink',
      };
      const id = ALIAS[raw] ?? raw.replace(/\s+/g, '-');
      try {
        const r = (await ctx.fetchJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`,
        )) as Record<string, Record<string, number>>;
        const row = r[id];
        const price = row?.[vs];
        if (typeof price !== 'number') return fail(`No price found for "${raw}". Try the full coin id, like "bitcoin".`);
        const chg = row[`${vs}_24h_change`];
        const dir = typeof chg === 'number' ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% in 24h` : 'no change data';
        return ok(`${id}: ${price.toLocaleString()} ${vs.toUpperCase()} (${dir})`, { id, price, change24h: chg });
      } catch (e) {
        return fail(`Crypto lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'earthquakes',
    group: 'network',
    desc: 'Recent significant earthquakes worldwide (keyless, USGS).',
    effect: 'C',
    network: true,
    params: [
      { name: 'min_magnitude', type: 'number', desc: 'minimum magnitude, default 4.5' },
      { name: 'limit', type: 'number', desc: 'how many to list, default 5' },
    ],
    run: async (a, ctx) => {
      const mag = Math.min(10, Math.max(0, num(a, 'min_magnitude', 4.5)));
      const limit = Math.min(20, Math.max(1, num(a, 'limit', 5)));
      try {
        const r = (await ctx.fetchJson(
          `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=${limit}&minmagnitude=${mag}&orderby=time`,
        )) as { features?: { properties?: { mag?: number; place?: string; time?: number } }[] };
        const list = r.features ?? [];
        if (!list.length) return ok(`No quakes at or above magnitude ${mag} in the current feed.`, []);
        const rows = list.map((f) => {
          const p = f.properties ?? {};
          const when = p.time ? new Date(p.time).toISOString().replace('T', ' ').slice(0, 16) : 'unknown time';
          return `M${p.mag ?? '?'} - ${p.place ?? 'unknown place'} (${when} UTC)`;
        });
        return ok(`${rows.length} quake(s) at or above M${mag}`, list, rows.join('\n'));
      } catch (e) {
        return fail(`Earthquake feed failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'hn_search',
    group: 'network',
    desc: 'Search Hacker News stories and comments (keyless, Algolia).',
    effect: 'C',
    network: true,
    params: [
      { name: 'query', type: 'string', required: true, desc: 'search terms' },
      { name: 'limit', type: 'number', desc: 'how many hits, default 5' },
    ],
    run: async (a, ctx) => {
      const q = str(a, 'query');
      if (!q) return fail('Empty query');
      const limit = Math.min(20, Math.max(1, num(a, 'limit', 5)));
      try {
        const r = (await ctx.fetchJson(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=${limit}&tags=story`,
        )) as { hits?: { title?: string; url?: string; points?: number; num_comments?: number; objectID?: string }[] };
        const hits = (r.hits ?? []).filter((h) => h.title);
        if (!hits.length) return fail(`No Hacker News stories match "${q}".`);
        const rows = hits.map(
          (h) => `- ${h.title} (${h.points ?? 0} points, ${h.num_comments ?? 0} comments)\n  ${h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`}`,
        );
        return ok(`${hits.length} Hacker News result(s) for "${q}"`, hits, rows.join('\n'));
      } catch (e) {
        return fail(`Hacker News search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'geocode',
    group: 'network',
    desc: 'Turn a place name into coordinates, country and timezone (keyless, Open-Meteo).',
    effect: 'C',
    network: true,
    params: [{ name: 'place', type: 'string', required: true, desc: 'city or place name' }],
    run: async (a, ctx) => {
      const place = str(a, 'place');
      if (!place) return fail('Empty place');
      try {
        const r = (await ctx.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=3`)) as {
          results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number; timezone?: string; population?: number }[];
        };
        const hits = r.results ?? [];
        if (!hits.length) return fail(`No place found matching "${place}".`);
        const top = hits[0];
        const rows = hits.map(
          (g) => `- ${g.name}${g.admin1 ? `, ${g.admin1}` : ''}${g.country ? `, ${g.country}` : ''}: ${g.latitude.toFixed(4)}, ${g.longitude.toFixed(4)}${g.timezone ? ` (${g.timezone})` : ''}`,
        );
        return ok(`${top.name}: ${top.latitude.toFixed(4)}, ${top.longitude.toFixed(4)}`, hits, rows.join('\n'));
      } catch (e) {
        return fail(`Geocoding failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'word_lookup',
    group: 'text',
    desc: 'Synonyms, rhymes and related words (keyless, Datamuse).',
    effect: 'C',
    network: true,
    params: [
      { name: 'word', type: 'string', required: true, desc: 'the word to look up' },
      { name: 'kind', type: 'string', desc: 'synonyms | rhymes | related | sounds_like' },
    ],
    run: async (a, ctx) => {
      const word = str(a, 'word').trim();
      if (!word) return fail('Empty word');
      const kind = str(a, 'kind', 'synonyms').toLowerCase();
      const PARAM: Record<string, string> = { synonyms: 'rel_syn', rhymes: 'rel_rhy', related: 'ml', sounds_like: 'sl' };
      const key = PARAM[kind] ?? 'ml';
      try {
        const r = (await ctx.fetchJson(`https://api.datamuse.com/words?${key}=${encodeURIComponent(word)}&max=12`)) as { word: string }[];
        if (!r.length) return fail(`No ${kind} found for "${word}".`);
        const words = r.map((w) => w.word);
        return ok(`${words.length} ${kind} for "${word}": ${words.slice(0, 6).join(', ')}`, words, words.join(', '));
      } catch (e) {
        return fail(`Word lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'book_search',
    group: 'network',
    desc: 'Find books by title, author or subject (keyless, Open Library).',
    effect: 'C',
    network: true,
    params: [
      { name: 'query', type: 'string', required: true, desc: 'title, author or subject' },
      { name: 'limit', type: 'number', desc: 'how many results, default 5' },
    ],
    run: async (a, ctx) => {
      const q = str(a, 'query');
      if (!q) return fail('Empty query');
      const limit = Math.min(15, Math.max(1, num(a, 'limit', 5)));
      try {
        const r = (await ctx.fetchJson(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=title,author_name,first_publish_year,number_of_pages_median`,
        )) as { docs?: { title?: string; author_name?: string[]; first_publish_year?: number; number_of_pages_median?: number }[] };
        const docs = r.docs ?? [];
        if (!docs.length) return fail(`No books match "${q}".`);
        const rows = docs.map(
          (d) => `- ${d.title}${d.author_name?.length ? ` by ${d.author_name.slice(0, 2).join(', ')}` : ''}${d.first_publish_year ? ` (${d.first_publish_year})` : ''}`,
        );
        return ok(`${docs.length} book(s) matching "${q}"`, docs, rows.join('\n'));
      } catch (e) {
        return fail(`Book search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'tv_search',
    group: 'network',
    desc: 'Look up a TV show, its status and network (keyless, TVmaze).',
    effect: 'C',
    network: true,
    params: [{ name: 'title', type: 'string', required: true, desc: 'show title' }],
    run: async (a, ctx) => {
      const q = str(a, 'title');
      if (!q) return fail('Empty title');
      try {
        const r = (await ctx.fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)) as {
          show?: { name?: string; status?: string; premiered?: string; genres?: string[]; network?: { name?: string }; rating?: { average?: number }; summary?: string };
        }[];
        const hits = r.filter((h) => h.show?.name).slice(0, 5);
        if (!hits.length) return fail(`No show found matching "${q}".`);
        const top = hits[0].show!;
        const rows = hits.map((h) => {
          const sh = h.show!;
          return `- ${sh.name}${sh.premiered ? ` (${sh.premiered.slice(0, 4)})` : ''} - ${sh.status ?? 'unknown status'}${sh.network?.name ? ` on ${sh.network.name}` : ''}${sh.rating?.average ? `, rated ${sh.rating.average}` : ''}`;
        });
        return ok(
          `${top.name}: ${top.status ?? 'unknown status'}${top.genres?.length ? ` - ${top.genres.join(', ')}` : ''}`,
          hits.map((h) => h.show),
          rows.join('\n'),
        );
      } catch (e) {
        return fail(`TV lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'space_news',
    group: 'network',
    desc: 'Latest spaceflight and astronomy headlines (keyless, Spaceflight News API).',
    effect: 'C',
    network: true,
    params: [
      { name: 'query', type: 'string', desc: 'optional search term' },
      { name: 'limit', type: 'number', desc: 'how many headlines, default 5' },
    ],
    run: async (a, ctx) => {
      const q = str(a, 'query').trim();
      const limit = Math.min(15, Math.max(1, num(a, 'limit', 5)));
      try {
        const url = `https://api.spaceflightnewsapi.net/v4/articles/?limit=${limit}${q ? `&search=${encodeURIComponent(q)}` : ''}`;
        const r = (await ctx.fetchJson(url)) as { results?: { title?: string; news_site?: string; published_at?: string; url?: string }[] };
        const list = r.results ?? [];
        if (!list.length) return fail(q ? `No spaceflight stories match "${q}".` : 'The news feed returned nothing.');
        const rows = list.map((n) => `- ${n.title} (${n.news_site ?? 'unknown source'}, ${n.published_at?.slice(0, 10) ?? 'undated'})\n  ${n.url ?? ''}`);
        return ok(`${list.length} spaceflight headline(s)`, list, rows.join('\n'));
      } catch (e) {
        return fail(`Space news failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'github_repo',
    group: 'network',
    desc: 'Repository facts, or a repo search. Anonymous by default; a token raises the rate limit.',
    effect: 'C',
    network: true,
    params: [
      { name: 'repo', type: 'string', desc: 'owner/name for a single repository' },
      { name: 'query', type: 'string', desc: 'search terms, when no repo is given' },
    ],
    run: async (a, ctx) => {
      const repo = str(a, 'repo').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      const q = str(a, 'query').trim();
      if (!repo && !q) return fail('Give either a repo like "vitejs/vite" or a search query.');
      // The token is optional on purpose: anonymous callers get 60 requests an
      // hour, a token gets 5,000 and can see the user's private repositories.
      const token = ctx.serviceKey('github');
      const init: RequestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const note = token ? '' : '\n\n(Anonymous GitHub access is capped at 60 requests an hour. Add a token in Settings to raise it.)';
      try {
        if (repo) {
          if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail(`"${repo}" is not an owner/name pair.`);
          const r = (await ctx.fetchJson(`https://api.github.com/repos/${repo}`, init)) as {
            full_name?: string; description?: string; stargazers_count?: number; forks_count?: number;
            open_issues_count?: number; language?: string; license?: { spdx_id?: string }; pushed_at?: string; archived?: boolean;
          };
          const bits = [
            `${r.stargazers_count?.toLocaleString() ?? 0} stars`,
            `${r.forks_count?.toLocaleString() ?? 0} forks`,
            `${r.open_issues_count ?? 0} open issues`,
            r.language ?? 'no primary language',
            r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : 'no declared license',
            r.archived ? 'ARCHIVED' : `last push ${r.pushed_at?.slice(0, 10) ?? 'unknown'}`,
          ];
          return ok(`${r.full_name}: ${bits.join(' \u00b7 ')}`, r, `${r.description ?? 'No description.'}\n\n${bits.join('\n')}${note}`);
        }
        const r = (await ctx.fetchJson(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5&sort=stars`,
          init,
        )) as { items?: { full_name?: string; description?: string; stargazers_count?: number; html_url?: string }[] };
        const items = r.items ?? [];
        if (!items.length) return fail(`No repositories match "${q}".`);
        const rows = items.map((i) => `- ${i.full_name} (${i.stargazers_count?.toLocaleString() ?? 0} stars)\n  ${i.description ?? 'No description.'}`);
        return ok(`${items.length} repository result(s)`, items, `${rows.join('\n')}${note}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('403')) return fail('GitHub rate limit reached. Add a personal access token in Settings to raise it from 60 to 5,000 requests an hour.');
        if (msg.includes('404')) return fail(repo ? `No such repository: ${repo}` : 'GitHub returned 404.');
        return fail(`GitHub lookup failed: ${msg}`);
      }
    },
  },
  {
    name: 'nasa_apod',
    group: 'network',
    desc: 'NASA astronomy picture of the day. Uses the shared demo key unless you add your own.',
    effect: 'C',
    network: true,
    params: [{ name: 'date', type: 'string', desc: 'YYYY-MM-DD, defaults to today' }],
    run: async (a, ctx) => {
      const date = str(a, 'date').trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Date must look like 2026-09-04.');
      const key = ctx.serviceKey('nasa') || 'DEMO_KEY';
      try {
        const r = (await ctx.fetchJson(
          `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}${date ? `&date=${date}` : ''}`,
        )) as { title?: string; date?: string; explanation?: string; url?: string; media_type?: string; copyright?: string };
        if (!r.title) return fail('NASA returned no picture for that date.');
        const note = key === 'DEMO_KEY' ? '\n\n(Using the shared DEMO_KEY, which every anonymous caller shares. Add a free NASA key in Settings for your own quota.)' : '';
        return ok(
          `${r.title} (${r.date ?? 'today'})`,
          r,
          `${r.explanation?.slice(0, 600) ?? ''}\n\n${r.media_type === 'video' ? 'Video' : 'Image'}: ${r.url ?? 'not provided'}${r.copyright ? `\nCredit: ${r.copyright}` : ''}${note}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('429')) return fail('The shared NASA demo key is rate limited right now. Add your own free key in Settings.');
        return fail(`NASA lookup failed: ${msg}`);
      }
    },
  },
  /* ---------------- public data APIs, all keyless and browser-callable ------- */
  {
    name: 'stack_search',
    group: 'network',
    desc: 'Search Stack Overflow for programming questions and accepted answers (keyless).',
    effect: 'C',
    network: true,
    params: [
      { name: 'query', type: 'string', required: true, desc: 'what to search for' },
      { name: 'limit', type: 'number', desc: 'how many questions, default 3' },
    ],
    run: async (a, ctx) => {
      const q = str(a, 'query', '').trim();
      if (!q) return fail('Give me something to search for.');
      const n = Math.min(Math.max(num(a, 'limit', 3), 1), 8);
      try {
        const r = (await ctx.fetchJson(
          `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=${n}&filter=default`,
        )) as { items?: { title: string; link: string; score: number; is_answered: boolean; answer_count: number }[] };
        const items = r.items ?? [];
        if (!items.length) return fail(`Stack Overflow has nothing for "${q}".`);
        const lines = items.map(
          (i) => `- ${i.title}\n  score ${i.score}, ${i.answer_count} answer${i.answer_count === 1 ? '' : 's'}${i.is_answered ? ', accepted' : ''}\n  ${i.link}`,
        );
        return ok(`${items.length} Stack Overflow result${items.length === 1 ? '' : 's'} for "${q}"`, items, lines.join('\n'));
      } catch (e) {
        return fail(`Stack Overflow search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'npm_package',
    group: 'network',
    desc: 'Look up an npm package: latest version, licence, description, links (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'name', type: 'string', required: true, desc: 'package name, e.g. react' }],
    run: async (a, ctx) => {
      const name = str(a, 'name', '').trim();
      if (!name) return fail('Which package?');
      try {
        // The full packument for a popular package is megabytes -- react alone is
        // ~7 MB. /latest returns just the current manifest, about 2 kB.
        const r = (await ctx.fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)) as {
          name?: string; version?: string; description?: string; license?: string; homepage?: string;
        };
        if (!r.version) return fail(`No npm package called "${name}".`);
        return ok(
          `${r.name}@${r.version} — ${r.description ?? 'no description'}`,
          { name: r.name, latest: r.version, license: r.license },
          `Latest: ${r.version}\nLicence: ${r.license ?? 'unstated'}\nHome: ${r.homepage ?? `https://www.npmjs.com/package/${r.name}`}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('404')) return fail(`No npm package called "${name}".`);
        return fail(`npm lookup failed: ${msg}`);
      }
    },
  },
  {
    name: 'pypi_package',
    group: 'network',
    desc: 'Look up a Python package on PyPI: version, summary, licence, requirements (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'name', type: 'string', required: true, desc: 'package name, e.g. requests' }],
    run: async (a, ctx) => {
      const name = str(a, 'name', '').trim();
      if (!name) return fail('Which package?');
      try {
        const r = (await ctx.fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)) as {
          info?: { name: string; version: string; summary: string; license?: string; requires_python?: string; home_page?: string; package_url?: string };
        };
        const i = r.info;
        if (!i) return fail(`No PyPI package called "${name}".`);
        return ok(
          `${i.name} ${i.version} — ${i.summary || 'no summary'}`,
          { name: i.name, version: i.version, license: i.license },
          `Version: ${i.version}\nLicence: ${i.license || 'unstated'}\nPython: ${i.requires_python || 'unstated'}\n${i.package_url || i.home_page || ''}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('404')) return fail(`No PyPI package called "${name}".`);
        return fail(`PyPI lookup failed: ${msg}`);
      }
    },
  },
  {
    name: 'world_time',
    group: 'network',
    desc: 'Current date and time in any IANA time zone (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'zone', type: 'string', required: true, desc: 'IANA zone, e.g. Europe/Berlin' }],
    run: async (a, ctx) => {
      const zone = str(a, 'zone', '').trim();
      if (!zone.includes('/')) return fail('Give an IANA zone such as Europe/Berlin or America/New_York.');
      try {
        const r = (await ctx.fetchJson(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(zone)}`)) as {
          dateTime?: string; timeZone?: string; dayOfWeek?: string;
        };
        if (!r.dateTime) return fail(`No clock for "${zone}". Check the zone name.`);
        const t = r.dateTime.replace('T', ' ').slice(0, 19);
        return ok(`${t} in ${r.timeZone ?? zone} (${r.dayOfWeek ?? ''})`.trim(), r);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('400')) return fail(`"${zone}" is not a time zone I can resolve.`);
        return fail(`Time lookup failed: ${msg}`);
      }
    },
  },
  {
    name: 'weather_alerts',
    group: 'network',
    desc: 'Active US weather alerts for a state, from the National Weather Service (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'state', type: 'string', required: true, desc: 'two-letter US state code, e.g. NJ' }],
    run: async (a, ctx) => {
      const st = str(a, 'state', '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(st)) return fail('Give a two-letter US state code, like NJ. This service only covers the United States.');
      try {
        const r = (await ctx.fetchJson(`https://api.weather.gov/alerts/active?area=${st}`)) as {
          features?: { properties?: { event?: string; headline?: string; severity?: string; areaDesc?: string } }[];
        };
        const f = r.features ?? [];
        if (!f.length) return ok(`No active weather alerts for ${st}.`, { state: st, count: 0 });
        const lines = f.slice(0, 6).map((x) => `- ${x.properties?.event ?? 'Alert'} (${x.properties?.severity ?? 'unknown'}): ${x.properties?.areaDesc ?? ''}`);
        return ok(`${f.length} active alert${f.length === 1 ? '' : 's'} for ${st}`, f.slice(0, 6), lines.join('\n'));
      } catch (e) {
        return fail(`Weather alert lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'paper_search',
    group: 'network',
    desc: 'Search academic papers by title and abstract via OpenAlex (keyless).',
    effect: 'C',
    network: true,
    params: [
      { name: 'query', type: 'string', required: true, desc: 'topic or title' },
      { name: 'limit', type: 'number', desc: 'how many papers, default 3' },
    ],
    run: async (a, ctx) => {
      const q = str(a, 'query', '').trim();
      if (!q) return fail('What should I search for?');
      const n = Math.min(Math.max(num(a, 'limit', 3), 1), 8);
      try {
        const r = (await ctx.fetchJson(
          `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}&select=title,publication_year,cited_by_count,doi,authorships`,
        )) as { results?: { title?: string; publication_year?: number; cited_by_count?: number; doi?: string; authorships?: { author?: { display_name?: string } }[] }[] };
        const items = r.results ?? [];
        if (!items.length) return fail(`No papers found for "${q}".`);
        const lines = items.map((w) => {
          const first = w.authorships?.[0]?.author?.display_name;
          const etal = (w.authorships?.length ?? 0) > 1 ? ' et al.' : '';
          return `- ${w.title ?? 'untitled'} (${w.publication_year ?? 'n.d.'})\n  ${first ? first + etal + ', ' : ''}${w.cited_by_count ?? 0} citations${w.doi ? `\n  ${w.doi}` : ''}`;
        });
        return ok(`${items.length} paper${items.length === 1 ? '' : 's'} on "${q}"`, items, lines.join('\n'));
      } catch (e) {
        return fail(`Paper search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'air_quality',
    group: 'network',
    desc: 'Current air quality (PM2.5, PM10, ozone and European AQI) for a place (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'place', type: 'string', required: true, desc: 'city or place name' }],
    run: async (a, ctx) => {
      const place = str(a, 'place', '').trim();
      if (!place) return fail('Which place?');
      try {
        const g = (await ctx.fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`,
        )) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
        const hit = g.results?.[0];
        if (!hit) return fail(`I could not find a place called "${place}".`);
        const r = (await ctx.fetchJson(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${hit.latitude}&longitude=${hit.longitude}&current=pm2_5,pm10,ozone,european_aqi`,
        )) as { current?: Record<string, number>; current_units?: Record<string, string> };
        const c = r.current;
        if (!c) return fail('The air quality service returned no readings.');
        const aqi = c.european_aqi;
        const band = aqi == null ? 'unknown' : aqi <= 20 ? 'good' : aqi <= 40 ? 'fair' : aqi <= 60 ? 'moderate' : aqi <= 80 ? 'poor' : 'very poor';
        return ok(
          `${hit.name}${hit.country ? ', ' + hit.country : ''}: European AQI ${aqi ?? 'n/a'} (${band})`,
          { place: hit.name, ...c },
          `PM2.5: ${c.pm2_5 ?? 'n/a'} µg/m³\nPM10: ${c.pm10 ?? 'n/a'} µg/m³\nOzone: ${c.ozone ?? 'n/a'} µg/m³`,
        );
      } catch (e) {
        return fail(`Air quality lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'sun_times',
    group: 'network',
    desc: 'Sunrise, sunset and day length for a place (keyless).',
    effect: 'C',
    network: true,
    params: [
      { name: 'place', type: 'string', required: true, desc: 'city or place name' },
      { name: 'date', type: 'string', desc: 'YYYY-MM-DD, default today' },
    ],
    run: async (a, ctx) => {
      const place = str(a, 'place', '').trim();
      if (!place) return fail('Which place?');
      const date = str(a, 'date', 'today').trim();
      try {
        const g = (await ctx.fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`,
        )) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
        const hit = g.results?.[0];
        if (!hit) return fail(`I could not find a place called "${place}".`);
        const r = (await ctx.fetchJson(
          `https://api.sunrise-sunset.org/json?lat=${hit.latitude}&lng=${hit.longitude}&formatted=0&date=${encodeURIComponent(date)}`,
        )) as { status?: string; results?: { sunrise: string; sunset: string; day_length: number; solar_noon: string } };
        if (r.status !== 'OK' || !r.results) return fail('The sunrise service could not answer for that date.');
        const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16) + ' UTC';
        const h = Math.floor(r.results.day_length / 3600);
        const m = Math.round((r.results.day_length % 3600) / 60);
        return ok(
          `${hit.name}: sunrise ${hhmm(r.results.sunrise)}, sunset ${hhmm(r.results.sunset)}`,
          r.results,
          `Day length: ${h}h ${m}m\nSolar noon: ${hhmm(r.results.solar_noon)}\nTimes are UTC; convert with world_time if you need local.`,
        );
      } catch (e) {
        return fail(`Sunrise lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'wikidata_lookup',
    group: 'network',
    desc: 'Resolve a name to a Wikidata entity with its short description (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'query', type: 'string', required: true, desc: 'person, place or thing' }],
    run: async (a, ctx) => {
      const q = str(a, 'query', '').trim();
      if (!q) return fail('What should I look up?');
      try {
        const r = (await ctx.fetchJson(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&limit=3&origin=*`,
        )) as { search?: { id: string; label?: string; description?: string; concepturi?: string }[] };
        const items = r.search ?? [];
        if (!items.length) return fail(`Wikidata has no entity matching "${q}".`);
        const top = items[0];
        const lines = items.map((i) => `- ${i.label ?? i.id} (${i.id}): ${i.description ?? 'no description'}`);
        return ok(`${top.label ?? top.id} — ${top.description ?? 'no description'}`, items, lines.join('\n'));
      } catch (e) {
        return fail(`Wikidata lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'worldbank_stat',
    group: 'network',
    desc: 'A World Bank development indicator for a country, most recent value (keyless).',
    effect: 'C',
    network: true,
    params: [
      { name: 'country', type: 'string', required: true, desc: 'ISO code, e.g. US, BR, IN' },
      { name: 'indicator', type: 'string', desc: 'indicator code, default NY.GDP.MKTP.CD (GDP)' },
    ],
    run: async (a, ctx) => {
      const c = str(a, 'country', '').trim().toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(c)) return fail('Give a two or three letter country code, like US or BRA.');
      const ind = str(a, 'indicator', 'NY.GDP.MKTP.CD').trim();
      try {
        const r = (await ctx.fetchJson(
          `https://api.worldbank.org/v2/country/${encodeURIComponent(c)}/indicator/${encodeURIComponent(ind)}?format=json&per_page=60`,
        )) as [unknown, { date: string; value: number | null; country?: { value?: string }; indicator?: { value?: string } }[]?];
        const rows = Array.isArray(r) ? r[1] ?? [] : [];
        const latest = rows.find((x) => x.value != null);
        if (!latest) return fail(`No data for ${ind} in ${c}. Check the indicator code.`);
        return ok(
          `${latest.country?.value ?? c}, ${latest.indicator?.value ?? ind} (${latest.date}): ${Number(latest.value).toLocaleString()}`,
          latest,
        );
      } catch (e) {
        return fail(`World Bank lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'music_search',
    group: 'network',
    desc: 'Look up an artist or band in MusicBrainz: type, country, active years (keyless).',
    effect: 'C',
    network: true,
    params: [{ name: 'artist', type: 'string', required: true, desc: 'artist or band name' }],
    run: async (a, ctx) => {
      const q = str(a, 'artist', '').trim();
      if (!q) return fail('Which artist?');
      try {
        const r = (await ctx.fetchJson(
          `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json&limit=3`,
        )) as { artists?: { name: string; type?: string; country?: string; disambiguation?: string; 'life-span'?: { begin?: string; end?: string } }[] };
        const items = r.artists ?? [];
        if (!items.length) return fail(`MusicBrainz has no artist matching "${q}".`);
        const top = items[0];
        const span = top['life-span'];
        const years = span?.begin ? `${span.begin}${span.end ? `–${span.end}` : '–present'}` : 'unknown years';
        return ok(
          `${top.name}${top.type ? ` (${top.type})` : ''} — ${top.country ?? 'unknown country'}, ${years}`,
          items,
          items.map((x) => `- ${x.name}${x.disambiguation ? ` — ${x.disambiguation}` : ''}`).join('\n'),
        );
      } catch (e) {
        return fail(`MusicBrainz lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
  {
    name: 'ddg_answer',
    group: 'network',
    effect: 'C',
    network: true,
    desc: 'DuckDuckGo Instant Answer: a sourced summary for a topic, definition or calculation. Not a web-results search.',
    params: [{ name: 'query', type: 'string', required: true, desc: 'topic, definition or calculation' }],
    async run(a, ctx) {
      const query = str(a, 'query').trim();
      if (!query) return fail('Give me something to look up.');
      try {
        const r = (await ctx.fetchJson(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        )) as {
          Abstract?: string;
          AbstractText?: string;
          AbstractSource?: string;
          AbstractURL?: string;
          Heading?: string;
          Answer?: string;
          AnswerType?: string;
          Definition?: string;
          DefinitionSource?: string;
          DefinitionURL?: string;
          RelatedTopics?: { Text?: string; FirstURL?: string }[];
        };
        // Direct answers (unit maths, IP-style lookups) come back in Answer.
        if (r.Answer) {
          return ok(`${r.Answer}`, { query, kind: r.AnswerType ?? 'answer' }, `DuckDuckGo instant answer for "${query}".`);
        }
        const abstract = (r.AbstractText || r.Abstract || '').trim();
        if (abstract) {
          const src = r.AbstractSource ? ` (${r.AbstractSource})` : '';
          return ok(
            `${r.Heading || query}${src}: ${abstract.slice(0, 400)}`,
            { query, heading: r.Heading, source: r.AbstractSource, url: r.AbstractURL },
            `${abstract}\n\nSource: ${r.AbstractURL || 'DuckDuckGo'}`,
          );
        }
        if (r.Definition) {
          return ok(
            `${query}: ${r.Definition.slice(0, 300)}`,
            { query, source: r.DefinitionSource, url: r.DefinitionURL },
            `${r.Definition}\n\nSource: ${r.DefinitionURL || r.DefinitionSource || 'DuckDuckGo'}`,
          );
        }
        const topics = (r.RelatedTopics ?? []).map((t) => t.Text).filter(Boolean).slice(0, 5) as string[];
        if (topics.length) {
          return ok(
            `No direct answer for "${query}", but ${topics.length} related topics`,
            { query, topics },
            topics.map((t, i) => `${i + 1}. ${t}`).join('\n'),
          );
        }
        // This is the common case for ordinary web queries, and saying so is the
        // honest outcome -- the Instant Answer API is not a web search engine.
        return fail(
          `DuckDuckGo has no instant answer for "${query}".`,
          'The Instant Answer API only covers topics, definitions and calculations. It does not return web results, so an ordinary search query usually comes back empty. Use web_search for ranked results.',
        );
      } catch (e) {
        return fail('DuckDuckGo lookup failed', e instanceof Error ? e.message : String(e));
      }
    },
  },
];

export const TOOL_MAP: Record<string, ToolSpec> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export const TOOL_GROUPS: string[] = [...new Set(TOOLS.map((t) => t.group))];

/** Tool names only, resolved lazily so importers never read TOOL_MAP at module scope. */
export const toolNames = (): string[] => TOOLS.map((t) => t.name);

/** Pick a relevant subset so small models are not drowned in a 24-tool list. */
export function selectTools(prompt: string, groups: string[] = [], max = 8): ToolSpec[] {
  const p = prompt.toLowerCase();
  const pool = groups.length ? TOOLS.filter((t) => groups.includes(t.group)) : TOOLS;
  const score = (t: ToolSpec): number => {
    let s = 0;
    if (p.includes(t.name.replace(/_/g, ' ')) || p.includes(t.name)) s += 10;
    for (const w of t.desc.toLowerCase().split(/\W+/)) if (w.length > 4 && p.includes(w)) s += 2;
    if (t.group === 'compute' && /\d\s*[-+*/^%]\s*\d|calculat|convert|how much|how many/.test(p)) s += 6;
    if (t.group === 'network' && /search|look ?up|weather|fetch|url|http|news|latest/.test(p)) s += 6;
    if (t.group === 'code' && /code|script|function|run this|javascript|review/.test(p)) s += 6;
    if (t.group === 'files' && /file|write|save|read|sandbox|workspace/.test(p)) s += 5;
    if (t.group === 'memory' && /remember|memory|recall|forget|note that/.test(p)) s += 6;
    if (t.group === 'text' && /text|word|json|regex|diff|count|format/.test(p)) s += 4;
    if (t.group === 'data' && /csv|encode|decode|base64|hash|table/.test(p)) s += 4;
    if (t.effect === 'A') s += 1;
    return s;
  };
  return [...pool]
    .map((t) => ({ t, s: score(t) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, max)
    .filter((x, i) => x.s > 0 || i < 3)
    .map((x) => x.t);
}
