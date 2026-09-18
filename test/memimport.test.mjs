import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';

test('format detection', async (t) => {
  await t.test('by extension', () => {
    assert.equal(C.detectKind('a.json', '{}'), 'json');
    assert.equal(C.detectKind('a.md', 'x'), 'markdown');
    assert.equal(C.detectKind('a.csv', 'x'), 'csv');
    assert.equal(C.detectKind('a.pdf', 'x'), 'pdf');
  });
  await t.test('by content when the name says nothing', () => {
    assert.equal(C.detectKind('paste', '  [1,2]'), 'json');
    assert.equal(C.detectKind('paste', '# Title\nbody'), 'markdown');
    assert.equal(C.detectKind('paste', 'just words'), 'text');
  });
});

test('JSON import', async (t) => {
  await t.test('an array of strings', () => {
    const r = C.fromJson('["first fact","second fact"]');
    assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates[0].text, 'first fact');
  });
  await t.test('a chat export keeps the role as a tag', () => {
    const r = C.fromJson(JSON.stringify([{ role: 'user', content: 'I prefer dark mode' }]));
    assert.equal(r.candidates[0].text, 'I prefer dark mode');
    assert.deepEqual(r.candidates[0].tags, ['user']);
  });
  await t.test('objects with a text field, including nested', () => {
    const r = C.fromJson(JSON.stringify({ items: [{ text: 'nested one', tags: ['a'] }] }));
    assert.equal(r.candidates[0].text, 'nested one');
    assert.deepEqual(r.candidates[0].tags, ['a']);
  });
  await t.test('invalid JSON explains itself instead of throwing', () => {
    const r = C.fromJson('{oops');
    assert.equal(r.candidates.length, 0);
    assert.match(r.notes[0], /not valid JSON/);
  });
  await t.test('JSON with no text fields says so', () => {
    const r = C.fromJson('{"a":1,"b":2}');
    assert.equal(r.candidates.length, 0);
    assert.match(r.notes.join(' '), /No text fields/);
  });
});

test('Markdown import', async (t) => {
  const md = '# Preferences\n- Dark mode always\n- Metric units\n\n## Work\nI ship on Fridays.\n\n```\ncode here\n```\n';
  await t.test('bullets become entries tagged by their heading', () => {
    const r = C.fromMarkdown(md);
    const dark = r.candidates.find((c) => c.text === 'Dark mode always');
    assert.ok(dark, 'bullet not captured');
    assert.deepEqual(dark.tags, ['preferences']);
  });
  await t.test('paragraphs are captured under their heading', () => {
    const r = C.fromMarkdown(md);
    const para = r.candidates.find((c) => c.text === 'I ship on Fridays.');
    assert.ok(para);
    assert.deepEqual(para.tags, ['work']);
  });
  await t.test('code blocks are skipped and reported', () => {
    const r = C.fromMarkdown(md);
    assert.match(r.notes.join(' '), /Code blocks/);
  });
  await t.test('checkbox markers are stripped', () => {
    const r = C.fromMarkdown('- [x] Done thing');
    assert.equal(r.candidates[0].text, 'Done thing');
  });
});

test('CSV import', async (t) => {
  await t.test('first column is the text, the rest are tags', () => {
    const r = C.fromCsv('Likes espresso,coffee,habit\nWorks in DC,place');
    assert.equal(r.candidates[0].text, 'Likes espresso');
    assert.deepEqual(r.candidates[0].tags, ['coffee', 'habit']);
    assert.equal(r.candidates.length, 2);
  });
  await t.test('a header row is skipped', () => {
    const r = C.fromCsv('text,tag\nreal entry,x');
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].text, 'real entry');
  });
  await t.test('quoted commas survive', () => {
    const r = C.fromCsv('"Boston, MA",place');
    assert.equal(r.candidates[0].text, 'Boston, MA');
  });
});

test('plain text import', async (t) => {
  await t.test('blank lines separate blocks', () => {
    const r = C.fromText('first thought\n\nsecond thought');
    assert.equal(r.candidates.length, 2);
  });
  await t.test('otherwise one entry per line', () => {
    const r = C.fromText('one\ntwo\nthree');
    assert.equal(r.candidates.length, 3);
  });
});

test('deduplication', async (t) => {
  await t.test('drops repeats within the import', () => {
    const out = C.dedupe([{ text: 'same', tags: [], origin: 'a' }, { text: 'SAME', tags: [], origin: 'b' }], []);
    assert.equal(out.length, 1);
  });
  await t.test('drops anything already in memory', () => {
    const out = C.dedupe([{ text: 'known', tags: [], origin: 'a' }], ['Known']);
    assert.equal(out.length, 0);
  });
});

test('PDF is refused honestly', async (t) => {
  await t.test('the note explains why and what to do instead', () => {
    assert.match(C.PDF_NOTE, /does not bundle/);
    assert.match(C.PDF_NOTE, /paste/);
  });
});
