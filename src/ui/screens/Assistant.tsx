// The executive-assistant layer: Telegram link, personality engine, email
// sending, and the Expenses + Contacts books that the server-side brain reads
// and writes. Everything here talks to the sync server, so it needs a signed-in
// cloud session. Local expenses/contacts still work without it.

import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, Chips, CopyBtn, Empty, Field, Input, Pill, SectionTitle, Select, Sheet, Stat, Textarea, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import * as api from '../../core/api.ts';
import type { AssistantSettings, AssistantStatus, LearnedFact } from '../../core/api.ts';
import type { Contact, Expense } from '../../core/types.ts';
import { fmtWhen } from '../../core/util.ts';

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number, cur: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n); } catch { return `${cur} ${n.toFixed(2)}`; }
};

type Tab = 'telegram' | 'memory' | 'expenses' | 'contacts' | 'persona' | 'email';

export default function Assistant() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('telegram');
  const signedIn = app.cloud.enabled && !!app.cloud.serverUrl && api.isSignedIn();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    if (!signedIn) return;
    api.assistantStatus().then((s) => { setStatus(s); setErr(null); }, (e: Error) => setErr(e.message));
  };
  useEffect(refresh, [signedIn]);

  const currency = status?.settings.currency ?? 'USD';

  return (
    <Shell title="Assistant" sub={status?.bot ? `@${status.bot} on Telegram` : 'Telegram · email · expenses · contacts'}>
      {!signedIn && (
        <Card tight>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon name="info" size={16} />
            <div className="muted" style={{ fontSize: '0.83rem' }}>
              Telegram, email and the personality engine run on your sync server. Connect and sign in under{' '}
              <a href="#/app/cloud">Cloud</a> to enable them. Expenses and contacts still work locally.
            </div>
          </div>
        </Card>
      )}
      {err && signedIn && (
        <Card tight>
          <div className="row" style={{ gap: 10 }}><Icon name="warn" size={16} /><span className="muted" style={{ fontSize: '0.83rem' }}>{err}</span></div>
        </Card>
      )}

      <Chips
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'telegram', label: 'Telegram' },
          { value: 'memory', label: 'Memory' },
          { value: 'expenses', label: 'Expenses' },
          { value: 'contacts', label: 'Contacts' },
          { value: 'persona', label: 'Personality' },
          { value: 'email', label: 'Email' },
        ]}
      />

      {tab === 'telegram' && <TelegramTab status={status} signedIn={signedIn} onChange={refresh} />}
      {tab === 'memory' && <MemoryTab signedIn={signedIn} llm={!!status?.llm} />}
      {tab === 'expenses' && <ExpensesTab currency={currency} />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'persona' && <PersonaTab status={status} signedIn={signedIn} onSaved={setStatus} />}
      {tab === 'email' && <EmailTab status={status} signedIn={signedIn} onSaved={setStatus} />}
    </Shell>
  );
}

/* ------------------------------------------------------------ Telegram */

function TelegramTab({ status, signedIn, onChange }: { status: AssistantStatus | null; signedIn: boolean; onChange: () => void }) {
  const app = useApp();
  const [code, setCode] = useState<{ code: string; deepLink: string; bot: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const [log, setLog] = useState<{ role: 'you' | 'jarvis'; text: string; steps?: string[] }[]>([]);

  // A line handed over from the dashboard launcher ("add expense 12 coffee")
  // lands in the box, editable, rather than being sent on the user's behalf.
  useEffect(() => {
    if (!app.pendingPrompt) return;
    setQ(app.pendingPrompt);
    app.setPendingPrompt('');
  }, [app.pendingPrompt]);

  const getCode = async () => {
    setBusy(true);
    try { setCode(await api.assistantLinkCode()); } catch (e) { app.toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  const send = async () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    setLog((l) => [...l, { role: 'you', text }]);
    setBusy(true);
    try {
      const r = await api.assistantAsk(text);
      setLog((l) => [...l, { role: 'jarvis', text: r.text, steps: r.steps.map((s) => `${s.tool} · ${s.ms}ms`) }]);
    } catch (e) {
      setLog((l) => [...l, { role: 'jarvis', text: `Error: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {confirmNode}
      <SectionTitle>How it works</SectionTitle>
      <Card>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.86rem', lineHeight: 1.7 }}>
          <li>Send a text message to the bot on Telegram</li>
          <li>JARVIS reads it with the model on your server</li>
          <li>The right tool runs: expenses, contacts, calendar, email, research, math</li>
          <li>Anything it writes syncs back into this app</li>
        </ol>
      </Card>

      <SectionTitle>Link your chat</SectionTitle>
      <Card>
        {!signedIn ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>Sign in under Cloud first.</div>
        ) : !status ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>Checking server…</div>
        ) : !status.bot ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            The server has no <code>TELEGRAM_BOT_TOKEN</code> set. Create a bot with @BotFather, add the token to the server environment, and redeploy.
          </div>
        ) : status.telegram ? (
          <div className="row between">
            <div>
              <b style={{ fontSize: '0.92rem' }}>Linked{status.telegram.username ? ` to @${status.telegram.username}` : ''}</b>
              <div className="dim" style={{ fontSize: '0.78rem' }}>since {fmtWhen(new Date(status.telegram.linked_at + 'Z').getTime())} · bot @{status.bot}</div>
            </div>
            <Btn size="sm" variant="danger" onClick={() => confirm({ title: 'Unlink Telegram?', body: 'The bot will stop answering that chat until you link again.', danger: true, onYes: () => void api.assistantUnlink().then(onChange) })}>Unlink</Btn>
          </div>
        ) : code ? (
          <>
            <div className="row between" style={{ marginBottom: 10 }}>
              <div>
                <div className="dim" style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your code · valid 10 min</div>
                <b style={{ fontSize: '1.6rem', letterSpacing: '0.18em', fontFamily: 'ui-monospace, monospace' }}>{code.code}</b>
              </div>
              <CopyBtn text={`/link ${code.code}`} title="Copy /link command" />
            </div>
            <a className="btn primary block" href={code.deepLink} target="_blank" rel="noreferrer">
              <Icon name="paperplane" size={17} /> Open @{code.bot} in Telegram
            </a>
            <div className="hint" style={{ marginTop: 10 }}>Tapping the button links automatically. Or send <code>/link {code.code}</code> to the bot by hand. Then click refresh.</div>
            <Btn size="sm" icon="refresh" onClick={onChange} className="mt">Refresh status</Btn>
          </>
        ) : (
          <>
            <Btn block variant="primary" icon="paperplane" onClick={() => void getCode()} disabled={busy}>Generate link code</Btn>
            <div className="hint" style={{ marginTop: 10 }}>Bot: @{status.bot}. {status.llm ? `Model: ${status.model}.` : 'Warning: OPENAI_API_KEY is not set on the server, so the bot cannot think yet.'}</div>
          </>
        )}
      </Card>

      {signedIn && status?.llm && (
        <>
          <SectionTitle>Try it here</SectionTitle>
          <Card>
            <div className="hint" style={{ marginBottom: 8 }}>Same brain, same tools as Telegram — handy for testing without your phone.</div>
            {log.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                {log.map((m, i) => (
                  <div key={i} style={{ fontSize: '0.86rem', padding: '8px 10px', borderRadius: 10, background: m.role === 'you' ? 'var(--panel-2)' : 'transparent', border: m.role === 'you' ? 'none' : '1px solid var(--line)' }}>
                    <div className="dim" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.role}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    {m.steps && m.steps.length > 0 && <div className="dim" style={{ fontSize: '0.72rem', marginTop: 4 }}>{m.steps.join(' → ')}</div>}
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder='e.g. "log $18 lunch" or "what did I spend this week?"' disabled={busy} />
              <Btn variant="primary" icon="send" onClick={() => void send()} disabled={busy || !q.trim()} />
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ Memory */

function MemoryTab({ signedIn, llm }: { signedIn: boolean; llm: boolean }) {
  const app = useApp();
  const [facts, setFacts] = useState<LearnedFact[] | null>(null);
  const [draft, setDraft] = useState('');
  const [showQuarantine, setShowQuarantine] = useState(false);
  const [confirmNode, confirm] = useConfirm();

  const load = () => { if (signedIn) api.learnedFacts().then((r) => setFacts(r.facts), (e: Error) => app.toast(e.message, 'err')); };
  useEffect(load, [signedIn]);

  if (!signedIn) return <Card><div className="muted" style={{ fontSize: '0.85rem' }}>What JARVIS learns about you is stored on your server. Sign in under Cloud first.</div></Card>;

  const visible = (facts ?? []).filter((f) => showQuarantine ? f.trust === 'untrusted' : f.trust !== 'untrusted');
  const quarantined = (facts ?? []).filter((f) => f.trust === 'untrusted').length;

  const add = async () => {
    const t = draft.trim(); if (!t) return;
    try { await api.learnFact(t); setDraft(''); load(); app.toast('Remembered', 'ok'); } catch (e) { app.toast((e as Error).message, 'err'); }
  };

  const exportPrompts = async () => {
    try {
      const { prompts } = await api.serverPrompts();
      const md = prompts.map((p) => `# ${p.name}.md\n\n${p.text.trim()}\n`).join('\n\n---\n\n');
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'jarvis-prompts.md'; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { app.toast((e as Error).message, 'err'); }
  };

  return (
    <>
      {confirmNode}
      <Card tight>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon name="memory" size={16} />
          <div className="muted" style={{ fontSize: '0.83rem' }}>
            After every exchange, a background pass distils durable facts about you — preferences, people, goals, habits — and recalls the relevant ones on the next turn. You can see, correct and delete all of it here.
            {!llm && <> <b>OPENAI_API_KEY is not set on the server, so automatic learning is off.</b> Explicit facts still work.</>}
          </div>
        </div>
      </Card>

      <div className="row" style={{ gap: 8 }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} placeholder='Tell JARVIS something to remember, e.g. "I prefer calls after 10am"' />
        <Btn variant="primary" icon="plus" onClick={() => void add()} disabled={!draft.trim()} />
      </div>

      <div className="row between" style={{ margin: '4px 0' }}>
        <SectionTitle>{showQuarantine ? 'Quarantined' : 'What JARVIS knows'} · {visible.length}</SectionTitle>
        <div className="row" style={{ gap: 6 }}>
          {quarantined > 0 && <Btn size="sm" variant={showQuarantine ? 'primary' : 'ghost'} icon="shield" onClick={() => setShowQuarantine(!showQuarantine)}>{quarantined}</Btn>}
          <Btn size="sm" icon="refresh" onClick={load} title="Refresh" />
        </div>
      </div>

      {facts === null ? (
        <Card><div className="muted" style={{ fontSize: '0.85rem' }}>Loading…</div></Card>
      ) : visible.length === 0 ? (
        <Empty icon="memory" title={showQuarantine ? 'Nothing quarantined' : 'Nothing learned yet'}>
          {showQuarantine ? 'Text that looks like an injected instruction lands here instead of memory.' : 'Chat with JARVIS on Telegram or above and this fills in on its own.'}
        </Empty>
      ) : (
        <Card tight>
          {visible.map((f) => (
            <div key={f.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem' }}>{f.text}</div>
                <div className="dim" style={{ fontSize: '0.72rem' }}>
                  {f.source === 'explicit' ? 'you told it' : f.source === 'scanner' ? 'flagged by scanner' : 'learned'} · {fmtWhen(f.created_at)}
                  {f.trust === 'trusted' && <Pill tone="ok"> trusted</Pill>}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                {f.trust === 'auto' && <Btn size="sm" variant="ghost" icon="check" title="Mark as trusted" onClick={() => void api.setFactTrust(f.id, 'trusted').then(load)} />}
                {f.trust === 'untrusted' && <Btn size="sm" variant="ghost" icon="check" title="Actually fine — restore" onClick={() => void api.setFactTrust(f.id, 'auto').then(load)} />}
                <Btn size="sm" variant="ghost" icon="trash" title="Forget" onClick={() => void api.forgetFact(f.id).then(load)} />
              </div>
            </div>
          ))}
        </Card>
      )}

      <SectionTitle>Vetting</SectionTitle>
      <Card>
        <div className="row wrap" style={{ gap: 8 }}>
          <Btn icon="download" onClick={() => void exportPrompts()}>Download system prompts</Btn>
          {(facts?.length ?? 0) > 0 && (
            <Btn variant="danger" icon="trash" onClick={() => confirm({ title: 'Forget everything?', body: `Deletes all ${facts!.length} learned facts on the server. Your app Memory screen is not affected.`, danger: true, onYes: () => void api.forgetAll().then(() => { load(); app.toast('Forgotten', 'ok'); }) })}>Forget all</Btn>
          )}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>The prompts are the exact Markdown files the server reads from <code>server/prompts/</code>. Edit them there and redeploy — no code changes needed.</div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ Expenses */

const CATS = ['food', 'travel', 'software', 'office', 'marketing', 'personal', 'other'];

function ExpensesTab({ currency }: { currency: string }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Expense | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const month = today().slice(0, 7);
  const thisMonth = useMemo(() => app.expenses.filter((e) => e.date.startsWith(month)), [app.expenses, month]);
  const total = thisMonth.reduce((s, e) => s + e.amount, 0);
  const business = thisMonth.filter((e) => e.business).reduce((s, e) => s + e.amount, 0);
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of thisMonth) m[e.category] = (m[e.category] ?? 0) + e.amount;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [thisMonth]);

  const start = (e?: Expense) => {
    setDraft(e ?? { id: uid(), amount: 0, currency, category: 'food', note: '', date: today(), business: false, created: Date.now(), updated: Date.now() });
    setOpen(true);
  };
  const save = () => {
    if (!draft || !(draft.amount > 0)) { app.toast('Enter an amount', 'err'); return; }
    app.saveExpense({ ...draft, updated: Date.now() });
    setOpen(false);
    app.toast('Expense saved', 'ok');
  };

  return (
    <>
      {confirmNode}
      <div className="grid3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat value={money(total, currency)} label="This month" />
        <Stat value={money(business, currency)} label="Business" />
        <Stat value={thisMonth.length} label="Entries" />
      </div>

      {byCat.length > 0 && (
        <Card title="By category" icon="chart">
          {byCat.map(([c, v]) => (
            <div key={c} className="row between" style={{ fontSize: '0.85rem', padding: '4px 0' }}>
              <span style={{ textTransform: 'capitalize' }}>{c}</span>
              <span className="row" style={{ gap: 10 }}>
                <span className="dim">{Math.round((v / total) * 100)}%</span>
                <b>{money(v, currency)}</b>
              </span>
            </div>
          ))}
        </Card>
      )}

      <SectionTitle>Recent</SectionTitle>
      <Btn block variant="primary" icon="plus" onClick={() => start()}>Log expense</Btn>
      {app.expenses.length === 0 ? (
        <Empty icon="wallet" title="No expenses yet">Log one here, or tell JARVIS on Telegram: “log $42 client lunch”.</Empty>
      ) : (
        <Card tight>
          {app.expenses.slice(0, 50).map((e) => (
            <div key={e.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => start(e)}>
              <div>
                <b style={{ fontSize: '0.9rem', textTransform: 'capitalize' }}>{e.note || e.category}</b>
                <div className="dim" style={{ fontSize: '0.76rem' }}>{e.date} · {e.category}{e.business ? ' · business' : ''}</div>
              </div>
              <b>{money(e.amount, e.currency || currency)}</b>
            </div>
          ))}
        </Card>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={draft && app.expenses.some((x) => x.id === draft.id) ? 'Edit expense' : 'Log expense'}>
        {draft && (
          <>
            <Field label={`Amount (${draft.currency || currency})`}>
              <Input type="number" inputMode="decimal" step="0.01" value={draft.amount || ''} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} autoFocus />
            </Field>
            <Field label="Category">
              <Select value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={CATS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
            </Field>
            <Field label="Note"><Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Client lunch with Sarah" /></Field>
            <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <label className="row" style={{ gap: 8, fontSize: '0.86rem', margin: '6px 0 12px' }}>
              <input type="checkbox" checked={draft.business} onChange={(e) => setDraft({ ...draft, business: e.target.checked })} /> Business expense
            </label>
            <div className="row" style={{ gap: 8 }}>
              <Btn variant="primary" block onClick={save}>Save</Btn>
              {app.expenses.some((x) => x.id === draft.id) && (
                <Btn variant="danger" icon="trash" onClick={() => confirm({ title: 'Delete expense?', body: 'This cannot be undone.', danger: true, onYes: () => { app.deleteExpense(draft.id); setOpen(false); } })} />
              )}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------ Contacts */

function ContactsTab() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Contact | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return app.contacts;
    return app.contacts.filter((c) => [c.name, c.email, c.phone, c.company, c.role, c.notes, ...c.tags].join(' ').toLowerCase().includes(s));
  }, [app.contacts, q]);

  const start = (c?: Contact) => {
    setDraft(c ?? { id: uid(), name: '', email: '', phone: '', company: '', role: '', notes: '', tags: [], created: Date.now(), updated: Date.now() });
    setOpen(true);
  };
  const save = () => {
    if (!draft?.name.trim()) { app.toast('Name is required', 'err'); return; }
    app.saveContact({ ...draft, name: draft.name.trim(), updated: Date.now() });
    setOpen(false);
    app.toast('Contact saved', 'ok');
  };
  const isNew = !!draft && !app.contacts.some((x) => x.id === draft.id);

  return (
    <>
      {confirmNode}
      <div className="row" style={{ gap: 8 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, tag…" />
        <Btn variant="primary" icon="plus" onClick={() => start()} />
      </div>
      {list.length === 0 ? (
        <Empty icon="contacts" title={q ? 'No matches' : 'No contacts yet'}>{q ? 'Try a different search.' : 'Add one here, or tell JARVIS: “add Sarah Chen, CTO at Acme, sarah@acme.com”.'}</Empty>
      ) : (
        <Card tight>
          {list.map((c) => (
            <div key={c.id} className="row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => start(c)}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: '0.9rem' }}>{c.name}</b>
                <div className="dim" style={{ fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.role, c.company].filter(Boolean).join(' · ') || c.email || c.phone}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {c.email && <a className="btn icon sm" href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} title="Email"><Icon name="mail" size={15} /></a>}
                {c.phone && <a className="btn icon sm" href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} title="Call"><Icon name="phone" size={15} /></a>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={isNew ? 'New contact' : 'Edit contact'}>
        {draft && (
          <>
            <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
              <Field label="Phone"><Input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
              <Field label="Company"><Input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></Field>
              <Field label="Role"><Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></Field>
            </div>
            <Field label="Tags" hint="Comma separated"><Input value={draft.tags.join(', ')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="client, investor" /></Field>
            <Field label="Notes"><Textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
            <div className="row" style={{ gap: 8 }}>
              <Btn variant="primary" block onClick={save}>Save</Btn>
              {!isNew && <Btn variant="danger" icon="trash" onClick={() => confirm({ title: `Delete ${draft.name}?`, body: 'This cannot be undone.', danger: true, onYes: () => { app.deleteContact(draft.id); setOpen(false); } })} />}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------ Personality */

function PersonaTab({ status, signedIn, onSaved }: { status: AssistantStatus | null; signedIn: boolean; onSaved: (s: AssistantStatus) => void }) {
  const app = useApp();
  const [s, setS] = useState<AssistantSettings | null>(null);
  useEffect(() => { if (status) setS(status.settings); }, [status]);
  if (!signedIn) return <Card><div className="muted" style={{ fontSize: '0.85rem' }}>Personality settings live on your server. Sign in under Cloud first.</div></Card>;
  if (!s || !status) return <Card><div className="muted" style={{ fontSize: '0.85rem' }}>Loading…</div></Card>;

  const save = async () => {
    try {
      const r = await api.assistantSaveSettings({ persona: s.persona, humor: s.humor, name: s.name ?? '', currency: s.currency });
      onSaved({ ...status, settings: r.settings });
      app.toast('Personality saved', 'ok');
    } catch (e) { app.toast((e as Error).message, 'err'); }
  };

  const sample = {
    jarvis: 'Logged $42 for lunch, sir. Your food spend is now 18% over last month — the client had better have been worth it.',
    neutral: 'Done — I logged $42 under food for today. Your food total this month is $312.',
    terse: 'Logged. Food, $42. Month: $312.',
  }[s.persona];

  return (
    <>
      <SectionTitle>The JARVIS personality engine</SectionTitle>
      <Card>
        <Field label="Persona">
          <Select value={s.persona} onChange={(v) => setS({ ...s, persona: v as AssistantSettings['persona'] })} options={[
            { value: 'jarvis', label: 'JARVIS — composed, British, dry wit' },
            { value: 'neutral', label: 'Neutral — warm and professional' },
            { value: 'terse', label: 'Terse — fewest words possible' },
          ]} />
        </Field>
        {s.persona === 'jarvis' && (
          <Field label={`Humor · ${Math.round(s.humor * 10)}/10`} hint="Never applied to money, errors or when you sound stressed.">
            <input type="range" min={0} max={1} step={0.1} value={s.humor} onChange={(e) => setS({ ...s, humor: Number(e.target.value) })} style={{ width: '100%' }} />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Call you" hint="Leave blank for “sir”"><Input value={s.name ?? ''} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Tony" /></Field>
          <Field label="Currency"><Input value={s.currency} maxLength={3} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })} /></Field>
        </div>
        <div className="dim" style={{ fontSize: '0.8rem', fontStyle: 'italic', padding: '8px 10px', borderLeft: '2px solid var(--line)', margin: '4px 0 12px' }}>“{sample}”</div>
        <Btn variant="primary" block onClick={() => void save()}>Save</Btn>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ Email */

function EmailTab({ status, signedIn, onSaved }: { status: AssistantStatus | null; signedIn: boolean; onSaved: (s: AssistantStatus) => void }) {
  const app = useApp();
  const [smtp, setSmtp] = useState({ host: '', port: 587, user: '', pass: '', from: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status?.settings.smtp) setSmtp(status.settings.smtp); }, [status]);
  if (!signedIn) return <Card><div className="muted" style={{ fontSize: '0.85rem' }}>Email sending runs on your server. Sign in under Cloud first.</div></Card>;
  if (!status) return <Card><div className="muted" style={{ fontSize: '0.85rem' }}>Loading…</div></Card>;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.assistantSaveSettings({ smtp });
      onSaved({ ...status, settings: r.settings });
      app.toast('Email settings saved', 'ok');
    } catch (e) { app.toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const r = await api.assistantTestEmail(); app.toast(r.ok ? 'SMTP login OK' : r.error ?? 'Failed', r.ok ? 'ok' : 'err'); }
    catch (e) { app.toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const clear = async () => {
    try { const r = await api.assistantSaveSettings({ smtp: null }); onSaved({ ...status, settings: r.settings }); setSmtp({ host: '', port: 587, user: '', pass: '', from: '' }); app.toast('Email removed', 'ok'); }
    catch (e) { app.toast((e as Error).message, 'err'); }
  };

  return (
    <>
      <SectionTitle>Outgoing email (SMTP)</SectionTitle>
      <Card>
        <div className="hint" style={{ marginBottom: 10 }}>
          JARVIS drafts, you confirm, it sends. For Gmail: host <code>smtp.gmail.com</code>, port 587, and an <b>App Password</b> (not your normal password).
          {status.settings.smtp?.host && <Pill tone="ok"> configured</Pill>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Host"><Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value.trim() })} placeholder="smtp.gmail.com" /></Field>
          <Field label="Port"><Input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Username"><Input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value.trim() })} placeholder="you@gmail.com" autoComplete="off" /></Field>
        <Field label="Password / app password"><Input type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="From" hint="Optional display address, e.g. “Tony Stark <tony@stark.com>”"><Input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Btn variant="primary" block onClick={() => void save()} disabled={busy || !smtp.host || !smtp.user}>Save</Btn>
          <Btn icon="check" onClick={() => void test()} disabled={busy || !status.settings.smtp?.host}>Test login</Btn>
          {status.settings.smtp?.host && <Btn variant="danger" icon="trash" onClick={() => void clear()} />}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>Credentials are stored on your server only and never synced to this browser.</div>
      </Card>
    </>
  );
}
