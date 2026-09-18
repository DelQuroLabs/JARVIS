// Tool execution context. Kept in its own module so tools.ts never has to import
// the store (the previous build's circular-import blank-screen bug).

import type { MemoryStore, PrivacyLevel, ServiceId, ToolCtx } from './types.ts';

export interface CtxOptions {
  fs: Record<string, string>;
  onFsChange?: (fs: Record<string, string>) => void;
  privacy?: PrivacyLevel;
  memory: MemoryStore;
  approve?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  log?: (line: string) => void;
  now?: () => number;
  /** Optional third-party keys, looked up by tools that can use them. */
  serviceKeys?: Partial<Record<ServiceId, string>>;
}

export function makeCtx(opts: CtxOptions): ToolCtx {
  const fs = { ...opts.fs };
  const lines: string[] = [];
  return {
    fs,
    writeFs(path, content) {
      fs[path] = content;
      opts.onFsChange?.({ ...fs });
    },
    deleteFs(path) {
      delete fs[path];
      opts.onFsChange?.({ ...fs });
    },
    privacy: opts.privacy ?? 'GUARDED',
    approve: opts.approve ?? (async () => false),
    log(line) {
      lines.push(line);
      opts.log?.(line);
    },
    memory: opts.memory,
    now: opts.now ?? (() => Date.now()),
    serviceKey: (id) => (opts.serviceKeys?.[id] ?? '').trim(),
    async fetchJson(url, init) {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as unknown;
    },
  };
}

/** In-memory memory store, used by tests and by any caller without persistence. */
export function memoryStoreFrom(
  read: () => import('./types.ts').MemoryItem[],
  write: (items: import('./types.ts').MemoryItem[]) => void,
): MemoryStore {
  return {
    all: read,
    add(item) {
      const full = { ...item, id: `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now() };
      write([full, ...read()]);
      return full;
    },
    remove(id) {
      write(read().filter((m) => m.id !== id));
    },
    search(q, limit = 5) {
      const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      if (!words.length) return read().slice(0, limit);
      return read()
        .map((m) => {
          const t = m.text.toLowerCase();
          const tags = m.tags.join(' ').toLowerCase();
          const score = words.reduce((n, w) => n + (t.includes(w) ? 2 : 0) + (tags.includes(w) ? 1 : 0), 0) + (m.pinned ? 1 : 0);
          return { m, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.m);
    },
  };
}
