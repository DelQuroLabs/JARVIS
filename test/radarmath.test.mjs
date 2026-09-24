import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

test('tile projection round-trips', async (t) => {
  const places = [[38.895, -77.037], [0, 0], [51.5, -0.12], [-33.87, 151.21], [64.1, -21.9]];
  await t.test('lat/lon survives a there-and-back at every zoom', () => {
    for (const [lat, lon] of places) {
      for (const z of [3, 7, 10]) {
        const t2 = C.tileFor(lat, lon, z);
        const back = C.latLonFor(t2.x, t2.y, z);
        assert.ok(Math.abs(back.lat - lat) < 1e-9, `lat ${lat}@z${z} drifted to ${back.lat}`);
        assert.ok(Math.abs(back.lon - lon) < 1e-9, `lon ${lon}@z${z} drifted to ${back.lon}`);
      }
    }
  });
});

test('panning', async (t) => {
  await t.test('one tile of drag moves exactly one tile of longitude', () => {
    const z = 7;
    const p = C.panBy(38.895, -77.037, z, 256, 0);
    assert.ok(Math.abs(p.lon - (-77.037 - 360 / 2 ** z)) < 1e-6);
  });
  await t.test('dragging down moves the view north', () => {
    const p = C.panBy(38.895, -77.037, 7, 0, 128);
    assert.ok(p.lat > 38.895, `expected to move north, got ${p.lat}`);
  });
  await t.test('latitude is clamped near the poles instead of going out of range', () => {
    const p = C.panBy(84, 0, 3, 0, -4000);
    assert.ok(p.lat <= 85 && p.lat >= -85, `latitude escaped: ${p.lat}`);
  });
  await t.test('longitude wraps across the date line rather than clamping', () => {
    const p = C.panBy(0, 179, 3, -400, 0);
    assert.ok(p.lon >= -180 && p.lon <= 180, `longitude out of range: ${p.lon}`);
  });
  await t.test('a zero drag is a no-op', () => {
    const p = C.panBy(38.895, -77.037, 7, 0, 0);
    assert.ok(Math.abs(p.lat - 38.895) < 1e-9 && Math.abs(p.lon - -77.037) < 1e-9);
  });
});

test('radar history span', async (t) => {
  const f = (mins, forecast = false) => ({ time: 1_700_000_000 + mins * 60, path: '/p', forecast });
  await t.test('measures only observed frames', () => {
    assert.equal(C.historySpanMinutes([f(0), f(60), f(120), f(130, true)]), 120);
  });
  await t.test('a single frame has no span rather than a bogus one', () => {
    assert.equal(C.historySpanMinutes([f(0)]), 0);
    assert.equal(C.historySpanMinutes([]), 0);
  });
});

test('explainers', async (t) => {
  await t.test('every entry answers all three questions', () => {
    for (const [route, e] of Object.entries(C.EXPLAINERS)) {
      assert.ok(e.what && e.what.length > 30, `${route}: what is too thin`);
      assert.ok(e.when && e.when.length > 20, `${route}: when is too thin`);
      assert.ok(e.limit && e.limit.length > 20, `${route}: limit is too thin`);
    }
  });
  await t.test('lookup tolerates a trailing slash', () => {
    assert.ok(C.explainerFor('/app/modes'));
    assert.ok(C.explainerFor('/app/modes/'));
    assert.equal(C.explainerFor('/nope'), undefined);
  });
});

test('modes are self-describing', async (t) => {
  await t.test('every mode says when to reach for it', () => {
    for (const m of C.MODES) {
      assert.ok(m.when && m.when.length > 20, `${m.id} has no usable "when"`);
      assert.ok(m.blurb && m.blurb.length > 15, `${m.id} has no blurb`);
    }
  });
  await t.test('budgets are real numbers, not placeholders', () => {
    for (const m of C.MODES) {
      assert.ok(m.maxSteps >= 1 && m.toolBudget >= 0, `${m.id} has a nonsense budget`);
    }
  });
});
