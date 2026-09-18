import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

// In Node the store falls back to an in-memory backing, so read/write are real.
const isRowArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x) && typeof x.id === 'string');

test('read() with a shape check', async (t) => {
  await t.test('returns a valid value untouched', () => {
    C.write('t.rows', [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual(C.read('t.rows', [], isRowArray), [{ id: 'a' }, { id: 'b' }]);
  });
  await t.test('falls back when the shape is wrong', () => {
    C.write('t.bad', { not: 'an array' });
    assert.deepEqual(C.read('t.bad', [], isRowArray), []);
  });
  await t.test('a wrong-shaped value is removed, not left for the next reader', () => {
    C.write('t.bad2', ['just a string']);
    C.read('t.bad2', [], isRowArray);
    // second read sees nothing at all, so the fallback is stable
    assert.deepEqual(C.read('t.bad2', ['fallback'], isRowArray), ['fallback']);
  });
  await t.test('rows missing an id are rejected as a group', () => {
    C.write('t.partial', [{ id: 'ok' }, { noId: true }]);
    assert.deepEqual(C.read('t.partial', [], isRowArray), []);
  });
  await t.test('corrupt JSON still falls back', () => {
    C.write('t.ok', [{ id: 'x' }]);
    assert.deepEqual(C.read('t.ok', [], isRowArray), [{ id: 'x' }]);
  });
  await t.test('with no checker the value is returned as-is, as before', () => {
    C.write('t.free', { anything: 1 });
    assert.deepEqual(C.read('t.free', null), { anything: 1 });
  });
  await t.test('an absent key returns the fallback without touching storage', () => {
    assert.equal(C.read('t.never-written', 'dflt'), 'dflt');
  });
});

test('schema version', async (t) => {
  await t.test('was bumped when the weather cache shape changed', () => {
    assert.ok(C.SCHEMA_VERSION >= 2, 'a released shape change must bump the version');
  });
});
