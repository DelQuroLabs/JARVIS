#!/usr/bin/env node
/**
 * In-repo test runner.
 *
 * The domain layer is framework-free TypeScript, so it is bundled to ESM with
 * esbuild and exercised with node:test. The bundle is rebuilt on every run - a
 * stale bundle silently testing old code is a real failure mode.
 */
import { build } from 'esbuild';
import { rm, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test', '.build');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(root, 'test', 'core.entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: join(out, 'core.mjs'),
  logLevel: 'error',
});

console.log('bundled test/.build/core.mjs from current sources');

const files = (await readdir(join(root, 'test'))).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join('test', f));
const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
