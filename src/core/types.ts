// Framework-independent shared types. No React / DOM-framework imports (POL-PORTABLE-019).

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface Msg {
  id: string;
  role: Role;
  content: string;
  ts: number;
  /** Tool invocations attached to an assistant turn. */
  calls?: ToolCallRecord[];
  /** Which provider answered, for honest attribution in the UI. */
  via?: string;
  /** Model reported an error / degraded path. */
  degraded?: boolean;
  /** This mode recommended another one for the request. */
  switchHint?: { id: string; reason: string; applied?: boolean };
  /** This mode recommended a different model tier. Advisory only. */
  modelHint?: { tier: string; reason: string };
  pending?: boolean;
  /** Images attached for this turn only (data URLs). Stripped before persistence. */
  images?: string[];
  /** What was attached, kept after the pixels are dropped. */
  attached?: { kind: 'image'; bytes: number }[];
  /** Honest per-answer accounting, rendered as receipt pills under the bubble. */
  receipt?: {
    ms?: number;
    mode?: string;
    steps?: number;
    tools?: number;
    tokensIn?: number;
    tokensOut?: number;
    offline?: boolean;
  };
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: Msg[];
  mode: string;
  /** Set when the row has been pushed to the cloud. */
  synced?: number;
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export type ProviderId =
  | 'groq'
  | 'gemini'
  | 'cerebras'
  | 'mistral'
  | 'zhipu'
  | 'huggingface'
  | 'siliconflow'
  | 'cohere'
  | 'qwen'
  | 'deepinfra'
  | 'novita'
  | 'chutes'
  | 'openrouter'
  | 'nebius'
  | 'together'
  | 'deepseek'
  | 'xai'
  | 'perplexity'
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'lmstudio'
  | 'custom'
  | 'edge'
  | 'pollinations'
  | 'reflex';

/**
 * What the account costs at the point of use. `free` means a standing free
 * tier with no card; `trial` means starter credit that runs out; `local` means
 * it runs on your own hardware. Never label a paid API 'free'.
 */
export type ProviderTier = 'free' | 'trial' | 'paid' | 'local' | 'keyless';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Human note shown in Settings. */
  note: string;
  /** True when the provider needs a user-supplied key. */
  needsKey: boolean;
  /** True when the provider is free at the point of use. */
  free: boolean;
  /** Finer-grained cost story than `free`, shown as a chip in Settings. */
  tier: ProviderTier;
  /**
   * Browser reachability. A provider is only listed once its CORS preflight has
   * been probed from a real origin -- see docs/providers.md for the evidence.
   */
  cors: 'verified' | 'unverified' | 'local';
  /** Date the CORS probe last ran, ISO yyyy-mm-dd. */
  probed?: string;
  /** Short note on what the free allowance actually is. */
  allowance?: string;
  /** Where to get a free key. */
  keyUrl?: string;
  /** Default model id. */
  model: string;
  /** Alternative model ids the user can pick. */
  models: string[];
  /** Supports the OpenAI-style native tools array. */
  nativeTools: boolean;
  /** Supports a system role. */
  systemRole: boolean;
  /** Supports multi-turn history. */
  multiTurn: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  key?: string;
  model?: string;
  baseUrl?: string;
}

/** Stored credentials for one provider. The key never leaves the device unless
 *  cloud sync is on AND the user has opted into syncing keys. */
export interface ProviderCreds {
  key?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * An optional third-party key that upgrades a tool rather than the model. Each
 * one is additive: the tool works without it, and works better with it.
 */
export type ServiceId = 'tavily' | 'github' | 'nasa' | 'openweather';

export interface ServiceSpec {
  id: ServiceId;
  label: string;
  /** What the user gets by adding this key. */
  unlocks: string;
  /** What still works with no key at all. */
  withoutKey: string;
  keyUrl: string;
  free: boolean;
  tools: string[];
}

export interface ChatRequest {
  provider: ProviderConfig;
  messages: Msg[];
  system?: string;
  tools?: ToolSpec[];
  signal?: AbortSignal;
  temperature?: number;
  onToken?: (t: string) => void;
}

export interface ChatResult {
  text: string;
  via: ProviderId;
  toolCalls: ToolCall[];
  degraded?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export type ToolClass = 'A' | 'B' | 'C' | 'D';

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  desc: string;
}

export interface ToolSpec {
  name: string;
  group: string;
  desc: string;
  params: ToolParam[];
  /** Effect class per the build spec. C/D require approval. */
  effect: ToolClass;
  /** Requires network egress -> blocked under STRICT privacy. */
  network?: boolean;
  /** Never auto-runs; the user must approve each call. */
  approval?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolOutput>;
}

export interface ToolOutput {
  ok: boolean;
  summary: string;
  data?: unknown;
  /** Rendered as a code block when present. */
  detail?: string;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallRecord extends ToolCall {
  id: string;
  ok: boolean;
  summary: string;
  detail?: string;
  ms: number;
  blocked?: boolean;
  reason?: string;
}

export interface ToolCtx {
  /** Virtual sandbox filesystem (AGT-001: no host FS access). */
  fs: Record<string, string>;
  writeFs: (path: string, content: string) => void;
  deleteFs: (path: string) => void;
  privacy: PrivacyLevel;
  /** Resolve an approval request; returns false when denied. */
  approve: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  log: (line: string) => void;
  memory: MemoryStore;
  now: () => number;
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
  /**
   * An optional third-party key, or '' when the user has not added one. Tools
   * must degrade to their keyless path rather than failing when this is empty.
   */
  serviceKey: (id: ServiceId) => string;
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

export type PrivacyLevel = 'STRICT' | 'GUARDED' | 'OPEN';

export interface Redaction {
  label: string;
  count: number;
}

export interface ScanResult {
  clean: string;
  findings: Redaction[];
}

/* ------------------------------------------------------------------ */
/* Agent loop                                                          */
/* ------------------------------------------------------------------ */

export type StepKind = 'think' | 'route' | 'act' | 'observe' | 'respond' | 'error' | 'budget';

export interface LoopStep {
  kind: StepKind;
  label: string;
  detail?: string;
  ts: number;
  ms?: number;
}

export interface AgentMode {
  id: string;
  name: string;
  blurb: string;
  /** When you would actually reach for this mode. Shown on the Modes screen. */
  when: string;
  icon: string;
  maxSteps: number;
  toolBudget: number;
  temperature: number;
  /** Tool groups this mode may use; empty = all. */
  groups: string[];
  system: string;
}

export interface RunOptions {
  mode: AgentMode;
  provider: ProviderConfig;
  /** Ranked providers to try after the active one, in order. */
  chain?: ProviderConfig[];
  /** Allow the keyless endpoint as a last resort before the reflex core. */
  allowKeyless?: boolean;
  privacy: PrivacyLevel;
  ctx: ToolCtx;
  signal?: AbortSignal;
  onStep?: (s: LoopStep) => void;
  onToken?: (t: string) => void;
  /** Extra remembered facts from outside the local store (e.g. the server's learned facts). */
  recallExtra?: string[];
  /** Set false to run a turn with no memory in the prompt (private / incognito). */
  recall?: boolean;
}

export interface RunResult {
  text: string;
  steps: LoopStep[];
  calls: ToolCallRecord[];
  via: string;
  degraded: boolean;
  tokensIn: number;
  tokensOut: number;
}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

export interface MemoryItem {
  id: string;
  kind: 'fact' | 'preference' | 'decision' | 'task' | 'note';
  text: string;
  tags: string[];
  created: number;
  pinned?: boolean;
  source?: string;
}

export interface MemoryStore {
  all: () => MemoryItem[];
  add: (item: Omit<MemoryItem, 'id' | 'created'>) => MemoryItem;
  remove: (id: string) => void;
  search: (q: string, limit?: number) => MemoryItem[];
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

export type NodeGroup = 'trigger' | 'io' | 'logic' | 'data' | 'action' | 'agent';

export interface NodeKind {
  kind: string;
  group: NodeGroup;
  label: string;
  desc: string;
  fields: { name: string; label: string; type: 'text' | 'number' | 'select' | 'textarea'; options?: string[] }[];
  inputs: number;
  outputs: string[];
}

export interface WFNode {
  id: string;
  kind: string;
  x: number;
  y: number;
  config: Record<string, string>;
}

export interface WFEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
}

export interface Workflow {
  id: string;
  name: string;
  desc: string;
  nodes: WFNode[];
  edges: WFEdge[];
  updated: number;
}

export type NodeStatus = 'ok' | 'failed' | 'skipped' | 'blocked';

export interface NodeRun {
  nodeId: string;
  kind: string;
  status: NodeStatus;
  output: string;
  ms: number;
  reason?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  started: number;
  finished: number;
  status: 'ok' | 'failed' | 'blocked';
  nodes: NodeRun[];
  log: string[];
}

/* ------------------------------------------------------------------ */
/* Crew                                                                */
/* ------------------------------------------------------------------ */

export interface CrewRole {
  id: string;
  name: string;
  dept: string;
  brief: string;
  tools: string[];
  icon: string;
}

export interface CrewPreset {
  id: string;
  name: string;
  desc: string;
  roles: string[];
}

export interface CrewTurn {
  roleId: string;
  roleName: string;
  text: string;
  ms: number;
  via: string;
  error?: string;
  /** The answer is real but came from the offline core, not a model. */
  fellBack?: boolean;
  /** The role never ran because the tier was already down. */
  skipped?: boolean;
}

export interface CrewRun {
  id: string;
  brief: string;
  presetId: string;
  turns: CrewTurn[];
  started: number;
  finished: number;
  status: 'ok' | 'partial' | 'failed';
}

/* ------------------------------------------------------------------ */
/* Skills, routines, traces                                            */
/* ------------------------------------------------------------------ */

export interface Skill {
  id: string;
  name: string;
  desc: string;
  trigger: string;
  steps: SkillStep[];
  builtin?: boolean;
  updated: number;
}

export interface SkillStep {
  tool: string;
  args: Record<string, string>;
  /** Store the result under this name for later steps: {{name}} */
  as?: string;
}

export interface SkillResult {
  ok: boolean;
  steps: { tool: string; ok: boolean; summary: string; ms: number }[];
  output: string;
}

export interface Routine {
  id: string;
  name: string;
  when: 'manual' | 'startup' | 'interval' | 'daily';
  everyMin?: number;
  atHour?: number;
  action: { type: 'skill' | 'workflow' | 'prompt'; ref: string };
  enabled: boolean;
  lastRun?: number;
  runs: number;
}

export interface Trace {
  id: string;
  ts: number;
  kind: 'chat' | 'agent' | 'workflow' | 'crew' | 'skill' | 'tool' | 'command';
  label: string;
  ms: number;
  ok: boolean;
  via?: string;
  tokensIn?: number;
  tokensOut?: number;
  toolCount?: number;
  detail?: string;
}

/** An expense logged in the app or via the Telegram assistant. */
export interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: string;
  note: string;
  date: string;        // YYYY-MM-DD
  business: boolean;
  created: number;
  updated: number;
}

/** A calendar event created by the assistant (or in the app). */
export interface AgendaEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  location: string;
  attendees: string[];
  notes: string;
  created: number;
  updated: number;
  source?: string;
}

/** A person in the user's address book. */
export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  notes: string;
  tags: string[];
  created: number;
  updated: number;
}

export interface Idea {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created: number;
  starred?: boolean;
}
