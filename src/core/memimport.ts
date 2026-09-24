/**
 * Bulk import into memory.
 *
 * Accepts what people actually have to hand: a pasted block from a chat, a JSON
 * export, a Markdown note, a CSV, a plain text file. Every path ends in the same
 * place -- a list of candidate items the user reviews before anything is saved.
 *
 * The review step is deliberate. Importing straight into memory would let a
 * malformed file quietly fill the store with junk that then rides along in every
 * prompt.
 */

export type SourceKind = 'json' | 'markdown' | 'csv' | 'text' | 'pdf';

export interface Candidate {
  text: string;
  tags: string[];
  /** Where in the source it came from, for the review list. */
  origin: string;
}

export interface ImportResult {
  kind: SourceKind;
  candidates: Candidate[];
  /** Things the reader could not use, stated plainly. */
  notes: string[];
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Longer than a fragment, shorter than an essay. */
const usable = (s: string): boolean => s.length >= 3 && s.length <= 2000;

export function detectKind(name: string, text: string): SourceKind {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.csv')) return 'csv';
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'markdown';
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (/^#{1,6}\s|\n[-*]\s/.test(text)) return 'markdown';
  return 'text';
}

/* ------------------------------------------------------------------ JSON */

/**
 * Pulls strings out of whatever shape the JSON happens to be: an array of
 * strings, an array of objects, a chat export with role/content, or a bare
 * object. Anything unrecognised is reported rather than dropped silently.
 */
export function fromJson(text: string): ImportResult {
  const notes: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { kind: 'json', candidates: [], notes: [`That is not valid JSON: ${e instanceof Error ? e.message : 'parse failed'}`] };
  }

  const out: Candidate[] = [];
  const pushText = (v: unknown, origin: string, tags: string[] = []): void => {
    if (typeof v === 'string' && usable(clean(v))) out.push({ text: clean(v), tags, origin });
  };

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      // Chat-export shape: {role, content}
      if (typeof o.content === 'string' && typeof o.role === 'string') {
        pushText(o.content, `${path} (${o.role})`, [String(o.role)]);
        return;
      }
      for (const key of ['text', 'content', 'note', 'value', 'summary', 'body', 'memory']) {
        if (typeof o[key] === 'string') {
          pushText(o[key], `${path}.${key}`, Array.isArray(o.tags) ? (o.tags as unknown[]).map(String) : []);
          return;
        }
      }
      for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (typeof node === 'string') pushText(node, path);
  };

  walk(data, '');
  if (!out.length) notes.push('No text fields were found. Recognised keys are text, content, note, value, summary, body and memory.');
  return { kind: 'json', candidates: out, notes };
}

/* -------------------------------------------------------------- Markdown */

/** Bullets and numbered items become entries; headings become their tags. */
export function fromMarkdown(text: string): ImportResult {
  const out: Candidate[] = [];
  const notes: string[] = [];
  let heading = '';
  const paragraph: string[] = [];

  const flushParagraph = (): void => {
    const joined = clean(paragraph.join(' '));
    paragraph.length = 0;
    if (usable(joined)) out.push({ text: joined, tags: heading ? [slug(heading)] : [], origin: heading || 'body' });
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph();
      heading = h[2].trim();
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const t = clean(bullet[1].replace(/^\[[ xX]\]\s*/, ''));
      if (usable(t)) out.push({ text: t, tags: heading ? [slug(heading)] : [], origin: heading || 'list' });
      continue;
    }
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^```/.test(line)) {
      notes.push('Code blocks were skipped.');
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return { kind: 'markdown', candidates: out, notes: [...new Set(notes)] };
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

/* ------------------------------------------------------------------- CSV */

/** First column becomes the text; any remaining columns become tags. */
export function fromCsv(text: string): ImportResult {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  const out: Candidate[] = [];
  rows.forEach((row, i) => {
    const cells = splitCsvRow(row);
    const first = clean(cells[0] ?? '');
    if (!usable(first)) return;
    if (i === 0 && /^(text|note|memory|content)$/i.test(first)) return; // header
    out.push({ text: first, tags: cells.slice(1).map(clean).filter(Boolean).slice(0, 4), origin: `row ${i + 1}` });
  });
  return { kind: 'csv', candidates: out, notes: [] };
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') {
      if (q && row[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------ plain text */

/** Blank-line separated blocks, or one entry per line for short lines. */
export function fromText(text: string): ImportResult {
  const blocks = text.split(/\n\s*\n/).map(clean).filter(usable);
  if (blocks.length > 1) {
    return { kind: 'text', candidates: blocks.map((b, i) => ({ text: b, tags: [], origin: `block ${i + 1}` })), notes: [] };
  }
  const lines = text.split(/\r?\n/).map(clean).filter(usable);
  return { kind: 'text', candidates: lines.map((l, i) => ({ text: l, tags: [], origin: `line ${i + 1}` })), notes: [] };
}

/* --------------------------------------------------------------- routing */

export function parseImport(name: string, text: string): ImportResult {
  const kind = detectKind(name, text);
  if (kind === 'json') return fromJson(text);
  if (kind === 'markdown') return fromMarkdown(text);
  if (kind === 'csv') return fromCsv(text);
  return fromText(text);
}

/** Same text twice, or text already in memory, is not worth storing again. */
export function dedupe(candidates: Candidate[], existing: string[]): Candidate[] {
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  const out: Candidate[] = [];
  for (const c of candidates) {
    const k = c.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * PDFs are a binary container; the text is compressed inside object streams and
 * cannot be read without a parser this app does not carry. Rather than shipping
 * a half-working extractor that returns mojibake, say so and point at the
 * reliable path.
 */
export const PDF_NOTE =
  'PDF text lives inside compressed binary streams, and extracting it properly needs a PDF engine this app does not bundle. ' +
  'Open the PDF, select the text and paste it into the box above -- that path is exact, and it takes a few seconds.';
