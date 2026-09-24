import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DB_PATH = '/tmp/jarvis-test-' + process.pid + '.db';
const db = await import('../src/db.ts');
const { TOOL_DEFS, systemPrompt } = await import('../src/assistant.ts');

const u = db.upsertUser(42, 'tester', 'Tester', null);
test.after(() => { for (const f of [process.env.DB_PATH!, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) fs.rmSync(f, { force: true }); });

test('tool definitions are well formed', () => {
  assert.ok(TOOL_DEFS.length >= 14);
  for (const t of TOOL_DEFS) {
    assert.equal(t.type, 'function');
    assert.match(t.function.name, /^[a-z_]+$/);
    assert.ok(t.function.description);
  }
});

test('persona prompt reflects settings', () => {
  const p = systemPrompt({ persona: 'jarvis', humor: 0.8, currency: 'EUR', name: 'Tony' }, 'telegram');
  assert.match(p, /Address the user as Tony/);
  assert.match(p, /EUR/);
  assert.match(p, /Humor level 8\/10/);
  assert.match(p, /Telegram chat/);
  assert.match(systemPrompt({ persona: 'terse', humor: 0, currency: 'USD' }, 'app'), /fewest words/);
});

test('telegram link codes are single-use and map chat → user', () => {
  const code = db.createLinkCode(u.id);
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(db.redeemLinkCode(code, 9001, 'tg')?.id, u.id);
  assert.equal(db.redeemLinkCode(code, 9002, 'tg'), undefined, 'second redeem must fail');
  assert.equal(db.userForChat(9001)?.login, 'tester');
  assert.equal(db.telegramLinkFor(u.id)?.chat_id, 9001);
  db.unlinkTelegram(u.id);
  assert.equal(db.userForChat(9001), undefined);
});

test('settings merge with defaults and persist', () => {
  assert.deepEqual(db.getSettings(u.id), db.DEFAULT_SETTINGS);
  db.setSettings(u.id, { persona: 'neutral', currency: 'GBP' });
  const s = db.getSettings(u.id);
  assert.equal(s.persona, 'neutral');
  assert.equal(s.currency, 'GBP');
  assert.equal(s.humor, 0.5, 'untouched fields keep defaults');
});

test('conversation buffer is capped at 40 turns', () => {
  for (let i = 0; i < 50; i++) db.pushTgMessage(u.id, i % 2 ? 'assistant' : 'user', `m${i}`);
  const all = db.recentTgMessages(u.id, 100);
  assert.equal(all.length, 40);
  assert.equal(all.at(-1)?.content, 'm49');
  db.clearTgMessages(u.id);
  assert.equal(db.recentTgMessages(u.id).length, 0);
});

test('data rows are isolated per user', () => {
  const other = db.upsertUser(43, 'other', null, null);
  db.putRow('expenses', u.id, 'e1', { id: 'e1', amount: 10 });
  db.putRow('expenses', other.id, 'e2', { id: 'e2', amount: 20 });
  assert.equal(db.listRows('expenses', u.id).length, 1);
  assert.equal(db.deleteRow('expenses', u.id, 'e2'), false, 'cannot delete another user\'s row');
  assert.equal(db.deleteRow('expenses', u.id, 'e1'), true);
});
