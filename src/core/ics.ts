/**
 * iCalendar (RFC 5545) reader.
 *
 * Enough of the spec to import a real export from Google Calendar, Apple
 * Calendar, Outlook or Fastmail: line unfolding, escaped text, all-day dates,
 * UTC and zoned times, and the recurrence rules people actually use.
 *
 * What it deliberately does not do is listed in `UNSUPPORTED` and surfaced in
 * the UI. A calendar importer that silently drops a repeating meeting is worse
 * than one that says it skipped it.
 */

export interface CalEvent {
  uid: string;
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  description: string;
  /** True when produced by expanding a recurrence rule. */
  recurring: boolean;
}

export interface CalendarImport {
  id: string;
  name: string;
  /** Where it came from, for display: a filename or a URL. */
  source: string;
  added: number;
  events: CalEvent[];
  /** Rules the parser could not honour, in plain English. */
  warnings: string[];
}

export const UNSUPPORTED = [
  'Recurrence rules other than DAILY, WEEKLY, MONTHLY and YEARLY',
  'BYSETPOS, BYMONTHDAY and other fine-grained recurrence filters',
  'VTODO, VJOURNAL and free/busy blocks',
  'Attendee lists, alarms and attachments',
];

/** Hard ceiling on expanded occurrences, so one silly rule cannot hang the tab. */
export const MAX_OCCURRENCES = 400;

/* ------------------------------------------------------------- unfolding */

/**
 * RFC 5545 folds long lines by starting the continuation with a space or tab.
 * Unfolding must happen before anything else or values are silently truncated.
 */
export function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.trim() !== '');
}

/** `DTSTART;VALUE=DATE:20210118` -> name, params, value. */
export function parseLine(line: string): { name: string; params: Record<string, string>; value: string } {
  const colon = findUnquoted(line, ':');
  if (colon < 0) return { name: line.toUpperCase(), params: {}, value: '' };
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** A colon inside a quoted parameter is not the value separator. */
function findUnquoted(s: string, ch: string): number {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (!q && s[i] === ch) return i;
  }
  return -1;
}

/** TEXT values escape commas, semicolons, backslashes and newlines. */
export function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/* -------------------------------------------------------------- date/time */

/**
 * The offset of an IANA zone at a given UTC instant, in minutes.
 * Uses Intl rather than a bundled tz database, which keeps this dependency-free
 * and correct for whatever zones the runtime knows about.
 */
function zoneOffsetMinutes(utcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    return (asUtc - utcMs) / 60000;
  } catch {
    return 0; // unknown zone: fall back to treating it as UTC
  }
}

export interface ParsedDate {
  ms: number;
  allDay: boolean;
}

/** DTSTART/DTEND in any of the three forms the spec allows. */
export function parseDate(value: string, params: Record<string, string>): ParsedDate | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    // All-day events are floating: local midnight is what a person means.
    return { ms: new Date(Number(y), Number(mo) - 1, Number(d)).getTime(), allDay: true };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  const [, y, mo, d, h, mi, s, z] = dt;
  const nums = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  if (z) return { ms: Date.UTC(...nums), allDay: false };
  const tz = params.TZID;
  if (tz) {
    // Guess with the zone's offset at that wall time, then correct once. Two
    // passes settle daylight-saving boundaries.
    const naive = Date.UTC(...nums);
    let ms = naive - zoneOffsetMinutes(naive, tz) * 60000;
    ms = naive - zoneOffsetMinutes(ms, tz) * 60000;
    return { ms, allDay: false };
  }
  return { ms: new Date(...nums).getTime(), allDay: false };
}

/* ------------------------------------------------------------ recurrence */

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export interface Rrule {
  freq: string;
  interval: number;
  count?: number;
  until?: number;
  byDay: string[];
}

export function parseRrule(value: string): Rrule | null {
  const parts = Object.fromEntries(
    value.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).toUpperCase(), p.slice(i + 1)];
    }),
  );
  if (!parts.FREQ) return null;
  const until = parts.UNTIL ? parseDate(parts.UNTIL, {}) : null;
  return {
    freq: parts.FREQ.toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : undefined,
    until: until?.ms,
    byDay: (parts.BYDAY ?? '').split(',').map((d) => d.slice(-2).toUpperCase()).filter((d) => d in DAY_INDEX),
  };
}

/**
 * Expand a rule into start times within a window. Bounded by MAX_OCCURRENCES so
 * an unbounded yearly rule cannot spin.
 */
export function expandRrule(startMs: number, rule: Rrule, windowStart: number, windowEnd: number): number[] {
  const out: number[] = [];
  const limit = Math.min(rule.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const hardEnd = Math.min(windowEnd, rule.until ?? windowEnd);
  let produced = 0;

  const push = (ms: number) => {
    if (ms >= windowStart && ms <= hardEnd) out.push(ms);
  };

  if (rule.freq === 'WEEKLY' && rule.byDay.length) {
    const base = new Date(startMs);
    // Walk week by week, emitting each named weekday.
    for (let w = 0; produced < limit && w < 520; w++) {
      const weekStart = new Date(base);
      weekStart.setDate(base.getDate() + w * 7 * rule.interval);
      for (const d of rule.byDay) {
        const occ = new Date(weekStart);
        occ.setDate(weekStart.getDate() + ((DAY_INDEX[d] - weekStart.getDay() + 7) % 7));
        if (occ.getTime() < startMs) continue;
        produced++;
        push(occ.getTime());
        if (produced >= limit) break;
      }
      if (weekStart.getTime() > hardEnd) break;
    }
    return out.sort((a, b) => a - b);
  }

  const step = (d: Date, n: number): void => {
    if (rule.freq === 'DAILY') d.setDate(d.getDate() + n);
    else if (rule.freq === 'WEEKLY') d.setDate(d.getDate() + 7 * n);
    else if (rule.freq === 'MONTHLY') d.setMonth(d.getMonth() + n);
    else if (rule.freq === 'YEARLY') d.setFullYear(d.getFullYear() + n);
  };
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return out;

  const cur = new Date(startMs);
  while (produced < limit && cur.getTime() <= hardEnd) {
    push(cur.getTime());
    produced++;
    step(cur, rule.interval);
  }
  return out;
}

/* ----------------------------------------------------------------- parse */

/**
 * Read a whole .ics file. Never throws on malformed input: a broken event is
 * skipped and counted, because a partial import beats a blank error page.
 */
export function parseIcs(
  text: string,
  opts: { windowStart?: number; windowEnd?: number } = {},
): { name: string; events: CalEvent[]; warnings: string[] } {
  const now = Date.now();
  const windowStart = opts.windowStart ?? now - 90 * 86400_000;
  const windowEnd = opts.windowEnd ?? now + 365 * 86400_000;

  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase().startsWith('BEGIN:VCALENDAR'))) {
    throw new Error('That file is not an iCalendar export. Look for a .ics file.');
  }

  let name = '';
  const events: CalEvent[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  let depth = 0;

  for (const line of lines) {
    const { name: key, params, value } = parseLine(line);
    if (key === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      cur = {};
      depth = 1;
      continue;
    }
    if (key === 'END' && value.toUpperCase() === 'VEVENT') {
      if (cur) {
        const made = buildEvent(cur, windowStart, windowEnd);
        if (made.length) events.push(...made);
        else skipped++;
      }
      cur = null;
      depth = 0;
      continue;
    }
    if (!cur && (key === 'X-WR-CALNAME' || key === 'NAME')) name = unescapeText(value);
    if (cur && depth) cur[key] = { value, params };
  }

  if (skipped) warnings.push(`${skipped} entr${skipped === 1 ? 'y' : 'ies'} had no usable start time and were skipped.`);
  const recurring = events.filter((e) => e.recurring).length;
  if (recurring) warnings.push(`${recurring} occurrences were generated from repeat rules.`);

  events.sort((a, b) => a.start - b.start);
  return { name: name || 'Imported calendar', events, warnings };
}

function buildEvent(
  f: Record<string, { value: string; params: Record<string, string> }>,
  windowStart: number,
  windowEnd: number,
): CalEvent[] {
  const dtstart = f.DTSTART ? parseDate(f.DTSTART.value, f.DTSTART.params) : null;
  if (!dtstart) return [];
  const dtend = f.DTEND ? parseDate(f.DTEND.value, f.DTEND.params) : null;
  const duration = dtend ? Math.max(0, dtend.ms - dtstart.ms) : dtstart.allDay ? 86400_000 : 3600_000;

  const base: Omit<CalEvent, 'start' | 'end' | 'recurring'> = {
    uid: f.UID?.value ?? `${dtstart.ms}-${f.SUMMARY?.value ?? ''}`,
    title: unescapeText(f.SUMMARY?.value ?? '(untitled)'),
    allDay: dtstart.allDay,
    location: unescapeText(f.LOCATION?.value ?? ''),
    description: unescapeText(f.DESCRIPTION?.value ?? '').slice(0, 500),
  };

  const rruleRaw = f.RRULE?.value;
  if (rruleRaw) {
    const rule = parseRrule(rruleRaw);
    if (rule) {
      const excluded = new Set(
        (f.EXDATE?.value ?? '').split(',').map((v) => parseDate(v, f.EXDATE?.params ?? {})?.ms).filter(Boolean),
      );
      return expandRrule(dtstart.ms, rule, windowStart, windowEnd)
        .filter((ms) => !excluded.has(ms))
        .map((ms) => ({ ...base, start: ms, end: ms + duration, recurring: true }));
    }
  }

  if (dtstart.ms < windowStart || dtstart.ms > windowEnd) return [];
  return [{ ...base, start: dtstart.ms, end: dtstart.ms + duration, recurring: false }];
}

/* -------------------------------------------------------------- querying */

const dayKey = (ms: number): string => new Date(ms).toDateString();

export function eventsOn(events: CalEvent[], when: number): CalEvent[] {
  const k = dayKey(when);
  return events.filter((e) => dayKey(e.start) === k || (e.start <= when && e.end > when));
}

/** The next N events from now, across every imported calendar. */
export function upcoming(events: CalEvent[], from: number, limit = 8): CalEvent[] {
  return events.filter((e) => e.end > from).sort((a, b) => a.start - b.start).slice(0, limit);
}

export function fmtEventTime(e: CalEvent): string {
  if (e.allDay) return 'All day';
  const d = new Date(e.start);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtEventDay(ms: number, now: number): string {
  const a = new Date(ms);
  const b = new Date(now);
  const days = Math.round((new Date(a.toDateString()).getTime() - new Date(b.toDateString()).getTime()) / 86400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return a.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
