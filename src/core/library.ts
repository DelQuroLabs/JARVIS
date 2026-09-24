/**
 * The project library.
 *
 * JARVIS is the home base, so every project the operator runs gets a card here:
 * what it is, where it lives, and enough of a rebuild spec that the thing could
 * be reconstructed from this record alone.
 *
 * Attachments are stored inline as data URLs. That is deliberate -- it keeps the
 * library working with no backend -- but browser storage is small, so the size
 * accounting in this file is load-bearing and the UI must show it honestly.
 */

export type ProjectStatus = 'idea' | 'building' | 'live' | 'paused' | 'archived';

export interface Attachment {
  id: string;
  name: string;
  /** MIME type as reported by the file input. */
  kind: string;
  /** Bytes of the original file, before base64 expansion. */
  size: number;
  /** data: URL. Images render inline; everything else downloads. */
  data: string;
  added: number;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  /** One line. Shown on the card. */
  tagline: string;
  status: ProjectStatus;
  /** Free tags, same vocabulary as the idea library. */
  tags: string[];
  /** The long description. Markdown. */
  about: string;
  /** Everything needed to rebuild it: stack, architecture, decisions, gotchas. */
  spec: string;
  /** Launch targets. The first is treated as the primary. */
  links: ProjectLink[];
  attachments: Attachment[];
  /** Hex accent for the card, or '' to use the app accent. */
  colour: string;
  pinned: boolean;
  created: number;
  updated: number;
}

export const STATUSES: { id: ProjectStatus; label: string; tone: string }[] = [
  { id: 'idea', label: 'Idea', tone: 'info' },
  { id: 'building', label: 'Building', tone: 'warn' },
  { id: 'live', label: 'Live', tone: 'ok' },
  { id: 'paused', label: 'Paused', tone: 'default' },
  { id: 'archived', label: 'Archived', tone: 'default' },
];

export const statusOf = (id: string): { id: ProjectStatus; label: string; tone: string } =>
  STATUSES.find((s) => s.id === id) ?? STATUSES[0];

/* ------------------------------------------------------------------ limits */

/**
 * localStorage is typically a 5 MB budget for the whole origin, shared with
 * conversations, memory and everything else. These caps keep one screenshot
 * from evicting the rest of the app.
 */
export const MAX_ATTACHMENT_BYTES = 1_200_000;
export const MAX_LIBRARY_BYTES = 3_500_000;

/** Base64 inflates by about 4/3, plus a little JSON overhead. */
export const encodedSize = (a: Attachment): number => a.data.length;

export const librarySize = (projects: Project[]): number =>
  projects.reduce((n, p) => n + p.attachments.reduce((m, a) => m + encodedSize(a), 0), 0);

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether one more attachment fits, and why not when it does not. */
export function canAttach(projects: Project[], bytes: number): { ok: boolean; reason: string } {
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `That file is ${fmtBytes(bytes)}. The per-file ceiling is ${fmtBytes(MAX_ATTACHMENT_BYTES)} because attachments live in browser storage.`,
    };
  }
  const used = librarySize(projects);
  if (used + bytes * 1.37 > MAX_LIBRARY_BYTES) {
    return {
      ok: false,
      reason: `The library is using ${fmtBytes(used)} of its ${fmtBytes(MAX_LIBRARY_BYTES)} budget. Remove an attachment first.`,
    };
  }
  return { ok: true, reason: '' };
}

export const isImage = (a: Attachment): boolean => a.kind.startsWith('image/');

/* ------------------------------------------------------------- operations */

export function blankProject(id: string, now: number): Project {
  return {
    id,
    name: '',
    tagline: '',
    status: 'idea',
    tags: [],
    about: '',
    spec: '',
    links: [],
    attachments: [],
    colour: '',
    pinned: false,
    created: now,
    updated: now,
  };
}

/** Problems that must be fixed before a project can be saved. */
export function validateProject(p: Project): string[] {
  const out: string[] = [];
  if (!p.name.trim()) out.push('A project needs a name.');
  for (const l of p.links) {
    if (!l.url.trim()) continue;
    if (!/^https?:\/\//i.test(l.url)) out.push(`"${l.url}" is not a http(s) link.`);
  }
  return out;
}

/** Pinned first, then most recently updated. */
export function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updated - a.updated;
  });
}

/** Name, tagline, tags, about and spec are all searchable. */
export function filterProjects(list: Project[], query: string, status: string): Project[] {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (status !== 'all' && p.status !== status) return false;
    if (!q) return true;
    return [p.name, p.tagline, p.about, p.spec, p.tags.join(' ')].join(' ').toLowerCase().includes(q);
  });
}

/** Every tag in use, most common first. */
export function allTags(list: Project[]): string[] {
  const counts = new Map<string, number>();
  for (const p of list) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/**
 * A portable text dump of one project. This is what "full rebuild spec" means:
 * paste it into a fresh agent session and it has everything except the binaries.
 */
export function projectToMarkdown(p: Project): string {
  const lines = [`# ${p.name}`, ''];
  if (p.tagline) lines.push(`> ${p.tagline}`, '');
  lines.push(`**Status:** ${statusOf(p.status).label}`);
  if (p.tags.length) lines.push(`**Tags:** ${p.tags.join(', ')}`);
  if (p.links.length) {
    lines.push('', '## Links');
    for (const l of p.links) lines.push(`- ${l.label || 'Link'}: ${l.url}`);
  }
  if (p.about.trim()) lines.push('', '## About', '', p.about.trim());
  if (p.spec.trim()) lines.push('', '## Rebuild spec', '', p.spec.trim());
  if (p.attachments.length) {
    lines.push('', '## Attachments');
    for (const a of p.attachments) lines.push(`- ${a.name} (${a.kind || 'unknown type'}, ${fmtBytes(a.size)})`);
    lines.push('', '_Attachment contents are binary and are not included in this text dump._');
  }
  lines.push('', `_Created ${new Date(p.created).toISOString().slice(0, 10)}, updated ${new Date(p.updated).toISOString().slice(0, 10)}._`);
  return lines.join('\n');
}
