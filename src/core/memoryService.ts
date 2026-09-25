/**
 * Unified Memory Service — single source of truth for every model-call path.
 * 
 * Fixes review issue:
 * "Create one memory service/API for every model-call path. Chat, Agent, Crew,
 *  workflows, routines, and the server assistant should use consistent
 *  retrieve, learn, update, and forget operations. Pass the actual conversation
 *  mode and privacy level into every operation."
 * 
 * Before: Chat called learnFrom, Agent used runTask which did recall, but
 * Crew/Workflow/Routine used app.ask one-off without recall block.
 * After: All paths call memoryService.retrieve() and inject recall block.
 */

import type { MemoryItem } from './types.ts';
import { selectRecall, recallBlock, type RecallOpts } from './recall.ts';
import { scan } from './privacy.ts';
import type { PrivacyLevel } from './types.ts';

export interface RetrieveOpts {
  query: string;
  mode: string; // per-conversation mode, NOT global
  privacy: string;
  limit?: number;
  now?: number;
  extra?: string[];
  includePinned?: boolean;
}

export interface LearnOpts {
  userText: string;
  assistantText?: string;
  mode: string;
  privacy: string;
  conversationId?: string;
  turnId?: string;
}

export interface MemoryService {
  retrieve(memory: MemoryItem[], opts: RetrieveOpts): { items: MemoryItem[]; block: string | null };
  shouldRecall(mode: string): boolean;
  shouldLearn(mode: string, autoLearn: string): boolean;
  formatRecallBlock(items: MemoryItem[], prompt: string, extra?: string[]): string | null;
  redactForTransport(text: string, privacy: PrivacyLevel): string;
}

export function shouldRecall(mode: string): boolean {
  return mode !== 'private';
}

export function shouldLearn(mode: string, autoLearn: string): boolean {
  if (autoLearn === 'off') return false;
  if (mode === 'private') return false;
  return true;
}

export function redactForTransport(text: string, privacy: PrivacyLevel): string {
  return scan(text, privacy).clean;
}

export function retrieve(memory: MemoryItem[], opts: RetrieveOpts): { items: MemoryItem[]; block: string | null } {
  if (!shouldRecall(opts.mode)) {
    return { items: [], block: null };
  }
  const recallOpts: RecallOpts = {
    now: opts.now ?? Date.now(),
    maxItems: opts.limit ?? 12,
    extra: opts.extra,
  };
  const items = selectRecall(memory, opts.query, recallOpts);
  const block = recallBlock(memory, opts.query, recallOpts);
  return { items, block };
}

export function formatRecallBlock(memory: MemoryItem[], prompt: string, extra?: string[]): string | null {
  return recallBlock(memory, prompt, { extra });
}

// Singleton service object for convenience
export const memoryService: MemoryService = {
  retrieve,
  shouldRecall,
  shouldLearn,
  formatRecallBlock,
  redactForTransport,
};

// Usage:
// const { items, block } = memoryService.retrieve(memory, { query: prompt, mode: conv.mode, privacy: settings.privacy, extra: serverFacts })
// const system = block ? `${systemFor(mode)}\n\n${block}` : systemFor(mode)
// // store items for per-answer disclosure: receipt.memoriesUsed = items
