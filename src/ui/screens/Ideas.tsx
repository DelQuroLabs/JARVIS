import { useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Btn, Empty, Field, IconBtn, Input, Pill, SectionTitle, Sheet, Textarea } from '../components.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import { blankIdea, searchIdeas } from '../../core/ideas.ts';
import type { Idea } from '../../core/types.ts';
import { fmtWhen } from '../../core/util.ts';

export default function Ideas() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Idea | null>(null);
  const shown = useMemo(() => searchIdeas(app.ideas, q).sort((a, b) => Number(b.starred ?? false) - Number(a.starred ?? false) || b.created - a.created), [app.ideas, q]);

  return (
    <Shell title="Ideas" sub={`${app.ideas.length} saved prompts and patterns`} actions={<IconBtn name="plus" title="New idea" onClick={() => setEdit(blankIdea())} />}>
      <Input placeholder="Search ideas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ideas" />

      {shown.length === 0 ? (
        <Empty icon="idea" title="Nothing here" action={<Btn variant="primary" icon="plus" onClick={() => setEdit(blankIdea())}>Add an idea</Btn>}>
          Keep the prompts and patterns that actually worked, so you are not rewriting them from scratch next week.
        </Empty>
      ) : (
        <>
          <SectionTitle>{shown.length} idea{shown.length === 1 ? '' : 's'}</SectionTitle>
          <div className="stack sm">
            {shown.map((i) => (
              <div className="card tight" key={i.id}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <b style={{ fontSize: '0.94rem' }}>{i.title}</b>
                  <div className="row" style={{ gap: 0 }}>
                    <IconBtn name="star" title={i.starred ? 'Unstar' : 'Star'} active={i.starred} onClick={() => app.saveIdea({ ...i, starred: !i.starred })} />
                    <IconBtn name="edit" title={`Edit ${i.title}`} onClick={() => setEdit({ ...i })} />
                  </div>
                </div>
                <div className="muted" style={{ fontSize: '0.86rem', lineHeight: 1.55 }}>{i.body}</div>
                <div className="row wrap between" style={{ marginTop: 10, gap: 6 }}>
                  <div className="row wrap" style={{ gap: 5 }}>
                    {i.tags.map((t) => (
                      <Pill key={t}>{t}</Pill>
                    ))}
                    <small className="dim">{fmtWhen(i.created)}</small>
                  </div>
                  <Btn
                    size="sm"
                    icon="chat"
                    onClick={() => {
                      app.newConversation();
                      app.setPendingPrompt(i.body);
                      navigate('/app/chat');
                    }}
                  >
                    Use
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.title ? 'Edit idea' : 'New idea'}>
        {edit && (
          <>
            <Field label="Title">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Body" hint="Tapping Use drops this straight into a new conversation.">
              <Textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={5} />
            </Field>
            <Field label="Tags" hint="Comma separated.">
              <Input value={edit.tags.join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              {app.ideas.some((i) => i.id === edit.id) && (
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => {
                    app.deleteIdea(edit.id);
                    setEdit(null);
                  }}
                >
                  Delete
                </Btn>
              )}
              <Btn
                block
                variant="primary"
                icon="check"
                disabled={!edit.title.trim() || !edit.body.trim()}
                onClick={() => {
                  app.saveIdea(edit);
                  setEdit(null);
                  app.toast('Idea saved', 'ok');
                }}
              >
                Save
              </Btn>
            </div>
          </>
        )}
      </Sheet>
    </Shell>
  );
}
