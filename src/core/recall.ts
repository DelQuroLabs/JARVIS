/**
 * Persistent memory, applied.
 *
 * Two halves that were missing:
 *  1. RECALL — every model turn gets a short "what you know about the user"
 *     block: pinned items and preferences always, plus the memories most
 *     relevant to the current prompt (keyword overlap, recency-weighted).
 *     Before this the model only remembered if it happened to call a tool.
 *  2. LEARN — after a turn, durable facts are extracted from what the user
 *     said with deterministic rules (no model call), deduplicated, and saved.
 *     A model-based pass can add more when a provider is available.
 *
 * Both are pure functions over MemoryItem[], so they are unit-tested and the
 * UI layer only decides when to call them and where to persist.
 */

import type { MemoryItem } from './types.ts';

export const RECALL_MAX_CHARS = 1800;
export const RECALL_MAX_ITEMS = 12;

const STOP = new Set('a an the and or but of to in on at for from by with about as is are was were be been being i me my mine you your it its this that these those we our they them their what which who whom how when where why do does did have has had not no yes can could should would will just so if then than too very please tell give make let'.split(' '));

export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Simple, honest relevance: term overlap with a mild recency bonus. */
export function scoreMemory(m: MemoryItem, promptTerms: Set<string>, now: number): number {
  const terms = tokens(m.text);
  if (!terms.length) return 0;
  let hits = 0;
  for (const t of terms) if (promptTerms.has(t) || [...promptTerms].some((p) => p.length > 4 && (t.startsWith(p) || p.startsWith(t)))) hits++;
  const overlap = hits / Math.sqrt(terms.length);
  const ageDays = Math.max(0, (now - m.created) / 86_400_000);
  const recency = 1 / (1 + ageDays / 60);
  return overlap * (0.8 + 0.2 * recency);
}

export interface RecallOpts { now?: number; maxChars?: number; maxItems?: number; extra?: string[] }

/**
 * Pick what to put in front of the model for this prompt. Returns null when
 * there is nothing worth saying, so callers can skip the block entirely.
 */
export function selectRecall(memory: MemoryItem[], prompt: string, opts: RecallOpts = {}): MemoryItem[] {
  const now = opts.now ?? Date.now();
  const max = opts.maxItems ?? RECALL_MAX_ITEMS;
  const promptTerms = new Set(tokens(prompt));
  const always = memory.filter((m) => m.pinned || m.kind === 'preference');
  const rest = memory.filter((m) => !always.includes(m));
  const scored = rest
    .map((m) => ({ m, s: scoreMemory(m, promptTerms, now) }))
    .filter((x) => x.s > 0.15)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
  // Newest facts fill any spare room so a fresh "my name is" is never missed.
  const fresh = rest.filter((m) => !scored.includes(m) && m.kind === 'fact').sort((a, b) => b.created - a.created).slice(0, 3);
  const out: MemoryItem[] = [];
  for (const m of [...always.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), ...scored, ...fresh]) {
    if (out.length >= max) break;
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Render the block appended to the system prompt. Null when empty. */
export function recallBlock(memory: MemoryItem[], prompt: string, opts: RecallOpts = {}): string | null {
  const picked = selectRecall(memory, prompt, opts);
  const extra = (opts.extra ?? []).map((t) => t.trim()).filter(Boolean);
  if (!picked.length && !extra.length) return null;
  const maxChars = opts.maxChars ?? RECALL_MAX_CHARS;
  const lines: string[] = [];
  let used = 0;
  const push = (line: string) => {
    if (used + line.length + 1 > maxChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  for (const m of picked) if (!push(`- [${m.kind}${m.pinned ? ', pinned' : ''}] ${m.text}`)) break;
  for (const t of extra) if (!push(`- [learned] ${t}`)) break;
  return [
    'WHAT YOU REMEMBER ABOUT THIS USER (persistent memory; use it naturally, do not recite it, correct it if the user contradicts it):',
    ...lines,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

export interface Learned { text: string; kind: MemoryItem['kind']; tags: string[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.trim().replace(/[.!?,;:]+$/, '').replace(/\s+/g, ' ');

/** Deterministic patterns for durable, first-person facts. Conservative on purpose. */
const RULES: Array<{ re: RegExp; kind: MemoryItem['kind']; tag: string; make: (m: RegExpMatchArray) => string | null }> = [
  { re: /\b(?:my name is|i am called|i'm called|call me|you can call me)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/i, kind: 'fact', tag: 'identity', make: (m) => { const name = m[1].split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).join(' '); return name ? `The user's name is ${name}` : null; } },
  { re: /\bi (?:live|am based|reside) in\s+([A-Z][\w .'-]{1,40}?)(?=[.,;!?]|$| and | but | with | where | now)/i, kind: 'fact', tag: 'location', make: (m) => `The user lives in ${clean(m[1])}` },
  { re: /\bi (?:work|am working) (?:at|for)\s+([A-Z][\w .&'-]{1,40}?)(?=[.,;!?]|$| and | as | where )/i, kind: 'fact', tag: 'work', make: (m) => `The user works at ${clean(m[1])}` },
  { re: /\bi (?:work as|am|'m) an?\s+((?:senior |junior |lead |staff |freelance |independent )?[a-z][a-z -]{2,40}?(?:engineer|developer|designer|manager|founder|teacher|nurse|doctor|lawyer|student|writer|analyst|consultant|architect|scientist|researcher|owner|ceo|cto|marketer|accountant|electrician|plumber|photographer))\b/i, kind: 'fact', tag: 'work', make: (m) => `The user works as a ${clean(m[1]).toLowerCase()}` },
  { re: /\bmy (wife|husband|partner|girlfriend|boyfriend|daughter|son|mom|mother|dad|father|sister|brother|dog|cat)(?:'s name)? is (?:called |named )?([A-Z][\w'-]+)/i, kind: 'fact', tag: 'people', make: (m) => `The user's ${m[1].toLowerCase()} is named ${m[2]}` },
  { re: /\bmy birthday is (?:on )?([A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/i, kind: 'fact', tag: 'dates', make: (m) => `The user's birthday is ${m[1]}` },
  { re: /\bi(?:'m| am) allergic to\s+([a-z][\w ,&'-]{1,40}?)(?=[.,;!?]|$| and | so )/i, kind: 'fact', tag: 'health', make: (m) => `The user is allergic to ${clean(m[1])}` },
  { re: /\bi (?:prefer|like|love|enjoy)\s+((?:to |using |working with |writing in |reading )?[a-z0-9][\w .#+'-]{2,50}?)(?=[.,;!?]|$| over | more than | because | rather than | and | but | when )/i, kind: 'preference', tag: 'likes', make: (m) => `The user likes ${clean(m[1])}` },
  { re: /\bi (?:hate|dislike|can't stand|don't like|do not like)\s+([a-z0-9][\w .#+'-]{2,50}?)(?=[.,;!?]|$| because | and | but | so | when )/i, kind: 'preference', tag: 'dislikes', make: (m) => `The user dislikes ${clean(m[1])}` },
  { re: /\b(?:always|please always|from now on,?)\s+((?:answer|reply|respond|write|use|keep|be|speak|call me)\b[^.!?\n]{3,80})/i, kind: 'preference', tag: 'style', make: (m) => `Standing instruction: ${clean(m[1])}` },
  { re: /\b(?:never|please never|don't ever)\s+((?:use|write|say|call me|reply|answer|add|include)\b[^.!?\n]{3,80})/i, kind: 'preference', tag: 'style', make: (m) => `Standing instruction: never ${clean(m[1])}` },
  { re: /\bmy (?:time ?zone|timezone) is\s+([A-Za-z_/+-]{2,40}(?: [A-Za-z]{2,10})?)/i, kind: 'fact', tag: 'location', make: (m) => `The user's timezone is ${clean(m[1])}` },
  { re: /\b(?:i(?:'m| am) (?:currently |now )?(?:working on|building|learning|studying|planning|training for))\s+([^.!?\n]{3,80})/i, kind: 'task', tag: 'projects', make: (m) => `The user is ${m[0].toLowerCase().replace(/^i(?:'m| am) (?:currently |now )?/, '')}`.replace(/\s+/g, ' ') },
  { re: /\b(?:remember|note|keep in mind)(?: that)?[:,]?\s+([^\n]{4,200})/i, kind: 'note', tag: 'explicit', make: (m) => cap(clean(m[1])) },
];

/** Things that look like facts but are questions, hypotheticals or about someone else. */
const NOT_ABOUT_USER = /\b(?:if i|when i|should i|do i|can i|could i|would i|what if|suppose|imagine|pretend|for example|e\.g\.|hypothetically)\b/i;

export function extractFacts(userText: string): Learned[] {
  const text = userText.trim();
  if (!text || text.length > 4000 || text.startsWith('/')) return [];
  const out: Learned[] = [];
  const seen = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (sentence.trim().endsWith('?') || NOT_ABOUT_USER.test(sentence)) continue;
    for (const r of RULES) {
      const m = sentence.match(r.re);
      if (!m) continue;
      const made = r.make(m);
      if (!made || made.length < 8 || made.length > 220) continue;
      const key = normalise(made);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: made, kind: r.kind, tags: ['learned', r.tag] });
    }
  }
  return out.slice(0, 5);
}

export const normalise = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

/** Drop anything already known (exact or near-duplicate by normalised text / same identity slot). */
export function dedupeLearned(candidates: Learned[], existing: MemoryItem[]): Learned[] {
  const known = new Set(existing.map((m) => normalise(m.text)));
  return candidates.filter((c) => {
    const k = normalise(c.text);
    if (known.has(k)) return false;
    // "The user's name is X" should replace, not duplicate: caller handles supersede via slotOf.
    return true;
  });
}

/** Facts that have exactly one true value at a time. A new one supersedes the old. */
export function slotOf(text: string): string | null {
  const t = text.toLowerCase();
  if (t.startsWith("the user's name is")) return 'name';
  if (t.startsWith('the user lives in')) return 'home';
  if (t.startsWith("the user's timezone is")) return 'tz';
  if (t.startsWith("the user's birthday is")) return 'birthday';
  if (t.startsWith('the user works at')) return 'employer';
  return null;
}

/** Prompt for the optional model pass. Strict JSON, first-person durable facts only. */
export const LEARN_PROMPT = [
  'You extract durable facts about the USER from a chat exchange, for a personal assistant\'s long-term memory.',
  'Return ONLY a JSON array of strings, no prose. Each string is one fact in the third person ("The user ..."), under 120 characters.',
  'Include only things likely to still be true next month: identity, location, work, people, preferences, standing instructions, ongoing projects, constraints.',
  'Exclude: one-off questions, the assistant\'s own answers, anything hypothetical, secrets or credentials, and anything already in KNOWN.',
  'If there is nothing durable, return [].',
].join(' ');

/** Parse a model reply for the learn pass. Tolerates fences and stray prose. */
export function parseLearned(reply: string): string[] {
  const m = reply.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').map((s) => clean(s)).filter((s) => s.length >= 8 && s.length <= 160).slice(0, 6);
  } catch {
    return [];
  }
}
