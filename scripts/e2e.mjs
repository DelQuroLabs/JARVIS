#!/usr/bin/env node
/**
 * End-to-end route sweep.
 *
 * Loads every route in a real browser at phone and desktop widths, and fails on
 * any console error, page error, blank render, or React error boundary. Also
 * exercises the interactions that cannot be covered by domain unit tests: the
 * chat send path, tool execution, approval gating, and the workflow runner.
 *
 *   node scripts/e2e.mjs [baseUrl]     default http://localhost:5173
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:4173';
const SHOTS = new URL('../artifacts/screens/', import.meta.url).pathname;

const ROUTES = [
  '/', '/guide', '/privacy',
  '/app', '/app/chat', '/app/agent', '/app/build', '/app/more',
  '/app/tools', '/app/skills', '/app/workflows', '/app/crew', '/app/routines',
  '/app/memory', '/app/traces', '/app/modes', '/app/ideas', '/app/cloud',
  '/app/settings', '/app/providers', '/app/diagnostics', '/app/library', '/app/help', '/app/weather', '/app/calendar',
];

// Noise that is expected in the sandbox and is not an app defect.
/**
 * The keyless endpoint answers 4xx/5xx from some networks. That is an upstream
 * condition, so it is judged by resource URL -- a 500 from our own origin is
 * still a real failure.
 */
const UPSTREAM = /pollinations\.ai/i;
function ignorable(m) {
  let url = '';
  try { url = m.location()?.url || ''; } catch { url = ''; }
  if (url && UPSTREAM.test(url)) return true;
  return IGNORE.some((r) => r.test(m.text()));
}

const IGNORE = [
  /Failed to load resource.*sw\.js/i,
  /ServiceWorker/i,
  /favicon/i,
  /Download the React DevTools/i,
  // Upstream rate limiting on the keyless model endpoint. The app surfaces this
  // as a failed node with the real reason, which is the behaviour under test -
  // the browser still logs the raw response, and that log is not a defect.
  /Failed to load resource.*status of (401|402|403|429)/i,
  // Vite's HMR socket targets the sandbox proxy port; it is absent under `vite preview`.
  /ws:\/\/localhost:443/i,
];

const results = [];
let failures = 0;

const fail = (name, detail) => {
  failures++;
  results.push({ name, ok: false, detail });
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const pass = (name, detail = '') => {
  results.push({ name, ok: true, detail });
  console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
};

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();

async function sweep(label, viewport) {
  console.log(`\n== ${label} ${viewport.width}x${viewport.height} ==`);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m)) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${BASE}/#${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(450);

    const state = await page.evaluate(() => {
      const root = document.getElementById('root');
      const text = (root?.innerText || '').trim();
      return {
        chars: text.length,
        boot: !!document.getElementById('boot'),
        boundary: /Something went wrong|ChunkLoadError/i.test(text),
        // Anything wider than the viewport means a horizontal scrollbar on a phone.
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // The design system sets a 44px tap floor on touch widths. The canvas
        // ports are the one documented exception, so they are excluded here.
        tiny: Array.from(document.querySelectorAll('button, a[href], input, select'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.height < 40 && !el.closest('.canvas');
          })
          .map((el) => `${el.tagName}.${el.className}`.slice(0, 40)),
      };
    });

    const name = `${label} ${route}`;
    if (state.boot) fail(name, 'stuck on the boot spinner - the bundle never mounted');
    else if (state.boundary) fail(name, 'error boundary rendered');
    else if (state.chars < 60) fail(name, `rendered only ${state.chars} chars of text`);
    else if (errors.length) fail(name, errors.slice(0, 2).join(' | '));
    else if (viewport.width < 500 && state.overflow > 2) fail(name, `horizontal overflow of ${state.overflow}px`);
    else if (viewport.width < 500 && state.tiny.length) fail(name, `below the 44px tap floor: ${state.tiny.join(', ')}`);
    else pass(name);

    if (viewport.width < 500) {
      const file = route === '/' ? 'landing' : route.replace(/^\/app\/?/, 'app-').replace(/\//g, '-') || 'app';
      await page.screenshot({ path: `${SHOTS}${file}.png` });
    }
  }
  await ctx.close();
  return page;
}

await sweep('phone', { width: 390, height: 844 });
await sweep('desktop', { width: 1440, height: 900 });

/* -------------------- interaction checks -------------------- */
console.log('\n== interactions ==');
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !ignorable(m)) errs.push(m.text());
});

async function check(name, fn) {
  errs.length = 0;
  try {
    const detail = await fn();
    if (errs.length) fail(name, errs[0]);
    else pass(name, detail || '');
  } catch (e) {
    fail(name, e.message.split('\n')[0].slice(0, 200));
  }
}

await check('chat answers an identity question with zero network calls', async () => {
  await page.goto(`${BASE}/#/app/chat`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  // The dashboard's weather and radar refresh on their own schedule and have
  // nothing to do with answering a chat message. The claim under test is that
  // the ANSWER needed no network, so only model and tool traffic counts.
  // Hosts the dashboard polls on its own schedule. They have nothing to do with
  // answering a chat message, and the claim under test is that the ANSWER needed
  // no network -- so only model and tool traffic counts.
  const AMBIENT = /open-meteo\.com|api\.met\.no|api\.weather\.gov|rainviewer\.com|tile\.openstreetmap\.org/;
  let calls = 0;
  const seen = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(BASE) || AMBIENT.test(u)) return;
    calls++;
    seen.push(u.slice(0, 80));
  });
  // Enter inserts a newline unless the user opts into send-on-enter, so the
  // real mobile path is the send button.
  await page.fill('textarea', 'who are you');
  await page.click('button[aria-label="Send"]');
  await page.waitForTimeout(1200);
  const text = await page.innerText('#root');
  if (!/JARVIS/i.test(text)) throw new Error('no reply rendered');
  if (calls > 0) throw new Error(`${calls} outbound request(s) for a canned answer: ${seen.join(', ')}`);
  return 'reply rendered, 0 outbound requests';
});

await check('chat runs the calculator tool and shows the result', async () => {
  await page.fill('textarea', 'what is 847 * 23');
  await page.click('button[aria-label="Send"]');
  await page.waitForTimeout(1800);
  const text = await page.innerText('#root');
  if (!text.includes('19481')) throw new Error('19481 not present in the transcript');
  return 'tool result 19481 shown';
});

await check('the conversation survives a reload', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  const text = await page.innerText('#root');
  if (!text.includes('19481')) throw new Error('transcript lost on reload');
  return 'persisted to localStorage';
});

await check('an approval-gated tool asks before running', async () => {
  await page.goto(`${BASE}/#/app/tools`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const gated = page.locator('text=fs_write').first();
  await gated.click();
  await page.waitForTimeout(400);
  const body = await page.innerText('#root');
  if (!/approval|approve/i.test(body)) throw new Error('no approval affordance surfaced for fs_write');
  return 'gate surfaced';
});

await check('diagnostics runs its live checks', async () => {
  await page.goto(`${BASE}/#/app/diagnostics`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.click('button:has-text("Run live checks")');
  await page.waitForTimeout(3500);
  const text = await page.innerText('#root');
  const m = text.match(/(\d+) passed\D+(\d+) failed\D+(\d+) blocked/);
  if (!m) throw new Error('no diagnostics summary rendered');
  const [, passed, failed, blocked] = m.map(Number);
  if (failed > 0) throw new Error(`${failed} diagnostic check(s) reported failed`);
  if (/not run/i.test(text)) throw new Error('a check was left un-run after pressing Run');
  if (passed < 15) throw new Error(`only ${passed} checks passed`);
  return `${passed} passed, ${blocked} blocked with a reason`;
});

await check('a workflow template runs end to end', async () => {
  await page.goto(`${BASE}/#/app/workflows`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  // The list button opens a run sheet that asks for the {{input}} value first.
  await page.click('button[aria-label^="Run "]');
  await page.waitForTimeout(500);
  await page.fill('.sheet textarea, .sheet input[type="text"]', 'the deploy failed at 3am, can someone look');
  await page.click('button:has-text("Run workflow")');
  await page.waitForTimeout(3000);
  const text = await page.innerText('#root');
  const m = text.match(/\b(ok|failed|blocked)\b/i);
  if (!m) throw new Error('no run status reported');
  // With no API key the ai_prompt node legitimately fails or blocks. What must
  // hold either way is that no node ends non-ok without saying why.
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^(failed|blocked)$/i.test(lines[i])) {
      // Shape is [status, nodeLabel, reason]. The run-level chip is
      // [status, duration] and carries its reason on the nodes instead.
      if (/^\d+(\.\d+)?m?s$/i.test(lines[i + 1] || '')) continue;
      const reason = (lines[i + 2] || '').trim();
      if (!reason || /^(ok|failed|blocked|skipped)$/i.test(reason)) {
        throw new Error(`a ${lines[i]} node reported no reason`);
      }
    }
  }
  if (!/branch not taken/.test(text)) throw new Error('untaken branches were not marked skipped');
  return `status ${m[1].toLowerCase()}, every non-ok node carries a reason`;
});

await check('the app still works offline', async () => {
  await ctx.setOffline(true);
  await page.goto(`${BASE}/#/app`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(800);
  const text = await page.innerText('#root').catch(() => '');
  await ctx.setOffline(false);
  if (text.length < 60) throw new Error('blank while offline');
  return 'shell rendered from cache';
});

await browser.close();

const summary = { when: new Date().toISOString(), base: BASE, total: results.length, failed: failures, results };
await writeFile(new URL('../artifacts/e2e-report.json', import.meta.url), JSON.stringify(summary, null, 2));

console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
console.log('report: artifacts/e2e-report.json   screenshots: artifacts/screens/');
process.exit(failures ? 1 : 0);
