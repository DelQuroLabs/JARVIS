// Routines: scheduled or triggered actions. A browser tab cannot wake itself, so
// interval routines only run while the app is open. The UI says so plainly.

import type { Routine } from './types.ts';
import { uid } from './util.ts';

export function blankRoutine(): Routine {
  return { id: uid('rt'), name: 'New routine', when: 'manual', action: { type: 'skill', ref: '' }, enabled: false, runs: 0 };
}

export function seedRoutines(): Routine[] {
  return [
    { id: 'rt_brief', name: 'Morning briefing', when: 'daily', atHour: 8, action: { type: 'workflow', ref: 'wf_daily' }, enabled: false, runs: 0 },
    { id: 'rt_tidy', name: 'Tidy pasted text', when: 'manual', action: { type: 'skill', ref: 'sk_clean' }, enabled: true, runs: 0 },
  ];
}

/** Is this routine due right now? Pure, so it is trivially testable. */
export function isDue(r: Routine, now: number): boolean {
  if (!r.enabled) return false;
  if (r.when === 'manual') return false;
  if (r.when === 'startup') return !r.lastRun;
  if (r.when === 'interval') {
    const every = Math.max(1, r.everyMin ?? 60) * 60_000;
    return !r.lastRun || now - r.lastRun >= every;
  }
  if (r.when === 'daily') {
    const d = new Date(now);
    if (d.getHours() < (r.atHour ?? 8)) return false;
    if (!r.lastRun) return true;
    const last = new Date(r.lastRun);
    return last.toDateString() !== d.toDateString();
  }
  return false;
}

export function dueRoutines(list: Routine[], now = Date.now()): Routine[] {
  return list.filter((r) => isDue(r, now));
}

export function describeSchedule(r: Routine): string {
  switch (r.when) {
    case 'manual': return 'Runs only when you tap it';
    case 'startup': return 'Runs once when the app opens';
    case 'interval': return `Every ${r.everyMin ?? 60} min while the app is open`;
    case 'daily': return `Daily at ${String(r.atHour ?? 8).padStart(2, '0')}:00, next time the app is open`;
  }
}
