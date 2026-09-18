// Reflex core: the offline brain. No network, no model, fully deterministic.
// It is the last hop of the fallback chain and must always produce something useful
// and honest - never a fabricated answer dressed up as a model response.

import type { MemoryItem, Msg } from './types.ts';
import { matchIntent } from './intents.ts';

export interface ReflexReply {
  text: string;
  /** True when the reply came from a deterministic rule rather than reasoning. */
  rule: string;
  /** Reflex never pretends to be the model. */
  offline: true;
}

const OPENERS = [
  'Working offline right now, so here is what I can give you without a model:',
  'No model provider reached, so this is the on-device answer:',
  'Running on the reflex core (offline):',
];

function summarise(text: string): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
  if (sentences.length < 3) return null;
  const stop = new Set('the a an and or but of to in for on with is are was were it this that as at by be have has from not you your i we they'.split(' '));
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z']{4,}/g) ?? []) {
    if (stop.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const score = (s: string) =>
    (s.toLowerCase().match(/[a-z']{4,}/g) ?? []).reduce((n, w) => n + (freq.get(w) ?? 0), 0) / Math.sqrt(s.length);
  const top = [...sentences].sort((a, b) => score(b) - score(a)).slice(0, 3);
  const ordered = sentences.filter((s) => top.includes(s));
  return ordered.join(' ');
}

export function reflex(messages: Msg[], memory: MemoryItem[] = [], reason?: string): ReflexReply {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const q = (last?.content ?? '').trim();
  const opener = OPENERS[Math.abs(q.length) % OPENERS.length];

  // 1. Deterministic intents answer for free.
  const hit = matchIntent(q);
  if (hit?.canned && hit.text) return { text: hit.text, rule: `intent:${hit.intent.id}`, offline: true };

  // 2. Relevant memory beats a generic apology.
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const relevant = memory
    .map((m) => ({ m, hits: words.filter((w) => m.text.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3);
  if (relevant.length) {
    return {
      text: `${opener}\n\nFrom your saved memory:\n${relevant.map((r) => `- [${r.m.kind}] ${r.m.text}`).join('\n')}\n\n${reason ? `The model provider was unavailable: ${reason}. ` : ''}Connect a free Groq or Gemini key in Settings for a reasoned answer.`,
      rule: 'memory-recall',
      offline: true,
    };
  }

  // 3. Long pasted text: extractive summary is genuinely useful with no model.
  if (q.length > 400) {
    const s = summarise(q);
    if (s) {
      return {
        text: `${opener}\n\nExtractive summary (highest-signal sentences, selected by word frequency - not a model paraphrase):\n\n${s}`,
        rule: 'extractive-summary',
        offline: true,
      };
    }
  }

  // 4. Question shape: say what is missing rather than inventing an answer.
  const isQuestion = /\?\s*$|^(?:who|what|when|where|why|how|can|does|is|are|should|could|would)\b/i.test(q);
  const detail = reason ? `\n\nWhy: ${reason}` : '';
  if (isQuestion) {
    return {
      text: `${opener} I can\u2019t answer that offline without guessing, and guessing is worse than nothing.${detail}\n\nTwo ways forward:\n1. Add a free API key in Settings (Groq and Google AI Studio both have real free tiers).\n2. Ask me something a tool can answer deterministically - arithmetic, unit conversion, dates, text and JSON work, hashing, sandboxed code, or anything in your saved memory.`,
      rule: 'question-no-model',
      offline: true,
    };
  }

  return {
    text: `${opener} I have no model connection, so I can\u2019t reason about that yet.${detail}\n\nI can still run tools for you: maths, conversions, dates, text and JSON transforms, CSV stats, hashing, encoding, sandboxed JavaScript, virtual files, and memory. Add a free key in Settings to unlock full reasoning.`,
    rule: 'fallback',
    offline: true,
  };
}
