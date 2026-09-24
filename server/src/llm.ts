/**
 * Model-aware request parameters for the OpenAI Chat Completions API.
 * GPT-5-family reasoning models (gpt-5.x, o-series) reject `temperature` and the
 * legacy `max_tokens`; they take `max_completion_tokens` and `reasoning_effort`.
 * Older chat models (gpt-4o*) accept temperature and ignore reasoning_effort.
 */
export const DEFAULT_MODEL = 'gpt-5.6-luna';
export const MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;
export const MEMORY_MODEL = process.env.OPENAI_MEMORY_MODEL || MODEL;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

export function reasoningEffort(fallback: ReasoningEffort): ReasoningEffort {
  const e = (process.env.OPENAI_REASONING_EFFORT || '').toLowerCase() as ReasoningEffort;
  return EFFORTS.includes(e) ? e : fallback;
}

/** Sampling params appropriate for `model`. `temperature` is only sent to non-reasoning models. */
export function samplingParams(model: string, opts: { temperature?: number; maxTokens?: number; effort?: ReasoningEffort }) {
  const p: Record<string, unknown> = {};
  if (isReasoningModel(model)) {
    if (opts.maxTokens) p.max_completion_tokens = opts.maxTokens;
    p.reasoning_effort = reasoningEffort(opts.effort ?? 'low');
  } else {
    if (opts.temperature !== undefined) p.temperature = opts.temperature;
    if (opts.maxTokens) p.max_tokens = opts.maxTokens;
  }
  return p;
}
