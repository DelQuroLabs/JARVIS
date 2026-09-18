// Persistence. Everything is local-first: the app is fully functional with no
// account and no network. Cloud sync is additive and opt-in.
//
// Import rule: store.ts may import workflow.ts, so workflow.ts must never read
// TOOL_MAP at module-evaluation time. See workflow.ts primeToolOptions().

import type {
  Conversation, Idea, MemoryItem, Routine, Skill, Trace, Workflow, PrivacyLevel, ProviderConfig,
  ProviderCreds, ProviderId, ServiceId,
} from './types.ts';
import { seedWorkflows } from './workflow.ts';
import { builtinSkills } from './skills.ts';
import { seedRoutines } from './routines.ts';
import { seedIdeas } from './ideas.ts';
import { seedProjects } from './seedProjects.ts';
import { normaliseLayout } from './dashboard.ts';

export const NS = 'jarvis';
export const SCHEMA_VERSION = 2;

export const KEYS = {
  version: `${NS}.version`,
  conversations: `${NS}.conversations`,
  memory: `${NS}.memory`,
  workflows: `${NS}.workflows`,
  runs: `${NS}.workflow.runs`,
  crew: `${NS}.crew.runs`,
  skills: `${NS}.skills`,
  routines: `${NS}.routines`,
  traces: `${NS}.traces`,
  ideas: `${NS}.ideas`,
  settings: `${NS}.settings`,
  sandbox: `${NS}.sandbox`,
  dash: `${NS}.dashboard`,
  weather: `${NS}.weather`,
  projects: `${NS}.projects`,
  calendars: `${NS}.calendars`,
  cloud: `${NS}.cloud`,
  seeded: `${NS}.seeded`,
  projectsSeeded: `${NS}.projects.seeded`,
} as const;

type Store = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const memoryFallback = (): Store => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

let backing: Store;
try {
  const probe = '__jarvis_probe__';
  globalThis.localStorage.setItem(probe, '1');
  globalThis.localStorage.removeItem(probe);
  backing = globalThis.localStorage;
} catch {
  backing = memoryFallback();
}

/**
 * Read a persisted value.
 *
 * `isValid` matters more than it looks. JSON.parse only protects against
 * corrupt text; it happily returns valid JSON in a shape this build no longer
 * understands. That is exactly what a released schema change produces, and
 * casting it to T hands the UI an object with missing fields -- which is how
 * "Cannot read properties of undefined" reached a user. A value that fails the
 * check is treated as absent.
 */
export function read<T>(key: string, fallback: T, isValid?: (v: unknown) => boolean): T {
  try {
    const raw = backing.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (isValid && !isValid(parsed)) {
      // Drop it rather than leave a landmine for the next reader.
      try {
        backing.removeItem(key);
      } catch {
        /* read-only storage is still survivable */
      }
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------------- shapes */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every row must be an object carrying an id, whatever else changed. */
const isRowArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');
/** The merged weather cache. The single-source shape it replaced lacks both. */
const isMergedWeather = (v: unknown): boolean =>
  v === null || (isObj(v) && Array.isArray(v.readings) && typeof v.agreement === 'string' && isObj(v.place));

export function write<T>(key: string, value: T): boolean {
  try {
    backing.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage disabled. Callers surface this honestly.
    return false;
  }
}

export function remove(key: string): void {
  try {
    backing.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface Settings {
  provider: ProviderConfig;
  /**
   * Saved credentials per provider, so switching brains does not mean
   * re-pasting a key. Written to localStorage; only leaves the device when
   * cloud sync is connected AND syncKeys is on.
   */
  keyring: Partial<Record<ProviderId, ProviderCreds>>;
  /** Ranked fallback order. Tried in sequence after the active provider. */
  chain: ProviderId[];
  /** Optional third-party keys that upgrade tools rather than the model. */
  serviceKeys: Partial<Record<ServiceId, string>>;
  /** Include credentials in the cloud sync payload. Off means keys stay on this device. */
  syncKeys: boolean;
  privacy: PrivacyLevel;
  mode: string;
  theme: 'dark' | 'light' | 'system';
  accent: string;
  reduceMotion: boolean;
  fontScale: number;
  sendOnEnter: boolean;
  autoApprove: boolean;
  keylessFallback: boolean;
  haptics: boolean;
  onboarded: boolean;
  /** Imperial shows Fahrenheit and mph; metric shows Celsius and km/h. */
  units: import('./weather.ts').Units;
  /** Where the dashboard reads weather for. Null until the user picks one. */
  weatherPlace: import('./weather.ts').WeatherPlace | null;
  /** Turn the dashboard weather card off entirely. */
  weatherOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: { id: 'groq', model: 'llama-3.3-70b-versatile' },
  keyring: {},
  // Free tiers first, so an unconfigured user never lands on a billed account.
  chain: ['groq', 'cerebras', 'gemini', 'mistral'],
  serviceKeys: {},
  syncKeys: false,
  privacy: 'GUARDED',
  mode: 'agent',
  theme: 'dark',
  accent: 'aqua',
  reduceMotion: false,
  fontScale: 1,
  sendOnEnter: false,
  autoApprove: false,
  keylessFallback: true,
  haptics: true,
  onboarded: false,
  units: 'imperial',
  weatherPlace: { name: 'Washington', admin: 'District of Columbia', country: 'US', lat: 38.895, lon: -77.037 },
  weatherOn: true,
};

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) });
export const saveSettings = (s: Settings): boolean => write(KEYS.settings, s);

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export const loadConversations = (): Conversation[] => read<Conversation[]>(KEYS.conversations, [], isRowArray);
export const saveConversations = (c: Conversation[]): boolean => write(KEYS.conversations, c.slice(0, 200));

export const loadMemory = (): MemoryItem[] => read<MemoryItem[]>(KEYS.memory, [], isRowArray);
export const saveMemory = (m: MemoryItem[]): boolean => write(KEYS.memory, m.slice(0, 1000));

export const loadWorkflows = (): Workflow[] => read<Workflow[]>(KEYS.workflows, [], isRowArray);
export const saveWorkflows = (w: Workflow[]): boolean => write(KEYS.workflows, w);

export const loadRuns = (): import('./types.ts').WorkflowRun[] => read(KEYS.runs, []);
export const saveRuns = (r: import('./types.ts').WorkflowRun[]): boolean => write(KEYS.runs, r.slice(0, 50));

export const loadCrewRuns = (): import('./types.ts').CrewRun[] => read(KEYS.crew, []);
export const saveCrewRuns = (r: import('./types.ts').CrewRun[]): boolean => write(KEYS.crew, r.slice(0, 30));

export const loadSkills = (): Skill[] => read<Skill[]>(KEYS.skills, [], isRowArray);
export const saveSkills = (s: Skill[]): boolean => write(KEYS.skills, s);

export const loadRoutines = (): Routine[] => read<Routine[]>(KEYS.routines, [], isRowArray);
export const saveRoutines = (r: Routine[]): boolean => write(KEYS.routines, r);

export const loadTraces = (): Trace[] => read<Trace[]>(KEYS.traces, []);
export const saveTraces = (t: Trace[]): boolean => write(KEYS.traces, t.slice(0, 400));

export const loadIdeas = (): Idea[] => read<Idea[]>(KEYS.ideas, [], isRowArray);
export const saveIdeas = (i: Idea[]): boolean => write(KEYS.ideas, i);

export const loadSandbox = (): Record<string, string> => read(KEYS.sandbox, {});
export const saveSandbox = (fs: Record<string, string>): boolean => write(KEYS.sandbox, fs);

export interface CloudConfig {
  serverUrl: string;
  enabled: boolean;
  lastSync?: number;
}

export const loadCloud = (): CloudConfig => read<CloudConfig>(KEYS.cloud, { serverUrl: '', enabled: false });
export const saveCloud = (c: CloudConfig): boolean => write(KEYS.cloud, c);

/** Last weather reading, kept so the card can render instantly and offline. */
export const loadWeather = (): import('./wxmerge.ts').MergedWeather | null =>
  read<import('./wxmerge.ts').MergedWeather | null>(KEYS.weather, null, isMergedWeather);
export const saveWeather = (w: import('./wxmerge.ts').MergedWeather | null): boolean => write(KEYS.weather, w);

export const loadCalendars = (): import('./ics.ts').CalendarImport[] =>
  read<import('./ics.ts').CalendarImport[]>(KEYS.calendars, [], isRowArray);
export const saveCalendars = (c: import('./ics.ts').CalendarImport[]): boolean => write(KEYS.calendars, c);

export const loadProjects = (): import('./library.ts').Project[] =>
  read<import('./library.ts').Project[]>(KEYS.projects, [], isRowArray);
export const saveProjects = (p: import('./library.ts').Project[]): boolean => write(KEYS.projects, p);

/** Dashboard tile order and hidden set. Reconciled against the live registry. */
export const loadDashboard = (): import('./dashboard.ts').DashLayout =>
  normaliseLayout(read<Partial<import('./dashboard.ts').DashLayout> | null>(KEYS.dash, null));
export const saveDashboard = (l: import('./dashboard.ts').DashLayout): boolean => write(KEYS.dash, l);

/* ------------------------------------------------------------------ */
/* First-run seeding and maintenance                                   */
/* ------------------------------------------------------------------ */

export function seedIfEmpty(): void {
  // The library shipped after the first release, so it carries its own marker.
  // A global "seeded" flag would mean existing installs never get it, and
  // seeding on "empty" alone would resurrect projects the user deleted.
  if (!read<boolean>(KEYS.projectsSeeded, false)) {
    if (!loadProjects().length) saveProjects(seedProjects());
    write(KEYS.projectsSeeded, true);
  }
  if (read<boolean>(KEYS.seeded, false)) return;
  if (!loadWorkflows().length) saveWorkflows(seedWorkflows());
  if (!loadSkills().length) saveSkills(builtinSkills());
  if (!loadRoutines().length) saveRoutines(seedRoutines());
  if (!loadIdeas().length) saveIdeas(seedIdeas());
  write(KEYS.seeded, true);
  write(KEYS.version, SCHEMA_VERSION);
}

export interface UsageReport {
  bytes: number;
  perKey: { key: string; bytes: number }[];
}

export function storageUsage(): UsageReport {
  const perKey = Object.values(KEYS).map((key) => {
    let bytes = 0;
    try {
      bytes = (backing.getItem(key) ?? '').length;
    } catch {
      bytes = 0;
    }
    return { key, bytes };
  });
  return { bytes: perKey.reduce((n, k) => n + k.bytes, 0), perKey: perKey.sort((a, b) => b.bytes - a.bytes) };
}

export function exportAll(): string {
  const out: Record<string, unknown> = { exported: new Date().toISOString(), version: SCHEMA_VERSION };
  for (const [name, key] of Object.entries(KEYS)) out[name] = read<unknown>(key, null);
  // Never export credentials, not even the user's own. This has to cover the
  // whole keyring and the service keys, not just the active provider.
  const settings = out.settings as Settings | null;
  if (settings) {
    const keyring: Partial<Record<ProviderId, ProviderCreds>> = {};
    for (const [id, creds] of Object.entries(settings.keyring ?? {})) {
      keyring[id as ProviderId] = { ...(creds as ProviderCreds), key: undefined };
    }
    out.settings = {
      ...settings,
      provider: { ...settings.provider, key: undefined },
      keyring,
      serviceKeys: {},
    };
  }
  const sb = out.cloud as CloudConfig | null;
  if (sb) out.cloud = { ...sb };
  return JSON.stringify(out, null, 2);
}

export function importAll(json: string): { ok: boolean; imported: string[]; error?: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, imported: [], error: e instanceof Error ? e.message : 'invalid JSON' };
  }
  const imported: string[] = [];
  for (const [name, key] of Object.entries(KEYS)) {
    if (name === 'cloud' || name === 'settings') continue;
    const v = parsed[name];
    if (v !== undefined && v !== null) {
      write(key, v);
      imported.push(name);
    }
  }
  return { ok: true, imported };
}

export function resetAll(): void {
  for (const key of Object.values(KEYS)) remove(key);
}
