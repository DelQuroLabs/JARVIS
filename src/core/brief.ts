/**
 * The briefing: a short spoken summary of what is going on right now.
 *
 * From JARVIS_Features.md, this is the "morning briefing" and "proactive
 * nudges" pair. Both are built from data the app already holds, so neither
 * needs a model or a key.
 *
 * Speech uses the browser's built-in SpeechSynthesis. That is free and offline
 * in most browsers, but it is genuinely absent in some, so the caller must
 * check `canSpeak()` and hide the control rather than offering a dead button.
 */

import type { MergedWeather } from './wxmerge.ts';
import { precipOutlook } from './wxmerge.ts';
import { temp, windLabel, type Units } from './weather.ts';

export interface BriefEvent {
  title: string;
  start: number;
  allDay: boolean;
}

export interface BriefInput {
  now: Date;
  weather: MergedWeather | null;
  units: Units;
  dueRoutines: string[];
  runs24h: number;
  providerLabel: string | null;
  online: boolean;
  /** The next few calendar events, already sorted. */
  events?: BriefEvent[];
}

export function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A precipitation nudge, or null when there is nothing worth saying.
 * Deliberately quiet: an alert that fires every day gets ignored.
 */
export function precipNudge(w: MergedWeather | null, units: Units): string | null {
  if (!w?.hours?.length) return null;
  const future = w.hours.filter((h) => h.t >= Date.now() - 3600_000);
  const o = precipOutlook(future, 6);
  if (o.startsInH === null) return null;
  const kind = o.snowCm > 0.05 ? 'Snow' : 'Rain';
  if (o.startsInH === 0) return `${kind} within the hour.`;
  if (o.startsInH <= 3) return `${kind} starting in about ${o.startsInH} hour${o.startsInH === 1 ? '' : 's'}.`;
  void units;
  return null;
}

/** A severe-weather nudge from the government feed, if any. */
export function alertNudge(w: MergedWeather | null): string | null {
  const a = w?.alerts?.[0];
  return a ? `${a.event} in effect.` : null;
}

/** The full briefing, as sentences. Every clause is dropped when unknown. */
export function buildBrief(i: BriefInput): string[] {
  const out: string[] = [];
  out.push(`${greeting(i.now.getHours())}.`);

  if (i.weather?.tempC !== undefined) {
    const t = temp(i.weather.tempC, i.units);
    const cond = i.weather.label ? `, ${i.weather.label.toLowerCase()}` : '';
    out.push(`It is ${t} degrees${cond} in ${i.weather.place.name}.`);
    if (i.weather.agreement === 'loose') {
      out.push('The forecasts disagree today, so treat that number loosely.');
    }
    if (i.weather.windKph !== undefined && i.weather.windKph > 25) {
      out.push(`Wind is up at ${windLabel(i.weather.windKph, i.units)}.`);
    }
    if (i.weather.air?.aqi !== undefined && i.weather.air.aqi > 100) {
      out.push(`Air quality is ${i.weather.air.band}, at ${i.weather.air.aqi}.`);
    }
  }

  const alert = alertNudge(i.weather);
  if (alert) out.push(alert);
  const rain = precipNudge(i.weather, i.units);
  if (rain) out.push(rain);

  const ev = (i.events ?? []).filter((e) => e.start > i.now.getTime() - 3600_000).slice(0, 2);
  if (ev.length) {
    const first = ev[0];
    const mins = Math.round((first.start - i.now.getTime()) / 60000);
    const whenText = first.allDay
      ? 'today'
      : mins <= 0 ? 'now'
      : mins < 60 ? `in ${mins} minutes`
      : `at ${new Date(first.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    out.push(`Next up: ${first.title}, ${whenText}.`);
    if (ev.length > 1) out.push(`Then ${ev[1].title}.`);
  }

  if (i.dueRoutines.length === 1) out.push(`One routine is due: ${i.dueRoutines[0]}.`);
  else if (i.dueRoutines.length > 1) out.push(`${i.dueRoutines.length} routines are due.`);

  if (i.runs24h > 0) out.push(`${i.runs24h} run${i.runs24h === 1 ? '' : 's'} in the last day.`);

  if (!i.online) out.push('You are offline, so live data is stale.');
  else if (!i.providerLabel) out.push('No model is connected, so I am running on the offline core.');

  return out;
}

/** Is browser speech available at all? */
export function canSpeak(): boolean {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis;
}
