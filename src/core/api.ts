// Cloud sync via the JARVIS API server. Drop-in replacement for supabase.ts.
// Same SyncSummary / SyncInput / SyncOutput shapes so state.tsx and Cloud.tsx
// need only swap the import.

import type { AgendaEvent, Contact, Conversation, CrewRun, Expense, Idea, MemoryItem, Routine, Skill, Trace, Workflow } from './types.ts';
import type { Project } from './library.ts';

export interface SyncSummary {
  table: string;
  pushed: number;
  pulled: number;
  error?: string;
}

export interface KeyVaultRow {
  id: string;
  updated: number;
  keyring: Record<string, { key?: string; model?: string; baseUrl?: string }>;
  serviceKeys: Record<string, string>;
}

export interface SyncInput {
  vault?: KeyVaultRow;
  conversations: Conversation[];
  memory: MemoryItem[];
  workflows: Workflow[];
  skills: Skill[];
  routines: Routine[];
  ideas: Idea[];
  traces: Trace[];
  crewRuns: CrewRun[];
  projects: Project[];
  expenses?: Expense[];
  contacts?: Contact[];
  events?: AgendaEvent[];
}

export interface SyncOutput {
  summaries: SyncSummary[];
  merged: SyncInput;
  ok: boolean;
}

// ---- Token management ----

const TOKEN_KEY = 'jarvis.cloud.token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

// ---- Server URL ----

/** In dev the Vite proxy forwards /api → localhost:3001. In prod, same origin. */
function apiBase(): string {
  return '/api';
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(`${apiBase()}${path}`, { ...init, headers });
}

// ---- Auth ----

export interface AuthUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface AuthConfig { requireLogin: boolean; configured: boolean; gate: 'allowlist' | 'owner' | 'first-user-claims' }

/**
 * Does this server want a login wall? Fails open to "no wall" when there is no
 * server at all (pure static / local-first use) - the wall protects the
 * server's resources, not the on-device app.
 */
export async function authConfig(): Promise<AuthConfig | null> {
  try {
    const res = await fetch(`${apiBase()}/auth/config`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as AuthConfig;
  } catch {
    return null;
  }
}

/**
 * Start GitHub sign-in with a full-page redirect (no pop-up, so pop-up
 * blockers and privacy browsers cannot swallow it). The server sends the
 * browser back to the app with the token in the URL fragment, which
 * consumeAuthReturn() picks up on the next boot.
 */
export function signInWithGitHub(serverUrl = ''): void {
  const back = encodeURIComponent(globalThis.location.hash || '');
  globalThis.location.assign(`${serverUrl}/api/auth/github?back=${back}`);
}

/**
 * Called once on boot: if the URL fragment carries the result of a sign-in
 * redirect (#auth=<token>&back=... or #auth_error=<msg>), store the token,
 * scrub the fragment from the address bar and report what happened.
 */
export function consumeAuthReturn(): { token?: string; error?: string; back?: string } | null {
  const hash = globalThis.location.hash || '';
  const m = hash.match(/^#auth(_error)?=([^&]*)(?:&back=([^&]*))?/);
  if (!m) return null;
  const value = decodeURIComponent(m[2] || '');
  const back = m[3] ? decodeURIComponent(m[3]) : '';
  const out = m[1] ? { error: value || 'Sign-in failed', back } : { token: value, back };
  if (out.token) setToken(out.token);
  try { history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search + (back || '')); } catch { /* fine */ }
  return out;
}

/** Check who we are (from the stored token). */
export async function currentUser(): Promise<AuthUser | null> {
  try {
    const res = await authedFetch('/auth/me');
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

export function signOut(): void {
  setToken(null);
  // Also drop the domain-wide SSO cookie, if the server set one. Fire and forget.
  try { void fetch(`${apiBase()}/auth/logout`, { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {}); } catch { /* offline */ }
}

export function isSignedIn(): boolean {
  return !!getToken();
}

// ---- Sync ----

/** Push/pull merge (last-write-wins). */
async function pushAll(payload: Record<string, unknown[]>): Promise<{
  ok: boolean;
  summaries: { table: string; pushed: number; pulled: number; error?: string }[];
  merged: Record<string, unknown[]>;
}> {
  const res = await authedFetch('/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; summaries: SyncSummary[]; merged: Record<string, unknown[]> };
}

/**
 * Full bidirectional sync — the same contract as the old supabase.syncAll().
 * Sends local state, receives merged state.
 */
export async function syncAll(input: SyncInput): Promise<SyncOutput> {
  // Build the payload — each table is an array of { id, updated_at, payload }
  const ts = (item: { updated?: number; created?: number; finished?: number; ts?: number; lastRun?: number }) =>
    item.updated ?? item.created ?? item.finished ?? item.ts ?? item.lastRun ?? Date.now();

  const payload: Record<string, { id: string; updated_at: number; payload: unknown }[]> = {};

  const collections: [keyof SyncInput, string][] = [
    ['conversations', 'conversations'],
    ['memory', 'memory_items'],
    ['workflows', 'workflows'],
    ['skills', 'skills'],
    ['routines', 'routines'],
    ['ideas', 'ideas'],
    ['traces', 'traces'],
    ['crewRuns', 'crew_runs'],
    ['projects', 'projects'],
    ['expenses', 'expenses'],
    ['contacts', 'contacts'],
    ['events', 'events'],
  ];

  for (const [key, table] of collections) {
    payload[table] = ((input[key] ?? []) as { id: string }[]).map((item) => ({
      id: item.id,
      updated_at: ts(item as unknown as Record<string, number>),
      payload: item,
    }));
  }

  // Vault is opt-in
  if (input.vault) {
    payload['key_vault'] = [{
      id: input.vault.id,
      updated_at: input.vault.updated as number,
      payload: input.vault,
    }];
  }

  const result = await pushAll(payload);

  // Map merged tables back to the SyncInput shape
  const merged: SyncInput = { ...input };

  const reverseMap: [keyof SyncInput, string][] = [
    ['conversations', 'conversations'],
    ['memory', 'memory_items'],
    ['workflows', 'workflows'],
    ['skills', 'skills'],
    ['routines', 'routines'],
    ['ideas', 'ideas'],
    ['traces', 'traces'],
    ['crewRuns', 'crew_runs'],
    ['projects', 'projects'],
    ['expenses', 'expenses'],
    ['contacts', 'contacts'],
    ['events', 'events'],
  ];

  for (const [key, table] of reverseMap) {
    const rows = (result.merged[table] ?? []) as { payload: unknown }[];
    (merged[key] as unknown) = rows.map((r) => r.payload);
  }

  if (input.vault && result.merged['key_vault']?.[0]) {
    merged.vault = (result.merged['key_vault'][0] as unknown as { payload: KeyVaultRow }).payload;
  }

  return {
    ok: result.ok,
    summaries: result.summaries,
    merged,
  };
}

/** Delete all cloud data for this account. */
export async function purgeCloud(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch('/sync', { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: `Server returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// ---- Assistant (Telegram + server-side brain) ----

export interface AssistantSettings {
  persona: 'jarvis' | 'neutral' | 'terse';
  humor: number;
  name?: string;
  currency: string;
  smtp?: { host: string; port: number; user: string; pass: string; from: string };
}

export interface AssistantStatus {
  bot: string | null;
  llm: boolean;
  model: string;
  telegram: { chat_id: number; username: string | null; linked_at: string } | null;
  settings: AssistantSettings;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  return body as T;
}

export const assistantStatus = () => authedFetch('/assistant/status').then(json<AssistantStatus>);
export const assistantLinkCode = () => authedFetch('/assistant/link-code', { method: 'POST' }).then(json<{ code: string; bot: string; deepLink: string; expiresIn: number }>);
export const assistantUnlink = () => authedFetch('/assistant/telegram', { method: 'DELETE' }).then(json<{ ok: boolean }>);
export const assistantSaveSettings = (s: Partial<AssistantSettings> | { smtp: null }) =>
  authedFetch('/assistant/settings', { method: 'POST', body: JSON.stringify(s) }).then(json<{ ok: boolean; settings: AssistantSettings }>);
export const assistantTestEmail = () => authedFetch('/assistant/test-email', { method: 'POST' }).then(json<{ ok: boolean; error?: string }>);
export const assistantAsk = (text: string) =>
  authedFetch('/assistant/ask', { method: 'POST', body: JSON.stringify({ text }) })
    .then(json<{ text: string; steps: { tool: string; args: unknown; result: unknown; ms: number }[] }>);

// ---- Long-term memory (what JARVIS has learned about you) ----

export interface LearnedFact { id: number; text: string; source: string; trust: 'auto' | 'trusted' | 'untrusted'; created_at: number; last_seen: number }

export const learnedFacts = () => authedFetch('/assistant/memory').then(json<{ facts: LearnedFact[] }>);
export const learnFact = (text: string) => authedFetch('/assistant/memory', { method: 'POST', body: JSON.stringify({ text }) }).then(json<{ ok: boolean }>);
export const setFactTrust = (id: number, trust: LearnedFact['trust']) =>
  authedFetch(`/assistant/memory/${id}/trust`, { method: 'POST', body: JSON.stringify({ trust }) }).then(json<{ ok: boolean }>);
export const forgetFact = (id: number) => authedFetch(`/assistant/memory/${id}`, { method: 'DELETE' }).then(json<{ ok: boolean }>);
export const forgetAll = () => authedFetch('/assistant/memory', { method: 'DELETE' }).then(json<{ ok: boolean; removed: number }>);
export const serverPrompts = () => authedFetch('/assistant/prompts').then(json<{ prompts: { name: string; text: string }[] }>);
