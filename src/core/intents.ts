// Deterministic intent rules: things we can answer or dispatch with zero model calls.
// Order matters. Conversational rules come first so "who are you" is never routed to
// a search tool. Unsupported rules exist so the app explains a limit instead of
// silently failing (POL-FALLBACK-011, POL-NOFAKE-010).

import type { ToolCall } from './types.ts';

export type IntentKind = 'canned' | 'tool' | 'unsupported';

export interface Intent {
  id: string;
  label: string;
  kind: IntentKind;
  re: RegExp;
  /** Canned reply text. Only read when kind === 'canned'. */
  canned?: (m: RegExpMatchArray) => string;
  /** Direct tool dispatch. Only read when kind === 'tool'. */
  tool?: (m: RegExpMatchArray) => ToolCall;
  /** Why this cannot run here. Only read when kind === 'unsupported'. */
  reason?: string;
}

export const INTENTS: Intent[] = [
  /* ---------- conversational (must precede lookup rules) ---------- */
  {
    id: 'identity',
    label: 'Identity',
    kind: 'canned',
    re: /^\s*(?:who (?:are|r) (?:you|u)|what are you|introduce yourself|your name)\b/i,
    canned: () =>
      'I am JARVIS - a local-first agent workspace. I run in your browser, keep your data on-device by default, and call out to a model provider only when you have configured one. I can plan, use tools, run code in a sandbox, and remember what you tell me to remember.',
  },
  {
    id: 'capabilities',
    label: 'Capabilities',
    kind: 'canned',
    re: /^\s*(?:what can you do|help me|what do you do|capabilities|commands)\b/i,
    canned: () =>
      'I can hold a conversation, run 24 tools (maths, text, data, sandboxed code, virtual files, keyless search and weather, memory), execute multi-step workflows, run a role-based crew review, and save skills and routines. Everything is on-device unless you connect a model provider or a sync server.',
  },
  {
    id: 'greeting',
    label: 'Greeting',
    kind: 'canned',
    re: /^\s*(?:hi|hey|hello|yo|good (?:morning|afternoon|evening))\b[\s!.?]*$/i,
    canned: () => 'Ready when you are. Ask a question, or give me a task and I will plan it out.',
  },
  {
    id: 'thanks',
    label: 'Thanks',
    kind: 'canned',
    re: /^\s*(?:thanks|thank you|ty|cheers|nice work|great)\b[\s!.?]*$/i,
    canned: () => 'Any time.',
  },
  {
    id: 'privacy-question',
    label: 'Privacy',
    kind: 'canned',
    re: /\b(?:where is my data|do you store|is this private|who can see my)\b/i,
    canned: () =>
      'Conversations, memory, workflows and settings live in this browser\u2019s local storage. Nothing is sent anywhere until you configure a model provider, and outbound payloads are scanned for credentials first. If you connect your sync server, rows are written under your GitHub account.',
  },

  /* ---------- direct tool dispatch ---------- */
  {
    id: 'math',
    label: 'Arithmetic',
    kind: 'tool',
    re: /^\s*(?:what(?:'s| is)\s+|calc(?:ulate)?\s+|compute\s+|=\s*)?([-+]?[\d.]+(?:\s*[-+*/^%]\s*\(?[-+]?[\d.]+\)?)+)\s*[=?]?\s*$/i,
    tool: (m) => ({ tool: 'calculator', args: { expression: m[1] } }),
  },
  {
    id: 'convert',
    label: 'Unit conversion',
    kind: 'tool',
    re: /\b(?:convert\s+)?([\d.]+)\s*(mm|cm|m|km|in|ft|yd|mi|mg|g|kg|lb|oz|ml|l|gal|cup|c|f)\b\s*(?:to|in|into)\s*(mm|cm|m|km|in|ft|yd|mi|mg|g|kg|lb|oz|ml|l|gal|cup|c|f)\b/i,
    tool: (m) => ({ tool: 'unit_convert', args: { value: Number(m[1]), from: m[2], to: m[3] } }),
  },
  {
    id: 'time',
    label: 'Date and time',
    kind: 'tool',
    re: /\b(?:what(?:'s| is) the )?(?:current )?(?:time|date)\b|\bwhat day is it\b|\btoday'?s date\b/i,
    tool: () => ({ tool: 'datetime', args: {} }),
  },
  {
    id: 'tomorrow',
    label: 'Relative date',
    kind: 'tool',
    re: /\b(?:what(?:'s| is) the date )?(tomorrow|yesterday)\b/i,
    tool: (m) => ({ tool: 'datetime', args: { offset_days: m[1].toLowerCase() === 'tomorrow' ? 1 : -1 } }),
  },
  {
    id: 'weather',
    label: 'Weather',
    kind: 'tool',
    re: /\bweather\b(?:\s+(?:in|for|at))?\s+([A-Za-z\u00c0-\u024f .'-]{2,40})/i,
    tool: (m) => ({ tool: 'weather', args: { location: m[1].trim().replace(/[?.!]$/, '') } }),
  },
  {
    id: 'weather-bare',
    label: 'Weather (no place)',
    kind: 'canned',
    re: /^\s*(?:what(?:'s| is) the )?weather\b[\s?]*$/i,
    canned: () => 'Which place? A browser tab cannot read your location without permission, so name a city and I will pull the forecast.',
  },
  {
    id: 'search',
    label: 'Search',
    kind: 'tool',
    re: /^\s*(?:search(?: for| the web for)?|look ?up|google|find out about|who was|what is a|define)\s+(?!you\b|i\b|we\b|this\b|that\b|it\b)(.{3,80})$/i,
    tool: (m) => ({ tool: 'web_search', args: { query: m[1].replace(/[?.!]+$/, '') } }),
  },
  {
    id: 'remember',
    label: 'Remember',
    kind: 'tool',
    re: /^\s*(?:remember|note|save|keep in mind)(?: that)?[:,]?\s+(.{3,300})$/i,
    tool: (m) => ({ tool: 'memory_write', args: { text: m[1], kind: 'fact' } }),
  },
  {
    id: 'recall',
    label: 'Recall',
    kind: 'tool',
    re: /^\s*(?:what do you (?:remember|know) about|recall|remind me about)\s+(.{2,80})$/i,
    tool: (m) => ({ tool: 'memory_search', args: { query: m[1].replace(/[?.!]+$/, '') } }),
  },
  {
    id: 'random',
    label: 'Random number',
    kind: 'tool',
    re: /\b(?:random|pick a) number(?:\s+between\s+(\d+)\s+and\s+(\d+))?/i,
    tool: (m) => ({ tool: 'random', args: m[1] ? { min: Number(m[1]), max: Number(m[2]) } : {} }),
  },
  {
    id: 'coinflip',
    label: 'Coin flip',
    kind: 'tool',
    re: /\b(?:flip a coin|heads or tails)\b/i,
    tool: () => ({ tool: 'random', args: { choices: 'heads,tails' } }),
  },
  {
    id: 'wordcount',
    label: 'Text stats',
    kind: 'tool',
    re: /^\s*(?:count (?:the )?words?|word count|how many words)(?: in)?[:\s]+([\s\S]{3,})$/i,
    tool: (m) => ({ tool: 'text_stats', args: { text: m[1] } }),
  },
  {
    id: 'hash',
    label: 'Hash',
    kind: 'tool',
    re: /^\s*(?:sha ?-?256|hash)(?: of)?[:\s]+(.{1,200})$/i,
    tool: (m) => ({ tool: 'hash_text', args: { text: m[1] } }),
  },
  {
    id: 'base64',
    label: 'Base64',
    kind: 'tool',
    re: /^\s*base ?64 (encode|decode)[:\s]+(.{1,400})$/i,
    tool: (m) => ({ tool: 'encode', args: { op: `base64-${m[1].toLowerCase()}`, text: m[2] } }),
  },
  {
    id: 'plan',
    label: 'Plan',
    kind: 'tool',
    re: /^\s*(?:plan|outline|break down|give me a plan for)\s+(?:how to\s+)?(.{4,120})$/i,
    tool: (m) => ({ tool: 'plan_outline', args: { goal: m[1].replace(/[?.!]+$/, '') } }),
  },
  {
    id: 'files',
    label: 'Sandbox files',
    kind: 'tool',
    re: /^\s*(?:list|show)(?: me)?(?: the)? (?:files|workspace|sandbox)\b/i,
    tool: () => ({ tool: 'fs_list', args: {} }),
  },

  /* ---------- honestly unsupported in a browser ---------- */
  {
    id: 'open-app',
    label: 'Open a desktop app',
    kind: 'unsupported',
    re: /\b(?:open|launch|start)\s+(?:the\s+)?(?:app|application|program|notepad|chrome|spotify|vscode|terminal)\b/i,
    reason:
      'I cannot launch desktop applications. A web page is sandboxed by the browser and has no process-launch capability. If you install this as a PWA it still runs inside that sandbox.',
  },
  {
    id: 'system-control',
    label: 'Control the machine',
    kind: 'unsupported',
    re: /\b(?:lock (?:the )?screen|shut ?down|restart the (?:pc|computer|machine)|volume (?:up|down)|take a screenshot)\b/i,
    reason:
      'I have no operating-system control. Browsers deliberately deny pages access to power state, input volume, screen capture without an explicit per-session permission prompt, and window management of other apps.',
  },
  {
    id: 'battery',
    label: 'Battery / system stats',
    kind: 'unsupported',
    re: /\b(?:battery (?:level|status|percent)|cpu (?:usage|temperature)|how much ram|disk space)\b/i,
    reason:
      'System telemetry is not available. The Battery Status API has been removed from most browsers for fingerprinting reasons, and CPU, RAM and disk figures are not exposed to web pages at all.',
  },
  {
    id: 'local-files',
    label: 'Real filesystem',
    kind: 'unsupported',
    re: /\b(?:open|read|delete|find)\s+(?:my|the)\s+(?:file|folder|document|downloads|desktop)\b/i,
    reason:
      'I cannot reach your real filesystem. The agent workspace is a virtual, in-memory sandbox. To work on a real file, paste its contents or drop it into a chat message and I will operate on that copy.',
  },
  {
    id: 'send-message',
    label: 'Send email or SMS',
    kind: 'unsupported',
    re: /\b(?:send (?:an? )?(?:email|text|sms|message|whatsapp)|call\s+(?:my|him|her|them))\b/i,
    reason:
      'I cannot send email, SMS or WhatsApp messages. That needs a server-side credential I deliberately do not hold in the client bundle. I can draft the message for you to send.',
  },
  {
    id: 'always-listen',
    label: 'Wake word',
    kind: 'unsupported',
    re: /\b(?:wake ?word|always listening|listen for my voice|hey jarvis mode)\b/i,
    reason:
      'There is no wake word. Continuous background listening is not something a web page can do honestly - it cannot run while the tab is closed, and it would keep the microphone open. Use the mic button for one-shot dictation instead.',
  },
];

export interface IntentMatch {
  intent: Intent;
  match: RegExpMatchArray;
  /** Explicit flag - never overload another field to mean "this is a canned reply". */
  canned: boolean;
  text?: string;
  call?: ToolCall;
  reason?: string;
}

export function matchIntent(input: string): IntentMatch | null {
  const text = input.trim();
  if (!text || text.length > 600) return null;
  for (const intent of INTENTS) {
    const m = text.match(intent.re);
    if (!m) continue;
    if (intent.kind === 'canned') return { intent, match: m, canned: true, text: intent.canned?.(m) ?? '' };
    if (intent.kind === 'tool') return { intent, match: m, canned: false, call: intent.tool?.(m) };
    return { intent, match: m, canned: true, text: intent.reason, reason: intent.reason };
  }
  return null;
}

export const INTENT_COUNT = INTENTS.length;
export const supportedIntents = (): Intent[] => INTENTS.filter((i) => i.kind !== 'unsupported');
export const unsupportedIntents = (): Intent[] => INTENTS.filter((i) => i.kind === 'unsupported');
