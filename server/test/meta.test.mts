import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { getMeta, setMeta } = await import('../src/db.ts');

test('meta store round-trips and upserts (owner claim relies on it)', () => {
  assert.equal(getMeta('owner_login'), null);
  setMeta('owner_login', 'delquro');
  assert.equal(getMeta('owner_login'), 'delquro');
  setMeta('owner_login', 'someone-else');
  assert.equal(getMeta('owner_login'), 'someone-else');
});
