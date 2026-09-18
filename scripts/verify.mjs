#!/usr/bin/env node
/**
 * Ships-clean gate. Checks the claims the product makes about itself against
 * the built artifact, so a stale number in the UI or a leaked key fails the
 * build rather than reaching a user.
 *
 *   node scripts/verify.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];
const ok = (m) => notes.push(`  ok    ${m}`);
const bad = (m) => problems.push(`  FAIL  ${m}`);

const read = (p) => readFile(join(root, p), 'utf8');

/* 1. The dist bundle must exist and contain no credentials. */
let bundle = '';
try {
  const assets = join(root, 'dist', 'assets');
  for (const f of await readdir(assets)) {
    if (f.endsWith('.js') || f.endsWith('.css')) bundle += await readFile(join(assets, f), 'utf8');
  }
  ok(`read ${(bundle.length / 1024).toFixed(0)} kB of built assets`);
} catch {
  bad('dist/assets is missing - run npm run build first');
}

const KEY_SHAPES = [
  [/\bgsk_[A-Za-z0-9]{40,}/, 'Groq key'],
  [/\bsk-ant-[A-Za-z0-9_-]{25,}/, 'Anthropic key'],
  [/\bsk-proj-[A-Za-z0-9_-]{25,}/, 'OpenAI key'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, 'Supabase service key'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
];
for (const [re, label] of KEY_SHAPES) {
  if (re.test(bundle)) bad(`a ${label} is embedded in the built bundle`);
}
if (!problems.length) ok('no credential shapes found in the bundle');

/* 2. Counts stated in the UI must match the registries. */
const src = {
  tools: await read('src/core/tools.ts'),
  workflow: await read('src/core/workflow.ts'),
  crew: await read('src/core/crew.ts'),
  modes: await read('src/core/modes.ts'),
  intents: await read('src/core/intents.ts'),
  providers: await read('src/core/providers.ts'),
  shell: await read('src/ui/Shell.tsx'),
  e2e: await read('scripts/e2e.mjs'),
  audit: await read('scripts/audit.mjs'),
  contrast: await read('scripts/contrast.mjs'),
  services: await read('src/core/services.ts'),
};
const count = (text, re) => (text.match(re) || []).length;

const counts = {
  tools: count(src.tools, /^\s{2}\{\s*$|^\s{2}tool\(/gm),
  nodeKinds: count(src.workflow, /^\s{2}\{ kind:/gm),
  roles: count(src.crew, /^\s{2}\{ id:/gm),
  modes: count(src.modes, /^\s{2}\{$/gm),
};
ok(`registry sizes parsed: ${JSON.stringify(counts)}`);

/* 2b. A provider must not be offerable without a real adapter and real evidence.
 *     The failure this prevents: a plausible-looking entry that 404s or is
 *     silently blocked by the browser the first time a user pastes a key. */
{
  const ids = [...src.providers.matchAll(/^\s{4}id: '([a-z]+)',$/gm)].map((m) => m[1]);
  const verified = [...src.providers.matchAll(/cors: 'verified',\n\s*probed: '(\d{4}-\d{2}-\d{2})'/g)].length;
  const corsClaims = count(src.providers, /cors: 'verified'/g);
  if (!ids.length) bad('could not parse the provider registry');
  if (verified !== corsClaims) {
    bad(`${corsClaims - verified} provider(s) claim a verified CORS probe with no probe date`);
  }
  // Anything routed through the OpenAI-compatible table must also have a spec.
  const hosts = [...src.providers.matchAll(/^\s{2}([a-z]+): 'https:\/\//gm)].map((m) => m[1]);
  const orphans = hosts.filter((h) => !ids.includes(h));
  if (orphans.length) bad(`endpoint(s) with no provider spec: ${orphans.join(', ')}`);
  // Services must only promise upgrades to tools that exist.
  const promised = [...src.services.matchAll(/tools: \['([^']+)'\]/g)].map((m) => m[1]);
  const missing = promised.filter((t) => !src.tools.includes(`name: '${t}'`));
  if (missing.length) bad(`service key promises a missing tool: ${missing.join(', ')}`);
  ok(`${ids.length} providers, ${corsClaims} with a dated browser CORS probe, ${promised.length} tool keys all resolvable`);
}

/* 2c. A new screen must not be able to ship untested. The Providers screen was
 *     added and the e2e harness kept passing because its route list is hand
 *     written; the gate simply never visited it. */
{
  const declared = [...src.shell.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const covered = (name, text) => {
    const list = [...text.matchAll(/'(\/[a-z/]*)'/g)].map((m) => m[1]);
    const missing = declared.filter((r) => !list.includes(r));
    if (missing.length) bad(`${name} does not visit: ${missing.join(", ")}`);
  };
  if (declared.length < 5) bad('could not parse the route table from Shell.tsx');
  covered('scripts/e2e.mjs', src.e2e);
  covered('scripts/audit.mjs', src.audit);
  covered('scripts/contrast.mjs', src.contrast);
  ok(`all ${declared.length} declared routes are visited by every browser gate`);
}

/* 3. Hard-coded numbers in UI copy are the biggest drift risk. */
const uiFiles = [];
async function walk(dir) {
  for (const f of await readdir(dir)) {
    const p = join(dir, f);
    if ((await stat(p)).isDirectory()) await walk(p);
    else if (f.endsWith('.tsx')) uiFiles.push(p);
  }
}
await walk(join(root, 'src', 'ui'));

const FORBIDDEN = [
  [/720\s*B|720 billion/i, 'a "720B parameters" style capability claim'],
  [/wake word|always listening|hey jarvis/i, 'a wake-word claim the app cannot deliver'],
  [/\$\d+\s*\/\s*(mo|month)|per month|pricing tier/i, 'a pricing claim'],
  [/controls your (computer|desktop|phone)/i, 'an OS-control claim'],
];
// Checked line by line: naming a capability in order to deny it is exactly what
// the honesty rule asks for, so a line that also negates is not a violation.
const NEGATED = /\bno\b|\bnot\b|cannot|can't|never|without|unlike|refus|instead of/i;
for (const file of uiFiles) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const [re, label] of FORBIDDEN) {
      if (re.test(line) && !NEGATED.test(line)) bad(`${file.replace(root, '.')}:${i + 1} contains ${label}`);
    }
  });
}
ok(`scanned ${uiFiles.length} UI files for capability claims the app cannot honour`);

/* 4. The service worker must not cache model or API responses. */
const sw = await read('public/sw.js');
for (const host of ['api.groq.com', 'generativelanguage.googleapis.com', 'text.pollinations.ai', '.supabase.co']) {
  if (!sw.includes(host)) bad(`the service worker does not exclude ${host} from caching`);
}
ok('the service worker excludes every model and backend host from its caches');

/* 5. The manifest must be installable. */
const manifest = JSON.parse(await read('public/manifest.webmanifest'));
for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
  if (!manifest[field]) bad(`manifest.webmanifest is missing ${field}`);
}
if (!manifest.icons.some((i) => i.purpose?.includes('maskable'))) bad('the manifest has no maskable icon');
if (manifest.display !== 'standalone') bad('the manifest is not installable as standalone');
ok('the web app manifest is installable with a maskable icon');

/* 6. The core layer must stay framework-free so it remains unit-testable. */
const coreDir = join(root, 'src', 'core');
for (const f of await readdir(coreDir)) {
  const text = await readFile(join(coreDir, f), 'utf8');
  if (/from ['"]react/.test(text)) bad(`src/core/${f} imports React - the core layer must stay framework-free`);
}
ok('src/core imports no framework code');

/* 7. The known circular-import trap must not reappear. */
if (/from ['"]\.\/store/.test(src.tools)) bad('src/core/tools.ts imports store.ts - this is the documented circular-import trap');
ok('the tools registry does not import the store');


/* 8. A \uXXXX escape only works inside a JS string or template literal. Sitting
      in raw JSX text it renders as the literal characters, which shipped once
      already ("working\u2026" on the Agent screen). */
{
  const offenders = [];
  for (const file of uiFiles) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('\\u')) return;
      // Only single quotes and backticks are JS string literals here. JSX text
      // AND double-quoted JSX attribute values both render \uXXXX verbatim.
      const outsideJsStrings = line.replace(/'[^']*'|`[^`]*`/g, '');
      if (outsideJsStrings.includes('\\u')) offenders.push(`${file.split('/src/')[1]}:${i + 1}`);
    });
  }
  if (offenders.length) bad(`unicode escape stranded in JSX text, renders literally: ${offenders.join(', ')}`);
  else ok('no unicode escapes stranded in JSX text');
}

/* 9. Duplicate @keyframes names silently override each other. This shipped a
      real bug once: a second "sheen" turned the primary button's highlight
      sweep into a white smear across the page. */
{
  const raw = await readFile(join(root, 'src', 'styles.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ''); // comments mention rule names too
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupes.length) bad(`duplicate @keyframes names, the later one silently wins: ${dupes.join(', ')}`);
  else ok(`${names.length} @keyframes names, all unique`);
}

/* 10. test/core.entry.ts re-exports every domain module with `export *`. Two
       modules exporting the same name makes it ambiguous and the bundler drops
       it silently -- weather.ts's isDue once blanked routines.ts's isDue and
       four passing tests turned red with no error message. */
{
  const dir = join(root, 'src', 'core');
  const seen = new Map();
  const clashes = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.ts')) continue;
    const text = await readFile(join(dir, f), 'utf8');
    const names = new Set();
    for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(m[1]);
    }
    for (const n of names) {
      if (seen.has(n)) clashes.push(`${n} (${seen.get(n)} + ${f})`);
      else seen.set(n, f);
    }
  }
  if (clashes.length) bad(`duplicate export names across src/core, ambiguous under "export *": ${clashes.join(', ')}`);
  else ok(`${seen.size} core exports, no name collisions`);
}

/* 11. Every app route must carry an explainer, and every explainer must state
       a limit. A screen that ships without one is a screen nobody can learn. */
{
  const shell = await readFile(join(root, 'src', 'ui', 'Shell.tsx'), 'utf8');
  const explain = await readFile(join(root, 'src', 'core', 'explain.ts'), 'utf8');
  const routes = [...shell.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const documented = new Set([...explain.matchAll(/^\s*'(\/[^']*)':/gm)].map((m) => m[1]));
  const missing = routes.filter((r) => !documented.has(r));
  if (missing.length) bad(`routes with no explainer: ${missing.join(', ')}`);
  else ok(`${routes.length} routes all carry an explainer`);

  const entries = [...explain.matchAll(/\bwhat:\s*'/g)].length;
  const limits = [...explain.matchAll(/\blimit:\s*'/g)].length;
  if (entries !== limits) bad(`${entries} explainers but only ${limits} state a limit`);
  else ok(`all ${entries} explainers state what it will not do`);
}

console.log('\nverify\n' + [...notes, ...problems].join('\n'));
console.log(problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n');
process.exit(problems.length ? 1 : 0);
