// Model transport. One adapter per provider, a common streaming contract, and an
// honest fallback chain. No React / DOM imports.
//
// Design note (carried from the previous build's field notes): the keyless
// pollinations endpoint rejects system roles, multi-turn history, long prompts and
// native tool arrays. Rather than pretending otherwise, its capability flags below
// declare those limits and the caller degrades the request to match.

import type { ChatRequest, ChatResult, ProviderConfig, ProviderCreds, ProviderId, ProviderSpec, ToolSpec, Msg } from './types.ts';
import { estTokens } from './util.ts';
import { splitDataUrl } from './attach.ts';

/**
 * Every entry below had its CORS preflight probed from a real browser origin on
 * 2026-09-04 before being listed -- see docs/providers.md for the raw results.
 * Two candidates were rejected by that probe rather than shipped on faith:
 * GitHub Models (HTTP 410, "github_models_retirement_brownout") and NVIDIA NIM
 * / SambaNova (preflight passes but no Access-Control-Allow-Origin, so a
 * browser cannot read the reply). Listing them would be a lie the user only
 * discovers on first use.
 */
export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'groq',
    label: 'Groq',
    note: 'Free tier, very fast, open models (Llama 3.3, Qwen, Kimi). Recommended default.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Free tier, no card. Per-minute and per-day request caps.',
    keyUrl: 'https://console.groq.com/keys',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    note: 'Free tier via AI Studio. Large context window.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Free tier, no card. Daily request cap per model.',
    keyUrl: 'https://aistudio.google.com/apikey',
    model: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'],
    nativeTools: false,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    note: 'Free tier with the largest daily token budget of any provider, and the fastest output.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Roughly 1M tokens/day free, no card. 30 requests/min.',
    keyUrl: 'https://cloud.cerebras.ai',
    model: 'llama-3.3-70b',
    models: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'gpt-oss-120b'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    note: 'Free "Experiment" tier covering every Mistral model. Slow rate limit, big monthly budget.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Free tier, phone verification, about 1 request/second.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    model: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'codestral-latest', 'open-mistral-nemo'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'zhipu',
    label: 'Z.ai / Zhipu GLM',
    note: 'GLM Flash models are free to call. Servers are in mainland China; latency varies.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Flash-class models free; larger GLM models are paid.',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-flashx', 'glm-4-air'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    note: 'Router endpoint in front of many open models. Small monthly credit on a free account.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Small monthly inference credit; PRO raises it.',
    keyUrl: 'https://huggingface.co/settings/tokens',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    note: 'A handful of models are permanently free: Qwen3-8B and a distilled DeepSeek-R1. No card needed.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Free models are rate limited per model. The free tier is reportedly unavailable in the EU, UK and Switzerland.',
    keyUrl: 'https://cloud.siliconflow.com/account/ak',
    model: 'Qwen/Qwen3-8B',
    models: ['Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', 'Qwen/Qwen2.5-7B-Instruct'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'cohere',
    label: 'Cohere',
    note: 'Trial keys are free forever, with a low rate limit. Reached through the OpenAI-compatible endpoint.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Trial keys are limited to roughly 20 calls a minute and 1,000 a month, and may not be used in production.',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    model: 'command-r7b-12-2024',
    models: ['command-r7b-12-2024', 'command-r-plus-08-2024', 'command-a-03-2025'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen',
    note: 'DashScope international. New accounts get a free token quota per model.',
    needsKey: true,
    free: false,
    tier: 'trial',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'A free quota per model for new accounts, then paid.',
    keyUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    note: 'Signup credit, then pay as you go. Wide open-model catalogue.',
    needsKey: true,
    free: false,
    tier: 'trial',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'A small signup credit, then paid per token.',
    keyUrl: 'https://deepinfra.com/dash/api_keys',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    models: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'meta-llama/Meta-Llama-3.1-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'novita',
    label: 'Novita AI',
    note: 'Signup credit, then pay as you go.',
    needsKey: true,
    free: false,
    tier: 'trial',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'A small signup credit, then paid per token.',
    keyUrl: 'https://novita.ai/settings/key-management',
    model: 'meta-llama/llama-3.1-8b-instruct',
    models: ['meta-llama/llama-3.1-8b-instruct', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'chutes',
    label: 'Chutes',
    note: 'Open models on donated GPUs. The free tier was retired in 2026 and now needs a one-off deposit.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'A one-off deposit unlocks a daily request allowance; beyond that it is pay as you go.',
    keyUrl: 'https://chutes.ai/app/api',
    model: 'deepseek-ai/DeepSeek-V3-0324',
    models: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.1-70B-Instruct'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    note: 'Aggregator. Models tagged :free cost nothing, but a key is still required.',
    needsKey: true,
    free: true,
    tier: 'free',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: ':free models capped at a low daily request count.',
    keyUrl: 'https://openrouter.ai/keys',
    model: 'deepseek/deepseek-chat-v3-0324:free',
    models: ['deepseek/deepseek-chat-v3-0324:free', 'google/gemma-2-9b-it:free', 'meta-llama/llama-3.3-70b-instruct'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'nebius',
    label: 'Nebius AI Studio',
    note: 'Open models on European infrastructure. Starter credit rather than a standing free tier.',
    needsKey: true,
    free: false,
    tier: 'trial',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Signup credit; pay-as-you-go once spent.',
    keyUrl: 'https://studio.nebius.com',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'together',
    label: 'Together AI',
    note: 'Wide open-model catalogue. Starter credit, then paid.',
    needsKey: true,
    free: false,
    tier: 'trial',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'Signup credit only; no standing free tier.',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    note: 'Paid, but among the cheapest per token. Strong at reasoning and code.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    note: 'Paid. New accounts usually start with signup credit.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    keyUrl: 'https://console.x.ai',
    model: 'grok-3-mini',
    models: ['grok-3-mini', 'grok-3', 'grok-4-fast-non-reasoning'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    note: 'Paid. Answers are grounded in a live web search, which the other providers cannot do.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    model: 'sonar',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning'],
    nativeTools: false,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    note: 'Paid. Bring your own key; billed to your account.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    keyUrl: 'https://platform.openai.com/api-keys',
    model: 'gpt-5.6-luna',
    models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.4-nano', 'gpt-4o-mini', 'gpt-4o'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    note: 'Paid. Direct browser calls require the CORS opt-in header, sent automatically.',
    needsKey: true,
    free: false,
    tier: 'paid',
    cors: 'verified',
    probed: '2026-09-04',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    model: 'claude-3-5-haiku-latest',
    models: ['claude-3-5-haiku-latest', 'claude-sonnet-4-20250514'],
    nativeTools: false,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    note: 'Self-hosted. Set the base URL; the host must send permissive CORS headers.',
    needsKey: false,
    free: true,
    tier: 'local',
    cors: 'local',
    model: 'llama3.2',
    models: ['llama3.2', 'qwen2.5', 'mistral'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    note: 'Self-hosted. Start the local server, then enable CORS in its settings.',
    needsKey: false,
    free: true,
    tier: 'local',
    cors: 'local',
    model: 'local-model',
    models: ['local-model'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    note: 'Any endpoint that speaks /v1/chat/completions. Paste the base URL and an optional key.',
    needsKey: false,
    free: true,
    tier: 'keyless',
    cors: 'unverified',
    model: 'default',
    models: ['default'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'edge',
    label: 'Edge proxy',
    note: 'Keeps the model key server-side. Deploy an edge function and point here.',
    needsKey: false,
    free: true,
    tier: 'keyless',
    cors: 'local',
    model: 'server-default',
    models: ['server-default'],
    nativeTools: true,
    systemRole: true,
    multiTurn: true,
  },
  {
    id: 'pollinations',
    label: 'Keyless fallback',
    note: 'No key, no signup, heavily rate limited. Single-turn only, no system prompt, no native tools.',
    needsKey: false,
    free: true,
    tier: 'keyless',
    cors: 'verified',
    probed: '2026-09-04',
    allowance: 'No account. Returns 403 from some networks.',
    model: 'openai-fast',
    models: ['openai-fast'],
    nativeTools: false,
    systemRole: false,
    multiTurn: false,
  },
  {
    id: 'reflex',
    label: 'Reflex core (offline)',
    note: 'On-device rule engine. Always available, never leaves the browser.',
    needsKey: false,
    free: true,
    tier: 'keyless',
    cors: 'local',
    model: 'reflex-1',
    models: ['reflex-1'],
    nativeTools: false,
    systemRole: true,
    multiTurn: true,
  },
];

/** Providers a user can pick as their main brain, best free options first. */
export const SELECTABLE = PROVIDERS.filter((p) => p.id !== 'reflex' && p.id !== 'pollinations');

export const specOf = (id: ProviderId): ProviderSpec =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

export const isConfigured = (c: ProviderConfig): boolean => {
  const s = specOf(c.id);
  if (s.needsKey) return !!(c.key && c.key.trim().length > 8);
  if (c.id === 'ollama' || c.id === 'lmstudio' || c.id === 'edge' || c.id === 'custom') {
    return !!(c.baseUrl && c.baseUrl.startsWith('http'));
  }
  return true;
};

/**
 * "Has the user actually set this up?" — deliberately stricter than isConfigured.
 *
 * isConfigured answers "can we attempt a call", which is what the fallback chain
 * needs, and a local provider passes it as soon as a default localhost URL is
 * merged in. That is not a connection: nothing may be listening on that port.
 * UI counts must use this instead, or the app claims connections it does not have.
 */
export const hasCredential = (
  id: ProviderId,
  keyring: Partial<Record<ProviderId, ProviderCreds>> = {},
): boolean => {
  const entry = keyring[id];
  if (!entry) return false;
  const spec = specOf(id);
  if (spec.needsKey) return !!(entry.key && entry.key.trim().length > 8);
  if (id === 'ollama' || id === 'lmstudio' || id === 'edge' || id === 'custom') {
    return !!(entry.baseUrl && entry.baseUrl.startsWith('http'));
  }
  return true;
};

/** Default local base URLs, so the two self-hosted options are one tap to set up. */
export const DEFAULT_BASE_URL: Partial<Record<ProviderId, string>> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

/* ------------------------------------------------------------------ */
/* Text tool protocol                                                  */
/* ------------------------------------------------------------------ */

/** Extract ```tool fenced blocks (and bare {"tool":...} objects) from model text. */
/**
 * Scans for balanced top-level `{...}` objects, skipping over string literals
 * so a brace inside a quoted value cannot end the object early. This is what
 * lets a nested `args` object survive without a recursive regex.
 */
function scanJsonObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let quote = '';
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        found.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    }
  }
  return found;
}

/**
 * Tolerant by design. Weak models drift on key names constantly, and every
 * alias accepted here is a retry the user does not pay for. Malformed JSON is
 * ignored rather than thrown - a broken block must never take down a turn.
 *
 * Accepts: ```tool and ```json fences, bare objects anywhere in the prose,
 * `tool` / `name` / `tool_name` / `command`, and
 * `args` / `arguments` / `parameters` / `input`.
 */
export function parseToolCalls(text: string): { tool: string; args: Record<string, unknown> }[] {
  const out: { tool: string; args: Record<string, unknown> }[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // malformed block, ignored on purpose
    }
    if (typeof o !== 'object' || o === null) return;

    const tool = ['tool', 'name', 'tool_name', 'command'].map((k) => o[k]).find((v) => typeof v === 'string' && v.length > 0) as
      | string
      | undefined;
    if (!tool) return;

    const rawArgs = ['args', 'arguments', 'parameters', 'input'].map((k) => o[k]).find((v) => v !== undefined);
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return;

    // Structural de-dupe: key order must not create a phantom second call.
    const k = `${tool}|${JSON.stringify(args, Object.keys(args).sort())}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ tool, args });
  };

  // Fenced blocks first - they are the documented protocol.
  const fence = /```(?:tool|json)?[^\S\n]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let fenced = '';
  while ((m = fence.exec(text))) {
    fenced += m[1];
    for (const obj of scanJsonObjects(m[1])) push(obj);
  }

  // Then bare objects in the surrounding prose. Content already seen inside a
  // fence is skipped so one call is not counted twice.
  for (const obj of scanJsonObjects(text)) {
    if (fenced.includes(obj)) continue;
    if (!/"(?:tool|name|tool_name|command)"\s*:/.test(obj)) continue;
    push(obj);
  }

  return out;
}

/** Remove tool blocks from prose so the user never sees raw protocol. */
export function stripToolBlocks(text: string): string {
  return text
    .replace(/```(?:tool|json)?\s*\n[\s\S]*?```/g, '')
    .replace(/^\s*\{\s*"(?:tool|name)"[\s\S]*?\}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toolProtocolPrompt(tools: ToolSpec[]): string {
  if (!tools.length) return '';
  const list = tools
    .map((t) => `- ${t.name}(${t.params.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ')}) - ${t.desc}`)
    .join('\n');
  return [
    'You can call tools. To call one, emit a fenced block exactly like this and stop:',
    '```tool',
    '{"tool":"calculator","args":{"expression":"2+2"}}',
    '```',
    'Emit one block per call; several blocks run in parallel. After results arrive, answer in plain prose.',
    'Never describe a tool result you did not receive.',
    '',
    'Available tools:',
    list,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

type WirePart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface Wire {
  role: string;
  content: string | WirePart[];
}

/** OpenAI-style content: a plain string unless the turn carries images. */
function partsFor(m: Msg): string | WirePart[] {
  if (!m.images?.length) return m.content;
  return [{ type: 'text', text: m.content }, ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
}

const usableMessages = (messages: Msg[]): Msg[] => messages.filter((m) => m.role !== 'system' && (m.content.trim() || m.images?.length));

function toWire(messages: Msg[], spec: ProviderSpec, system?: string): Wire[] {
  const usable = usableMessages(messages);
  if (!spec.multiTurn) {
    const last = usable[usable.length - 1];
    return last ? [{ role: 'user', content: partsFor(last) }] : [];
  }
  const wire: Wire[] = usable.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: partsFor(m) }));
  if (system && spec.systemRole) wire.unshift({ role: 'system', content: system });
  else if (system && wire.length) {
    const first = wire[0].content;
    wire[0] = typeof first === 'string'
      ? { role: 'user', content: `${system}\n\n---\n\n${first}` }
      : { role: 'user', content: [{ type: 'text', text: `${system}\n\n---\n\n` }, ...first] };
  }
  return wire;
}

/**
 * Per-chunk idle ceiling. A tier that accepts the connection and then goes
 * quiet used to hold a whole turn hostage for minutes; now it fails fast and
 * the chain falls through to the next provider. Kept well above a slow-but-
 * alive stream so a working tier is never killed by mistake.
 */
export const STREAM_IDLE_MS = 20_000;

export class StreamTimeout extends Error {
  constructor(ms: number) {
    super(`The model stopped sending data for ${Math.round(ms / 1000)}s.`);
    this.name = 'StreamTimeout';
  }
}

async function readSSE(
  res: Response,
  onDelta: (chunk: string) => void,
  pick: (json: unknown) => string,
  idleMs: number = STREAM_IDLE_MS,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no response body');
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    // Race each read against the idle timer rather than timing the whole
    // stream, so a long but healthy answer is never cut off.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StreamTimeout(idleMs)), idleMs);
    });
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await Promise.race([reader.read(), idle]);
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const { done, value } = chunk;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        onDelta(pick(JSON.parse(payload)));
      } catch {
        /* partial frame */
      }
    }
  }
}

interface OAIDelta {
  choices?: { delta?: { content?: string; tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[] } }[];
}

/**
 * Every OpenAI-compatible host in one table. Adding a provider is a row here
 * plus a spec entry -- no new adapter, which is why the list can grow without
 * the transport layer growing with it.
 */
const OPENAI_HOSTS: Partial<Record<ProviderId, string>> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  huggingface: 'https://router.huggingface.co/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
  cohere: 'https://api.cohere.ai/compatibility/v1/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
  novita: 'https://api.novita.ai/v3/openai/chat/completions',
  chutes: 'https://llm.chutes.ai/v1/chat/completions',
  nebius: 'https://api.studio.nebius.com/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
};

function openAIBase(id: ProviderId, cfg: ProviderConfig): { url: string; headers: Record<string, string> } {
  const base = (cfg.baseUrl ?? '').replace(/\/$/, '');
  switch (id) {
    case 'ollama':
    case 'lmstudio':
      return { url: `${base || DEFAULT_BASE_URL[id]}/v1/chat/completions`, headers: {} };
    case 'custom': {
      // Accept either a bare host or a full completions URL, since users paste both.
      const url = /\/(chat\/)?completions$/.test(base) ? base : `${base}/v1/chat/completions`;
      return { url, headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {} };
    }
    case 'edge':
      return { url: base, headers: {} };
    default: {
      const url = OPENAI_HOSTS[id];
      return url ? { url, headers: { Authorization: `Bearer ${cfg.key}` } } : { url: '', headers: {} };
    }
  }
}

async function callOpenAICompatible(req: ChatRequest, spec: ProviderSpec): Promise<ChatResult> {
  const { url, headers } = openAIBase(spec.id, req.provider);
  const useNative = spec.nativeTools && !!req.tools?.length;
  const system = useNative ? req.system : [req.system, toolProtocolPrompt(req.tools ?? [])].filter(Boolean).join('\n\n');
  const body: Record<string, unknown> = {
    model: req.provider.model || spec.model,
    messages: toWire(req.messages, spec, system),
    stream: true,
    temperature: req.temperature ?? 0.6,
  };
  if (useNative) {
    body.tools = (req.tools ?? []).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.desc,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(t.params.map((p) => [p.name, { type: p.type, description: p.desc }])),
          required: t.params.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`${spec.label} HTTP ${res.status}${res.status === 401 ? ' - check your API key' : ''}`);

  let text = '';
  const partial = new Map<number, { name: string; args: string }>();
  await readSSE(res, (chunk) => {
    if (chunk) {
      text += chunk;
      req.onToken?.(chunk);
    }
  }, (json) => {
    const d = json as OAIDelta;
    const delta = d.choices?.[0]?.delta;
    for (const tc of delta?.tool_calls ?? []) {
      const slot = partial.get(tc.index) ?? { name: '', args: '' };
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      partial.set(tc.index, slot);
    }
    return delta?.content ?? '';
  });

  const toolCalls = [...partial.values()]
    .filter((p) => p.name)
    .map((p) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(p.args || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { tool: p.name, args };
    });
  const parsed = toolCalls.length ? toolCalls : parseToolCalls(text);
  return { text: stripToolBlocks(text), via: spec.id, toolCalls: parsed };
}

async function callGemini(req: ChatRequest, spec: ProviderSpec): Promise<ChatResult> {
  const model = req.provider.model || spec.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.provider.key ?? '')}`;
  const system = [req.system, toolProtocolPrompt(req.tools ?? [])].filter(Boolean).join('\n\n');
  const contents = usableMessages(req.messages).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      { text: m.content || ' ' },
      ...(m.images ?? []).map((u) => splitDataUrl(u)).filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ inline_data: { mime_type: p.mime, data: p.data } })),
    ],
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { temperature: req.temperature ?? 0.6 },
    }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}${res.status === 400 ? ' - check your API key' : ''}`);
  let text = '';
  await readSSE(res, (c) => {
    if (c) {
      text += c;
      req.onToken?.(c);
    }
  }, (json) => {
    const g = json as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return g.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  });
  return { text: stripToolBlocks(text), via: 'gemini', toolCalls: parseToolCalls(text) };
}

async function callAnthropic(req: ChatRequest, spec: ProviderSpec): Promise<ChatResult> {
  const system = [req.system, toolProtocolPrompt(req.tools ?? [])].filter(Boolean).join('\n\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.provider.key ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: req.provider.model || spec.model,
      max_tokens: 2048,
      stream: true,
      system: system || undefined,
      messages: req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [
              ...m.images.map((u) => splitDataUrl(u)).filter((p): p is NonNullable<typeof p> => !!p)
                .map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })),
              { type: 'text', text: m.content || 'Describe this.' },
            ]
            : m.content,
        })),
    }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}${res.status === 401 ? ' - check your API key' : ''}`);
  let text = '';
  await readSSE(res, (c) => {
    if (c) {
      text += c;
      req.onToken?.(c);
    }
  }, (json) => {
    const a = json as { type?: string; delta?: { text?: string } };
    return a.type === 'content_block_delta' ? a.delta?.text ?? '' : '';
  });
  return { text: stripToolBlocks(text), via: 'anthropic', toolCalls: parseToolCalls(text) };
}

/** Keyless endpoint. Single turn, no system role, prompt kept short on purpose. */
async function callPollinations(req: ChatRequest): Promise<ChatResult> {
  const last = [...req.messages].reverse().find((m) => m.role === 'user');
  if (!last) throw new Error('nothing to send');
  const protocol = toolProtocolPrompt(req.tools ?? []);
  let content = req.system || protocol ? `${[req.system, protocol].filter(Boolean).join('\n')}\n\nUser: ${last.content}` : last.content;
  if (content.length > 560) content = `${content.slice(0, 557)}...`;
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai-fast', stream: true, messages: [{ role: 'user', content }] }),
    signal: req.signal,
  });
  if (!res.ok) {
    // Report the status, and only name a cause the status actually supports.
    // Blaming every failure on rate limiting hides real outages.
    const why =
      res.status === 429 ? ' (rate limited)'
      : res.status === 402 ? ' (this endpoint refuses the request shape)'
      : res.status === 403 ? ' (blocked for this network)'
      : res.status >= 500 ? ' (the endpoint is failing, not your setup)'
      : '';
    throw new Error(`Keyless endpoint HTTP ${res.status}${why}`);
  }
  let text = '';
  await readSSE(res, (c) => {
    if (c) {
      text += c;
      req.onToken?.(c);
    }
  }, (json) => (json as OAIDelta).choices?.[0]?.delta?.content ?? '');
  if (!text.trim()) throw new Error('Keyless endpoint returned an empty response');
  return { text: stripToolBlocks(text), via: 'pollinations', toolCalls: parseToolCalls(text), degraded: true };
}

export async function callProvider(req: ChatRequest): Promise<ChatResult> {
  const spec = specOf(req.provider.id);
  switch (spec.id) {
    case 'gemini':
      return callGemini(req, spec);
    case 'anthropic':
      return callAnthropic(req, spec);
    case 'pollinations':
      return callPollinations(req);
    case 'reflex':
      throw new Error('reflex is handled by the caller');
    default:
      // Everything else speaks the OpenAI wire format.
      return callOpenAICompatible(req, spec);
  }
}

export interface ChainHop {
  provider: ProviderId;
  ok: boolean;
  error?: string;
  ms: number;
}

/**
 * Build the ordered list of providers to attempt.
 *
 * Rules, in order: the explicitly requested provider always goes first; then
 * each configured provider from the user's ranked chain; then the keyless
 * endpoint if allowed. Unconfigured providers are dropped here rather than
 * failing later, so the chain reported to the UI only contains real attempts.
 */
export function buildChain(
  primary: ProviderConfig,
  ranked: ProviderConfig[] = [],
  opts: { allowKeyless?: boolean } = {},
): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  const seen = new Set<ProviderId>();
  const add = (c: ProviderConfig) => {
    if (seen.has(c.id) || c.id === 'reflex') return;
    seen.add(c.id);
    out.push(c);
  };
  if (isConfigured(primary)) add(primary);
  for (const c of ranked) if (isConfigured(c)) add(c);
  // An unconfigured primary is still worth reporting, so the user learns why
  // nothing happened instead of silently getting the fallback.
  if (!out.length) add(primary);
  if (opts.allowKeyless !== false) add({ id: 'pollinations' });
  return out;
}

/**
 * Walk the chain until one provider answers. Every hop is reported, so the UI
 * can show which brain actually produced the words on screen.
 */
export async function chatWithFallback(
  req: ChatRequest,
  opts: {
    allowKeyless?: boolean;
    /** Fired after each hop, with its outcome. */
    onHop?: (h: ChainHop) => void;
    /** Fired *before* each attempt, so a caller can say what it is waiting on. */
    onAttempt?: (id: ProviderId) => void;
    chain?: ProviderConfig[];
  } = {},
): Promise<ChatResult & { chain: ChainHop[] }> {
  const chain: ChainHop[] = [];
  const order = buildChain(req.provider, opts.chain ?? [], { allowKeyless: opts.allowKeyless });
  let lastErr = 'no provider available';
  for (const p of order) {
    if (p.id === 'reflex') break;
    if (!isConfigured(p)) {
      const hop = { provider: p.id, ok: false, error: 'not configured', ms: 0 };
      chain.push(hop);
      opts.onHop?.(hop);
      lastErr = `${specOf(p.id).label} is not configured`;
      continue;
    }
    const t0 = Date.now();
    opts.onAttempt?.(p.id);
    try {
      const r = await callProvider({ ...req, provider: p });
      if (!r.text.trim() && !r.toolCalls.length) throw new Error('empty response');
      const hop = { provider: p.id, ok: true, ms: Date.now() - t0 };
      chain.push(hop);
      opts.onHop?.(hop);
      return { ...r, chain };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('abort')) throw e;
      const hop = { provider: p.id, ok: false, error: msg, ms: Date.now() - t0 };
      chain.push(hop);
      opts.onHop?.(hop);
      lastErr = msg;
    }
  }
  return { text: '', via: 'reflex', toolCalls: [], degraded: true, error: lastErr, chain };
}

export interface ProbeResult {
  ok: boolean;
  ms: number;
  detail: string;
  /** Set when the browser blocked the call rather than the provider rejecting it. */
  cors?: boolean;
}

/**
 * Send the smallest possible real request to check a key actually works.
 * A key that looks right but 401s is the single most common setup failure, and
 * finding out mid-conversation is the worst time to learn it.
 */
export async function probeProvider(cfg: ProviderConfig, signal?: AbortSignal): Promise<ProbeResult> {
  const spec = specOf(cfg.id);
  const t0 = Date.now();
  if (spec.id === 'reflex') return { ok: true, ms: 0, detail: 'The offline core is always available.' };
  if (!isConfigured(cfg)) {
    return { ok: false, ms: 0, detail: spec.needsKey ? 'No API key saved yet.' : 'No base URL saved yet.' };
  }
  try {
    const res = await callProvider({
      provider: cfg,
      messages: [{ id: 'probe', role: 'user', content: 'Reply with the single word: ready', ts: Date.now() }],
      system: 'Answer with one word.',
      temperature: 0,
      signal,
    });
    const ms = Date.now() - t0;
    const text = res.text.trim();
    if (!text) return { ok: false, ms, detail: 'Connected, but the model returned nothing.' };
    return { ok: true, ms, detail: `Replied in ${ms} ms: "${text.slice(0, 40)}"` };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    // A browser CORS rejection surfaces as an opaque TypeError, never as a status.
    const cors = /failed to fetch|networkerror|load failed/i.test(msg);
    return {
      ok: false,
      ms,
      cors,
      detail: cors
        ? 'The browser blocked the response. This host does not allow direct calls from a web page; use an edge proxy instead.'
        : msg,
    };
  }
}

export const countTokens = (messages: Msg[]): number =>
  messages.reduce((n, m) => n + estTokens(m.content), 0);
