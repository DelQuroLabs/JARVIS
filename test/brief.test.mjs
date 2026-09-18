import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

const wx = (over = {}) => ({
  place: { name: 'Washington', lat: 38.9, lon: -77 },
  fetchedAt: Date.now(), readings: [], spreadC: 0, agreement: 'tight',
  hours: [], alerts: [], tempC: 20, label: 'Clear', ...over,
});
const base = {
  now: new Date('2026-09-05T09:00:00'), weather: null, units: 'imperial',
  dueRoutines: [], runs24h: 0, providerLabel: 'Groq', online: true,
};

test('greeting', async (t) => {
  await t.test('splits the day sensibly', () => {
    assert.equal(C.greeting(2), 'Still up');
    assert.equal(C.greeting(9), 'Good morning');
    assert.equal(C.greeting(14), 'Good afternoon');
    assert.equal(C.greeting(21), 'Good evening');
  });
});

test('precipitation nudge', async (t) => {
  const hours = (arr) => arr.map(([mm, snowCm], i) => ({ t: Date.now() + i * 3600_000, mm, snowCm, chance: mm ? 80 : 5, tempC: 3 }));
  await t.test('stays silent when nothing is coming', () => {
    assert.equal(C.precipNudge(wx({ hours: hours([[0, 0], [0, 0]]) }), 'imperial'), null);
  });
  await t.test('warns about rain starting soon', () => {
    const n = C.precipNudge(wx({ hours: hours([[0, 0], [0, 0], [1.2, 0]]) }), 'imperial');
    assert.match(n, /Rain starting in about 2 hours/);
  });
  await t.test('says snow when it is snow', () => {
    const n = C.precipNudge(wx({ hours: hours([[0, 0.4]]) }), 'imperial');
    assert.match(n, /Snow within the hour/);
  });
  await t.test('stays quiet for precipitation far out, so it is not noise', () => {
    const h = hours([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [2, 0]]);
    assert.equal(C.precipNudge(wx({ hours: h }), 'imperial'), null);
  });
  await t.test('no weather means no nudge rather than a crash', () => {
    assert.equal(C.precipNudge(null, 'imperial'), null);
  });
});

test('briefing', async (t) => {
  await t.test('always greets, even with nothing else known', () => {
    const b = C.buildBrief(base);
    assert.match(b[0], /Good morning/);
  });
  await t.test('states the temperature in the chosen unit', () => {
    const b = C.buildBrief({ ...base, weather: wx() }).join(' ');
    assert.match(b, /68 degrees/, 'should be Fahrenheit');
    const m = C.buildBrief({ ...base, units: 'metric', weather: wx() }).join(' ');
    assert.match(m, /20 degrees/);
  });
  await t.test('admits when the forecasts disagree', () => {
    const b = C.buildBrief({ ...base, weather: wx({ agreement: 'loose' }) }).join(' ');
    assert.match(b, /disagree/);
  });
  await t.test('mentions a government alert', () => {
    const b = C.buildBrief({ ...base, weather: wx({ alerts: [{ id: '1', event: 'Flood Warning', severity: 'Severe', headline: '', description: '' }] }) }).join(' ');
    assert.match(b, /Flood Warning in effect/);
  });
  await t.test('says it is on the offline core when no model is connected', () => {
    const b = C.buildBrief({ ...base, providerLabel: null }).join(' ');
    assert.match(b, /offline core/);
  });
  await t.test('offline takes priority over the model note', () => {
    const b = C.buildBrief({ ...base, providerLabel: null, online: false }).join(' ');
    assert.match(b, /offline, so live data is stale/);
    assert.ok(!/offline core/.test(b));
  });
  await t.test('pluralises routines and runs correctly', () => {
    assert.match(C.buildBrief({ ...base, dueRoutines: ['Morning briefing'] }).join(' '), /One routine is due: Morning briefing/);
    assert.match(C.buildBrief({ ...base, dueRoutines: ['a', 'b'] }).join(' '), /2 routines are due/);
    assert.match(C.buildBrief({ ...base, runs24h: 1 }).join(' '), /1 run in the last day/);
    assert.match(C.buildBrief({ ...base, runs24h: 4 }).join(' '), /4 runs in the last day/);
  });
  await t.test('quiet wind and clean air are not mentioned at all', () => {
    const b = C.buildBrief({ ...base, weather: wx({ windKph: 5, air: { aqi: 30, band: 'good' } }) }).join(' ');
    assert.ok(!/Wind is up/.test(b));
    assert.ok(!/Air quality/.test(b));
  });
});
