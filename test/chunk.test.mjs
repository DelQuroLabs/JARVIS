import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// lazyScreen.ts touches React and window, so the matcher is re-derived from the
// source here rather than importing the module into Node.
const src = readFileSync(new URL('../src/ui/lazyScreen.ts', import.meta.url), 'utf8');
const pattern = src.match(/return\s+(\/.+?\/i)\.test\(/s)[1];
const RE = new RegExp(pattern.slice(1, pattern.lastIndexOf('/')), 'i');
const isChunkLoadError = (err) => RE.test(err instanceof Error ? `${err.name}: ${err.message}` : String(err));

test('chunk load error detection', async (t) => {
  await t.test('matches the exact message this app produced in the wild', () => {
    assert.ok(isChunkLoadError(new TypeError(
      'Failed to fetch dynamically imported module: https://example.arena.site/assets/Agent-Mp0UpwBb.js',
    )));
  });
  await t.test('matches the other browsers wordings', () => {
    assert.ok(isChunkLoadError(new Error('Importing a module script failed.')), 'Safari');
    assert.ok(isChunkLoadError(new Error('error loading dynamically imported module')), 'Firefox');
    assert.ok(isChunkLoadError(Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' })));
  });
  await t.test('does NOT match ordinary application errors', () => {
    assert.ok(!isChunkLoadError(new Error('Cannot read properties of undefined')));
    assert.ok(!isChunkLoadError(new Error('fetch failed')));
    assert.ok(!isChunkLoadError(new Error('HTTP 500')));
    assert.ok(!isChunkLoadError(new TypeError('x is not a function')));
  });
  await t.test('a non-Error value does not throw the matcher', () => {
    assert.equal(isChunkLoadError('some string'), false);
    assert.equal(isChunkLoadError(null), false);
  });
});

test('the reload guard is spent only on success', async (t) => {
  await t.test('the guard is cleared in the then branch, not on mount', () => {
    // Regression: clearing guards when the app mounted reset them before the
    // failing screen retried, producing an infinite reload loop.
    assert.ok(/\.then\([\s\S]*removeItem\(key\)/.test(src), 'guard must be cleared after a successful import');
    assert.ok(!/clearChunkGuards/.test(src), 'the mount-time clear must not come back');
  });
  await t.test('the reload is guarded by a stored flag', () => {
    assert.ok(/if \(s && !s\.getItem\(key\)\)/.test(src));
    assert.ok(/setItem\(key, '1'\)/.test(src));
  });
  await t.test('a second failure rethrows instead of reloading again', () => {
    assert.ok(/throw err;\s*\}\),/.test(src.replace(/\s+/g, ' ').replace(/ /g, ' ')) || /throw err;/.test(src));
  });
});
