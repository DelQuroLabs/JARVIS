// Telemetry: local-only run traces plus derived estimates and pattern discovery.
// Estimates are labelled as estimates everywhere they surface (POL-HONESTY-005).

import type { Trace } from './types.ts';
import { uid } from './util.ts';

export const MAX_TRACES = 400;

export function makeTrace(t: Omit<Trace, 'id' | 'ts'>): Trace {
  return { ...t, id: uid('tr'), ts: Date.now() };
}

export function pushTrace(list: Trace[], t: Trace): Trace[] {
  return [t, ...list].slice(0, MAX_TRACES);
}

/* Published per-million-token prices, used only to estimate. Sources are shown in
   the UI and these are the free/cheap tiers as of 2026-09. */
export const PRICES: Record<string, { in: number; out: number; note: string }> = {
  groq: { in: 0, out: 0, note: 'free tier, rate limited' },
  gemini: { in: 0, out: 0, note: 'free tier, rate limited' },
  pollinations: { in: 0, out: 0, note: 'keyless, rate limited' },
  reflex: { in: 0, out: 0, note: 'on-device' },
  tool: { in: 0, out: 0, note: 'on-device' },
  openai: { in: 0.2, out: 1.2, note: 'gpt-5.6-luna list price' },
  anthropic: { in: 0.8, out: 4, note: 'claude haiku list price' },
  openrouter: { in: 0.3, out: 0.6, note: 'varies by model' },
  ollama: { in: 0, out: 0, note: 'self-hosted' },
  edge: { in: 0, out: 0, note: 'depends on your server key' },
};

export interface Estimates {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Rough Wh, from a published ~0.3 Wh per 1k output tokens figure for small models. */
  energyWh: number;
  avgMs: number;
  successRate: number;
  toolCalls: number;
  failures: number;
  /** Runs answered by the offline reflex core rather than any model. */
  offlineRuns: number;
  /** offlineRuns / runs, as a 0-1 share. 0 when there are no runs yet. */
  offlineShare: number;
}

export function estimate(traces: Trace[]): Estimates {
  const runs = traces.length;
  const offline = traces.filter((t) => t.via === 'reflex').length;
  const tokensIn = traces.reduce((n, t) => n + (t.tokensIn ?? 0), 0);
  const tokensOut = traces.reduce((n, t) => n + (t.tokensOut ?? 0), 0);
  const costUsd = traces.reduce((n, t) => {
    const p = PRICES[t.via ?? 'reflex'] ?? { in: 0, out: 0 };
    return n + ((t.tokensIn ?? 0) * p.in + (t.tokensOut ?? 0) * p.out) / 1_000_000;
  }, 0);
  return {
    runs,
    tokensIn,
    tokensOut,
    costUsd,
    energyWh: (tokensOut / 1000) * 0.3,
    avgMs: runs ? traces.reduce((n, t) => n + t.ms, 0) / runs : 0,
    successRate: runs ? traces.filter((t) => t.ok).length / runs : 1,
    toolCalls: traces.reduce((n, t) => n + (t.toolCount ?? 0), 0),
    failures: traces.filter((t) => !t.ok).length,
    offlineRuns: offline,
    offlineShare: runs ? offline / runs : 0,
  };
}

export interface Bucket {
  label: string;
  value: number;
}

export function byKind(traces: Trace[]): Bucket[] {
  const m = new Map<string, number>();
  for (const t of traces) m.set(t.kind, (m.get(t.kind) ?? 0) + 1);
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function byProvider(traces: Trace[]): Bucket[] {
  const m = new Map<string, number>();
  for (const t of traces) m.set(t.via ?? 'unknown', (m.get(t.via ?? 'unknown') ?? 0) + 1);
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/** Runs per hour bucket over the last 24h, oldest first. */
export function activity(traces: Trace[], now = Date.now()): Bucket[] {
  const out: Bucket[] = [];
  for (let h = 23; h >= 0; h--) {
    const hi = now - h * 3_600_000;
    const lo = hi - 3_600_000;
    out.push({ label: `${new Date(hi).getHours()}`, value: traces.filter((t) => t.ts > lo && t.ts <= hi).length });
  }
  return out;
}

export interface Pattern {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warn';
}

/** Discover honest, checkable patterns. Nothing here is invented. */
export function discoverPatterns(traces: Trace[]): Pattern[] {
  const out: Pattern[] = [];
  if (traces.length < 5) return out;
  const est = estimate(traces);

  if (est.successRate < 0.8) {
    out.push({
      id: 'failures',
      title: `${Math.round((1 - est.successRate) * 100)}% of runs failed`,
      detail: 'Most failures at this rate are provider rate limits. Add a second provider key in Settings so the chain has somewhere to fall back to.',
      severity: 'warn',
    });
  }
  const reflexShare = traces.filter((t) => t.via === 'reflex').length / traces.length;
  if (reflexShare > 0.3) {
    out.push({
      id: 'reflex',
      title: `${Math.round(reflexShare * 100)}% of answers came from the offline reflex core`,
      detail: 'That means no model provider was reachable for those runs. A free Groq or Gemini key removes almost all of these.',
      severity: 'warn',
    });
  }
  const slow = traces.filter((t) => t.ms > 12_000).length;
  if (slow > traces.length * 0.2) {
    out.push({ id: 'slow', title: `${slow} runs took over 12 seconds`, detail: 'Long runs are usually multi-step tool loops. A mode with a smaller tool budget will answer faster.', severity: 'info' });
  }
  const kinds = byKind(traces);
  if (kinds[0] && kinds[0].value > traces.length * 0.6) {
    out.push({ id: 'concentration', title: `${kinds[0].value} of ${traces.length} runs were "${kinds[0].label}"`, detail: 'A repeated shape like this is usually worth saving as a skill or a workflow so it runs in one tap.', severity: 'info' });
  }
  const hours = activity(traces);
  const peak = hours.reduce((a, b) => (b.value > a.value ? b : a), hours[0]);
  if (peak && peak.value > 2) {
    out.push({ id: 'peak', title: `Busiest hour: ${peak.label}:00 with ${peak.value} runs`, detail: 'A routine scheduled just before that hour could have the answer waiting for you.', severity: 'info' });
  }
  if (est.toolCalls === 0 && traces.length > 10) {
    out.push({ id: 'notools', title: 'No tool has run yet', detail: 'The model is answering everything from memory alone. Try a mode with a larger tool budget, such as Deep work.', severity: 'info' });
  }
  return out;
}
