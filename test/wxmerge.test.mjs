import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

const R = (source, tempC, extra = {}) => ({ source, ok: true, error: '', ms: 1, tempC, ...extra });
const PLACE = { name: 'Washington', lat: 38.895, lon: -77.037 };

test('median and spread', async (t) => {
  await t.test('odd and even counts', () => {
    assert.equal(C.median([1, 2, 3]), 2);
    assert.equal(C.median([1, 2, 3, 4]), 2.5);
  });
  await t.test('a single source is its own median', () => assert.equal(C.median([7]), 7));
  await t.test('no values yields undefined rather than NaN', () => assert.equal(C.median([]), undefined));
  await t.test('non-numbers are ignored, not coerced', () => {
    assert.equal(C.median([1, NaN, 3]), 2);
    assert.equal(C.spread([5, NaN]), 0);
  });
  await t.test('spread is the full range', () => {
    assert.equal(C.spread([10, 12, 11]), 2);
    assert.equal(C.spread([10]), 0);
  });
  await t.test('median resists one wild outlier where a mean would not', () => {
    // 20, 21, 60 -> median 21. A mean would report 33.7 and be useless.
    assert.equal(C.median([20, 21, 60]), 21);
  });
});

test('agreement', async (t) => {
  await t.test('classifies by source count and spread', () => {
    assert.equal(C.agreementOf(0, 0), 'none');
    assert.equal(C.agreementOf(1, 0), 'single');
    assert.equal(C.agreementOf(3, 0.9), 'tight');
    assert.equal(C.agreementOf(3, 4), 'loose');
  });
  await t.test('the 1.5C boundary is inclusive', () => {
    assert.equal(C.agreementOf(2, 1.5), 'tight');
    assert.equal(C.agreementOf(2, 1.51), 'loose');
  });
});

test('consensus label', async (t) => {
  await t.test('picks the label most sources agree on', () => {
    const rs = [R('open-meteo', 10, { label: 'Rain' }), R('met.no', 10, { label: 'Rain' }), R('nws', 10, { label: 'Cloudy' })];
    assert.equal(C.consensusLabel(rs), 'Rain');
  });
  await t.test('ignores sources that failed', () => {
    const rs = [{ source: 'nws', ok: false, error: 'down', ms: 1, label: 'Sunny' }, R('met.no', 10, { label: 'Snow' })];
    assert.equal(C.consensusLabel(rs), 'Snow');
  });
  await t.test('undefined when nothing answered', () => assert.equal(C.consensusLabel([]), undefined));
});

test('merge', async (t) => {
  await t.test('three agreeing sources produce a tight consensus', () => {
    const m = C.merge(PLACE, [R('open-meteo', 20, { label: 'Clear' }), R('met.no', 20.5, { label: 'Clear' }), R('nws', 20.2, { label: 'Clear' })], [], [], undefined, 1000);
    assert.equal(m.tempC, 20.2);
    assert.ok(m.spreadC <= 0.6);
    assert.equal(m.agreement, 'tight');
    assert.equal(m.label, 'Clear');
    assert.equal(m.fetchedAt, 1000);
  });
  await t.test('disagreement is surfaced, not averaged away', () => {
    const m = C.merge(PLACE, [R('open-meteo', 18), R('met.no', 24)], [], [], undefined, 0);
    assert.equal(m.agreement, 'loose');
    assert.equal(m.spreadC, 6);
  });
  await t.test('a failed source does not break the merge', () => {
    const m = C.merge(PLACE, [R('open-meteo', 20), { source: 'nws', ok: false, error: 'covers the United States only', ms: 5 }], [], [], undefined, 0);
    assert.equal(m.tempC, 20);
    assert.equal(m.agreement, 'single');
    assert.equal(m.readings.filter((r) => !r.ok).length, 1);
  });
  await t.test('every source failing yields no temperature rather than a fake one', () => {
    const m = C.merge(PLACE, [{ source: 'nws', ok: false, error: 'x', ms: 1 }], [], [], undefined, 0);
    assert.equal(m.tempC, undefined);
    assert.equal(m.agreement, 'none');
  });
});

test('air quality bands', async (t) => {
  await t.test('EPA boundaries', () => {
    assert.equal(C.aqiBand(0), 'good');
    assert.equal(C.aqiBand(50), 'good');
    assert.equal(C.aqiBand(51), 'moderate');
    assert.equal(C.aqiBand(150), 'unhealthy for sensitive groups');
    assert.equal(C.aqiBand(201), 'very unhealthy');
    assert.equal(C.aqiBand(500), 'hazardous');
  });
});

test('precipitation outlook', async (t) => {
  const hrs = (arr) => arr.map(([mm, snowCm, chance], i) => ({ t: i * 3600_000, mm, snowCm, chance, tempC: 5 }));
  await t.test('sums liquid and snow and finds the peak chance', () => {
    const o = C.precipOutlook(hrs([[0, 0, 10], [1.5, 0, 80], [0.5, 0, 60]]), 12);
    assert.equal(o.mm, 2);
    assert.equal(o.peakChance, 80);
    assert.equal(o.startsInH, 1);
  });
  await t.test('a dry outlook reports no start hour rather than zero', () => {
    const o = C.precipOutlook(hrs([[0, 0, 5], [0, 0, 5]]), 12);
    assert.equal(o.startsInH, null);
    assert.equal(o.mm, 0);
  });
  await t.test('snow is tracked separately from rain', () => {
    const o = C.precipOutlook(hrs([[0, 0, 0], [0, 1.2, 90]]), 12);
    assert.equal(o.snowCm, 1.2);
    assert.equal(o.startsInH, 1);
  });
  await t.test('the window is respected', () => {
    const o = C.precipOutlook(hrs([[0, 0, 0], [5, 0, 90]]), 1);
    assert.equal(o.mm, 0, 'an hour beyond the window must not be counted');
  });
});

test('met.no symbol codes become readable labels', async (t) => {
  await t.test('strips the day/night suffix', () => {
    assert.equal(C.metLabel('partlycloudy_day'), 'Partly cloudy');
    assert.equal(C.metLabel('clearsky_night'), 'Clear');
  });
  await t.test('unknown codes degrade to the raw word rather than throwing', () => {
    assert.equal(typeof C.metLabel('somethingnew_day'), 'string');
  });
  await t.test('undefined in, undefined out', () => assert.equal(C.metLabel(undefined), undefined));
});
