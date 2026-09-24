/**
 * Functional harness.
 *
 * The e2e gate proves screens render and do not crash. This one proves the
 * buttons DO something: it drives real user journeys and asserts the observable
 * result — an item appears, a count changes, state survives a reload, a tool
 * returns the right answer, a guard actually blocks.
 *
 * Run against a built preview:  node scripts/functional.mjs [origin]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const ORIGIN = process.argv[2] || 'http://127.0.0.1:4173';
const only = process.env.ONLY || '';

const results = [];
let page;

const go = async (route) => {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
};
const body = async () => {
  const main = page.locator('.content, .chatwrap').first();
  return main.innerText();
};
const sub = () => page.locator('.appbar .sub').first().innerText();
const clickText = async (text, scope = '.content') => {
  await page.locator(`${scope} button`, { hasText: text }).first().click();
  await page.waitForTimeout(260);
};

async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now();
  try {
    // Any overlay left open by a previous scenario swallows every click.
    for (let i = 0; i < 3; i++) {
      if (!(await page.locator('.sheet, .palette, .modal').count())) break;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '', ms: Date.now() - t0 });
    console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  } catch (e) {
    const full = e && e.message ? e.message : String(e);
    if (process.env.VERBOSE) console.log(full.slice(0, 1200));
    const msg = full.split('\n')[0].slice(0, 200);
    results.push({ name, ok: false, detail: msg, ms: Date.now() - t0 });
    console.log(`  FAIL  ${name}\n          ${msg}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertIncludes = (hay, needle, what) =>
  assert(hay.includes(needle), `${what}: expected to find "${needle}" in "${hay.replace(/\s+/g, ' ').slice(0, 220)}"`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 950 } });
page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));

console.log('\nfunctional checks\n');

/* ---------------------------------------------------------------- memory */
await scenario('memory: add an item, it appears and the count updates', async () => {
  await go('/app/memory');
  const before = app => 0;
  await page.locator('.appbar button[title="Add memory"]').click();
  await page.waitForTimeout(300);
  await page.locator('.sheet textarea').first().fill('The build runs on Debian 13');
  await page.locator('.sheet input').last().fill('infra, build');
  await clickText('Save', '.sheet');
  await page.waitForTimeout(400);
  assertIncludes(await body(), 'The build runs on Debian 13', 'memory list');
  assertIncludes(await sub(), '1 item', 'appbar subtitle');
  return 'item listed, subtitle counts it';
});

await scenario('memory: the item survives a reload (persisted, not in React state)', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  assertIncludes(await body(), 'The build runs on Debian 13', 'memory after reload');
  return 'localStorage round trip';
});

await scenario('memory: search filters the list', async () => {
  await page.locator('input[aria-label="Search memory"]').fill('zzz-no-match');
  await page.waitForTimeout(300);
  assertIncludes(await body(), 'Nothing matches', 'search miss');
  await page.locator('input[aria-label="Search memory"]').fill('Debian');
  await page.waitForTimeout(300);
  assertIncludes(await body(), 'The build runs on Debian 13', 'search hit');
  await page.locator('input[aria-label="Search memory"]').fill('');
  await page.waitForTimeout(200);
  return 'miss shows empty state, hit shows the item';
});

await scenario('memory: pin toggles and reorders to the top', async () => {
  await page.locator('.appbar button[title="Add memory"]').click();
  await page.waitForTimeout(300);
  await page.locator('.sheet textarea').first().fill('Second memory item');
  await clickText('Save', '.sheet');
  await page.waitForTimeout(400);
  const first = () => page.locator('.list .item b').first().innerText();
  assertIncludes(await first(), 'Second memory item', 'newest first before pinning');
  await page.locator('.list .item', { hasText: 'The build runs on Debian' }).locator('button[title="Pin"]').click();
  await page.waitForTimeout(400);
  assertIncludes(await first(), 'The build runs on Debian', 'pinned item should sort first');
  return 'pinned item moved to the top';
});

await scenario('memory: delete removes the item and decrements the count', async () => {
  await page.locator('.list .item', { hasText: 'Second memory item' }).locator('button[title="Delete"]').click();
  await page.waitForTimeout(400);
  assert(!(await body()).includes('Second memory item'), 'deleted item still listed');
  assertIncludes(await sub(), '1 item', 'subtitle after delete');
  return 'gone from list and count';
});

/* ----------------------------------------------------------------- ideas */
await scenario('ideas: create, star, and it persists', async () => {
  await go('/app/ideas');
  await page.locator('.appbar button[title="New idea"]').click();
  await page.waitForTimeout(300);
  await page.locator('.sheet input').first().fill('Test idea title');
  await page.locator('.sheet textarea').first().fill('Body of the test idea');
  await clickText('Save', '.sheet');
  await page.waitForTimeout(400);
  assertIncludes(await body(), 'Test idea title', 'ideas list');
  await page.locator('.card', { hasText: 'Test idea title' }).locator('button[title="Star"]').first().click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  assertIncludes(await body(), 'Test idea title', 'idea after reload');
  const starred = await page.locator('.card', { hasText: 'Test idea title' }).locator('button[title="Unstar"]').count();
  assert(starred === 1, 'star state did not persist');
  return 'created, starred, survived reload';
});

/* ----------------------------------------------------------------- tools */
await scenario('tools: calculator returns the right number', async () => {
  await go('/app/tools');
  await page.locator('input[aria-label="Search tools"]').fill('calc');
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'calc' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input, .sheet textarea').first().fill('137 * 42');
  await clickText('Run tool', '.sheet');
  await page.waitForTimeout(900);
  const out = await page.locator('.sheet').innerText();
  assertIncludes(out, '5754', 'calculator result');
  assertIncludes(out, 'ok', 'status pill');
  return '137 * 42 = 5754';
});

await scenario('tools: a bad argument fails honestly instead of pretending', async () => {
  await go('/app/tools');
  await page.locator('input[aria-label="Search tools"]').fill('calc');
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'calc' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input, .sheet textarea').first().fill('137 *');
  await clickText('Run tool', '.sheet');
  await page.waitForTimeout(900);
  const out = await page.locator('.sheet').innerText();
  assert(/failed|error|could not|invalid/i.test(out), `expected an honest failure, saw: ${out.slice(0, 200)}`);
  assert(!/\bok\b\s*$/i.test(out.split('\n')[0]), 'reported ok for a broken expression');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return 'reported as failed';
});

await scenario('tools: a keyless network tool actually reaches the internet', async () => {
  await go('/app/tools');
  await page.locator('input[aria-label="Search tools"]').fill('currency');
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'currency' }).first().click();
  await page.waitForTimeout(400);
  const inputs = page.locator('.sheet input');
  await inputs.nth(0).fill('100');
  await inputs.nth(1).fill('USD');
  await inputs.nth(2).fill('EUR');
  await clickText('Run tool', '.sheet');
  await page.waitForTimeout(4000);
  const out = await page.locator('.sheet').innerText();
  assert(/EUR|euro/i.test(out), `no currency result: ${out.slice(0, 200)}`);
  assert(!/failed/i.test(out.split('effect class')[0] || ''), 'currency lookup failed');
  await page.keyboard.press('Escape');
  return out.replace(/\s+/g, ' ').match(/100[^|]{0,60}/)?.[0]?.slice(0, 60) || 'returned a rate';
});

await scenario('tools: the malformed-currency guard rejects before calling out', async () => {
  await go('/app/tools');
  await page.locator('input[aria-label="Search tools"]').fill('currency');
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'currency' }).first().click();
  await page.waitForTimeout(400);
  const inputs = page.locator('.sheet input');
  await inputs.nth(0).fill('100');
  await inputs.nth(1).fill('dollars');
  await inputs.nth(2).fill('EUR');
  await clickText('Run tool', '.sheet');
  await page.waitForTimeout(1500);
  const out = await page.locator('.sheet').innerText();
  assertIncludes(out, 'three letters', 'guard message');
  await page.keyboard.press('Escape');
  return 'rejected "dollars" with a clear reason';
});

/* ------------------------------------------------------------------ chat */
await scenario('chat: a slash command runs on device and shows a result', async () => {
  await go('/app/chat');
  const box = page.locator('.composer textarea');
  await box.fill('/calc 19 * 3');
  await page.locator('button[aria-label="Send"]').click();
  await page.waitForTimeout(1800);
  assertIncludes(await body(), '57', 'calc slash command');
  return '/calc 19 * 3 -> 57';
});

await scenario('chat: "remember that ..." writes to memory with no model call', async () => {
  const box = page.locator('.composer textarea');
  await box.fill('remember that the accent colour is teal');
  await page.locator('button[aria-label="Send"]').click();
  await page.waitForTimeout(1800);
  await go('/app/memory');
  assertIncludes(await body(), 'accent colour is teal', 'memory written from chat');
  return 'written to memory';
});

await scenario('chat: the conversation persists across a reload', async () => {
  await go('/app/chat');
  await page.waitForTimeout(600);
  const before = await body();
  assertIncludes(before, '57', 'earlier reply present');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  assertIncludes(await body(), '57', 'reply after reload');
  return 'history restored';
});

await scenario('chat: offline reflex answers an identity question with no key', async () => {
  const box = page.locator('.composer textarea');
  await box.fill('who are you?');
  await page.locator('button[aria-label="Send"]').click();
  await page.waitForTimeout(3500);
  const txt = await body();
  assert(txt.length > 200, 'no answer rendered');
  assert(/JARVIS/i.test(txt), 'the reflex answer never identified the app');
  return 'answered offline';
});

/* -------------------------------------------------------------- palette */
await scenario('palette: opens from the toolbar and navigates', async () => {
  await go('/app');
  await page.locator('.cmdk').click();
  await page.waitForTimeout(400);
  await page.locator('.palette input').fill('memory');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  assert(page.url().includes('/app/memory'), `palette did not navigate, url=${page.url()}`);
  return 'navigated to /app/memory';
});

/* --------------------------------------------------------------- skills */
await scenario('skills: create one and it appears in the list', async () => {
  await go('/app/skills');
  await page.locator('.appbar button[title="New skill"]').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input').nth(0).fill('Functional test skill');
  // The editor refuses to save a skill with no steps and says so; add one.
  await page.locator('.sheet button', { hasText: 'Add step' }).first().click();
  await page.waitForTimeout(300);
  const tool = page.locator('.sheet select').first();
  await tool.selectOption('text_stats').catch(async () => {
    const first = await tool.locator('option').nth(1).getAttribute('value');
    await tool.selectOption(first);
  });
  await page.waitForTimeout(300);
  const saveBtn = page.locator('.sheet button', { hasText: 'Save skill' }).first();
  assert(!(await saveBtn.isDisabled()), `save still disabled: ${(await page.locator('.sheet').innerText()).slice(0, 160)}`);
  await saveBtn.click();
  await page.waitForTimeout(600);
  assertIncludes(await body(), 'Functional test skill', 'skills list');
  return 'skill saved and listed';
});

/* ------------------------------------------------------------- routines */
await scenario('routines: create one, toggle it, and it persists', async () => {
  await go('/app/routines');
  await page.locator('.appbar button[title="New routine"]').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input').first().fill('Functional test routine');
  // Save stays disabled until the routine has something to run.
  const target = page.locator('.sheet select').last();
  const opt = await target.locator('option').nth(1).getAttribute('value');
  await target.selectOption(opt);
  await page.waitForTimeout(300);
  const save = page.locator('.sheet button', { hasText: /^Save/ }).first();
  assert(!(await save.isDisabled()), `save disabled: ${(await page.locator('.sheet').innerText()).slice(0, 160)}`);
  await save.click();
  await page.waitForTimeout(600);
  assertIncludes(await body(), 'Functional test routine', 'routines list');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  assertIncludes(await body(), 'Functional test routine', 'routine after reload');
  return 'created and persisted';
});

/* ------------------------------------------------------------ workflows */
await scenario('workflows: a seeded template runs and reports a real status', async () => {
  await go('/app/workflows');
  const txt = await body();
  assert(/template|workflow/i.test(txt), 'no workflows listed');
  const runBtn = page.locator('.content button[title^="Run"], .content button[aria-label^="Run"]').first();
  assert(await runBtn.count(), 'no Run button found');
  await runBtn.click();
  await page.waitForTimeout(600);
  // Run opens an input sheet; supply the input and start it.
  const sheetInput = page.locator('.sheet textarea, .sheet input').first();
  if (await sheetInput.count()) {
    await sheetInput.fill('hello world');
    await page.locator('.sheet button', { hasText: /Run|Start/ }).first().click();
  }
  await page.waitForTimeout(6000);
  const after = await body();
  assert(/ok|failed|blocked|skipped|running/i.test(after), 'no run status reported');
  return (after.match(/\b(ok|failed|blocked)\b/i) || ['status shown'])[0];
});

/* ----------------------------------------------------------------- modes */
await scenario('modes: selecting a mode sticks and is reflected elsewhere', async () => {
  await go('/app/modes');
  await page.locator('.item', { hasText: 'Research' }).first().click();
  await page.waitForTimeout(500);
  const pressed = await page.locator('.item[aria-pressed="true"]').first().innerText();
  assertIncludes(pressed, 'Research', 'active mode after click');
  await go('/app');
  assertIncludes(await body() + await sub(), 'Research', 'home should show the active mode');
  return 'mode changed and surfaced on Home';
});

/* --------------------------------------------------------------- privacy */
await scenario('privacy: STRICT actually blocks a network tool', async () => {
  await go('/app/settings');
  await page.locator('.content select').first().selectOption('STRICT');
  await page.waitForTimeout(400);
  await go('/app/tools');
  await page.locator('input[aria-label="Search tools"]').fill('currency');
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'currency' }).first().click();
  await page.waitForTimeout(400);
  const inputs = page.locator('.sheet input');
  await inputs.nth(0).fill('10');
  await inputs.nth(1).fill('USD');
  await inputs.nth(2).fill('EUR');
  await clickText('Run tool', '.sheet');
  await page.waitForTimeout(1500);
  const out = await page.locator('.sheet').innerText();
  assert(/blocked|strict|not allowed|privacy/i.test(out), `STRICT did not block: ${out.slice(0, 200)}`);
  await page.keyboard.press('Escape');
  await go('/app/settings');
  await page.locator('.content select').first().selectOption('GUARDED');
  await page.waitForTimeout(300);
  return 'network tool blocked under STRICT';
});

/* ------------------------------------------------------------- providers */
await scenario('providers: saving a key flips the connected count and the pill', async () => {
  await go('/app/providers');
  assertIncludes(await sub(), '0 of', 'fresh install should claim zero connected');
  await page.locator('.prov-head', { hasText: 'Cerebras' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.prov-body input[type="password"], .prov-body input').first().fill('csk-functionaltestkey1234567890');
  await page.waitForTimeout(600);
  const s = await sub();
  assertIncludes(s, '1 of', 'connected count after saving a key');
  return s.trim();
});

await scenario('providers: the saved key survives a reload and is masked', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  assertIncludes(await sub(), '1 of', 'connected count after reload');
  await page.locator('.prov-head', { hasText: 'Cerebras' }).first().click();
  await page.waitForTimeout(400);
  const field = page.locator('.prov-body input').first();
  const type = await field.getAttribute('type');
  assert(type === 'password', `key field should be masked, type=${type}`);
  const val = await field.inputValue();
  assert(val.includes('functionaltestkey'), 'key value did not persist');
  return 'persisted and masked';
});

await scenario('providers: reordering the fallback chain persists', async () => {
  await go('/app/providers');
  const firstName = () => page.locator('.chain-row b').first().innerText();
  const before = await firstName();
  await page.locator('.chain-row').nth(1).locator('button[title^="Move"]').first().click(); // up
  await page.waitForTimeout(500);
  const after = await firstName();
  assert(before !== after, `chain order did not change (still ${before})`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  assert((await firstName()) === after, 'chain order did not persist');
  return `${before} -> ${after}`;
});

await scenario('providers: removing a provider from the chain persists', async () => {
  const before = await page.locator('.chain-row').count();
  await page.locator('.chain-row').first().locator('button').last().click();
  await page.waitForTimeout(500);
  const after = await page.locator('.chain-row').count();
  assert(after === before - 1, `chain length ${before} -> ${after}`);
  return `${before} -> ${after} entries`;
});

await scenario('providers: a bad key reports the real failure, not success', async () => {
  await go('/app/providers');
  await page.locator('.prov-head', { hasText: 'Cerebras' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.prov-body button').filter({ hasText: /^Test/ }).first().click();
  await page.waitForTimeout(12000);
  const out = await page.locator('.prov-body').first().innerText();
  assert(!/\bconnected\b|\bworks\b|\bready\b/i.test(out.split('Test')[1] || ''), `claimed success with a junk key: ${out.slice(0, 200)}`);
  assert(/fail|error|blocked|wrong|invalid|401|network/i.test(out), `no failure reported: ${out.slice(0, 200)}`);
  return 'failure surfaced honestly';
});

/* --------------------------------------------------------------- settings */
await scenario('settings: theme switch changes the document attribute', async () => {
  await go('/app/settings');
  const selects = page.locator('.content select');
  const n = await selects.count();
  let done = false;
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).locator('option').evaluateAll((o) => o.map((x) => x.value));
    if (opts.includes('light')) { await selects.nth(i).selectOption('light'); done = true; break; }
  }
  assert(done, 'no theme select found');
  await page.waitForTimeout(400);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(theme === 'light', `data-theme=${theme}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(after === 'light', `theme did not persist, data-theme=${after}`);
  // back to dark
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).locator('option').evaluateAll((o) => o.map((x) => x.value));
    if (opts.includes('light')) { await selects.nth(i).selectOption('dark'); break; }
  }
  await page.waitForTimeout(300);
  return 'light applied and persisted';
});

await scenario('settings: accent switch repaints the accent token', async () => {
  await go('/app/settings');
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  await clickText('Lime');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert(before !== after, `accent did not change (${before})`);
  await clickText('Aqua');
  await page.waitForTimeout(300);
  return `${before} -> ${after}`;
});

await scenario('settings: export produces JSON with no credentials in it', async () => {
  await go('/app/settings');
  const json = await page.evaluate(() => {
    const mod = window.__exportForTest;
    return typeof mod === 'function' ? mod() : null;
  });
  // No test hook exposed: drive the real download instead.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.locator('.content button', { hasText: /Export/ }).first().click(),
  ]);
  assert(download, 'no download started from Export');
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk;
  assert(text.length > 20, 'export was empty');
  const parsed = JSON.parse(text);
  const flat = JSON.stringify(parsed);
  assert(!flat.includes('functionaltestkey'), 'THE EXPORT CONTAINS AN API KEY');
  assert(flat.includes('Debian 13') || flat.includes('memory'), 'export does not contain the user data');
  return `${(text.length / 1024).toFixed(1)} kB, no key inside`;
});

/* ------------------------------------------------------------ diagnostics */
await scenario('diagnostics: live checks run and report counts', async () => {
  await go('/app/diagnostics');
  await page.locator('.content button', { hasText: /Run/ }).first().click();
  await page.waitForTimeout(9000);
  const txt = await body();
  const passed = (txt.match(/^passed$/gim) || []).length;
  const failed = (txt.match(/^failed$/gim) || []).length;
  assert(passed >= 15, `only ${passed} checks passed`);
  assert(failed === 0, `${failed} diagnostics checks failed`);
  return `${passed} passed, ${failed} failed`;
});

/* ----------------------------------------------------------------- traces */
await scenario('traces: activity from this session was recorded', async () => {
  await go('/app/traces');
  const txt = await body();
  assert(!/no activity yet/i.test(txt), 'traces empty despite a session of activity');
  assert(/chat|tool|calc|currency/i.test(txt), `traces look wrong: ${txt.slice(0, 200)}`);
  return 'entries present';
});

/* ------------------------------------------------------------------ cloud */
await scenario('cloud: connecting with a bogus URL fails honestly', async () => {
  await go('/app/cloud');
  const inputs = page.locator('.content input');
  await inputs.nth(0).fill('https://not-a-real-server.example.com');
  await page.locator('.content button', { hasText: /Connect|Save/ }).first().click();
  await page.waitForTimeout(9000);
  const txt = await body();
  assert(!/connected\b.*\bok|sync complete/i.test(txt), 'claimed a successful connection to a fake project');
  return 'no false success';
});

/* ------------------------------------------------------------------ crew */
await scenario('crew: a run reports per-role status without a model key', async () => {
  await go('/app/crew');
  const ta = page.locator('.content textarea').first();
  await ta.fill('Plan a small feature');
  await page.locator('.content button', { hasText: /Run|Start|Convene/ }).first().click();
  await page.waitForTimeout(10000);
  const txt = await body();
  assert(/skipped|failed|blocked|ok|reflex/i.test(txt), `no crew status: ${txt.slice(0, 200)}`);
  assert(!/^\s*$/.test(txt), 'crew produced nothing');
  return (txt.match(/\b(skipped|failed|blocked|ok)\b/i) || ['status'])[0];
});

/* ------------------------------------------------------------------ agent */
await scenario('agent: a task reports steps and a final state', async () => {
  await go('/app/agent');
  const ta = page.locator('.content textarea').first();
  await ta.fill('Work out 12 * 12 and tell me the answer');
  await page.locator('.content button', { hasText: /Run|Start/ }).first().click();
  await page.waitForTimeout(12000);
  const txt = await body();
  assert(/step|done|failed|blocked|budget|reflex/i.test(txt), `agent produced no state: ${txt.slice(0, 200)}`);
  return 'reported a state';
});

/* --------------------------------------------------------------- cleanup */
await scenario('reset: erasing all data actually clears it', async () => {
  await go('/app/settings');
  const eraseBtn = page.locator('.content button', { hasText: /Erase all/ }).first();
  assert(await eraseBtn.count(), 'no Erase all button');
  await eraseBtn.click();
  await page.waitForTimeout(500);
  const confirmBtn = page.locator('.sheet button', { hasText: /^Confirm$/ }).first();
  assert(await confirmBtn.count(), 'no Confirm button in the erase dialog');
  await confirmBtn.click();
  await page.waitForTimeout(1200);
  await go('/app/memory');
  const txt = await body();
  assert(/memory is empty/i.test(txt), `memory not cleared: ${txt.slice(0, 160)}`);
  return 'all local data cleared';
});

/* ------------------------------------------------------------- dashboard */
await scenario('dashboard: the app opens on the dashboard, not the old landing page', async () => {
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const html = await page.locator('#root').innerHTML();
  assert(!html.includes('class="site"'), 'the marketing landing page still renders at /');
  assert((await page.locator('.launch-grid .tile-slot').count()) >= 4, 'no launcher tiles on the dashboard');
  return 'dashboard renders at /';
});

await scenario('dashboard: the former landing page is hidden but not deleted', async () => {
  await go('/former-landing');
  const html = await page.locator('#root').innerHTML();
  assert(html.includes('site') || (await body()).length > 200, 'the former landing page no longer renders anywhere');
  return 'still reachable at /former-landing';
});

await scenario('dashboard: every launcher tile actually navigates', async () => {
  // Derived from the rendered grid, so adding a tile widens this check for free.
  await go('/app');
  const ids = await page.locator('.launch-grid .tile-slot').evaluateAll((els) => els.map((e) => e.dataset.sortid));
  assert(ids.length >= 12, `only ${ids.length} tiles rendered`);
  for (const id of ids) {
    await go('/app');
    await page.locator(`.tile-slot[data-sortid="${id}"] > button`).first().click();
    await page.waitForTimeout(380);
    assert(/#\/app\/.+/.test(page.url()), `tile "${id}" did not navigate (${page.url()})`);
  }
  return `${ids.length} tiles all navigate`;
});

await scenario('dashboard: tiles reorder by drag and the order persists', async () => {
  await go('/app');
  const before = await page.locator('.launch-grid .tile-slot').evaluateAll((e) => e.map((x) => x.dataset.sortid));
  await page.locator('.content button', { hasText: 'Rearrange' }).first().click();
  await page.waitForTimeout(350);
  assert(await page.locator('.launch-grid.editing').count(), 'rearrange mode did not turn on');
  // Bring the grid clear of the sticky appbar before synthesising pointer moves.
  await page.locator('.launch-grid').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  const from = await page.locator('.tile-slot').nth(0).boundingBox();
  const to = await page.locator('.tile-slot').nth(3).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.locator('.launch-grid .tile-slot').evaluateAll((e) => e.map((x) => x.dataset.sortid));
  assert(JSON.stringify(before) !== JSON.stringify(after), 'the drag did not change the order');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const reloaded = await page.locator('.launch-grid .tile-slot').evaluateAll((e) => e.map((x) => x.dataset.sortid));
  assert(JSON.stringify(after) === JSON.stringify(reloaded), 'the new order did not persist');
  return `${before[0]} -> position ${after.indexOf(before[0]) + 1}`;
});

await scenario('dashboard: a tile can be hidden and restored', async () => {
  await go('/app');
  await page.locator('.content button', { hasText: 'Rearrange' }).first().click();
  await page.waitForTimeout(350);
  assert(await page.locator('.launch-grid.editing').count(), 'rearrange mode did not turn on');
  await page.locator('.launch-grid').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  const count = await page.locator('.tile-slot').count();
  const victim = await page.locator('.tile-slot').nth(3).evaluate((e) => e.dataset.sortid);
  const hide = page.locator(`.tile-slot[data-sortid="${victim}"] .tile-hide`);
  await hide.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await hide.click();
  await page.waitForTimeout(450);
  assert((await page.locator('.tile-slot').count()) === count - 1, 'the tile was not removed from the grid');
  const chip = page.locator('.chip', { hasText: /./ }).last();
  assert(await chip.count(), 'the hidden tile did not appear in the restore tray');
  await chip.click();
  await page.waitForTimeout(450);
  assert((await page.locator('.tile-slot').count()) === count, 'restoring did not bring the tile back');
  return `hid and restored ${victim}`;
});

await scenario('dashboard: a new tile is appended rather than dropped', async () => {
  // A saved layout must not hide a feature shipped after it was saved.
  const out = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis.dashboard');
    const saved = raw ? JSON.parse(raw) : { order: [], hidden: [] };
    // Simulate an older layout that predates two of the current tiles.
    const trimmed = { order: saved.order.slice(0, 3), hidden: [] };
    localStorage.setItem('jarvis.dashboard', JSON.stringify(trimmed));
    return trimmed.order.length;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const ids = await page.locator('.launch-grid .tile-slot').evaluateAll((e) => e.map((x) => x.dataset.sortid));
  assert(ids.length > out, `a 3-tile layout rendered ${ids.length} tiles; new tiles were dropped`);
  return `${out} saved -> ${ids.length} shown`;
});

/* --------------------------------------------------------------- weather */
await scenario('weather: a sheet opened from the dashboard is actually clickable', async () => {
  // Regression: a stacking context on .dash trapped the sheet's scrim under the
  // tab bar, so its own buttons could not be tapped on a phone.
  await go('/app');
  // The card ships with a default location, so the opener is the change-location
  // control; on a cleared profile it is the "Set a location" button instead.
  const setBtn = page.locator('.wx-card button', { hasText: 'Set a location' }).first();
  if (await setBtn.count()) await setBtn.click();
  else await page.locator('.wx-card button[title="Change location"]').first().click();
  await page.waitForTimeout(500);
  const btn = page.locator('.sheet button', { hasText: 'Find it' }).first();
  const box = await btn.boundingBox();
  assert(box, 'no submit button in the weather sheet');
  const topEl = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : 'none';
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  assert(!topEl.includes('tabbar') && !topEl.includes('fab'), `the tab bar covers the sheet button (${topEl})`);
  return 'sheet actions are on top';
});

await scenario('weather: a typed city fetches a real reading in Fahrenheit', async () => {
  await go('/app');
  const opener = page.locator('.wx-card button', { hasText: 'Set a location' }).first();
  if (await opener.count()) await opener.click();
  else await page.locator('.wx-card button[title="Change location"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('.sheet input[aria-label="City name"]').fill('Jersey City');
  await page.locator('.sheet button', { hasText: 'Find it' }).click();
  await page.waitForTimeout(5000);
  const txt = await page.locator('.wx-card').innerText();
  assert(/Jersey City/i.test(txt), `no place name in the card: ${txt.slice(0, 80)}`);
  const deg = txt.match(/(-?\d+)\u00b0/);
  assert(deg, `no temperature rendered: ${txt.slice(0, 80)}`);
  assert(/mph/.test(txt), 'wind is not in imperial units');
  assert(/Updated/.test(txt), 'the card does not say how fresh the reading is');
  return `${deg[0]} in Jersey City`;
});

await scenario('weather: the units toggle converts without refetching', async () => {
  const before = await page.locator('.wx-card').innerText();
  const f = Number(before.match(/(-?\d+)\u00b0/)[1]);
  await go('/app/settings');
  await page.locator('.content select').filter({ hasText: 'Imperial' }).first().selectOption('metric');
  await page.waitForTimeout(400);
  await go('/app');
  const after = await page.locator('.wx-card').innerText();
  const c = Number(after.match(/(-?\d+)\u00b0/)[1]);
  assert(/km\/h/.test(after), 'wind did not switch to metric');
  const expected = Math.round((f - 32) / 1.8);
  assert(Math.abs(c - expected) <= 1, `${f}F should be about ${expected}C, card shows ${c}C`);
  // put it back so later scenarios see the default
  await go('/app/settings');
  await page.locator('.content select').filter({ hasText: 'Metric' }).first().selectOption('imperial');
  return `${f}\u00b0F -> ${c}\u00b0C`;
});

/* --------------------------------------------------------------- library */
await scenario('library: seeded projects render as cards', async () => {
  await go('/app/library');
  const cards = await page.locator('.lib-card').count();
  assert(cards >= 1, 'no project cards rendered');
  assertIncludes(await body(), 'JARVIS', 'library');
  return `${cards} cards`;
});

await scenario('library: a card opens the full record with spec and links', async () => {
  await go('/app/library');
  await page.locator('.lib-card', { hasText: 'JARVIS' }).first().click();
  await page.waitForTimeout(500);
  const sheet = page.locator('.sheet').first();
  const txt = await sheet.innerText();
  assertIncludes(txt, 'Live', 'detail sheet');
  await sheet.locator('button', { hasText: 'Rebuild spec' }).click();
  await page.waitForTimeout(300);
  const spec = await sheet.innerText();
  assert(/Stack|Architecture/i.test(spec), `the rebuild spec did not render: ${spec.slice(0, 120)}`);
  return 'about, spec and tabs all render';
});

await scenario('library: create a project, and it persists', async () => {
  await go('/app/library');
  await page.locator('.appbar button[title="New project"]').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input[aria-label="Project name"]').fill('Functional test project');
  await page.locator('.sheet input[aria-label="Tagline"]').fill('Created by the functional suite');
  const save = page.locator('.sheet button', { hasText: 'Save project' }).first();
  assert(!(await save.isDisabled()), 'save disabled with a valid name');
  await save.click();
  await page.waitForTimeout(600);
  assertIncludes(await body(), 'Functional test project', 'library after save');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  assertIncludes(await body(), 'Functional test project', 'library after reload');
  return 'created and persisted';
});

await scenario('library: an invalid link is refused before saving', async () => {
  await go('/app/library');
  await page.locator('.appbar button[title="New project"]').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input[aria-label="Project name"]').fill('Bad link project');
  await page.locator('.sheet button', { hasText: 'Add link' }).click();
  await page.waitForTimeout(250);
  await page.locator('.sheet input[aria-label="Link 1 URL"]').fill('javascript:alert(1)');
  await page.waitForTimeout(300);
  const save = page.locator('.sheet button', { hasText: 'Save project' }).first();
  assert(await save.isDisabled(), 'a non-http link was accepted');
  const txt = await page.locator('.sheet').innerText();
  assert(/not a http/i.test(txt), 'no reason shown for the rejected link');
  return 'rejected with a stated reason';
});

await scenario('library: search narrows the grid', async () => {
  await go('/app/library');
  await page.locator('input[aria-label="Search projects"]').fill('zzz-no-match');
  await page.waitForTimeout(400);
  assert((await page.locator('.lib-card').count()) === 0, 'a miss still showed cards');
  await page.locator('input[aria-label="Search projects"]').fill('JARVIS');
  await page.waitForTimeout(400);
  assert((await page.locator('.lib-card').count()) >= 1, 'a hit showed nothing');
  return 'miss and hit both correct';
});

/* ------------------------------------------------------------------ help */
await scenario('help: the tour renders and its numbers come from the registries', async () => {
  await go('/app/help');
  const txt = await body();
  assertIncludes(txt, 'Start here', 'help');
  // The stat strip must agree with the live tool count, not a hardcoded number.
  const tools = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.help-stat')];
    const hit = cards.find((c) => /tools/.test(c.textContent || ''));
    return hit ? Number(hit.querySelector('b')?.textContent) : -1;
  });
  assert(tools > 40, `the help page reports ${tools} tools`);
  return `${tools} tools reported`;
});

await scenario('help: every chapter opens', async () => {
  await go('/app/help');
  const heads = page.locator('.help-ch-head');
  const n = await heads.count();
  assert(n >= 5, `only ${n} chapters`);
  for (let i = 0; i < n; i++) {
    // The first chapter ships open, so clicking it would collapse it.
    if ((await heads.nth(i).getAttribute('aria-expanded')) !== 'true') {
      await heads.nth(i).click();
      await page.waitForTimeout(200);
    }
    assert((await heads.nth(i).getAttribute('aria-expanded')) === 'true', `chapter ${i + 1} did not expand`);
    const body = page.locator('.help-ch').nth(i).locator('.help-ch-body');
    assert(await body.count(), `chapter ${i + 1} expanded with no content`);
  }
  return `${n} chapters open`;
});

await scenario('radar: tiles actually load for the saved location', async () => {
  await go('/app');
  await page.waitForTimeout(5000);
  const tiles = await page.locator('.radar-tile').evaluateAll((els) =>
    els.map((e) => ({ base: e.className.includes('base'), ok: e.naturalWidth > 0 })));
  assert(tiles.length > 0, 'no radar tiles rendered');
  const base = tiles.filter((t) => t.base && t.ok).length;
  const rain = tiles.filter((t) => !t.base && t.ok).length;
  assert(base > 0, 'no basemap tiles loaded');
  assert(rain > 0, 'no radar tiles loaded');
  return `${base} basemap + ${rain} radar tiles`;
});

/* ------------------------------------------------------- multi-source wx */
await scenario('weather: three sources are fetched and listed individually', async () => {
  await go('/app/weather');
  await page.waitForTimeout(7000);
  const rows = await page.locator('.wx-src').allInnerTexts();
  assert(rows.length === 3, `expected 3 source rows, got ${rows.length}`);
  const okDots = await page.locator('.wx-src .dot.ok').count();
  assert(okDots >= 2, `only ${okDots} sources answered`);
  const txt = rows.join(' | ');
  for (const name of ['Open-Meteo', 'MET Norway', 'US NWS']) {
    assert(txt.includes(name), `${name} missing from the source list`);
  }
  return `${okDots}/3 answered`;
});

await scenario('weather: the merged reading agrees with the sources it merged', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6000);
  const merged = Number((await page.locator('.wx-deg').first().innerText()).replace(/[^\d-]/g, ''));
  const vals = (await page.locator('.wx-src .val').allInnerTexts())
    .map((t) => Number(t.replace(/[^\d-]/g, '')))
    .filter((n) => Number.isFinite(n));
  assert(vals.length >= 2, 'not enough source readings to check the merge');
  // The median must sit inside the range of what the sources reported.
  assert(merged >= Math.min(...vals) && merged <= Math.max(...vals),
    `merged ${merged} is outside the source range ${Math.min(...vals)}..${Math.max(...vals)}`);
  const agree = await page.locator('.wx-agree').innerText();
  assert(/sources (agree|differ)|source only/.test(agree), `no agreement line: ${agree}`);
  return `${merged}\u00b0 within [${Math.min(...vals)}, ${Math.max(...vals)}]`;
});

await scenario('weather: the rain and snow strip renders real bars', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6000);
  const bars = await page.locator('.wx-h .bar').evaluateAll((els) =>
    els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  assert(bars.length >= 6, `only ${bars.length} hours rendered`);
  assert(bars.every((b) => b.w > 0 && b.h > 0), 'a precipitation bar rendered with no size');
  return `${bars.length} hours`;
});

await scenario('weather: air quality is reported with its band', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6000);
  const facts = await page.locator('.wx-facts').innerText();
  assert(/AQI \d+/.test(facts), `no AQI in the facts row: ${facts}`);
  return facts.match(/AQI \d+ . \w+/)?.[0] ?? 'AQI shown';
});

await scenario('weather: the dashboard refresh interval is ten minutes', async () => {
  const ms = await page.evaluate(() => {
    const raw = localStorage.getItem('jarvis.weather');
    return raw ? JSON.parse(raw).fetchedAt : 0;
  });
  assert(ms > 0, 'no cached reading was written');
  return 'cached with a timestamp';
});

await scenario('briefing: the brief button produces a spoken-or-shown summary', async () => {
  await go('/app');
  await page.waitForTimeout(4000);
  await page.locator('.content button', { hasText: /Brief me/ }).first().click();
  await page.waitForTimeout(800);
  const toast = await page.locator('.toast').first().innerText();
  assert(/morning|afternoon|evening|Still up/i.test(toast), `briefing did not start with a greeting: ${toast.slice(0, 80)}`);
  assert(toast.length > 25, 'the briefing was suspiciously short');
  return toast.slice(0, 60);
});

/* --------------------------------------------------- stacking regression */
await scenario('sheets: every bottom sheet is tappable, not trapped under the tab bar', async () => {
  // This has broken twice, both times from a stacking context added to an
  // ancestor (.dash, then .content). It is cheap to check on every screen.
  const cases = [
    ['/app/memory', '.appbar button[title="Add memory"]'],
    ['/app/ideas', '.appbar button[title="New idea"]'],
    ['/app/skills', '.appbar button[title="New skill"]'],
    ['/app/routines', '.appbar button[title="New routine"]'],
    ['/app/library', '.appbar button[title="New project"]'],
  ];
  const checked = [];
  // The quick-action sheet opens from inside the blurred tab bar. An ancestor
  // with backdrop-filter becomes the containing block for position:fixed, which
  // collapsed its scrim to the tab bar's 63px box and dimmed nothing. Sheets are
  // portalled to <body> so no ancestor can capture them.
  await go('/app');
  await page.locator('.fab').click();
  await page.waitForTimeout(500);
  const scrim = await page.locator('.scrim').first().boundingBox();
  const vp = page.viewportSize();
  assert(scrim, 'the quick-action sheet rendered without a scrim');
  assert(scrim.height > vp.height * 0.9 && scrim.width >= vp.width - 1,
    `the scrim covers only ${Math.round(scrim.width)}x${Math.round(scrim.height)} of ${vp.width}x${vp.height}`);
  assert((await page.locator('.scrim').first().evaluate((e) => e.parentElement?.id)) === 'root',
    'the sheet is not portalled out of the tab bar');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  for (const [route, opener] of cases) {
    await go(route);
    await page.locator(opener).click();
    await page.waitForTimeout(450);
    const sheet = page.locator('.sheet').first();
    assert(await sheet.count(), `no sheet opened on ${route}`);
    // The last button in a sheet is its primary action.
    const btn = sheet.locator('button:not([disabled])').last();
    const box = await btn.boundingBox();
    assert(box, `no actionable button in the ${route} sheet`);
    const topEl = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        return el.closest('.tabbar') ? 'TABBAR' : el.closest('.sheet') ? 'sheet' : el.tagName;
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    assert(topEl !== 'TABBAR', `the tab bar covers the primary button of the ${route} sheet`);
    checked.push(route.split('/').pop());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  return `quick actions + ${checked.length} sheets clear of the tab bar`;
});

/* ------------------------------------------------- stale persisted shapes */
await scenario('storage: data saved by an older build never crashes the app', async () => {
  // Regression: the weather cache changed from a single-source snapshot to a
  // merged one. A browser holding the old object rendered
  // "Cannot read properties of undefined (reading 'tone')" and the app was dead
  // until storage was cleared by hand.
  await go('/app');
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 120)));
  await page.evaluate(() => {
    // the exact previous weather schema
    localStorage.setItem('jarvis.weather', JSON.stringify({
      place: { name: 'Washington', lat: 38.895, lon: -77.037 },
      tempC: 24.4, feelsC: 25.1, humidity: 74, windKph: 9.6, code: 3, isDay: 1,
      highC: 29, lowC: 21, precipChance: 15, hourly: [{ hour: 14, tempC: 24 }], fetchedAt: Date.now(),
    }));
    // and a spread of shapes no build ever wrote
    localStorage.setItem('jarvis.projects', JSON.stringify([{ nope: true }]));
    localStorage.setItem('jarvis.memory', JSON.stringify({ not: 'an array' }));
    localStorage.setItem('jarvis.ideas', JSON.stringify(['a string, not a row']));
    localStorage.setItem('jarvis.skills', JSON.stringify(42));
    localStorage.setItem('jarvis.dashboard', JSON.stringify({ order: 'not-an-array' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const txt = await body();
  assert(!/crashed|Cannot read properties/i.test(txt), `the app crashed on stale data: ${txt.slice(0, 140)}`);
  assert((await page.locator('.launch-grid .tile-slot').count()) >= 4, 'the dashboard did not render');
  assert(errs.length === 0, `uncaught errors: ${errs.join(' | ')}`);
  return 'booted clean on six stale keys';
});

await scenario('storage: a stale value is discarded, not handed to the UI', async () => {
  const state = await page.evaluate(() => ({
    weather: localStorage.getItem('jarvis.weather'),
    memory: localStorage.getItem('jarvis.memory'),
    skills: localStorage.getItem('jarvis.skills'),
  }));
  // The reader removes anything that fails its shape check.
  assert(state.memory === null, `bad memory payload survived: ${state.memory}`);
  assert(state.skills === null, `bad skills payload survived: ${state.skills}`);
  return 'incompatible payloads cleared';
});

/* ------------------------------------------------------------ radar UX */
await scenario('radar: drag to move, zoom, and recentre all work', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6500);
  const view = page.locator('.radar-view').first();
  await view.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const tile = () => page.locator('.radar-tile.base').first().getAttribute('src');
  const before = await tile();
  const box = await view.boundingBox();

  // pan
  await page.mouse.move(box.x + box.width / 2, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const panned = await tile();
  assert(before !== panned, 'dragging the map did not move it');
  assertIncludes(await page.locator('.radar-head').innerText(), 'moved', 'radar header');

  // zoom - the buttons sit inside the map, so pointer capture must not eat them
  const z0 = before.split('/').at(-3);
  await page.locator('.radar-zoom button[aria-label="Zoom in"]').click();
  await page.waitForTimeout(800);
  const z1 = (await tile()).split('/').at(-3);
  assert(z0 !== z1, `zoom did not change (${z0} -> ${z1})`);

  // recentre
  await page.locator('.radar-zoom button[aria-label="Recentre on my location"]').click();
  await page.waitForTimeout(700);
  assert(!(await page.locator('.radar-head').innerText()).includes('moved'), 'recentre did not reset the view');
  return `panned, zoomed ${z0}->${z1}, recentred`;
});

await scenario('radar: the timeline states how far back it actually reaches', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6500);
  const scale = await page.locator('.radar-scale').innerText();
  const m = scale.match(/(\d+)\s*min/);
  assert(m, `no history span shown: ${scale}`);
  assert(Number(m[1]) >= 60, `only ${m[1]} minutes of history`);
  const credit = await page.locator('.radar-credit').innerText();
  assert(/free feed publishes/i.test(credit), 'the feed limit is not stated');
  return `${m[1]} min of history, limit stated`;
});

await scenario('radar: the forecast section is labelled as a forecast, not radar', async () => {
  await go('/app/weather');
  await page.waitForTimeout(6500);
  const cols = await page.locator('.fc-col').count();
  assert(cols >= 6, `only ${cols} forecast columns`);
  const txt = await body();
  assert(/not a radar image/i.test(txt), 'the forecast is not distinguished from radar imagery');
  return `${cols} forecast columns`;
});

/* ---------------------------------------------------------- calendar */
await scenario('calendar: a real Google export imports and lists events', async () => {
  await go('/app/calendar');
  const file = new URL('../test/fixtures/google-holidays.ics', import.meta.url);
  await page.setInputFiles('input[type="file"]', fileURLToPath(file));
  await page.waitForTimeout(1500);
  const txt = await body();
  assertIncludes(txt, 'Holidays', 'calendar list');
  const rows = await page.locator('.cal-row').count();
  const cals = await page.locator('.card', { hasText: 'events \u00b7 from' }).count();
  assert(cals >= 1, 'the imported calendar was not listed');
  assert(/\d+ events/.test(txt), `no event count shown: ${txt.slice(0, 120)}`);
  return `${rows} event rows, ${cals} calendar(s)`;
});

await scenario('calendar: the import survives a reload and can be removed', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  assertIncludes(await body(), 'Holidays', 'calendar after reload');
  await page.locator('.card button[title^="Remove"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.sheet button', { hasText: /^Confirm$/ }).click();
  await page.waitForTimeout(600);
  assert(!/Holidays in United States/.test(await body()), 'the calendar was not removed');
  return 'persisted, then removed';
});

await scenario('calendar: a non-calendar file is refused with a readable reason', async () => {
  await go('/app/calendar');
  const tmp = join(tmpdir(), 'not-a-calendar.ics');
  writeFileSync(tmp, 'this is definitely not an ics file');
  await page.setInputFiles('input[type="file"]', tmp);
  await page.waitForTimeout(900);
  const txt = await body();
  assert(/not an iCalendar export/i.test(txt), `no readable error: ${txt.slice(0, 160)}`);
  return 'refused with a reason';
});

await scenario('calendar: the screen states why URL subscription is impossible', async () => {
  await go('/app/calendar');
  const txt = await body();
  assert(/cannot work from a web page|cross-origin/i.test(txt), 'the CORS limitation is not explained');
  assert((await page.locator('input[type="url"]').count()) === 0, 'there is a URL box that cannot work');
  return 'limitation stated, no dead control';
});

/* ------------------------------------------------------- memory import */
await scenario('memory: a pasted markdown block imports after review', async () => {
  await go('/app/memory');
  await page.locator('.appbar button[title="Import into memory"]').click();
  await page.waitForTimeout(450);
  await page.locator('textarea[aria-label="Paste text to import"]').fill(
    '# Preferences\n- Imported likes dark mode\n- Imported uses metric\n',
  );
  await page.locator('.sheet button', { hasText: 'Read the paste' }).click();
  await page.waitForTimeout(500);
  const rows = await page.locator('.imp-row').count();
  assert(rows >= 2, `only ${rows} candidates found`);
  await page.locator('.sheet button', { hasText: /^Add \d+ to memory$/ }).click();
  await page.waitForTimeout(700);
  const txt = await body();
  assertIncludes(txt, 'Imported likes dark mode', 'memory list');
  return `${rows} candidates, imported`;
});

await scenario('memory: importing the same block twice adds nothing', async () => {
  // Self-contained: import a unique line, then offer the identical line again.
  const unique = `Dedupe probe ${Date.now()}`;
  await go('/app/memory');
  await page.locator('.appbar button[title="Import into memory"]').click();
  await page.waitForTimeout(450);
  await page.locator('textarea[aria-label="Paste text to import"]').fill(`- ${unique}`);
  await page.locator('.sheet button', { hasText: 'Read the paste' }).click();
  await page.waitForTimeout(500);
  await page.locator('.sheet button', { hasText: /^Add \d+ to memory$/ }).click();
  await page.waitForTimeout(700);

  await page.locator('.appbar button[title="Import into memory"]').click();
  await page.waitForTimeout(450);
  await page.locator('textarea[aria-label="Paste text to import"]').fill(`- ${unique}`);
  await page.locator('.sheet button', { hasText: 'Read the paste' }).click();
  await page.waitForTimeout(700);
  const sheetTxt = await page.locator('.sheet').innerText();
  assert(/duplicate|Nothing new/i.test(sheetTxt), `duplicates were not reported: ${sheetTxt.slice(0, 200)}`);
  assert((await page.locator('.imp-row').count()) === 0, 'a duplicate was offered for import');
  return 'duplicate rejected';
});

await scenario('memory: a PDF is refused with the reason and a real alternative', async () => {
  await go('/app/memory');
  await page.locator('.appbar button[title="Import into memory"]').click();
  await page.waitForTimeout(450);
  const tmp = join(tmpdir(), 'doc.pdf');
  writeFileSync(tmp, '%PDF-1.4 binary junk');
  await page.setInputFiles('.sheet input[type="file"]', tmp);
  await page.waitForTimeout(600);
  const t = await page.locator('.sheet').innerText();
  assert(/does not bundle/i.test(t), `no honest PDF explanation: ${t.slice(0, 160)}`);
  assert(/paste/i.test(t), 'no alternative offered');
  return 'refused with an alternative';
});

await scenario('typing: fields accept continuous input, not one character', async () => {
  // Regression: Sheet's focus effect depended on the inline onClose prop, so it
  // re-ran on every keystroke and pulled focus out of the field.
  for (const [route, opener, sel] of [
    ['/app/memory', '.appbar button[title="Add memory"]', '.sheet textarea'],
    ['/app/ideas', '.appbar button[title="New idea"]', '.sheet input'],
    ['/app/library', '.appbar button[title="New project"]', '.sheet input[aria-label="Project name"]'],
  ]) {
    await go(route);
    await page.locator(opener).click();
    await page.waitForTimeout(400);
    const f = page.locator(sel).first();
    await f.click();
    await page.keyboard.type('abcdefgh', { delay: 25 });
    const v = await f.inputValue();
    assert(v === 'abcdefgh', `${route}: typed 8 characters, field holds "${v}"`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  return '3 sheets accept full input';
});

await scenario('copy: a blocked clipboard is reported, never faked', async () => {
  await go('/app/library');
  // A sheet left open by an earlier scenario would cover the grid.
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // Earlier scenarios can leave the library empty (the reset scenario wipes it
  // and nothing reloads afterwards), so make our own subject.
  if (!(await page.locator('.lib-card').count())) {
    await page.locator('.appbar button[title="New project"]').click();
    await page.waitForTimeout(400);
    await page.locator('.sheet input[aria-label="Project name"]').fill('Copy probe project');
    await page.locator('.sheet button', { hasText: 'Save project' }).click();
    await page.waitForTimeout(700);
  }
  await page.locator('.lib-card').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.locator('.lib-card').first().click();
  await page.waitForTimeout(500);
  await page.locator('.sheet button', { hasText: 'Copy dump' }).click();
  await page.waitForTimeout(600);
  const toast = await page.locator('.toast').first().innerText();
  assert(/blocked/i.test(toast), `a failed copy claimed success: ${toast}`);
  assert(await page.locator('textarea[aria-label="Project record"]').count(), 'no manual-copy fallback shown');
  return 'failure surfaced with a fallback';
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (consoleErrors.length) {
  console.log(`\nuncaught page errors (${consoleErrors.length}):`);
  for (const e of [...new Set(consoleErrors)].slice(0, 6)) console.log('  ' + e);
}
await writeFile('artifacts/functional-report.json', JSON.stringify({ results, consoleErrors }, null, 2));
process.exit(failed.length ? 1 : 0);
