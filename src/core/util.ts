// Small pure helpers. No platform imports.

export const uid = (p = 'id'): string =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtWhen(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 45_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function titleFrom(text: string, max = 42): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'New conversation';
  return t.length <= max ? t : `${t.slice(0, max - 1)}\u2026`;
}

/** Deterministic, dependency-free token estimate (~4 chars/token). */
export const estTokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4));

/** Cheap non-cryptographic hash, used for ids and dedupe only. */
export function hash32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Safe arithmetic evaluator: digits and operators only, no eval of identifiers. */
export function safeMath(expr: string): { ok: boolean; value?: number; error?: string } {
  const cleaned = expr.replace(/[\s,]/g, '').replace(/\u00d7/g, '*').replace(/\u00f7/g, '/');
  if (!/^[-+*/().0-9%^]+$/.test(cleaned)) return { ok: false, error: 'only numbers and + - * / ( ) % ^ are allowed' };
  if (cleaned.length > 120) return { ok: false, error: 'expression too long' };
  const js = cleaned.replace(/\^/g, '**');
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict";return (${js});`) as () => unknown;
    const v = fn();
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'not a finite number' };
    return { ok: true, value: v };
  } catch {
    return { ok: false, error: 'could not parse expression' };
  }
}

/** {{name}} interpolation against a flat bag. Unknown keys are left intact. */
export function interpolate(tpl: string, bag: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => {
    const v = bag[k];
    if (v === undefined || v === null) return m;
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

export function groupBy<T, K extends string>(xs: T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of xs) {
    const k = key(x);
    (out[k] ||= []).push(x);
  }
  return out;
}

export function sortByPath(items: { path: string; hash: string }[]): { path: string; hash: string }[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
