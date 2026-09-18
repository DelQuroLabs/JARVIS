import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from './.build/core.mjs';

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => wrap(`BEGIN:VEVENT\r\n${lines}\r\nEND:VEVENT`);
const WIN = { windowStart: Date.parse('2020-01-01'), windowEnd: Date.parse('2030-01-01') };

test('line unfolding', async (t) => {
  await t.test('a folded value is rejoined before parsing', () => {
    const out = C.unfold('SUMMARY:Quarterly plan\r\n ning meeting\r\nUID:1');
    assert.equal(out[0], 'SUMMARY:Quarterly planning meeting');
  });
  await t.test('tab continuations count too', () => {
    assert.equal(C.unfold('A:one\n\ttwo')[0], 'A:onetwo');
  });
  await t.test('blank lines are dropped', () => {
    assert.equal(C.unfold('A:1\n\n\nB:2').length, 2);
  });
});

test('property parsing', async (t) => {
  await t.test('splits name, params and value', () => {
    const r = C.parseLine('DTSTART;TZID=America/New_York:20260905T090000');
    assert.equal(r.name, 'DTSTART');
    assert.equal(r.params.TZID, 'America/New_York');
    assert.equal(r.value, '20260905T090000');
  });
  await t.test('a colon inside a quoted param is not the separator', () => {
    const r = C.parseLine('ATTENDEE;CN="Smith:Jane":mailto:j@x.com');
    assert.equal(r.params.CN, 'Smith:Jane');
    assert.equal(r.value, 'mailto:j@x.com');
  });
  await t.test('escaped text is unescaped', () => {
    assert.equal(C.unescapeText('Line one\\nLine two\\, with comma'), 'Line one\nLine two, with comma');
  });
});

test('dates', async (t) => {
  await t.test('an all-day date is local midnight, not UTC', () => {
    const d = C.parseDate('20260905', {});
    assert.equal(d.allDay, true);
    assert.equal(new Date(d.ms).getDate(), 5, 'the calendar day must not shift');
  });
  await t.test('a UTC timestamp is exact', () => {
    const d = C.parseDate('20260905T143000Z', {});
    assert.equal(d.ms, Date.UTC(2026, 8, 5, 14, 30, 0));
    assert.equal(d.allDay, false);
  });
  await t.test('a zoned time is converted using the real offset', () => {
    // 09:00 in New York during DST is 13:00 UTC.
    const d = C.parseDate('20260905T090000', { TZID: 'America/New_York' });
    assert.equal(new Date(d.ms).toISOString(), '2026-09-05T13:00:00.000Z');
  });
  await t.test('a winter zoned time uses the winter offset', () => {
    const d = C.parseDate('20260115T090000', { TZID: 'America/New_York' });
    assert.equal(new Date(d.ms).toISOString(), '2026-01-15T14:00:00.000Z');
  });
  await t.test('an unparseable date returns null rather than NaN', () => {
    assert.equal(C.parseDate('not-a-date', {}), null);
  });
});

test('recurrence', async (t) => {
  await t.test('a weekly rule with BYDAY hits each named day', () => {
    const start = Date.parse('2026-09-07T09:00:00Z'); // a Monday
    const rule = C.parseRrule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4');
    const out = C.expandRrule(start, rule, start - 1, start + 40 * 86400_000);
    assert.equal(out.length, 4);
    const days = out.map((m) => new Date(m).getDay());
    assert.ok(days.every((d) => d === 1 || d === 3), `expected Mon/Wed, got ${days}`);
  });
  await t.test('COUNT is honoured', () => {
    const start = Date.parse('2026-09-07T09:00:00Z');
    const out = C.expandRrule(start, C.parseRrule('FREQ=DAILY;COUNT=3'), start - 1, start + 365 * 86400_000);
    assert.equal(out.length, 3);
  });
  await t.test('UNTIL stops the series', () => {
    const start = Date.parse('2026-09-07T09:00:00Z');
    const rule = C.parseRrule('FREQ=DAILY;UNTIL=20260910T000000Z');
    const out = C.expandRrule(start, rule, start - 1, start + 365 * 86400_000);
    assert.ok(out.length <= 4 && out.length >= 3, `expected ~3-4 occurrences, got ${out.length}`);
  });
  await t.test('INTERVAL skips periods', () => {
    const start = Date.parse('2026-09-07T09:00:00Z');
    const out = C.expandRrule(start, C.parseRrule('FREQ=DAILY;INTERVAL=3;COUNT=3'), start - 1, start + 40 * 86400_000);
    assert.equal(Math.round((out[1] - out[0]) / 86400_000), 3);
  });
  await t.test('an unbounded rule is capped rather than spinning forever', () => {
    const start = Date.parse('2020-01-01T09:00:00Z');
    const out = C.expandRrule(start, C.parseRrule('FREQ=DAILY'), start, start + 50 * 365 * 86400_000);
    assert.ok(out.length <= C.MAX_OCCURRENCES, `produced ${out.length}`);
  });
  await t.test('an unsupported frequency yields nothing instead of guessing', () => {
    const start = Date.now();
    assert.deepEqual(C.expandRrule(start, C.parseRrule('FREQ=SECONDLY;COUNT=5'), start - 1, start + 1e9), []);
  });
});

test('whole-file import', async (t) => {
  await t.test('a real Google Calendar export parses', () => {
    const text = readFileSync(new URL('./fixtures/google-holidays.ics', import.meta.url), 'utf8');
    const r = C.parseIcs(text, { windowStart: Date.parse('2000-01-01'), windowEnd: Date.parse('2040-01-01') });
    assert.ok(r.events.length >= 30, `only ${r.events.length} events`);
    assert.match(r.name, /Holidays/i);
    assert.ok(r.events.every((e) => Number.isFinite(e.start) && e.end >= e.start), 'an event has a broken time range');
    assert.ok(r.events.every((e) => e.title && e.title !== '(untitled)'), 'an event lost its title');
    assert.ok(r.events.some((e) => e.allDay), 'holidays should be all-day');
  });
  await t.test('events come back in chronological order', () => {
    const text = readFileSync(new URL('./fixtures/google-holidays.ics', import.meta.url), 'utf8');
    const r = C.parseIcs(text, { windowStart: Date.parse('2000-01-01'), windowEnd: Date.parse('2040-01-01') });
    for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].start >= r.events[i - 1].start);
  });
  await t.test('a non-calendar file is rejected with a readable message', () => {
    assert.throws(() => C.parseIcs('just some text'), /not an iCalendar export/);
  });
  await t.test('an event with no start is skipped and counted, not fatal', () => {
    const r = C.parseIcs(ev('UID:1\r\nSUMMARY:No start here'), WIN);
    assert.equal(r.events.length, 0);
    assert.match(r.warnings.join(' '), /skipped/);
  });
  await t.test('a missing DTEND gets a sensible duration', () => {
    const r = C.parseIcs(ev('UID:1\r\nSUMMARY:Standup\r\nDTSTART:20260905T090000Z'), WIN);
    assert.equal(r.events[0].end - r.events[0].start, 3600_000);
  });
  await t.test('EXDATE removes an occurrence', () => {
    const body = 'UID:1\r\nSUMMARY:Daily\r\nDTSTART:20260907T090000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20260908T090000Z';
    const r = C.parseIcs(ev(body), WIN);
    assert.equal(r.events.length, 2, 'the excluded date should be gone');
  });
});

test('querying', async (t) => {
  const mk = (iso, allDay = false) => ({ uid: iso, title: 't', start: Date.parse(iso), end: Date.parse(iso) + 3600_000, allDay, location: '', description: '', recurring: false });
  await t.test('upcoming skips finished events', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const list = [mk('2026-09-05T08:00:00Z'), mk('2026-09-05T15:00:00Z'), mk('2026-09-06T09:00:00Z')];
    const up = C.upcoming(list, now, 5);
    assert.equal(up.length, 2);
    assert.ok(up[0].start < up[1].start);
  });
  await t.test('day labels are relative where it helps', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    assert.equal(C.fmtEventDay(now, now), 'Today');
    assert.equal(C.fmtEventDay(now + 86400_000, now), 'Tomorrow');
  });
  await t.test('an all-day event says so rather than showing midnight', () => {
    assert.equal(C.fmtEventTime(mk('2026-09-05T00:00:00Z', true)), 'All day');
  });
});
