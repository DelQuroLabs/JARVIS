// The server-side JARVIS brain: persona engine + tool-calling agent loop.
// Used by the Telegram bot and the /api/assistant endpoint. It operates on the
// same per-user SQLite rows the PWA syncs, so anything logged here shows up in
// the app on the next sync (and vice versa).

import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import {
  getSettings, listRows, putRow, deleteRow, pushTgMessage, recentTgMessages, type UserSettings,
} from './db.js';
import { loadPrompt, fill } from './prompts.js';
import { recallBlock, submitExchange, addFact, listFacts, deleteFact, scanInjection } from './memory.js';

import { MODEL, samplingParams } from './llm.js';
const MAX_STEPS = 8;

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set on the server');
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

const uid8 = () => Math.random().toString(36).slice(2, 10);

// ---------------- Persona engine ----------------
// All text lives in server/prompts/*.md — see the README there.

export function systemPrompt(s: UserSettings, channel: 'telegram' | 'app', memory = ''): string {
  const vars = {
    address: s.name ? `Address the user as ${s.name}.` : 'Address the user as "sir" — at most once per reply.',
    humor: Math.round(s.humor * 10),
    currency: s.currency,
    today: new Date().toISOString().slice(0, 10),
    channel_rules: channel === 'telegram'
      ? '- This is a Telegram chat: keep replies short, plain text, no markdown tables or headers. Emoji only if the user uses them.'
      : '- Keep replies concise. Light markdown is fine.',
  };
  const parts = [fill(loadPrompt(`persona.${s.persona}`), vars), fill(loadPrompt('rules'), vars)];
  if (memory) parts.push(memory);
  return parts.join('\n\n');
}

// ---------------- SSRF guard ----------------
// Ported from OpenJarvis security/ssrf.py: never let fetch_url reach
// localhost, private ranges or cloud metadata endpoints from the server.

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', '169.254.169.254', 'metadata', 'instance-data']);
export function ssrfCheck(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'Invalid URL'; }
  if (!/^https?:$/.test(u.protocol)) return 'Only http(s) URLs are allowed';
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(h) || h.endsWith('.internal') || h.endsWith('.local')) return `Blocked host: ${h}`;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return `Blocked private address: ${h}`;
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return `Blocked private address: ${h}`;
  return null;
}

// ---------------- Tools ----------------

type Ctx = { uid: number; settings: UserSettings };
type ToolFn = (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

const TOOLS: { def: OpenAI.Chat.ChatCompletionFunctionTool; run: ToolFn }[] = [
  // ---- Expenses
  {
    def: { type: 'function' as const, function: { name: 'expense_add', description: 'Log an expense.', parameters: { type: 'object', properties: {
      amount: { type: 'number' }, category: { type: 'string', description: 'food, travel, software, office, personal, other…' },
      note: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' }, business: { type: 'boolean' },
    }, required: ['amount', 'category'] } } },
    run: async (a, { uid, settings }) => {
      const id = uid8();
      const data = { id, amount: num(a.amount), currency: settings.currency, category: str(a.category, 'other').toLowerCase(), note: str(a.note),
        date: str(a.date) || new Date().toISOString().slice(0, 10), business: !!a.business, created: Date.now(), updated: Date.now() };
      putRow('expenses', uid, id, data);
      return { ok: true, expense: data };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'expense_list', description: 'List or total expenses in a date range, optionally by category.', parameters: { type: 'object', properties: {
      from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string' }, category: { type: 'string' }, business: { type: 'boolean' },
    } } } },
    run: async (a, { uid }) => {
      let rows = listRows('expenses', uid).map((r) => r.data as { amount: number; category: string; date: string; note: string; business?: boolean; id: string });
      if (a.from) rows = rows.filter((r) => r.date >= str(a.from));
      if (a.to) rows = rows.filter((r) => r.date <= str(a.to));
      if (a.category) rows = rows.filter((r) => r.category === str(a.category).toLowerCase());
      if (typeof a.business === 'boolean') rows = rows.filter((r) => !!r.business === a.business);
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const byCat: Record<string, number> = {};
      for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + r.amount;
      return { count: rows.length, total: Math.round(total * 100) / 100, byCategory: byCat, items: rows.slice(0, 25) };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'expense_delete', description: 'Delete an expense by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    run: async (a, { uid }) => ({ ok: deleteRow('expenses', uid, str(a.id)) }),
  },

  // ---- Contacts
  {
    def: { type: 'function' as const, function: { name: 'contact_search', description: 'Find contacts by name, email, company or tag.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    run: async (a, { uid }) => {
      const q = str(a.query).toLowerCase();
      const all = listRows('contacts', uid).map((r) => r.data);
      const hits = all.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
      return { count: hits.length, contacts: hits.slice(0, 10) };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'contact_upsert', description: 'Create or update a contact. Pass id to update.', parameters: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' },
      role: { type: 'string' }, notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    }, required: ['name'] } } },
    run: async (a, { uid }) => {
      const id = str(a.id) || uid8();
      const existing = str(a.id) ? listRows('contacts', uid).find((r) => r.id === id)?.data ?? {} : {};
      const data = { ...existing, id, name: str(a.name), email: str(a.email, str(existing.email as string)), phone: str(a.phone, str(existing.phone as string)),
        company: str(a.company, str(existing.company as string)), role: str(a.role, str(existing.role as string)), notes: str(a.notes, str(existing.notes as string)),
        tags: Array.isArray(a.tags) ? a.tags : (existing.tags ?? []), created: (existing.created as number) ?? Date.now(), updated: Date.now() };
      putRow('contacts', uid, id, data);
      return { ok: true, contact: data };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'contact_delete', description: 'Delete a contact by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    run: async (a, { uid }) => ({ ok: deleteRow('contacts', uid, str(a.id)) }),
  },

  // ---- Reasoning scratchpad (OpenJarvis "think" tool — zero cost, helps multi-step tasks)
  {
    def: { type: 'function' as const, function: { name: 'think', description: 'A private scratchpad. Use it to plan a multi-step task or reason about ambiguous requests before acting. Nothing here is shown to the user.', parameters: { type: 'object', properties: { thought: { type: 'string' } }, required: ['thought'] } } },
    run: async (a) => ({ ok: true, noted: str(a.thought).length }),
  },

  // ---- Long-term memory about the user (facts, auto-learned + explicit)
  {
    def: { type: 'function' as const, function: { name: 'remember', description: 'Store a durable fact about the user for future conversations (preference, goal, relationship, habit). Use when the user says "remember", or reveals something stable about themselves.', parameters: { type: 'object', properties: { fact: { type: 'string', description: 'Third person, e.g. "User prefers morning meetings"' } }, required: ['fact'] } } },
    run: async (a, { uid }) => {
      const fact = str(a.fact);
      if (scanInjection(fact).flagged) return { ok: false, error: 'That text looks like an instruction, not a fact. Not stored.' };
      return { ok: addFact(uid, fact, 'explicit', 'trusted'), fact };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'forget', description: 'Delete something you remember about the user. Pass a search phrase; matching facts are removed.', parameters: { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] } } },
    run: async (a, { uid }) => {
      const q = str(a.phrase).toLowerCase();
      const hits = listFacts(uid, true).filter((f) => f.text.toLowerCase().includes(q));
      for (const f of hits) deleteFact(uid, f.id);
      return { ok: true, removed: hits.map((f) => f.text) };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'what_i_know', description: 'List everything you currently remember about the user.', parameters: { type: 'object', properties: {} } } },
    run: async (_a, { uid }) => ({ facts: listFacts(uid).map((f) => ({ id: f.id, text: f.text, since: new Date(f.created_at).toISOString().slice(0, 10), source: f.source })) }),
  },

  // ---- Memory (shared with the app's Memory screen)
  {
    def: { type: 'function' as const, function: { name: 'memory_write', description: 'Remember a fact, preference, decision, task or note about the user.', parameters: { type: 'object', properties: {
      text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'task', 'note'] }, tags: { type: 'array', items: { type: 'string' } },
    }, required: ['text'] } } },
    run: async (a, { uid }) => {
      const id = uid8();
      const data = { id, kind: str(a.kind, 'note'), text: str(a.text), tags: Array.isArray(a.tags) ? a.tags : [], created: Date.now(), source: 'telegram' };
      putRow('memory_items', uid, id, data);
      return { ok: true, id };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'memory_search', description: 'Search what you remember about the user.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    run: async (a, { uid }) => {
      const q = str(a.query).toLowerCase().split(/\s+/).filter(Boolean);
      const all = listRows('memory_items', uid).map((r) => r.data as { text: string; kind: string; tags: string[]; created: number });
      const hits = all.filter((m) => q.some((w) => m.text.toLowerCase().includes(w) || m.tags?.some((t) => t.toLowerCase().includes(w))));
      return { count: hits.length, items: hits.slice(0, 10).map((m) => ({ kind: m.kind, text: m.text, when: new Date(m.created).toISOString().slice(0, 10) })) };
    },
  },

  // ---- Calendar (events table; the app shows them as the "JARVIS" calendar)
  {
    def: { type: 'function' as const, function: { name: 'calendar_add', description: 'Schedule a meeting or event.', parameters: { type: 'object', properties: {
      title: { type: 'string' }, start: { type: 'string', description: 'ISO 8601 datetime' }, duration_min: { type: 'number' }, location: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
    }, required: ['title', 'start'] } } },
    run: async (a, { uid }) => {
      const start = new Date(str(a.start)).getTime();
      if (!Number.isFinite(start)) return { ok: false, error: 'Invalid start datetime' };
      const id = uid8();
      const data = { id, title: str(a.title), start, end: start + num(a.duration_min, 30) * 60_000, location: str(a.location),
        attendees: Array.isArray(a.attendees) ? a.attendees : [], notes: str(a.notes), created: Date.now(), updated: Date.now(), source: 'telegram' };
      putRow('events', uid, id, data);
      return { ok: true, event: { ...data, start: new Date(start).toISOString(), end: new Date(data.end).toISOString() } };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'calendar_list', description: 'List upcoming events between two datetimes (defaults: now → +7 days).', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
    run: async (a, { uid }) => {
      const from = a.from ? new Date(str(a.from)).getTime() : Date.now();
      const to = a.to ? new Date(str(a.to)).getTime() : from + 7 * 86_400_000;
      const evs = listRows('events', uid).map((r) => r.data as { title?: string; start?: number; end?: number; location?: string; id: string })
        .filter((e) => typeof e.start === 'number' && e.start >= from && e.start <= to)
        .sort((x, y) => (x.start ?? 0) - (y.start ?? 0));
      return { count: evs.length, events: evs.map((e) => ({ id: e.id, title: e.title, start: new Date(e.start!).toISOString(), end: e.end ? new Date(e.end).toISOString() : undefined, location: e.location })) };
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'calendar_delete', description: 'Cancel an event by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    run: async (a, { uid }) => ({ ok: deleteRow('events', uid, str(a.id)) }),
  },

  // ---- Email
  {
    def: { type: 'function' as const, function: { name: 'email_send', description: 'Send an email via the user\'s configured SMTP. Only call after the user confirmed the draft.', parameters: { type: 'object', properties: {
      to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string', description: 'Plain text body' }, cc: { type: 'string' },
    }, required: ['to', 'subject', 'body'] } } },
    run: async (a, { settings }) => {
      const s = settings.smtp;
      if (!s?.host || !s.user) return { ok: false, error: 'No SMTP configured. Set it in the app under Assistant → Email.' };
      const t = nodemailer.createTransport({ host: s.host, port: s.port || 587, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
      const info = await t.sendMail({ from: s.from || s.user, to: str(a.to), cc: str(a.cc) || undefined, subject: str(a.subject), text: str(a.body) });
      return { ok: true, messageId: info.messageId, accepted: info.accepted };
    },
  },

  // ---- Research
  {
    def: { type: 'function' as const, function: { name: 'web_search', description: 'Search the web for current information. Use for research, competitors, market facts, news.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] } } },
    run: async (a) => {
      const q = str(a.query);
      const n = Math.min(10, Math.max(1, num(a.max_results, 5)));
      const out: Record<string, unknown> = {};
      // 1. You.com — keyed if YOUCOM_API_KEY is set, else the keyless free tier (rate-limited per IP)
      try {
        const key = process.env.YOUCOM_API_KEY;
        const url = key ? `https://api.you.com/v1/search?query=${encodeURIComponent(q)}&count=${n}` : `https://api.you.com/v1/agents/search?query=${encodeURIComponent(q)}&count=${n}`;
        const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'jarvis/2.0', ...(key ? { 'X-API-Key': key } : {}) }, signal: AbortSignal.timeout(12_000) });
        if (res.ok) {
          const j = await res.json() as { results?: { web?: { title?: string; url?: string; description?: string; snippets?: string[] }[]; news?: { title?: string; url?: string; description?: string }[] } };
          const web = [...(j.results?.web ?? []), ...(j.results?.news ?? [])].slice(0, n)
            .map((r) => ({ title: r.title, url: r.url, summary: ((r as { snippets?: string[] }).snippets ?? []).join(' ').slice(0, 400) || r.description }));
          if (web.length) { out.engine = key ? 'you.com' : 'you.com (keyless)'; out.results = web; return out; }
        } else if (res.status === 429 || res.status === 403) {
          out.note = 'You.com keyless limit reached; set YOUCOM_API_KEY (free at you.com/platform). Falling back.';
        }
      } catch { /* fall through */ }
      // 2. DuckDuckGo + Wikipedia fallback
      out.engine = 'duckduckgo+wikipedia';
      try {
        const ddg = await (await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`)).json() as { AbstractText?: string; AbstractURL?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] };
        if (ddg.AbstractText) out.abstract = { text: ddg.AbstractText, url: ddg.AbstractURL };
        out.related = (ddg.RelatedTopics ?? []).filter((r) => r.Text).slice(0, 5).map((r) => ({ text: r.Text, url: r.FirstURL }));
      } catch { /* ignore */ }
      try {
        const w = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&origin=*`)).json() as { query?: { search?: { title: string; snippet: string }[] } };
        out.wikipedia = (w.query?.search ?? []).map((r) => ({ title: r.title, snippet: r.snippet.replace(/<[^>]+>/g, '') }));
      } catch { /* ignore */ }
      return out;
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'fetch_url', description: 'Fetch a web page and return its readable text (first 6000 chars).', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    run: async (a) => {
      const blocked = ssrfCheck(str(a.url));
      if (blocked) return { error: blocked };
      const res = await fetch(str(a.url), { headers: { 'User-Agent': 'JARVIS/2.0' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
      if ((res.headers.get('content-type') ?? '').includes('application/pdf')) return { error: 'PDF documents cannot be read directly yet' };
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { status: res.status, text: text.slice(0, 6000) };
    },
  },

  // ---- Calculator & logic
  {
    def: { type: 'function' as const, function: { name: 'calculate', description: 'Evaluate a math expression exactly (supports + - * / % ^ parentheses, sqrt, round, min, max, abs).', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } },
    run: async (a) => {
      const expr = str(a.expression);
      if (!/^[\d\s+\-*/%^().,a-z]+$/i.test(expr)) return { error: 'Unsupported characters' };
      const safe = expr.replace(/\^/g, '**').replace(/\b(sqrt|round|min|max|abs|floor|ceil|pow|log)\b/g, 'Math.$1');
      if (/[a-z]/i.test(safe.replace(/Math\.\w+/g, ''))) return { error: 'Unknown identifier' };
      try { return { result: Function(`"use strict"; return (${safe});`)() }; } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    def: { type: 'function' as const, function: { name: 'unit_convert', description: 'Convert between currencies (live ECB rates) or common units.', parameters: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] } } },
    run: async (a) => {
      const v = num(a.value); const from = str(a.from).toUpperCase(); const to = str(a.to).toUpperCase();
      if (/^[A-Z]{3}$/.test(from) && /^[A-Z]{3}$/.test(to)) {
        const r = await (await fetch(`https://api.frankfurter.app/latest?amount=${v}&from=${from}&to=${to}`)).json() as { rates?: Record<string, number>; message?: string };
        return r.rates ? { result: r.rates[to], from, to } : { error: r.message ?? 'Unknown currency' };
      }
      const U: Record<string, number> = { km: 1000, m: 1, cm: 0.01, mi: 1609.344, ft: 0.3048, in: 0.0254, kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523, l: 1, ml: 0.001, gal: 3.785411784 };
      const f = U[from.toLowerCase()], t = U[to.toLowerCase()];
      if (f && t) return { result: (v * f) / t, from, to };
      if (from === 'C' && to === 'F') return { result: v * 9 / 5 + 32 };
      if (from === 'F' && to === 'C') return { result: (v - 32) * 5 / 9 };
      return { error: 'Unknown unit pair' };
    },
  },
];

export const TOOL_DEFS = TOOLS.map((t) => t.def);
const TOOL_MAP = new Map(TOOLS.map((t) => [t.def.function.name, t.run]));

// ---------------- Agent loop ----------------

export interface AssistantReply {
  text: string;
  steps: { tool: string; args: unknown; result: unknown; ms: number }[];
}

export async function ask(uid: number, userText: string, channel: 'telegram' | 'app' = 'telegram'): Promise<AssistantReply> {
  const settings = getSettings(uid);
  const ctx: Ctx = { uid, settings };
  const history = recentTgMessages(uid, 20);
  pushTgMessage(uid, 'user', userText);

  const memory = recallBlock(uid, userText);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(settings, channel, memory) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: 'user', content: userText },
  ];
  const steps: AssistantReply['steps'] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await openai().chat.completions.create({ model: MODEL, messages, tools: TOOL_DEFS, ...samplingParams(MODEL, { temperature: 0.4, effort: 'low' }) });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      const text = (msg.content ?? '').trim() || 'Done.';
      pushTgMessage(uid, 'assistant', text);
      submitExchange(uid, userText, text); // learn in the background
      return { text, steps };
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const fn = TOOL_MAP.get(call.function.name);
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }
      const t0 = Date.now();
      let result: unknown;
      try { result = fn ? await fn(args, ctx) : { error: `Unknown tool ${call.function.name}` }; }
      catch (e) { result = { error: (e as Error).message }; }
      steps.push({ tool: call.function.name, args, result, ms: Date.now() - t0 });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }
  }

  const text = 'I ran out of steps before finishing that. Could you narrow it down?';
  pushTgMessage(uid, 'assistant', text);
  return { text, steps };
}
