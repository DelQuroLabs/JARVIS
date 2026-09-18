// Loads the production build inside a sandbox="allow-scripts" iframe -- an
// opaque origin, exactly like the workspace file viewer. A top-level page.goto
// hides two real bugs: module-scope SecurityErrors and refused popups.
// Usage: node scripts/iframe-check.mjs [origin]

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORIGIN = process.argv[2] ?? 'http://127.0.0.1:4173';
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ` -- ${note}` : ''}`);
};

const host = `<!doctype html><meta charset="utf-8"><title>sandbox harness</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<iframe id="f" sandbox="allow-scripts" src="${ORIGIN}/"></iframe>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.route('**/harness', (r) => r.fulfill({ contentType: 'text/html', body: host }));
await page.goto(`${ORIGIN}/harness`, { waitUntil: 'load' });

const frame = page.frameLocator('#f');
let booted = false;
try {
  await frame.locator('.app, .site').first().waitFor({ state: 'visible', timeout: 15_000 });
  booted = true;
} catch {
  /* reported below */
}
check('app boots inside an opaque-origin iframe', booted);

const fatal = errors.filter((e) => /SecurityError|is not defined|Cannot read|Failed to resolve|Unexpected token/i.test(e));
check('no fatal errors at module scope', fatal.length === 0, fatal.slice(0, 2).join(' | '));

// Reach the app shell.
if (booted) {
  const enter = frame.locator('a[href="#/app"], button:has-text("Open JARVIS"), button:has-text("Launch")').first();
  if (await enter.count()) {
    await enter.click().catch(() => {});
  } else {
    await page.evaluate(() => {
      const f = document.getElementById('f');
      f.src = f.src.replace(/#.*$/, '') + '#/app';
    });
  }
  await frame.locator('.tabbar').first().waitFor({ timeout: 10_000 }).catch(() => {});
}

const tabs = await frame.locator('.tabbar .tab').count().catch(() => 0);
check('bottom tab bar renders 4 destinations', tabs === 4, `saw ${tabs}`);

const fab = frame.locator('.fab');
check('centre action button is present', (await fab.count()) === 1);

let sheetOpened = false;
if ((await fab.count()) === 1) {
  await fab.click().catch(() => {});
  sheetOpened = await frame
    .locator('.sheet')
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);
  if (sheetOpened) await page.keyboard.press('Escape').catch(() => {});
}
check('centre button opens the quick-action sheet', sheetOpened);

// The palette must open from the toolbar button, since a sandboxed iframe
// still receives key events but the user may be on a phone with no keyboard.
let paletteOpened = false;
const cmdk = frame.locator('.cmdk');
if (await cmdk.count()) {
  await cmdk.first().click().catch(() => {});
  paletteOpened = await frame
    .locator('.palette')
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);
}
check('command palette opens from the toolbar', paletteOpened);

let paletteFinds = false;
if (paletteOpened) {
  await frame.locator('.palette input').fill('settings').catch(() => {});
  paletteFinds = (await frame.locator('.palette-row').count().catch(() => 0)) > 0;
  await page.keyboard.press('Escape').catch(() => {});
}
check('palette search returns matches', paletteFinds);

// No bare target="_blank" anchors: popups are refused in this sandbox.
const blanks = await frame.locator('a[target="_blank"]').count().catch(() => 0);
check('no anchors that the sandbox would silently refuse', blanks === 0, `saw ${blanks}`);

mkdirSync('artifacts', { recursive: true });
await page.screenshot({ path: 'artifacts/iframe-check.png' }).catch(() => {});
writeFileSync('artifacts/iframe-check.json', JSON.stringify({ origin: ORIGIN, results, errors: errors.slice(0, 20) }, null, 2));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
