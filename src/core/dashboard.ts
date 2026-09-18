/**
 * Dashboard layout.
 *
 * The dashboard is a grid of modular tiles the operator can rearrange and hide.
 * The registry lives here rather than in the screen so the layout can be
 * validated and unit-tested without a browser.
 *
 * Icons are plain strings on purpose: src/core must not import UI code.
 */

export type TileSize = 'lg' | 'sm';

export interface DashTile {
  id: string;
  to: string;
  icon: string;
  label: string;
  sub: string;
  tone: string;
  size: TileSize;
}

/**
 * Every tile the dashboard can show. Adding one here makes it appear at the end
 * of an existing layout rather than being dropped -- see normaliseLayout.
 */
export const DASH_TILES: DashTile[] = [
  { id: 'chat', to: '/app/chat', icon: 'chat', label: 'Ask', sub: 'Talk to it, tools and all', tone: 'accent', size: 'lg' },
  { id: 'agent', to: '/app/agent', icon: 'agent', label: 'Delegate', sub: 'Plan, act, verify', tone: 'violet', size: 'lg' },
  { id: 'library', to: '/app/library', icon: 'boxes', label: 'Library', sub: 'Every project you run', tone: 'ok', size: 'lg' },
  { id: 'workflows', to: '/app/workflows', icon: 'flow', label: 'Automate', sub: 'Wire steps together', tone: 'sky', size: 'lg' },
  { id: 'calendar', to: '/app/calendar', icon: 'clock', label: 'Calendar', sub: '', tone: 'violet', size: 'sm' },
  { id: 'weather', to: '/app/weather', icon: 'cloud-sun', label: 'Weather', sub: '', tone: 'sky', size: 'sm' },
  { id: 'tools', to: '/app/tools', icon: 'tools', label: 'Tools', sub: '', tone: 'accent', size: 'sm' },
  { id: 'skills', to: '/app/skills', icon: 'skills', label: 'Skills', sub: '', tone: 'violet', size: 'sm' },
  { id: 'routines', to: '/app/routines', icon: 'routine', label: 'Routines', sub: '', tone: 'sky', size: 'sm' },
  { id: 'crew', to: '/app/crew', icon: 'crew', label: 'Crew', sub: '', tone: 'amber', size: 'sm' },
  { id: 'memory', to: '/app/memory', icon: 'memory', label: 'Memory', sub: '', tone: 'ok', size: 'sm' },
  { id: 'ideas', to: '/app/ideas', icon: 'idea', label: 'Ideas', sub: '', tone: 'amber', size: 'sm' },
  { id: 'traces', to: '/app/traces', icon: 'trace', label: 'Activity', sub: '', tone: 'rose', size: 'sm' },
  { id: 'modes', to: '/app/modes', icon: 'mode', label: 'Modes', sub: '', tone: 'violet', size: 'sm' },
  { id: 'providers', to: '/app/providers', icon: 'key', label: 'Keys', sub: '', tone: 'accent', size: 'sm' },
  { id: 'cloud', to: '/app/cloud', icon: 'cloud', label: 'Cloud', sub: '', tone: 'sky', size: 'sm' },
  { id: 'diagnostics', to: '/app/diagnostics', icon: 'pulse', label: 'Checks', sub: '', tone: 'ok', size: 'sm' },
  { id: 'settings', to: '/app/settings', icon: 'settings', label: 'Settings', sub: '', tone: 'rose', size: 'sm' },
  { id: 'help', to: '/app/help', icon: 'book', label: 'Help', sub: '', tone: 'accent', size: 'sm' },
];

export const TILE_MAP: Record<string, DashTile> = Object.fromEntries(DASH_TILES.map((t) => [t.id, t]));

export interface DashLayout {
  /** Tile ids in display order. */
  order: string[];
  /** Tile ids the operator has hidden. They stay listed so they can return. */
  hidden: string[];
}

export const defaultLayout = (): DashLayout => ({ order: DASH_TILES.map((t) => t.id), hidden: [] });

/**
 * Reconcile a stored layout with the current registry.
 *
 * - Unknown ids are dropped, so a removed feature cannot leave a dead tile.
 * - New ids are appended, so shipping a feature never hides it from someone
 *   who already has a saved layout. This is the whole reason the layout is
 *   stored as ids rather than as a snapshot of the tiles.
 */
export function normaliseLayout(stored: Partial<DashLayout> | null | undefined): DashLayout {
  const known = new Set(DASH_TILES.map((t) => t.id));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of stored?.order ?? []) {
    if (known.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const t of DASH_TILES) if (!seen.has(t.id)) order.push(t.id);
  const hidden = [...new Set((stored?.hidden ?? []).filter((id) => known.has(id)))];
  return { order, hidden };
}

/** The tiles to render, in order, excluding hidden ones. */
export function visibleTiles(layout: DashLayout): DashTile[] {
  const hidden = new Set(layout.hidden);
  return layout.order.filter((id) => !hidden.has(id)).map((id) => TILE_MAP[id]).filter(Boolean);
}

export function hiddenTiles(layout: DashLayout): DashTile[] {
  return layout.hidden.map((id) => TILE_MAP[id]).filter(Boolean);
}

/**
 * Move the item at `from` so it sits at index `to`, shifting the rest.
 * Out-of-range indices return the list untouched rather than throwing.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Move one tile id in front of another. Both must be visible. */
export function reorderLayout(layout: DashLayout, dragId: string, overId: string): DashLayout {
  const from = layout.order.indexOf(dragId);
  const to = layout.order.indexOf(overId);
  if (from < 0 || to < 0) return layout;
  return { ...layout, order: moveItem(layout.order, from, to) };
}

export function toggleHidden(layout: DashLayout, id: string): DashLayout {
  if (!TILE_MAP[id]) return layout;
  return layout.hidden.includes(id)
    ? { ...layout, hidden: layout.hidden.filter((x) => x !== id) }
    : { ...layout, hidden: [...layout.hidden, id] };
}
