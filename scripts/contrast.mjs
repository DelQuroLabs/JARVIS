/**
 * Contrast gate.
 *
 * Every piece of text in the app must meet WCAG AA against what is actually
 * painted behind it: 4.5:1 for body text, 3:1 for large or bold text. This runs
 * in both themes because the brand colours are tuned for a dark background and
 * several of them dropped to 1.6:1 on a light one.
 *
 * Honest limitation: an element painted over a CSS gradient is skipped, because
 * getComputedStyle cannot tell us which stop sits behind the glyphs. Those cases
 * are the accent and danger buttons, and their ink is pinned to a token whose
 * ratio is asserted numerically at the bottom of this file instead.
 */
import { chromium } from 'playwright';

const ORIGIN = process.argv[2] || 'http://127.0.0.1:4173';
const ROUTES = [
  '/', '/privacy', '/guide',
  '/app', '/app/chat', '/app/agent', '/app/tools', '/app/skills', '/app/workflows',
  '/app/crew', '/app/routines', '/app/memory', '/app/traces', '/app/modes',
  '/app/ideas', '/app/cloud', '/app/settings', '/app/providers', '/app/diagnostics', '/app/library', '/app/help', '/app/weather', '/app/calendar',
  '/app/build', '/app/more',
];

const probe = () => {
  // oklab -> sRGB. Chrome serialises color-mix() results in oklab, and reading
  // the numbers as if they were rgb reports near-black for a near-white bar.
  const oklabToRgb = (L, a, bb) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * bb) ** 3;
    const lin = [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    return lin.map((v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, c * 255));
    });
  };
  const parse = (c) => {
    if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const m = (c.match(/-?[\d.]+/g) || [0, 0, 0]).map(Number);
    if (/^oklab\(/.test(c)) {
      const [r, g, b] = oklabToRgb(m[0], m[1], m[2]);
      return { r, g, b, a: m.length > 3 ? m[3] : 1 };
    }
    const scale = /^color\(/.test(c) ? 255 : 1; // color(srgb ...) uses 0-1 channels
    return { r: m[0] * scale, g: m[1] * scale, b: m[2] * scale, a: m.length > 3 ? m[3] : 1 };
  };
  const over = (f, b) => ({
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  });
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };

  const onGradient = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage.includes('gradient')) return true;
      if (parse(st.backgroundColor).a === 1) return false;
    }
    return false;
  };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0) stack.push(c);
      if (c.a === 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const out = [];
  for (const el of document.querySelectorAll('.content *, .appbar *, .tabbar *, .site *, .rail *')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (txt.length < 3) continue;
    const st = getComputedStyle(el);
    if (parseFloat(st.opacity) < 0.5) continue;
    if (el.getBoundingClientRect().width === 0) continue;
    if (onGradient(el)) continue;
    const bg = bgOf(el);
    const fg = over(parse(st.color), bg);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(st.fontSize);
    const need = size >= 24 || (size >= 18.66 && parseInt(st.fontWeight, 10) >= 700) ? 3 : 4.5;
    if (ratio < need) out.push({ txt: txt.slice(0, 34), ratio: +ratio.toFixed(2), need, size: st.fontSize });
  }
  return out;
};

const browser = await chromium.launch();
const failures = [];

for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(550);
    for (const f of await page.evaluate(probe)) failures.push({ theme, route, ...f });
  }
  await page.close();
}
await browser.close();

/* Ink pinned on top of a gradient, asserted numerically since the DOM cannot
   report which gradient stop a glyph sits over. */
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const rl = (c) => {
  const f = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const ratio = (a, b) => (Math.max(rl(hex(a)), rl(hex(b))) + 0.05) / (Math.min(rl(hex(a)), rl(hex(b))) + 0.05);
const PINNED = [
  ['primary button ink on accent', '#04120f', '#35e0c0'],
  ['danger button ink, dark theme', '#1a0407', '#ff6b7a'],
  ['danger button ink, light theme', '#ffffff', '#c8283c'],
];

console.log('\ncontrast');
for (const [label, ink, bg] of PINNED) {
  const r = ratio(ink, bg);
  console.log(`  ${r >= 4.5 ? 'ok  ' : 'FAIL'}  ${label} — ${r.toFixed(2)}:1`);
  if (r < 4.5) failures.push({ theme: 'both', route: '(token)', txt: label, ratio: +r.toFixed(2), need: 4.5 });
}

const seen = new Set();
const unique = failures.filter((f) => {
  const k = `${f.theme}|${f.txt}|${f.ratio}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

for (const f of unique) {
  console.log(`  FAIL  [${f.theme}] ${f.route} "${f.txt}" — ${f.ratio}:1, needs ${f.need} (${f.size || ''})`);
}
console.log(unique.length ? `\n${unique.length} contrast failures` : '\nall text meets AA in both themes');
process.exit(unique.length ? 1 : 0);
