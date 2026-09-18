import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

test('moveItem', async (t) => {
  const l = ['a', 'b', 'c', 'd'];
  await t.test('moves forward and shifts the rest', () => {
    assert.deepEqual(C.moveItem(l, 0, 2), ['b', 'c', 'a', 'd']);
  });
  await t.test('moves backward', () => {
    assert.deepEqual(C.moveItem(l, 3, 1), ['a', 'd', 'b', 'c']);
  });
  await t.test('a no-op move returns the same list', () => {
    assert.deepEqual(C.moveItem(l, 1, 1), l);
  });
  await t.test('out-of-range indices are ignored rather than throwing', () => {
    assert.deepEqual(C.moveItem(l, -1, 2), l);
    assert.deepEqual(C.moveItem(l, 0, 99), l);
  });
});

test('normaliseLayout', async (t) => {
  const all = C.DASH_TILES.map((x) => x.id);
  await t.test('null gives the full default order', () => {
    assert.deepEqual(C.normaliseLayout(null).order, all);
    assert.deepEqual(C.normaliseLayout(null).hidden, []);
  });
  await t.test('a tile shipped after the layout was saved is appended, not dropped', () => {
    const stored = { order: [all[2], all[0]], hidden: [] };
    const out = C.normaliseLayout(stored);
    assert.equal(out.order.length, all.length, 'every known tile must survive');
    assert.deepEqual(out.order.slice(0, 2), [all[2], all[0]], 'saved order is respected first');
    for (const id of all) assert.ok(out.order.includes(id), `${id} was dropped`);
  });
  await t.test('an id no longer in the registry is discarded', () => {
    const out = C.normaliseLayout({ order: ['ghost-tile', all[0]], hidden: ['ghost-tile'] });
    assert.ok(!out.order.includes('ghost-tile'));
    assert.ok(!out.hidden.includes('ghost-tile'));
  });
  await t.test('duplicates collapse', () => {
    const out = C.normaliseLayout({ order: [all[0], all[0], all[1]], hidden: [all[1], all[1]] });
    assert.equal(out.order.filter((x) => x === all[0]).length, 1);
    assert.equal(out.hidden.filter((x) => x === all[1]).length, 1);
  });
});

test('visibility', async (t) => {
  const all = C.DASH_TILES.map((x) => x.id);
  await t.test('hidden tiles leave the grid but stay recoverable', () => {
    const l = C.toggleHidden(C.defaultLayout(), all[1]);
    assert.ok(!C.visibleTiles(l).some((x) => x.id === all[1]));
    assert.ok(C.hiddenTiles(l).some((x) => x.id === all[1]));
    assert.equal(C.visibleTiles(l).length, all.length - 1);
  });
  await t.test('toggling twice restores it in place', () => {
    const once = C.toggleHidden(C.defaultLayout(), all[1]);
    const twice = C.toggleHidden(once, all[1]);
    assert.deepEqual(C.visibleTiles(twice).map((x) => x.id), all);
  });
  await t.test('an unknown id cannot be hidden', () => {
    const l = C.toggleHidden(C.defaultLayout(), 'nope');
    assert.deepEqual(l.hidden, []);
  });
});

test('reorderLayout', async (t) => {
  const all = C.DASH_TILES.map((x) => x.id);
  await t.test('moves the dragged tile to the target position', () => {
    const out = C.reorderLayout(C.defaultLayout(), all[0], all[3]);
    assert.equal(out.order.indexOf(all[0]), 3);
    assert.equal(out.order.length, all.length, 'no tile is lost in a reorder');
  });
  await t.test('an unknown id leaves the layout untouched', () => {
    const base = C.defaultLayout();
    assert.deepEqual(C.reorderLayout(base, 'nope', all[1]), base);
    assert.deepEqual(C.reorderLayout(base, all[1], 'nope'), base);
  });
  await t.test('every tile id in the registry is unique', () => {
    assert.equal(new Set(all).size, all.length);
  });
  await t.test('every tile points at a real app route', () => {
    for (const t2 of C.DASH_TILES) assert.match(t2.to, /^\/app(\/|$)/, `${t2.id} -> ${t2.to}`);
  });
});
