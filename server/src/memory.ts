// Long-term memory: the assistant learns the user over time.
//
// Two layers, modelled on OpenJarvis's memory service:
//  1. A background FactExtractor distils durable facts from each exchange
//     (never on the request path; any failure degrades to "no facts").
//  2. An FTS5 index over facts + the app's memory_items gives BM25 recall that
//     is injected into the system prompt on every turn.
//
// Every extracted fact carries a trust tier. Text that trips the injection
// scanner is quarantined ("untrusted") and never recalled into a prompt.

import OpenAI from 'openai';
import { db, listRows } from './db.js';
import { loadPrompt, fill } from './prompts.js';
import { MEMORY_MODEL as MODEL, samplingParams } from './llm.js';

// ---------------- Schema ----------------

db.exec(`
  CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'auto',
    trust      TEXT NOT NULL DEFAULT 'auto',
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    UNIQUE(user_id, text)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text, content='facts', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO facts_fts(rowid, text) VALUES (new.id, new.text);
  END;
`);

export type Trust = 'auto' | 'trusted' | 'untrusted';
export interface Fact { id: number; text: string; source: string; trust: Trust; created_at: number; last_seen: number }

const MAX_FACTS_PER_USER = 1000;

// ---------------- Injection scanner ----------------
// Ported from OpenJarvis security/injection_scanner.py. Anything matching is
// quarantined rather than remembered — memory must never become a channel for
// instructions to reach the model.

const INJECTION_PATTERNS: [RegExp, 'high' | 'critical'][] = [
  [/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i, 'critical'],
  [/disregard\s+(?:all\s+)?(?:previous|prior|your)\s+(?:instructions?|programming|rules?)/i, 'critical'],
  [/you\s+are\s+now\s+(?:a\s+)?(?:different|new|my)/i, 'high'],
  [/pretend\s+(?:you\s+)?(?:have\s+)?no\s+(?:restrictions?|limitations?|rules?|filters?)/i, 'high'],
  [/(?:DAN|do\s+anything\s+now)\s+(?:mode|prompt|jailbreak)/i, 'high'],
  [/(?:send|post|upload|exfiltrate|transmit)\s+(?:(?:to|data|all|everything)\s+)*(?:to\s+)?(?:https?:\/\/|my\s+server)/i, 'critical'],
  [/base64\s+encode\s+(?:and\s+)?(?:send|include|append)/i, 'high'],
  [/```(?:system|assistant)\b/, 'high'],
  [/<\|(?:im_start|im_end|system|assistant)\|>/, 'critical'],
  [/(?:;|\||&&)\s*(?:rm|curl|wget|nc|ncat|bash|sh|python|perl)\s/, 'high'],
];

export function scanInjection(text: string): { flagged: boolean; level?: 'high' | 'critical'; pattern?: string } {
  for (const [re, level] of INJECTION_PATTERNS) {
    if (re.test(text)) return { flagged: true, level, pattern: re.source.slice(0, 40) };
  }
  return { flagged: false };
}

// ---------------- Store ----------------

export function addFact(uid: number, text: string, source = 'auto', trust: Trust = 'auto'): boolean {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (clean.length < 4) return false;
  const now = Date.now();
  const r = db.prepare(`INSERT INTO facts (user_id, text, source, trust, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, text) DO UPDATE SET last_seen = excluded.last_seen`).run(uid, clean, source, trust, now, now);
  // Cap: drop the oldest auto facts past the limit
  db.prepare(`DELETE FROM facts WHERE user_id = ? AND trust = 'auto' AND id NOT IN (
    SELECT id FROM facts WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?)`).run(uid, uid, MAX_FACTS_PER_USER);
  return r.changes > 0;
}

export function listFacts(uid: number, includeUntrusted = false): Fact[] {
  return db.prepare(`SELECT * FROM facts WHERE user_id = ? ${includeUntrusted ? '' : "AND trust != 'untrusted'"} ORDER BY last_seen DESC`).all(uid) as Fact[];
}

export function deleteFact(uid: number, id: number): boolean {
  return db.prepare('DELETE FROM facts WHERE id = ? AND user_id = ?').run(id, uid).changes > 0;
}

export function setTrust(uid: number, id: number, trust: Trust): boolean {
  return db.prepare('UPDATE facts SET trust = ? WHERE id = ? AND user_id = ?').run(trust, id, uid).changes > 0;
}

export function clearFacts(uid: number): number {
  return db.prepare('DELETE FROM facts WHERE user_id = ?').run(uid).changes;
}

// ---------------- Recall ----------------

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'should', 'have', 'from', 'about', 'your', 'you', 'are', 'was', 'can', 'how', 'did', 'does', 'will']);
// Prefix match on a light stem so "meeting" finds "meetings" and vice versa.
const stem = (w: string) => w.replace(/(ings?|ies|ied|ed|es|s|ly)$/, '').slice(0, 5) || w;
const ftsQuery = (q: string) =>
  [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))]
    .slice(0, 12).map((w) => `"${w}"*`).join(' OR ');

/** BM25 recall over facts, plus a keyword pass over the app's memory_items. */
export function recall(uid: number, query: string, topK = 8): string[] {
  const out: string[] = [];
  const q = ftsQuery(query);
  if (q) {
    const rows = db.prepare(`SELECT f.text FROM facts_fts m JOIN facts f ON f.id = m.rowid
      WHERE facts_fts MATCH ? AND f.user_id = ? AND f.trust != 'untrusted' ORDER BY bm25(facts_fts) LIMIT ?`).all(q, uid, topK) as { text: string }[];
    for (const r of rows) { out.push(r.text); db.prepare('UPDATE facts SET last_seen = ? WHERE user_id = ? AND text = ?').run(Date.now(), uid, r.text); }
  }
  // App memory items (pinned first)
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const items = listRows('memory_items', uid).map((r) => r.data as { text: string; pinned?: boolean; tags?: string[] });
  const hits = items.filter((m) => m.pinned || words.some((w) => m.text.toLowerCase().includes(w)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).slice(0, topK);
  for (const h of hits) if (!scanInjection(h.text).flagged) out.push(h.text);
  return [...new Set(out)].slice(0, topK * 2);
}

/** Always-on profile: the most recent trusted/auto facts, regardless of query. */
export function profile(uid: number, n = 12): string[] {
  return listFacts(uid).slice(0, n).map((f) => f.text);
}

export function recallBlock(uid: number, query: string): string {
  const facts = [...new Set([...profile(uid), ...recall(uid, query)])];
  if (!facts.length) return '';
  return fill(loadPrompt('memory.recall'), { facts: facts.map((f) => `- ${f}`).join('\n') });
}

// ---------------- Background extraction ----------------

let client: OpenAI | null = null;
const queue: { uid: number; user: string; assistant: string }[] = [];
let draining = false;

export function submitExchange(uid: number, user: string, assistant: string): void {
  if (!process.env.OPENAI_API_KEY) return;
  if (queue.length >= 256) queue.shift();
  queue.push({ uid, user, assistant });
  if (!draining) void drain();
}

async function drain(): Promise<void> {
  draining = true;
  while (queue.length) {
    const job = queue.shift()!;
    try { await extractAndStore(job.uid, job.user, job.assistant); }
    catch (e) { console.warn('memory: extraction failed —', (e as Error).message); }
  }
  draining = false;
}

async function extractAndStore(uid: number, user: string, assistant: string): Promise<void> {
  // Scan BEFORE extraction so an overt injection never reaches the extractor
  const scan = scanInjection(`${user}\n${assistant}`);
  if (scan.flagged) {
    addFact(uid, `[quarantined] ${user.slice(0, 150)}`, 'scanner', 'untrusted');
    return;
  }
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: MODEL, ...samplingParams(MODEL, { temperature: 0, maxTokens: 1200, effort: 'none' }),
    messages: [
      { role: 'system', content: loadPrompt('memory.extract') },
      { role: 'user', content: `User: ${user}${assistant ? `\nAssistant: ${assistant}` : ''}` },
    ],
  });
  for (const f of parseFacts(res.choices[0]?.message?.content ?? '')) {
    addFact(uid, f, 'auto', scanInjection(f).flagged ? 'untrusted' : 'auto');
  }
}

export function parseFacts(content: string, max = 10): string[] {
  let raw: string[] = [];
  const m = content.match(/\[[\s\S]*\]/);
  if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) raw = p.map(String); } catch { /* fall through */ } }
  if (!raw.length) {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s+/.test(l));
    raw = (bullets.length ? bullets : lines).map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s+/, ''));
  }
  const seen = new Set<string>(); const out: string[] = [];
  for (const r of raw) {
    const f = r.replace(/^["'`]+|["'`,]+$/g, '').trim();
    if (f.length < 4 || f === '[]') continue;
    const k = f.toLowerCase(); if (seen.has(k)) continue;
    seen.add(k); out.push(f.slice(0, 200));
    if (out.length >= max) break;
  }
  return out;
}
