/**
 * Deploy-survival check.
 *
 * Publishes a new build while a tab is open on the previous one, then navigates
 * that stale tab to a screen it had never loaded. The chunk it asks for no
 * longer exists. The app must recover with exactly one silent reload -- not a
 * crash screen, and emphatically not a reload loop, which an earlier version of
 * the fix produced 144 times in nine seconds.
 *
 * Run against a running `vite preview`: node scripts/deploy-check.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const before = readdirSync('dist/assets').find((f) => /^Agent-.*\.js$/.test(f));
let failures = 0;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 412, height: 950 } });
let loads = 0;
p.on('load', () => loads++);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));

// 1. the user opens the app on build A and never visits /app/agent
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await p.waitForTimeout(2500);
const loadsAfterOpen = loads;

// 2. a new build is published while that tab sits there
const f = 'src/ui/screens/Agent.tsx';
const src = readFileSync(f, 'utf8');
// A visible string survives minification, so the chunk hash really changes.
writeFileSync(f, src.replace('title="Agent console"', `title="Agent console ${Date.now()}"`));
execSync('npx vite build', { stdio: 'ignore' });
writeFileSync(f, src);
const after = readdirSync('dist/assets').find((x) => /^Agent-.*\.js$/.test(x));
console.log(`chunk renamed: ${before} -> ${after}  (${before !== after ? 'different, as in a real deploy' : 'SAME - test invalid'})`);

// 3. the stale tab navigates to a screen it has not loaded yet
await p.evaluate(() => { globalThis.location.hash = '#/app/agent'; });
await p.waitForTimeout(6000);

const txt = await p.locator('#root').innerText();
const extra = loads - loadsAfterOpen;
const rendered = /Agent console|delegate|objective/i.test(txt);
const errored = /crashed|updated while this tab/i.test(txt);

const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

console.log('\ndeploy survival\n');
check('the chunk hash actually changed', before !== after, `${before} -> ${after}`);
check('recovered with exactly one reload', extra === 1, `${extra} extra load(s)`);
check('the screen rendered after recovery', rendered);
check('no error screen was left on display', !errored);
check('no uncaught page errors', errs.length === 0, errs.join(' | '));

await b.close();
console.log(failures ? `\n${failures} failed\n` : '\nall deploy checks passed\n');
process.exit(failures ? 1 : 0);
