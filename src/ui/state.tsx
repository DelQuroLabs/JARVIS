// Application state. One provider, one hook. All persistence goes through
// core/store.ts; all reasoning goes through core/*. This file is glue only.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AgendaEvent, Contact, Conversation, CrewRun, Expense, Idea, MemoryItem, Msg, Routine, Skill, ToolCtx, Trace, ToolCallRecord, Workflow, WorkflowRun,
  ProviderConfig, ProviderId,
} from '../core/types.ts';
import * as store from '../core/store.ts';
import { makeCtx, memoryStoreFrom } from '../core/ctx.ts';
import { executeTool, runAgent } from '../core/loop.ts';
import { modeOf, systemFor } from '../core/modes.ts';
import { TOOLS, toolNames } from '../core/tools.ts';
import { primeToolOptions } from '../core/workflow.ts';
import { chatWithFallback, isConfigured, specOf, DEFAULT_BASE_URL, probeProvider } from '../core/providers.ts';
import { makeTrace, pushTrace } from '../core/traces.ts';
import { detect } from '../core/privacy.ts';
import { runSkill } from '../core/skills.ts';
import { runWorkflow } from '../core/workflow.ts';
import { dueRoutines } from '../core/routines.ts';
import { geocode, isRefreshDue, REFRESH_EVERY_MS, type WeatherPlace } from '../core/weather.ts';
import { fetchAllWeather, type MergedWeather } from '../core/wxmerge.ts';
import { sortProjects, type Project } from '../core/library.ts';
import { defaultLayout, reorderLayout, toggleHidden, type DashLayout } from '../core/dashboard.ts';
import { parseIcs, type CalendarImport } from '../core/ics.ts';
import { uid, titleFrom } from '../core/util.ts';
import { dedupeLearned, extractFacts, LEARN_PROMPT, normalise, parseLearned, slotOf, type Learned } from '../core/recall.ts';
import * as cloudApi from '../core/api.ts';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'err';
}

export interface ApprovalReq {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  resolve: (ok: boolean) => void;
}

export interface AppApi {
  settings: store.Settings;
  setSettings: (patch: Partial<store.Settings>) => void;

  conversations: Conversation[];
  activeId: string | null;
  active: Conversation | null;
  newConversation: () => string;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationMode: (id: string, mode: string) => void;
  appendMessage: (convId: string, m: Msg) => void;
  patchMessage: (convId: string, msgId: string, patch: Partial<Msg>) => void;

  memory: MemoryItem[];
  addMemory: (m: Omit<MemoryItem, 'id' | 'created'>) => void;
  /** Learn durable facts from one exchange (rules, plus a model pass when allowed). Returns what was saved. 
   *  FIX: now accepts per-conversation mode & privacy to prevent private conversations being learned.
   */
  learnFrom: (userText: string, assistantText?: string, opts?: { mode?: string; privacy?: string; conversationId?: string; turnId?: string }) => Promise<MemoryItem[]>;
  /** Facts the server-side assistant (Telegram) has learned; merged into recall when signed in. */
  serverFacts: string[];
  refreshServerFacts: () => Promise<void>;
  removeMemory: (id: string) => void;
  togglePin: (id: string) => void;

  workflows: Workflow[];
  saveWorkflow: (w: Workflow) => void;
  deleteWorkflow: (id: string) => void;
  runs: WorkflowRun[];
  addRun: (r: WorkflowRun) => void;

  crewRuns: CrewRun[];
  addCrewRun: (r: CrewRun) => void;

  skills: Skill[];
  saveSkill: (s: Skill) => void;
  deleteSkill: (id: string) => void;

  routines: Routine[];
  saveRoutine: (r: Routine) => void;
  deleteRoutine: (id: string) => void;

  ideas: Idea[];
  saveIdea: (i: Idea) => void;
  deleteIdea: (id: string) => void;
  expenses: Expense[];
  saveExpense: (e: Expense) => void;
  deleteExpense: (id: string) => void;
  contacts: Contact[];
  saveContact: (c: Contact) => void;
  deleteContact: (id: string) => void;
  /** Events created by the assistant; shown as the JARVIS calendar. */
  events: AgendaEvent[];
  saveEvent: (e: AgendaEvent) => void;
  deleteEvent: (id: string) => void;

  traces: Trace[];
  addTrace: (t: Omit<Trace, 'id' | 'ts'>) => void;
  clearTraces: () => void;

  sandbox: Record<string, string>;
  setSandbox: (fs: Record<string, string>) => void;

  cloud: store.CloudConfig;
  setCloud: (c: store.CloudConfig) => void;

  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;

  approval: ApprovalReq | null;
  answerApproval: (ok: boolean) => void;

  /** Build a fresh tool-execution context (sandbox, privacy, approvals, memory). */
  makeToolCtx: () => ToolCtx;
  /** Run one tool by name, honouring approvals and privacy. */
  runTool: (tool: string, args: Record<string, unknown>) => Promise<ToolCallRecord>;
  /** Single-shot model call with the full fallback chain. */
  ask: (
    prompt: string,
    modeId?: string,
    /** Called with a human-readable note as the fallback chain is walked. */
    onProgress?: (note: string) => void,
  ) => Promise<{ ok: boolean; text: string; via: string; error?: string; blocked?: boolean }>;
  /** Full agent loop. */
  runTask: typeof runAgent;
  /** Merge a provider id with its saved credentials. */
  resolveProvider: (id: ProviderId) => ProviderConfig;
  /** Send one tiny real request to prove a key works. */
  testProvider: (id: ProviderId) => Promise<{ ok: boolean; ms: number; detail: string; cors?: boolean }>;
  /** Imported calendars, newest first. */
  calendars: CalendarImport[];
  /** Parse an .ics file and add it. Throws a readable error on bad input. */
  importCalendar: (name: string, text: string, source: string) => CalendarImport;
  removeCalendar: (id: string) => void;
  /** Dashboard tile order and hidden set. */
  dash: DashLayout;
  moveTile: (dragId: string, overId: string) => void;
  toggleTile: (id: string) => void;
  resetDash: () => void;
  /** Replace local collections with the merged result of a cloud sync. */
  applySync: (m: {
    conversations?: Conversation[]; memory?: MemoryItem[]; workflows?: Workflow[];
    skills?: Skill[]; routines?: Routine[]; ideas?: Idea[]; traces?: Trace[];
    crewRuns?: CrewRun[]; projects?: Project[]; expenses?: Expense[]; contacts?: Contact[]; events?: AgendaEvent[];
  }) => void;
  /** The project library, pinned first then most recently updated. */
  projects: Project[];
  saveProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  /** Last weather reading, or null when none has ever succeeded. */
  weather: MergedWeather | null;
  /** True while a reading is in flight. */
  weatherBusy: boolean;
  /** The reason the last attempt failed, in plain English. Null when fine. */
  weatherError: string | null;
  /** Fetch now for the saved place. Silent no-op when no place is set. */
  refreshWeather: (force?: boolean) => Promise<void>;
  /** Resolve a typed city, save it, and fetch it. Throws a readable error. */
  setWeatherPlace: (query: string) => Promise<WeatherPlace>;
  /** Ask the browser for coordinates, then save and fetch. */
  useDeviceLocation: () => Promise<WeatherPlace>;
  /** Execute one routine end to end. Shared by the Routines screen and the ticker. */
  runRoutine: (r: Routine) => Promise<{ ok: boolean; note: string }>;
  /** Routines the ticker is executing right now. */
  routineBusy: string[];
  /** Text handed to the chat composer from another screen (Ideas, Home spark). */
  pendingPrompt: string;
  setPendingPrompt: (text: string) => void;

  providerReady: boolean;
  online: boolean;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp() called outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<store.Settings>(() => store.loadSettings());
  const [conversations, setConversations] = useState<Conversation[]>(() => store.loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => store.loadConversations()[0]?.id ?? null);
  const [memory, setMemory] = useState<MemoryItem[]>(() => store.loadMemory());
  const [workflows, setWorkflows] = useState<Workflow[]>(() => store.loadWorkflows());
  const [runs, setRuns] = useState<WorkflowRun[]>(() => store.loadRuns());
  const [crewRuns, setCrewRuns] = useState<CrewRun[]>(() => store.loadCrewRuns());
  const [skills, setSkills] = useState<Skill[]>(() => store.loadSkills());
  const [routines, setRoutines] = useState<Routine[]>(() => store.loadRoutines());
  const [ideas, setIdeas] = useState<Idea[]>(() => store.loadIdeas());
  const [expenses, setExpenses] = useState<Expense[]>(() => store.loadExpenses());
  const [contacts, setContacts] = useState<Contact[]>(() => store.loadContacts());
  const [events, setEvents] = useState<AgendaEvent[]>(() => store.loadEvents());
  const [traces, setTraces] = useState<Trace[]>(() => store.loadTraces());
  const [sandbox, setSandboxState] = useState<Record<string, string>>(() => store.loadSandbox());
  const [cloud, setCloudState] = useState<store.CloudConfig>(() => store.loadCloud());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [approval, setApproval] = useState<ApprovalReq | null>(null);
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true);

  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- first run + tool option priming ---------- */
  useEffect(() => {
    store.seedIfEmpty();
    primeToolOptions(toolNames());
    setWorkflows(store.loadWorkflows());
    setSkills(store.loadSkills());
    setRoutines(store.loadRoutines());
    setIdeas(store.loadIdeas());
    setExpenses(store.loadExpenses());
    setContacts(store.loadContacts());
    setEvents(store.loadEvents());
    // Seeding happens above, so every seeded store must be re-read here or the
    // first render keeps the empty snapshot it captured before the seed ran.
    setProjects(sortProjects(store.loadProjects()));
  }, []);

  /* ---------- theme ---------- */
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const sys = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      root.dataset.theme = settings.theme === 'system' ? sys : settings.theme;
    };
    apply();
    root.dataset.accent = settings.accent;
    root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
    root.style.setProperty('--fs', String(settings.fontScale));
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [settings.theme, settings.accent, settings.reduceMotion, settings.fontScale]);

  /* ---------- connectivity ---------- */
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    globalThis.addEventListener('online', up);
    globalThis.addEventListener('offline', down);
    return () => {
      globalThis.removeEventListener('online', up);
      globalThis.removeEventListener('offline', down);
    };
  }, []);

  /* ---------- persistence ---------- */
  const persist = useCallback((fn: () => boolean, what: string) => {
    if (!fn()) {
      setToasts((t) => [...t, { id: uid('t'), text: `Could not save ${what}: browser storage is full or disabled.`, tone: 'err' }]);
    }
  }, []);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = uid('t');
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const setSettings = useCallback((patch: Partial<store.Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      store.saveSettings(next);
      return next;
    });
  }, []);

  /* ---------- conversations ---------- */
  const writeConvs = useCallback((next: Conversation[]) => {
    setConversations(next);
    persist(() => store.saveConversations(next), 'conversations');
  }, [persist]);

  const newConversation = useCallback((): string => {
    const c: Conversation = { id: uid('c'), title: 'New conversation', created: Date.now(), updated: Date.now(), messages: [], mode: settingsRef.current.mode };
    setConversations((prev) => {
      const next = [c, ...prev];
      store.saveConversations(next);
      return next;
    });
    setActiveId(c.id);
    return c.id;
  }, []);

  const appendMessage = useCallback((convId: string, m: Msg) => {
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, m], updated: Date.now(), title: c.messages.length === 0 && m.role === 'user' ? titleFrom(m.content) : c.title }
          : c,
      );
      store.saveConversations(next);
      return next;
    });
  }, []);

  const patchMessage = useCallback((convId: string, msgId: string, patch: Partial<Msg>) => {
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updated: Date.now() } : c,
      );
      store.saveConversations(next);
      return next;
    });
  }, []);

  /* ---------- memory ---------- */
  const writeMemory = useCallback((next: MemoryItem[]) => {
    setMemory(next);
    memoryRef.current = next;
    persist(() => store.saveMemory(next), 'memory');
  }, [persist]);

  const memoryStore = useMemo(
    () => memoryStoreFrom(() => memoryRef.current, (items) => writeMemory(items)),
    [writeMemory],
  );

  // Facts the server assistant learned (Telegram + in-app Assistant). Read-only
  // here; they ride along in recall so the web chat and the bot share one mind.
  const [serverFacts, setServerFacts] = useState<string[]>([]);
  const refreshServerFacts = useCallback(async () => {
    if (!cloudApi.isSignedIn()) { setServerFacts([]); return; }
    try {
      const { facts } = await cloudApi.learnedFacts();
      setServerFacts(facts.filter((f) => f.trust !== 'untrusted').map((f) => f.text));
    } catch { /* offline or server down: keep what we had */ }
  }, []);
  useEffect(() => { void refreshServerFacts(); }, [refreshServerFacts]);

  /** Save learned facts: supersede single-value slots, skip duplicates, mirror to the server when signed in. */
  const commitLearned = useCallback((cands: Learned[]): MemoryItem[] => {
    const fresh = dedupeLearned(cands, memoryRef.current);
    if (!fresh.length) return [];
    let next = memoryRef.current;
    const saved: MemoryItem[] = [];
    for (const c of fresh) {
      const slot = slotOf(c.text);
      if (slot) next = next.filter((m) => !(m.source === 'learned' && slotOf(m.text) === slot));
      const item: MemoryItem = { ...c, id: uid('mem'), created: Date.now(), source: 'learned' };
      next = [item, ...next];
      saved.push(item);
    }
    writeMemory(next);
    if (cloudApi.isSignedIn()) {
      for (const it of saved) void cloudApi.learnFact(it.text).catch(() => undefined);
      void refreshServerFacts();
    }
    return saved;
  }, [writeMemory, refreshServerFacts]);

  const learnFrom = useCallback(async (userText: string, assistantText?: string, opts?: { mode?: string; privacy?: string; conversationId?: string; turnId?: string }): Promise<MemoryItem[]> => {
    const st = settingsRef.current;
    // FIX: Use per-conversation mode & privacy if provided, not just global settings.
    // This prevents private conversations from being learned when global mode is standard.
    const effectiveMode = opts?.mode ?? st.mode;
    const effectivePrivacy = opts?.privacy ?? st.privacy;

    if (st.autoLearn === 'off' || effectiveMode === 'private') return [];
    const saved = commitLearned(extractFacts(userText));
    if (st.autoLearn !== 'full' || effectivePrivacy === 'STRICT' || !isConfigured(st.provider)) return saved;
    // Model pass: one small call, no mode prompt, only when a real provider is set.
    // FIX: Apply same privacy redaction path as agent loop — scan & redact before transport.
    try {
      const { scan } = await import('../core/privacy.ts');
      const safeUser = scan(userText.slice(0, 3000), effectivePrivacy as never).clean;
      const safeAssistant = scan((assistantText ?? '').slice(0, 1500), effectivePrivacy as never).clean;
      const known = memoryRef.current.slice(0, 40).map((m) => m.text).concat(serverFacts.slice(0, 20));
      const safeKnown = known.map(k => scan(k, effectivePrivacy as never).clean);
      const res = await chatWithFallback(
        {
          provider: resolveProvider(st.provider.id),
          messages: [{ id: uid('m'), role: 'user', content: `KNOWN:\n${safeKnown.map((k) => `- ${k}`).join('\n') || '(nothing)'}\n\nUSER SAID:\n${safeUser}\n\nASSISTANT REPLIED:\n${safeAssistant}`, ts: Date.now() }],
          system: LEARN_PROMPT,
          temperature: 0,
        },
        { allowKeyless: false, chain: [] },
      );
      const savedKeys = new Set(saved.map((x) => normalise(x.text)));
      const more = parseLearned(res.text)
        .filter((t) => !savedKeys.has(normalise(t)))
        .map((t): Learned => ({ text: t, kind: /prefer|like|dislike|always|never|instruction/i.test(t) ? 'preference' : 'fact', tags: ['learned', 'model'] }));
      return [...saved, ...commitLearned(more)];
    } catch {
      return saved;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitLearned, serverFacts]);

  /* ---------- approvals ---------- */
  const requestApproval = useCallback(
    (tool: string, args: Record<string, unknown>): Promise<boolean> => {
      if (settingsRef.current.autoApprove) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setApproval({ id: uid('ap'), tool, args, resolve }));
    },
    [],
  );

  const answerApproval = useCallback((ok: boolean) => {
    setApproval((a) => {
      a?.resolve(ok);
      return null;
    });
  }, []);

  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;

  const setSandbox = useCallback((fs: Record<string, string>) => {
    sandboxRef.current = fs;
    setSandboxState(fs);
    persist(() => store.saveSandbox(fs), 'the sandbox workspace');
  }, [persist]);

  const buildCtx = useCallback(
    () =>
      makeCtx({
        fs: sandboxRef.current,
        onFsChange: setSandbox,
        privacy: settingsRef.current.privacy,
        memory: memoryStore,
        approve: requestApproval,
        serviceKeys: settingsRef.current.serviceKeys,
      }),
    [memoryStore, requestApproval, setSandbox],
  );

  /* ---------- provider resolution ---------- */

  /**
   * Merge a provider id with whatever credentials are saved for it. Callers
   * never build a ProviderConfig by hand, so a key saved once is used
   * everywhere: chat, agent, crew, workflows and routines alike.
   */
  const resolveProvider = useCallback((id: ProviderId): ProviderConfig => {
    const st = settingsRef.current;
    const creds: import('../core/types.ts').ProviderCreds = st.keyring?.[id] ?? {};
    const active = st.provider.id === id ? st.provider : undefined;
    return {
      id,
      key: creds.key ?? active?.key,
      model: creds.model ?? active?.model,
      baseUrl: creds.baseUrl ?? active?.baseUrl ?? DEFAULT_BASE_URL[id],
    };
  }, []);

  /** The ranked fallback list, minus the active provider (which goes first). */
  const resolveChain = useCallback((): ProviderConfig[] => {
    const st = settingsRef.current;
    return (st.chain ?? []).filter((id) => id !== st.provider.id).map(resolveProvider);
  }, [resolveProvider]);

  /**
   * Every agent run goes through here, so the keyring, the ranked chain and the
   * keyless setting apply identically to chat, the agent console, workflows,
   * crew and routines. Screens pass a provider id; credentials are resolved here.
   */
  const runTask = useCallback<typeof runAgent>(
    (messages, opts) =>
      runAgent(messages, {
        ...opts,
        provider: resolveProvider(opts.provider?.id ?? settingsRef.current.provider.id),
        chain: opts.chain ?? resolveChain(),
        allowKeyless: opts.allowKeyless ?? settingsRef.current.keylessFallback,
        recall: opts.recall ?? opts.mode.id !== 'private',
        recallExtra: opts.recallExtra ?? serverFacts,
      }),
    [resolveProvider, resolveChain, serverFacts],
  );

  const testProvider = useCallback(
    (id: ProviderId) => probeProvider(resolveProvider(id)),
    [resolveProvider],
  );

  /* ---------- traces ---------- */
  const addTrace = useCallback((t: Omit<Trace, 'id' | 'ts'>) => {
    setTraces((prev) => {
      const next = pushTrace(prev, makeTrace(t));
      store.saveTraces(next);
      return next;
    });
  }, []);

  /* ---------- execution ---------- */
  const runTool = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<ToolCallRecord> => {
      const rec = await executeTool({ tool, args }, { ctx: buildCtx(), privacy: settingsRef.current.privacy });
      addTrace({ kind: 'tool', label: tool, ms: rec.ms, ok: rec.ok, toolCount: 1, detail: rec.summary });
      return rec;
    },
    [buildCtx, addTrace],
  );

  const ask = useCallback(
    async (
      prompt: string,
      modeId?: string,
      onProgress?: (note: string) => void,
    ): Promise<{ ok: boolean; text: string; via: string; error?: string; blocked?: boolean }> => {
      const mode = modeOf(modeId ?? settingsRef.current.mode);
      const t0 = Date.now();
      // FIX: Unified memory recall for all paths (Crew, Workflows, Routines previously missed recall)
      // This ensures app.ask also injects memory like runTask does.
      let systemPrompt = systemFor(mode);
      if (mode.id !== 'private') {
        try {
          const { recallBlock } = await import('../core/recall.ts');
          const block = recallBlock(memoryRef.current, prompt, { extra: serverFacts });
          if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
        } catch { /* recall is best-effort */ }
      }
      const res = await chatWithFallback(
        {
          provider: resolveProvider(settingsRef.current.provider.id),
          messages: [{ id: uid('m'), role: 'user', content: prompt, ts: Date.now() }],
          system: systemPrompt,
          temperature: mode.temperature,
        },
        {
          allowKeyless: settingsRef.current.keylessFallback,
          chain: resolveChain(),
          onAttempt: onProgress ? (id) => onProgress(`Trying ${specOf(id).label}\u2026`) : undefined,
          onHop: onProgress
            ? (h) => onProgress(h.ok ? `${specOf(h.provider).label} answered in ${h.ms} ms` : `${specOf(h.provider).label}: ${h.error}`)
            : undefined,
        },
      );
      addTrace({ kind: 'chat', label: prompt.slice(0, 60), ms: Date.now() - t0, ok: !res.error, via: res.via, tokensOut: Math.ceil(res.text.length / 4) });
      if (res.error && !res.text) {
        // Distinguish "never attempted" from "attempted and failed" so callers
        // can report blocked rather than inventing a failure.
        const configured = isConfigured(settingsRef.current.provider) || settingsRef.current.keylessFallback;
        return {
          ok: false,
          via: 'none',
          blocked: !configured,
          error: configured ? res.error : 'No model provider is configured. Add a free key in Settings.',
          text: configured ? `No provider answered. ${res.error}` : 'No model provider is configured. Add a free key in Settings.',
        };
      }
      return { ok: true, text: res.text, via: res.via };
    },
    [addTrace],
  );


  /* ---------- collection writers ---------- */
  const mk = <T extends { id: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    save: (v: T[]) => boolean,
    sort?: (a: T, b: T) => number,
  ) => ({
    save: (item: T) =>
      setter((prev) => {
        const idx = prev.findIndex((p) => p.id === item.id);
        const next = idx >= 0 ? prev.map((p) => (p.id === item.id ? item : p)) : [item, ...prev];
        if (sort) next.sort(sort);
        save(next);
        return next;
      }),
    remove: (id: string) =>
      setter((prev) => {
        const next = prev.filter((p) => p.id !== id);
        save(next);
        return next;
      }),
  });

  const wf = useMemo(() => mk<Workflow>(setWorkflows, store.saveWorkflows, (a, b) => b.updated - a.updated), []);
  const sk = useMemo(() => mk<Skill>(setSkills, store.saveSkills), []);
  const rt = useMemo(() => mk<Routine>(setRoutines, store.saveRoutines), []);
  const id = useMemo(() => mk<Idea>(setIdeas, store.saveIdeas, (a, b) => b.created - a.created), []);
  const ex = useMemo(() => mk<Expense>(setExpenses, store.saveExpenses, (a, b) => b.date.localeCompare(a.date) || b.created - a.created), []);
  const ct = useMemo(() => mk<Contact>(setContacts, store.saveContacts, (a, b) => a.name.localeCompare(b.name)), []);
  const ev = useMemo(() => mk<AgendaEvent>(setEvents, store.saveEvents, (a, b) => a.start - b.start), []);

  /* ---------- routines ---------- */
  const [routineBusy, setRoutineBusy] = useState<string[]>([]);
  const routineBusyRef = useRef<string[]>([]);
  routineBusyRef.current = routineBusy;
  const routinesRef = useRef<Routine[]>(routines);
  routinesRef.current = routines;
  const skillsRef = useRef<Skill[]>(skills);
  skillsRef.current = skills;
  const workflowsRef = useRef<Workflow[]>(workflows);
  workflowsRef.current = workflows;

  const runRoutine = useCallback(
    async (r: Routine): Promise<{ ok: boolean; note: string }> => {
      if (routineBusyRef.current.includes(r.id)) return { ok: false, note: 'Already running.' };
      setRoutineBusy((p) => [...p, r.id]);
      const t0 = Date.now();
      let ok = true;
      let note = '';
      try {
        if (r.action.type === 'skill') {
          const sk = skillsRef.current.find((x: Skill) => x.id === r.action.ref);
          if (!sk) throw new Error('That skill no longer exists.');
          const res = await runSkill(sk, '', { runTool });
          ok = res.ok;
          note = res.output.slice(0, 120);
        } else if (r.action.type === 'workflow') {
          const w = workflowsRef.current.find((x: Workflow) => x.id === r.action.ref);
          if (!w) throw new Error('That workflow no longer exists.');
          const res = await runWorkflow(w, {
            runTool: async (tool, args) => {
              const rec = await runTool(tool, args);
              return { ok: rec.ok, summary: rec.summary, detail: rec.detail };
            },
            ask: async (prompt, mode) => {
              const a = await ask(prompt, mode);
              return { ok: a.ok, text: a.text };
            },
            notify: (m) => toast(m, 'info'),
          });
          setRuns((prev) => {
            const next = [res, ...prev].slice(0, 50);
            store.saveRuns(next);
            return next;
          });
          ok = res.status === 'ok';
          note = `workflow ${res.status}`;
        } else {
          const a = await ask(r.action.ref);
          ok = a.ok;
          note = a.ok ? a.text.slice(0, 120) : (a.error ?? 'Model call failed');
        }
        rt.save({ ...r, lastRun: Date.now(), runs: r.runs + 1 });
      } catch (e) {
        ok = false;
        note = e instanceof Error ? e.message : 'Routine failed';
        // A failing routine still records the attempt, otherwise it retries in a loop.
        rt.save({ ...r, lastRun: Date.now(), runs: r.runs + 1 });
      } finally {
        setRoutineBusy((p) => p.filter((x) => x !== r.id));
      }
      addTrace({ kind: 'workflow', label: `routine: ${r.name}`, ms: Date.now() - t0, ok, detail: note });
      return { ok, note };
    },
    [runTool, ask, addTrace, rt, toast],
  );

  /* ----------------------------------------------------------- calendar */

  const [calendars, setCalendars] = useState<CalendarImport[]>(() => store.loadCalendars());

  const importCalendar = useCallback(
    (name: string, text: string, source: string) => {
      const parsed = parseIcs(text);
      const cal: CalendarImport = {
        id: uid(),
        name: parsed.name && parsed.name !== 'Imported calendar' ? parsed.name : name,
        source,
        added: Date.now(),
        events: parsed.events,
        warnings: parsed.warnings,
      };
      setCalendars((cur) => {
        const next = [cal, ...cur];
        persist(() => store.saveCalendars(next), 'calendars');
        return next;
      });
      return cal;
    },
    [persist],
  );

  const removeCalendar = useCallback(
    (id: string) => {
      setCalendars((cur) => {
        const next = cur.filter((c) => c.id !== id);
        persist(() => store.saveCalendars(next), 'calendars');
        return next;
      });
    },
    [persist],
  );

  /* ---------------------------------------------------------- dashboard */

  const [dash, setDash] = useState<DashLayout>(() => store.loadDashboard());
  const putDash = useCallback(
    (next: DashLayout) => {
      setDash(next);
      persist(() => store.saveDashboard(next), 'the dashboard layout');
    },
    [persist],
  );
  const moveTile = useCallback((dragId: string, overId: string) => {
    setDash((cur) => {
      const next = reorderLayout(cur, dragId, overId);
      store.saveDashboard(next);
      return next;
    });
  }, []);
  const toggleTile = useCallback((id: string) => putDash(toggleHidden(dash, id)), [dash, putDash]);
  const resetDash = useCallback(() => putDash(defaultLayout()), [putDash]);

  /* ------------------------------------------------------------ library */

  const [projects, setProjects] = useState<Project[]>(() => sortProjects(store.loadProjects()));

  const persistProjects = useCallback(
    (next: Project[]) => {
      const sorted = sortProjects(next);
      setProjects(sorted);
      persist(() => store.saveProjects(sorted), 'the project library');
    },
    [persist],
  );

  const saveProject = useCallback(
    (p: Project) => {
      const stamped = { ...p, updated: Date.now() };
      persistProjects([...projects.filter((x) => x.id !== p.id), stamped]);
    },
    [projects, persistProjects],
  );

  const deleteProject = useCallback(
    (id: string) => persistProjects(projects.filter((p) => p.id !== id)),
    [projects, persistProjects],
  );

  /**
   * Write a merged sync result back to this device. Without this the sync
   * summary would report rows pulled while nothing actually landed locally.
   */
  const applySync = useCallback(
    (m: {
      conversations?: Conversation[]; memory?: MemoryItem[]; workflows?: Workflow[];
      skills?: Skill[]; routines?: Routine[]; ideas?: Idea[]; traces?: Trace[];
      crewRuns?: CrewRun[]; projects?: Project[]; expenses?: Expense[]; contacts?: Contact[]; events?: AgendaEvent[];
    }) => {
      if (m.conversations) { setConversations(m.conversations); persist(() => store.saveConversations(m.conversations!), 'conversations'); }
      if (m.memory) { setMemory(m.memory); persist(() => store.saveMemory(m.memory!), 'memory'); }
      if (m.workflows) { setWorkflows(m.workflows); persist(() => store.saveWorkflows(m.workflows!), 'workflows'); }
      if (m.skills) { setSkills(m.skills); persist(() => store.saveSkills(m.skills!), 'skills'); }
      if (m.routines) { setRoutines(m.routines); persist(() => store.saveRoutines(m.routines!), 'routines'); }
      if (m.ideas) { setIdeas(m.ideas); persist(() => store.saveIdeas(m.ideas!), 'ideas'); }
      if (m.traces) { setTraces(m.traces); persist(() => store.saveTraces(m.traces!), 'traces'); }
      if (m.crewRuns) { setCrewRuns(m.crewRuns); persist(() => store.saveCrewRuns(m.crewRuns!), 'crew runs'); }
      if (m.expenses) { setExpenses(m.expenses); persist(() => store.saveExpenses(m.expenses!), 'expenses'); }
      if (m.contacts) { setContacts(m.contacts); persist(() => store.saveContacts(m.contacts!), 'contacts'); }
      if (m.events) { setEvents(m.events); persist(() => store.saveEvents(m.events!), 'events'); }
      if (m.projects) { const sorted = sortProjects(m.projects); setProjects(sorted); persist(() => store.saveProjects(sorted), 'the project library'); }
    },
    [persist],
  );

  /* ------------------------------------------------------------ weather */

  const [weather, setWeatherState] = useState<MergedWeather | null>(() => store.loadWeather());
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const weatherBusyRef = useRef(false);

  const putWeather = useCallback((w: MergedWeather | null) => {
    setWeatherState(w);
    store.saveWeather(w);
  }, []);

  // Weather is a plain public API with no key, so it uses fetch directly rather
  // than the tool context -- it must not consume a mode's tool budget.
  const weatherFetch = useCallback(async (url: string): Promise<unknown> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`The weather service answered ${r.status}.`);
    return r.json();
  }, []);

  const refreshWeather = useCallback(
    async (force = false) => {
      const place = settingsRef.current.weatherPlace;
      if (!place || !settingsRef.current.weatherOn) return;
      if (weatherBusyRef.current) return;
      // A doomed request while offline just produces a console error and a
      // scary toast. The cached reading with its age label is the honest view.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setWeatherError('Offline \u2014 showing the last reading.');
        return;
      }
      if (!force && !isRefreshDue(weatherRef.current, Date.now())) return;
      // A cached reading for a different place must never be shown as current.
      const stale = weatherRef.current;
      if (stale && (stale.place.lat !== place.lat || stale.place.lon !== place.lon)) putWeather(null);
      weatherBusyRef.current = true;
      setWeatherBusy(true);
      setWeatherError(null);
      try {
        putWeather(await fetchAllWeather(place, weatherFetch));
      } catch (e) {
        setWeatherError(e instanceof Error ? e.message : 'The weather lookup failed.');
      } finally {
        weatherBusyRef.current = false;
        setWeatherBusy(false);
      }
    },
    [putWeather, weatherFetch],
  );

  const setWeatherPlace = useCallback(
    async (query: string) => {
      const place = await geocode(query, weatherFetch);
      setSettings({ weatherPlace: place });
      settingsRef.current = { ...settingsRef.current, weatherPlace: place };
      putWeather(null);
      await refreshWeather(true);
      return place;
    },
    [refreshWeather, putWeather, weatherFetch],
  );

  const useDeviceLocation = useCallback(async () => {
    if (!('geolocation' in navigator)) throw new Error('This browser has no location service.');
    const pos = await new Promise<GeolocationPosition>((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, (err) => rej(new Error(geoMessage(err))), {
        timeout: 12_000,
        maximumAge: 10 * 60_000,
      });
    });
    const place: WeatherPlace = {
      name: 'My location',
      lat: Number(pos.coords.latitude.toFixed(3)),
      lon: Number(pos.coords.longitude.toFixed(3)),
    };
    // Name it properly when the reverse lookup works; keep the fix either way.
    try {
      const r = (await weatherFetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${place.lat},${place.lon}&count=1&language=en&format=json`,
      )) as { results?: { name: string; admin1?: string; country_code?: string }[] };
      const hit = r.results?.[0];
      if (hit) {
        place.name = hit.name;
        place.admin = hit.admin1;
        place.country = hit.country_code;
      }
    } catch {
      /* the coordinates are enough; a missing label is not a failure */
    }
    setSettings({ weatherPlace: place });
    settingsRef.current = { ...settingsRef.current, weatherPlace: place };
    putWeather(null);
    await refreshWeather(true);
    return place;
  }, [refreshWeather, putWeather, weatherFetch]);

  // Refresh on open, then every half hour while the tab is actually visible.
  useEffect(() => {
    if (!settings.weatherOn || !settings.weatherPlace) return;
    const tick = () => {
      if (document.hidden) return;
      void refreshWeather();
    };
    const first = setTimeout(tick, 600);
    const iv = setInterval(tick, REFRESH_EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [settings.weatherOn, settings.weatherPlace, refreshWeather]);

  // The ticker. A browser tab cannot wake itself, so this only fires while the
  // app is open -- which is exactly what the Routines screen promises.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      const due = dueRoutines(routinesRef.current).filter((r) => !routineBusyRef.current.includes(r.id));
      for (const r of due.slice(0, 1)) {
        const out = await runRoutine(r);
        toast(`${r.name}: ${out.note || (out.ok ? 'done' : 'failed')}`, out.ok ? 'ok' : 'err');
      }
    };
    const first = setTimeout(() => void tick(), 4_000);
    const iv = setInterval(() => void tick(), 30_000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [runRoutine]);

  const providerReady = isConfigured(settings.provider);

  const api: AppApi = {
    settings,
    setSettings,
    conversations,
    activeId,
    active: conversations.find((c) => c.id === activeId) ?? null,
    newConversation,
    openConversation: setActiveId,
    deleteConversation: (cid) => {
      const next = conversations.filter((c) => c.id !== cid);
      writeConvs(next);
      if (activeId === cid) setActiveId(next[0]?.id ?? null);
    },
    renameConversation: (cid, title) => writeConvs(conversations.map((c) => (c.id === cid ? { ...c, title, updated: Date.now() } : c))),
    setConversationMode: (cid, m) => writeConvs(conversations.map((c) => (c.id === cid ? { ...c, mode: m } : c))),
    appendMessage,
    patchMessage,

    memory,
    addMemory: (m) => writeMemory([{ ...m, id: uid('mem'), created: Date.now() }, ...memoryRef.current]),
    learnFrom,
    serverFacts,
    refreshServerFacts,
    removeMemory: (mid) => writeMemory(memoryRef.current.filter((m) => m.id !== mid)),
    togglePin: (mid) => writeMemory(memoryRef.current.map((m) => (m.id === mid ? { ...m, pinned: !m.pinned } : m))),

    workflows,
    saveWorkflow: wf.save,
    deleteWorkflow: wf.remove,
    runs,
    addRun: (r) =>
      setRuns((prev) => {
        const next = [r, ...prev].slice(0, 50);
        store.saveRuns(next);
        return next;
      }),

    crewRuns,
    addCrewRun: (r) =>
      setCrewRuns((prev) => {
        const next = [r, ...prev].slice(0, 30);
        store.saveCrewRuns(next);
        return next;
      }),

    skills,
    saveSkill: sk.save,
    deleteSkill: sk.remove,
    routines,
    saveRoutine: rt.save,
    deleteRoutine: rt.remove,
    ideas,
    saveIdea: id.save,
    deleteIdea: id.remove,
    expenses,
    saveExpense: ex.save,
    deleteExpense: ex.remove,
    contacts,
    saveContact: ct.save,
    deleteContact: ct.remove,
    events,
    saveEvent: ev.save,
    deleteEvent: ev.remove,

    traces,
    addTrace,
    clearTraces: () => {
      setTraces([]);
      store.saveTraces([]);
    },

    sandbox,
    setSandbox,
    cloud,
    setCloud: (c) => {
      setCloudState(c);
      store.saveCloud(c);
    },

    toasts,
    toast,
    dismissToast: (tid) => setToasts((t) => t.filter((x) => x.id !== tid)),

    approval,
    answerApproval,

    makeToolCtx: buildCtx,
    runTool,
    ask,
    runTask,
    resolveProvider,
    testProvider,
    calendars,
    importCalendar,
    removeCalendar,
    dash,
    moveTile,
    toggleTile,
    resetDash,
    applySync,
    projects,
    saveProject,
    deleteProject,
    weather,
    weatherBusy,
    weatherError,
    refreshWeather,
    setWeatherPlace,
    useDeviceLocation,
    runRoutine,
    routineBusy,
    pendingPrompt,
    setPendingPrompt,

    providerReady,
    online,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/* ---------------- helpers shared by screens ---------------- */

export const ALL_TOOLS = TOOLS;
export const providerLabel = (id: string): string => specOf(id as never).label;
export const warnIfSecret = (text: string): string[] => detect(text).map((f) => `${f.label} x${f.count}`);

/** Geolocation errors are numeric codes; say what actually happened. */
function geoMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Location permission was denied, so no place was saved.';
  if (err.code === err.POSITION_UNAVAILABLE) return 'This device could not determine a position.';
  if (err.code === err.TIMEOUT) return 'The location request timed out.';
  return 'The location request failed.';
}
