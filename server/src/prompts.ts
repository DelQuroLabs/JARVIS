// Prompt loader. Every system prompt is a Markdown file in server/prompts so it
// can be vetted and edited without touching code. Cached in production; re-read
// on every call in development so edits show up immediately.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_DIR = process.env.PROMPT_DIR || path.resolve(__dirname, '..', 'prompts');
const cache = new Map<string, string>();
const isProd = process.env.NODE_ENV === 'production';

export function loadPrompt(name: string): string {
  if (isProd && cache.has(name)) return cache.get(name)!;
  const file = path.join(PROMPT_DIR, `${name}.md`);
  const text = fs.readFileSync(file, 'utf8').trim();
  cache.set(name, text);
  return text;
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''));
}

export function listPrompts(): { name: string; text: string }[] {
  return fs.readdirSync(PROMPT_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => ({ name: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8') }));
}
