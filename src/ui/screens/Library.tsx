/**
 * The project library.
 *
 * Small cards that open into the whole record: tagline, about, rebuild spec,
 * launch links, screenshots and attachments. JARVIS is the home base, so this
 * is the index of everything the operator runs.
 */

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import Markdown, { Btn, Card, Field, IconBtn, Input, OpenLink, Pill, SectionTitle, Sheet, Textarea, Select, Toggle, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { haptic } from '../fx.tsx';
import { copyMessage, copyText } from '../clipboard.ts';
import { uid } from '../../core/util.ts';
import {
  MAX_LIBRARY_BYTES, STATUSES, allTags, blankProject, canAttach, filterProjects, fmtBytes,
  isImage, librarySize, projectToMarkdown, sortProjects, statusOf, validateProject,
  type Attachment, type Project,
} from '../../core/library.ts';

const TONE_CLASS: Record<string, 'ok' | 'warn' | 'info' | 'default'> = {
  ok: 'ok', warn: 'warn', info: 'info', default: 'default',
};

export default function Library() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState<Project | null>(null);
  const [edit, setEdit] = useState<Project | null>(null);
  const [confirmNode, askConfirm] = useConfirm();

  const shown = useMemo(
    () => sortProjects(filterProjects(app.projects, query, status)),
    [app.projects, query, status],
  );
  const tags = useMemo(() => allTags(app.projects), [app.projects]);
  const used = librarySize(app.projects);

  return (
    <Shell
      title="Library"
      sub={`${app.projects.length} project${app.projects.length === 1 ? '' : 's'} \u00b7 home base index`}
      actions={<IconBtn name="plus" title="New project" onClick={() => setEdit(blankProject(uid(), Date.now()))} />}
    >
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, tags, spec…"
          aria-label="Search projects"
        />
      </div>

      <div className="strip" style={{ marginBottom: 14 }}>
        <button type="button" className={`chip${status === 'all' ? ' on' : ''}`} onClick={() => setStatus('all')} aria-pressed={status === 'all'}>
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip${status === s.id ? ' on' : ''}`}
            onClick={() => setStatus(s.id)}
            aria-pressed={status === s.id}
          >
            {s.label}
          </button>
        ))}
      </div>

      {app.projects.length === 0 ? (
        <Card>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="hero-ic"><Icon name="boxes" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: '1rem' }}>Nothing catalogued yet</b>
              <p className="muted" style={{ fontSize: '0.85rem', margin: '5px 0 12px', lineHeight: 1.5 }}>
                Every app, site or experiment you run gets a card: what it is, where it lives, and a
                rebuild spec complete enough to reconstruct it from this record alone.
              </p>
              <Btn variant="primary" icon="plus" onClick={() => setEdit(blankProject(uid(), Date.now()))}>
                Add the first project
              </Btn>
            </div>
          </div>
        </Card>
      ) : shown.length === 0 ? (
        <Card tight>
          <div className="dim" style={{ fontSize: '0.86rem' }}>Nothing matches that filter.</div>
        </Card>
      ) : (
        <div className="lib-grid">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => { haptic.light(); setOpen(p); }} />
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <>
          <SectionTitle>Tags</SectionTitle>
          <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
            {tags.slice(0, 14).map((t) => (
              <button key={t} type="button" className="chip" onClick={() => setQuery(t)}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="dim" style={{ fontSize: '0.72rem', marginTop: 6 }}>
        Attachments use {fmtBytes(used)} of the {fmtBytes(MAX_LIBRARY_BYTES)} browser-storage budget.
      </div>

      <ProjectDetail
        p={open}
        onClose={() => setOpen(null)}
        onEdit={(p) => { setOpen(null); setEdit({ ...p }); }}
      />
      <ProjectEditor
        p={edit}
        onClose={() => setEdit(null)}
        onSave={(p) => { app.saveProject(p); setEdit(null); app.toast(`Saved "${p.name}"`, 'ok'); }}
        onDelete={(p) =>
          askConfirm({
            title: `Delete "${p.name}"?`,
            body: 'The card, its spec and every attachment are removed from this device.',
            danger: true,
            onYes: () => { app.deleteProject(p.id); setEdit(null); app.toast('Project deleted', 'ok'); },
          })
        }
      />
      {confirmNode}
    </Shell>
  );
}

/* ------------------------------------------------------------------ card */

function ProjectCard({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const st = statusOf(p.status);
  const shot = p.attachments.find(isImage);
  return (
    <button
      type="button"
      className="lib-card"
      onClick={onOpen}
      style={p.colour ? ({ '--tile': p.colour } as CSSProperties) : undefined}
    >
      <span className="lib-thumb">
        {shot ? <img src={shot.data} alt="" aria-hidden="true" /> : <Icon name="boxes" size={22} />}
      </span>
      <span className="lib-body">
        <span className="lib-top">
          <b className="lib-name">{p.name}</b>
          {p.pinned && <Icon name="pin" size={12} />}
        </span>
        {p.tagline && <span className="lib-tag">{p.tagline}</span>}
        <span className="lib-meta">
          <span className={`dot ${st.tone}`} aria-hidden="true" />
          {st.label}
          {p.attachments.length > 0 && (
            <>
              <span aria-hidden="true">&middot;</span>
              <Icon name="file" size={11} />
              {p.attachments.length}
            </>
          )}
          {p.links.length > 0 && (
            <>
              <span aria-hidden="true">&middot;</span>
              <Icon name="link" size={11} />
              {p.links.length}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- detail */

function ProjectDetail({ p, onClose, onEdit }: { p: Project | null; onClose: () => void; onEdit: (p: Project) => void }) {
  const app = useApp();
  const [tab, setTab] = useState<'about' | 'spec' | 'files'>('about');
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [dump, setDump] = useState('');
  if (!p) return null;
  const st = statusOf(p.status);
  const primary = p.links[0];

  return (
    <>
      <Sheet open={!!p} onClose={onClose} title={p.name} sub={p.tagline || undefined}>
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          <Pill tone={TONE_CLASS[st.tone] ?? 'default'}>{st.label}</Pill>
          {p.tags.map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </div>

        {p.links.length > 0 && (
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            {primary && (
              <OpenLink url={primary.url} variant="primary" icon="rocket">
                Launch {primary.label || 'project'}
              </OpenLink>
            )}
            {p.links.slice(1).map((l) => (
              <OpenLink key={l.url} url={l.url} size="sm" icon="link">
                {l.label || l.url.replace(/^https?:\/\//, '').slice(0, 22)}
              </OpenLink>
            ))}
          </div>
        )}

        <div className="strip" style={{ marginBottom: 12 }}>
          {(['about', 'spec', 'files'] as const).map((t) => (
            <button key={t} type="button" className={`chip${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} aria-pressed={tab === t}>
              {t === 'about' ? 'About' : t === 'spec' ? 'Rebuild spec' : `Files (${p.attachments.length})`}
            </button>
          ))}
        </div>

        {tab === 'about' && (
          p.about.trim()
            ? <Markdown text={p.about} />
            : <div className="dim" style={{ fontSize: '0.85rem' }}>No description yet.</div>
        )}

        {tab === 'spec' && (
          p.spec.trim()
            ? <Markdown text={p.spec} />
            : <div className="dim" style={{ fontSize: '0.85rem' }}>No rebuild spec yet. This is the field that lets the project be reconstructed from scratch.</div>
        )}

        {tab === 'files' && (
          p.attachments.length === 0 ? (
            <div className="dim" style={{ fontSize: '0.85rem' }}>No screenshots or attachments.</div>
          ) : (
            <div className="lib-files">
              {p.attachments.map((a) => (
                <button key={a.id} type="button" className="lib-file" onClick={() => setPreview(a)}>
                  {isImage(a) ? <img src={a.data} alt={a.name} /> : <Icon name="file" size={20} />}
                  <span className="fn">{a.name}</span>
                  <span className="fs">{fmtBytes(a.size)}</span>
                </button>
              ))}
            </div>
          )
        )}

        <div className="row" style={{ gap: 8, marginTop: 18 }}>
          <Btn block icon="edit" onClick={() => onEdit(p)}>
            Edit
          </Btn>
          <Btn
            block
            icon="copy"
            onClick={() => {
              void copyText(projectToMarkdown(p)).then((r) => {
                const m = copyMessage(r, 'The full record');
                app.toast(m.text, m.tone);
                if (r === 'failed') setDump(projectToMarkdown(p));
              });
            }}
          >
            Copy dump
          </Btn>
        </div>
        <p className="dim" style={{ fontSize: '0.74rem', marginTop: 10, lineHeight: 1.5 }}>
          The copy is a portable text record: everything except the binary attachments.
        </p>
        {dump && (
          <>
            <div className="section-title" style={{ marginTop: 14 }}>Select and copy</div>
            <textarea className="textarea" readOnly rows={10} value={dump} onFocus={(e) => e.currentTarget.select()} aria-label="Project record" />
          </>
        )}
      </Sheet>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? ''} sub={preview ? `${preview.kind || 'file'} \u00b7 ${fmtBytes(preview.size)}` : undefined}>
        {preview && (
          <>
            {isImage(preview) ? (
              <img src={preview.data} alt={preview.name} style={{ width: '100%', borderRadius: 12, display: 'block' }} />
            ) : (
              <div className="dim" style={{ fontSize: '0.85rem' }}>
                This file type cannot be previewed. Download it to open it.
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <a className="btn block" href={preview.data} download={preview.name}>
                <Icon name="download" size={16} />
                Download
              </a>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/* ---------------------------------------------------------------- editor */

function ProjectEditor({
  p, onClose, onSave, onDelete,
}: {
  p: Project | null;
  onClose: () => void;
  onSave: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const app = useApp();
  const [draft, setDraft] = useState<Project | null>(p);
  const [tagText, setTagText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed when a different project is opened.
  if (p && (!draft || draft.id !== p.id)) {
    setDraft(p);
    setTagText(p.tags.join(', '));
  }
  if (!p || !draft) return null;

  const issues = validateProject(draft);
  const set = (patch: Partial<Project>) => setDraft({ ...draft, ...patch });

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Attachment[] = [...draft.attachments];
    for (const f of Array.from(files)) {
      const verdict = canAttach(
        app.projects.map((x) => (x.id === draft.id ? { ...x, attachments: next } : x)),
        f.size,
      );
      if (!verdict.ok) {
        app.toast(verdict.reason, 'err');
        continue;
      }
      try {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error(`${f.name} could not be read.`));
          fr.readAsDataURL(f);
        });
        next.push({ id: uid(), name: f.name, kind: f.type, size: f.size, data, added: Date.now() });
      } catch (e) {
        app.toast(e instanceof Error ? e.message : 'That file could not be read.', 'err');
      }
    }
    set({ attachments: next });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Sheet open={!!p} onClose={onClose} title={draft.name ? `Edit ${draft.name}` : 'New project'} sub="Stored on this device.">
      <Field label="Name">
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Aurora Dashboard" aria-label="Project name" />
      </Field>
      <Field label="Tagline" hint="One line. This is what the card shows.">
        <Input value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Local-first analytics for small teams" aria-label="Tagline" />
      </Field>
      <div className="row" style={{ gap: 10 }}>
        <Field label="Status">
          <Select
            value={draft.status}
            onChange={(v) => set({ status: v as Project['status'] })}
            options={STATUSES.map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>
        <Field label="Card colour" hint="Blank uses the app accent.">
          <input
            type="color"
            className="input"
            value={draft.colour || '#35e0c0'}
            onChange={(e) => set({ colour: e.target.value })}
            aria-label="Card colour"
            style={{ minHeight: 44, padding: 4 }}
          />
        </Field>
      </div>
      <Field label="Tags" hint="Comma separated.">
        <Input
          value={tagText}
          onChange={(e) => {
            setTagText(e.target.value);
            set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) });
          }}
          placeholder="react, supabase, side project"
          aria-label="Tags"
        />
      </Field>

      <SectionTitle>Links</SectionTitle>
      {draft.links.map((l, i) => (
        <div className="row" style={{ gap: 6, marginBottom: 6 }} key={i}>
          <Input
            value={l.label}
            onChange={(e) => {
              const links = [...draft.links];
              links[i] = { ...l, label: e.target.value };
              set({ links });
            }}
            placeholder="Live site"
            aria-label={`Link ${i + 1} label`}
          />
          <Input
            value={l.url}
            onChange={(e) => {
              const links = [...draft.links];
              links[i] = { ...l, url: e.target.value };
              set({ links });
            }}
            placeholder="https://example.com"
            aria-label={`Link ${i + 1} URL`}
          />
          <IconBtn name="close" title="Remove link" onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Btn size="sm" icon="plus" onClick={() => set({ links: [...draft.links, { label: '', url: '' }] })}>
        Add link
      </Btn>

      <Field label="About" hint="Markdown. What it is and who it is for.">
        <Textarea
          value={draft.about}
          onChange={(e) => set({ about: e.target.value })}
          rows={5}
          placeholder="What this project does, and why it exists."
          aria-label="About"
        />
      </Field>
      <Field label="Rebuild spec" hint="Markdown. Stack, architecture, decisions, gotchas - enough to rebuild it from nothing.">
        <Textarea
          value={draft.spec}
          onChange={(e) => set({ spec: e.target.value })}
          rows={8}
          placeholder={'## Stack\n- React + Vite\n\n## Architecture\n\n## Gotchas'}
          aria-label="Rebuild spec"
        />
      </Field>

      <SectionTitle>Screenshots and attachments</SectionTitle>
      <input
        ref={fileRef}
        type="file"
        multiple
        onChange={(e) => void addFiles(e.target.files)}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <Btn size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
          Attach files
        </Btn>
        <span className="dim" style={{ fontSize: '0.74rem', alignSelf: 'center' }}>
          {draft.attachments.length} attached
        </span>
      </div>
      {draft.attachments.length > 0 && (
        <div className="lib-files" style={{ marginBottom: 10 }}>
          {draft.attachments.map((a) => (
            <div key={a.id} className="lib-file">
              {isImage(a) ? <img src={a.data} alt="" /> : <Icon name="file" size={20} />}
              <span className="fn">{a.name}</span>
              <span className="fs">{fmtBytes(a.size)}</span>
              <IconBtn
                name="trash"
                title={`Remove ${a.name}`}
                onClick={() => set({ attachments: draft.attachments.filter((x) => x.id !== a.id) })}
              />
            </div>
          ))}
        </div>
      )}

      <Toggle checked={draft.pinned} onChange={(v) => set({ pinned: v })} label="Pin to the top" />

      {issues.length > 0 && (
        <div className="issues" style={{ marginTop: 12 }}>
          {issues.map((iss, i) => (
            <div className="row" style={{ gap: 7 }} key={i}>
              <Icon name="warn" size={13} />
              <span>{iss}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        {app.projects.some((x) => x.id === draft.id) && (
          <Btn block variant="danger" icon="trash" onClick={() => onDelete(draft)}>
            Delete
          </Btn>
        )}
        <Btn block variant="primary" icon="check" disabled={issues.length > 0} onClick={() => onSave(draft)}>
          Save project
        </Btn>
      </div>
    </Sheet>
  );
}
