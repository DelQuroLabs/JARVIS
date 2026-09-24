import { useMemo, useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Chips, Empty, Field, IconBtn, Input, Pill, SectionTitle, Select, Sheet, Textarea } from '../components.tsx';
import { PDF_NOTE, dedupe, parseImport, type Candidate } from '../../core/memimport.ts';
import { useApp } from '../state.tsx';
import type { MemoryItem } from '../../core/types.ts';
import { fmtWhen } from '../../core/util.ts';

const KINDS: MemoryItem['kind'][] = ['fact', 'preference', 'decision', 'task', 'note'];
const KIND_ICON: Record<MemoryItem['kind'], string> = { fact: 'info', preference: 'star', decision: 'check', task: 'target', note: 'pen' };

export default function Memory() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ text: '', kind: 'fact' as MemoryItem['kind'], tags: '' });
  const [importing, setImporting] = useState(false);
  const [paste, setPaste] = useState('');
  const [cands, setCands] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const runParse = (name: string, text: string) => {
    const r = parseImport(name, text);
    const fresh = dedupe(r.candidates, app.memory.map((m) => m.text));
    setCands(fresh);
    setPicked(new Set(fresh.map((_, i) => i)));
    const extra = [...r.notes];
    if (r.candidates.length !== fresh.length) {
      extra.push(`${r.candidates.length - fresh.length} duplicate(s) were left out.`);
    }
    if (!fresh.length) extra.push('Nothing new to add from that source.');
    setNotes(extra);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const f = files[0];
    if (f.name.toLowerCase().endsWith('.pdf')) {
      setCands([]);
      setNotes([PDF_NOTE]);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      runParse(f.name, await f.text());
    } catch {
      setNotes([`${f.name} could not be read as text.`]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const commitImport = () => {
    let n = 0;
    cands.forEach((c, i) => {
      if (!picked.has(i)) return;
      app.addMemory({ text: c.text, kind: 'fact', tags: c.tags, pinned: false });
      n++;
    });
    app.toast(`${n} item${n === 1 ? '' : 's'} added to memory`, n ? 'ok' : 'err');
    setImporting(false);
    setCands([]);
    setPaste('');
    setNotes([]);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return app.memory
      .filter((m) => (filter === 'all' || m.kind === filter) && (!t || m.text.toLowerCase().includes(t) || m.tags.some((x) => x.includes(t))))
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.created - a.created);
  }, [app.memory, q, filter]);

  const save = () => {
    if (!draft.text.trim()) return;
    app.addMemory({
      text: draft.text.trim(),
      kind: draft.kind,
      tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
      source: 'you',
    });
    setDraft({ text: '', kind: 'fact', tags: '' });
    setAdding(false);
    app.toast('Saved to memory', 'ok');
  };

  return (
    <Shell
      title="Memory"
      sub={`${app.memory.length} items \u00b7 on this device`}
      actions={<><IconBtn name="upload" title="Import into memory" onClick={() => setImporting(true)} /><IconBtn name="plus" title="Add memory" onClick={() => setAdding(true)} /></>}
    >
      <Input placeholder="Search memory" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memory" />
      <div style={{ marginTop: 10 }}>
        <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...KINDS.map((k) => ({ value: k, label: k }))]} />
      </div>

      <Card tight>
        <div className="muted" style={{ fontSize: '0.83rem' }}>
          The agent reads memory through the <code className="inline">memory_search</code> tool and writes with{' '}
          <code className="inline">memory_write</code>. Saying &ldquo;remember that&hellip;&rdquo; in chat writes here with no model call.
        </div>
      </Card>

      {shown.length === 0 ? (
        <Empty icon="memory" title={app.memory.length ? 'Nothing matches' : 'Memory is empty'} action={<Btn variant="primary" icon="plus" onClick={() => setAdding(true)}>Add an item</Btn>}>
          {app.memory.length ? 'Try a different search or filter.' : 'Anything you would otherwise repeat every session belongs here \u2014 your stack, your tone, your constraints.'}
        </Empty>
      ) : (
        <>
          <SectionTitle>{shown.length} item{shown.length === 1 ? '' : 's'}</SectionTitle>
          <div className="list">
            {shown.map((m) => (
              <div className="item" key={m.id} style={{ alignItems: 'flex-start' }}>
                <span className={`ico${m.pinned ? '' : ' alt'}`}>
                  <Icon name={KIND_ICON[m.kind] as never} size={15} />
                </span>
                <span className="txt">
                  <b style={{ whiteSpace: 'normal', fontWeight: 500, fontSize: '0.88rem' }}>{m.text}</b>
                  <small>
                    {m.kind} &middot; {fmtWhen(m.created)}
                    {m.source ? ` \u00b7 ${m.source}` : ''}
                    {m.tags.length ? ` \u00b7 ${m.tags.join(', ')}` : ''}
                  </small>
                </span>
                <IconBtn name="pin" title={m.pinned ? 'Unpin' : 'Pin'} active={m.pinned} onClick={() => app.togglePin(m.id)} />
                <IconBtn name="trash" title="Delete" onClick={() => app.removeMemory(m.id)} />
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add to memory" sub="Stored locally. Synced only if you turn on cloud sync.">
        <Field label="What should I remember?">
          <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={3} />
        </Field>
        <Field label="Kind">
          <Select value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v as MemoryItem['kind'] })} options={KINDS.map((k) => ({ value: k, label: k }))} />
        </Field>
        <Field label="Tags" hint="Comma separated. Used for search weighting.">
          <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
        </Field>
        <Btn block variant="primary" icon="check" onClick={save} disabled={!draft.text.trim()}>
          Save
        </Btn>
      </Sheet>

      <Sheet open={importing} onClose={() => setImporting(false)} title="Import into memory" sub="Paste a block, or pick a file. Nothing is saved until you confirm.">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.md,.markdown,.csv,.txt,.text,.pdf,text/*,application/json"
          onChange={(e) => void onFiles(e.target.files)}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
        <Field label="Paste anything" hint="A chat transcript, a JSON export, notes in Markdown, or plain lines.">
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={'- Prefers dark mode\n- Ships on Fridays'}
            aria-label="Paste text to import"
          />
        </Field>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <Btn icon="search" disabled={!paste.trim()} onClick={() => runParse('paste', paste)}>
            Read the paste
          </Btn>
          <Btn icon="upload" onClick={() => fileRef.current?.click()}>
            Choose a file
          </Btn>
        </div>

        {notes.length > 0 && (
          <div className="callout" style={{ marginBottom: 12 }}>
            {notes.map((n) => (
              <p key={n} style={{ fontSize: '0.78rem', margin: '0 0 6px', lineHeight: 1.5 }}>{n}</p>
            ))}
          </div>
        )}

        {cands.length > 0 && (
          <>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="section-title" style={{ margin: 0 }}>{picked.size} of {cands.length} selected</div>
              <button
                type="button"
                className="chip"
                onClick={() => setPicked(picked.size === cands.length ? new Set() : new Set(cands.map((_, i) => i)))}
              >
                {picked.size === cands.length ? 'None' : 'All'}
              </button>
            </div>
            <div className="stack sm" style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
              {cands.map((c, i) => (
                <button
                  key={`${c.origin}-${i}`}
                  type="button"
                  className={`imp-row${picked.has(i) ? ' on' : ''}`}
                  aria-pressed={picked.has(i)}
                  onClick={() => {
                    const next = new Set(picked);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    setPicked(next);
                  }}
                >
                  <Icon name={picked.has(i) ? 'check' : 'plus'} size={14} />
                  <span className="grow">
                    <span className="t">{c.text}</span>
                    <span className="o">{c.origin}{c.tags.length ? ` \u00b7 ${c.tags.join(', ')}` : ''}</span>
                  </span>
                </button>
              ))}
            </div>
            <Btn block variant="primary" icon="check" disabled={!picked.size} onClick={commitImport}>
              Add {picked.size} to memory
            </Btn>
          </>
        )}
      </Sheet>

      {app.memory.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Pill tone="warn">
            <Icon name="info" size={11} /> Memory is included in prompts only when the agent searches it
          </Pill>
        </div>
      )}
    </Shell>
  );
}
