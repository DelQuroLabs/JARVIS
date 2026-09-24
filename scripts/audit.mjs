/**
 * Deep audit: walk every route at phone and desktop widths, click every visible
 * control, and record anything that looks broken.
 *
 * This is a fault-finder, not a gate. It is deliberately noisy: it reports
 * suspicions (dead controls, silent handlers, overflow, contrast-free text) that
 * a human then triages. Real defects get fixed and moved into the e2e gate.
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const ORIGIN = process.argv[2] || 'http://127.0.0.1:4173';
const ROUTES = [
  '/', '/privacy', '/guide',
  '/app', '/app/chat', '/app/agent', '/app/tools', '/app/skills', '/app/workflows',
  '/app/crew', '/app/routines', '/app/memory', '/app/traces', '/app/modes',
  '/app/ideas', '/app/cloud', '/app/settings', '/app/providers', '/app/diagnostics', '/app/library', '/app/help', '/app/weather', '/app/calendar',
  '/app/build', '/app/more',
];

const findings = [];
const note = (route, width, kind, detail) => findings.push({ route, width, kind, detail });

const browser = await chromium.launch();

for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  const page = await ctx.newPage();

  const errors = [];
  // A failed request to a third-party model endpoint is an upstream condition,
  // not a defect in this app. Judge by the resource URL, never by status alone,
  // so a 500 from our own origin still counts as a finding.
  const UPSTREAM = /pollinations\.ai/i;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    let url = '';
    try { url = m.location()?.url || ''; } catch { url = ''; }
    if (url && UPSTREAM.test(url)) return;
    let host = '';
    try { host = url ? ` [${new URL(url).host}]` : ''; } catch { host = ''; }
    errors.push(m.text().slice(0, 200) + host);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));

  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(650);

    // 1. did anything render at all?
    const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
    if (bodyText.length < 20) note(route, width, 'blank', `only ${bodyText.length} chars rendered`);
    // Detect the error boundary by its element, not by prose. Matching on the
    // word "crash" flagged the privacy page, which merely explains that the app
    // sends no crash reports.
    if (await page.locator('.crash').count()) {
      note(route, width, 'crash-screen', (await page.locator('.crash').first().innerText()).slice(0, 120));
    }

    // 2. horizontal overflow
    // Only a page that actually scrolls sideways is a defect. Chips inside a
    // deliberately scrollable strip extend past the viewport by design.
    const ovf = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= doc.clientWidth + 1) return [];
      const inScroller = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
        return false;
      };
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > doc.clientWidth + 1 || r.left < -1) && !inScroller(el)) {
          bad.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]} → ${Math.round(r.right)}px`);
        }
      }
      return bad.slice(0, 3);
    });
    if (ovf.length) note(route, width, 'overflow', `page scrolls sideways; ${ovf.join(' | ')}`);

    // 3. tap targets under 44px on phone
    if (width === 390) {
      const small = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('.content button, .sheet button, .appbar button, .tabbar button')) {
          if (el.classList.contains('wf-port')) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24)) {
            bad.push(`${(el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return bad.slice(0, 5);
      });
      if (small.length) note(route, width, 'tap-target', small.join(' | '));
    }

    // 4. controls with no accessible name
    const unnamed = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim();
        if (!name) bad.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]}`);
      }
      return [...new Set(bad)].slice(0, 5);
    });
    if (unnamed.length) note(route, width, 'no-accessible-name', unnamed.join(' | '));

    // 5. anchors the sandboxed preview will silently refuse
    const anchors = await page.evaluate(() =>
      [...document.querySelectorAll('a[target="_blank"], a[href^="http"]')].map((a) => a.getAttribute('href')).slice(0, 3));
    if (anchors.length) note(route, width, 'external-anchor', anchors.join(' | '));

    // 6. images that failed to load
    const brokenImg = await page.evaluate(() =>
      [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 3));
    if (brokenImg.length) note(route, width, 'broken-image', brokenImg.join(' | '));

    // 7. console errors on load
    if (errors.length) note(route, width, 'console-error', [...new Set(errors)].slice(0, 2).join(' | '));

    // 8. click every enabled button on phone and see if anything explodes.
    //    Destructive-sounding labels are skipped so the audit cannot wipe state.
    if (width === 390) {
      const SKIP = /delete|clear|remove|reset|purge|sign out|disconnect|wipe|forget/i;
      const count = await page.locator('.content button:not([disabled])').count();
      for (let i = 0; i < Math.min(count, 14); i++) {
        const btn = page.locator('.content button:not([disabled])').nth(i);
        const label = ((await btn.textContent().catch(() => '')) || (await btn.getAttribute('aria-label').catch(() => '')) || '').trim();
        if (!label || SKIP.test(label)) continue;
        errors.length = 0;
        try {
          await btn.click({ timeout: 1500, trial: false });
          await page.waitForTimeout(220);
        } catch { continue; }
        const after = (await page.locator('body').innerText().catch(() => '')).trim();
        if (after.length < 20) note(route, width, 'click-blanked-app', label);
        if (/crash|something went wrong/i.test(after.slice(0, 300))) note(route, width, 'click-crashed', label);
        if (errors.length) note(route, width, 'click-console-error', `${label} → ${errors[0]}`);
        // close any sheet the click opened, so the next click is not shadowed
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(120);
        if (!page.url().includes(route)) {
          await page.goto(`${ORIGIN}/#${route}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(400);
        }
      }
    }
  }
  await ctx.close();
}

await browser.close();

const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

console.log('\n=== audit findings ===');
for (const f of findings) console.log(`[${f.kind}] ${f.route} @${f.width}  ${f.detail}`);
console.log('\n=== totals ===');
console.log(JSON.stringify(byKind, null, 2));
console.log(`${findings.length} findings across ${ROUTES.length} routes`);
await writeFile('artifacts/audit.json', JSON.stringify(findings, null, 2));
