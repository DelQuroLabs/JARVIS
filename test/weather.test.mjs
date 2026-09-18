import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

test('temperature conversion', async (t) => {
  await t.test('Celsius to Fahrenheit at known points', () => {
    assert.equal(C.cToF(0), 32);
    assert.equal(C.cToF(100), 212);
    assert.equal(Math.round(C.cToF(20)), 68);
  });
  await t.test('imperial and metric render the same reading differently', () => {
    assert.equal(C.tempLabel(20, 'imperial'), '68\u00b0');
    assert.equal(C.tempLabel(20, 'metric'), '20\u00b0');
  });
  await t.test('negative temperatures survive the round trip', () => {
    assert.equal(C.temp(-40, 'imperial'), -40);
    assert.equal(C.temp(-40, 'metric'), -40);
  });
  await t.test('wind carries its unit', () => {
    assert.equal(C.windLabel(100, 'imperial'), '62 mph');
    assert.equal(C.windLabel(100, 'metric'), '100 km/h');
  });
});

test('conditions', async (t) => {
  await t.test('a known code maps to a label and an icon', () => {
    assert.equal(C.condition(0, true).label, 'Clear');
    assert.equal(C.condition(0, true).icon, 'sun');
  });
  await t.test('clear at night is a moon, not a sun', () => {
    assert.equal(C.condition(0, false).icon, 'moon');
  });
  await t.test('rain looks the same day or night', () => {
    assert.equal(C.condition(63, false).icon, 'rain');
  });
  await t.test('an unknown code says so instead of guessing', () => {
    const c = C.condition(9999, true);
    assert.match(c.label, /9999/);
  });
});

test('freshness is stated honestly', async (t) => {
  const now = 1_700_000_000_000;
  await t.test('a fresh reading', () => {
    assert.equal(C.freshness(now - 20_000, now), 'just now');
    assert.equal(C.freshness(now - 60_000, now), '1 min ago');
    assert.equal(C.freshness(now - 25 * 60_000, now), '25 min ago');
  });
  await t.test('an old reading', () => {
    assert.equal(C.freshness(now - 3 * 3_600_000, now), '3 hours ago');
    assert.equal(C.freshness(now - 26 * 3_600_000, now), 'yesterday');
  });
  await t.test('a clock skew never produces a negative age', () => {
    assert.equal(C.freshness(now + 5000, now), 'just now');
  });
  await t.test('staleness has a threshold and a refresh cadence', () => {
    const snap = { fetchedAt: now - 2 * 3_600_000 };
    assert.equal(C.isWeatherStale(snap, now), true);
    assert.equal(C.isWeatherStale({ fetchedAt: now - 60_000 }, now), false);
    assert.equal(C.isRefreshDue(null, now), true, 'no reading is always due');
    assert.equal(C.isRefreshDue({ fetchedAt: now - 60_000 }, now), false);
  });
});

test('hourly parsing', async (t) => {
  const hourly = {
    time: Array.from({ length: 24 }, (_, i) => `2026-09-05T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, i) => i),
  };
  await t.test('starts at the current hour and steps by two', () => {
    const now = new Date('2026-09-05T08:30:00').getTime();
    const out = C.pickHours(hourly, now);
    assert.equal(out[0].hour, 8);
    assert.equal(out[1].hour, 10);
    assert.ok(out.length <= 7);
  });
  await t.test('missing data yields an empty strip rather than throwing', () => {
    assert.deepEqual(C.pickHours(undefined, Date.now()), []);
    assert.deepEqual(C.pickHours({ time: [] }, Date.now()), []);
  });
  await t.test('hour labels are compact', () => {
    assert.equal(C.hourLabel(0), '12a');
    assert.equal(C.hourLabel(9), '9a');
    assert.equal(C.hourLabel(12), '12p');
    assert.equal(C.hourLabel(21), '9p');
  });
});

test('fetch behaviour', async (t) => {
  const place = { name: 'Jersey City', lat: 40.7, lon: -74.06 };
  await t.test('a response with no current block fails loudly', async () => {
    await assert.rejects(() => C.fetchWeather(place, async () => ({})), /no current conditions/i);
  });
  await t.test('a good response is normalised', async () => {
    const snap = await C.fetchWeather(
      place,
      async () => ({
        current: { temperature_2m: 20, apparent_temperature: 21, relative_humidity_2m: 60, wind_speed_10m: 10, weather_code: 0, is_day: 1 },
        daily: { temperature_2m_max: [27], temperature_2m_min: [18], precipitation_probability_max: [5] },
        hourly: { time: ['2026-09-05T00:00'], temperature_2m: [19] },
      }),
      123,
    );
    assert.equal(snap.tempC, 20);
    assert.equal(snap.isDay, true);
    assert.equal(snap.highC, 27);
    assert.equal(snap.fetchedAt, 123);
    assert.equal(snap.place.name, 'Jersey City');
  });
  await t.test('geocoding an unknown place names the place in the error', async () => {
    await assert.rejects(() => C.geocode('zzzznowhere', async () => ({ results: [] })), /zzzznowhere/);
  });
  await t.test('an empty query is refused before any request', async () => {
    let called = false;
    await assert.rejects(() => C.geocode('   ', async () => { called = true; return {}; }), /Type a city/);
    assert.equal(called, false, 'it should not hit the network for an empty query');
  });
});
