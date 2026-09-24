import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatShell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, CopyBtn, Dots, Empty, IconBtn, Pill, Sheet } from '../components.tsx';
import Markdown from '../components.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import type { LoopStep, Msg, ToolCallRecord } from '../../core/types.ts';
import { MODES, modeOf, extractSwitch } from '../../core/modes.ts';
import { matchSkill, runSkill } from '../../core/skills.ts';
import { type CommandCtx, matchCommand, suggestCommands } from '../../core/commands.ts';
import { toolNames } from '../../core/tools.ts';
import { detect } from '../../core/privacy.ts';
import { fmtMs, fmtWhen, uid } from '../../core/util.ts';
import { specOf } from '../../core/providers.ts';
import { ATTACH_LIMIT, canCaptureScreen, canSee, captureScreenFrame, dataUrlBytes, downscaleImage, drainShareInbox, imageFilesFrom, sharePrompt } from '../../core/attach.ts';

const STARTERS = [
  'Plan a weekend trip to the Catskills on a $400 budget',
  'What is 18% of 2,340 plus 12?',
  'Weather in Jersey City',
  'Review this snippet for security problems',
];

/** Honest per-answer accounting. Only shows numbers the run actually produced. */
function Receipt({ r }: { r: NonNullable<Msg['receipt']> }) {
  const bits: { k: string; v: string }[] = [];
  if (r.ms != null) bits.push({ k: 'took', v: r.ms < 1 ? 'under 1 ms' : r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s` });
  if (r.mode) bits.push({ k: 'mode', v: r.mode });
  if (r.steps) bits.push({ k: 'steps', v: String(r.steps) });
  if (r.tools) bits.push({ k: 'tools', v: String(r.tools) });
  if (r.tokensIn || r.tokensOut) bits.push({ k: 'tokens', v: `${r.tokensIn ?? 0} in / ${r.tokensOut ?? 0} out` });
  if (r.offline) bits.push({ k: '', v: 'no network used' });
  if (!bits.length) return null;
  return (
    <div className="receipt" aria-label="Answer details">
      {bits.map((b, i) => (
        <span className="receipt-pill" key={i}>
          {b.k && <i>{b.k}</i>}
          {b.v}
        </span>
      ))}
    </div>
  );
}

function Steps({ steps }: { steps: LoopStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div className="step" key={i}>
          <span className={`k ${s.kind === 'act' ? 'act' : s.kind === 'error' ? 'error' : s.kind === 'budget' ? 'budget' : ''}`}>{s.kind}</span>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function ToolCalls({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return null;
  return (
    <>
      {calls.map((c) => (
        <details className="toolcall" key={c.id}>
          <summary>
            <Icon name={c.ok ? 'check' : c.blocked ? 'shield' : 'warn'} size={14} />
            <span className="grow mono">{c.tool}</span>
            <Pill tone={c.ok ? 'ok' : c.blocked ? 'warn' : 'bad'}>{c.ok ? fmtMs(c.ms) : c.blocked ? c.reason ?? 'blocked' : 'failed'}</Pill>
          </summary>
          <pre>
{`args: ${JSON.stringify(c.args, null, 2)}
${c.summary}${c.detail ? `\n\n${c.detail.slice(0, 1500)}` : ''}`}
          </pre>
        </details>
      ))}
    </>
  );
}

export default function Chat() {
  const app = useApp();
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  /** Downscale on-device and queue for the next turn only. */
  const attachFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const room = ATTACH_LIMIT - images.length;
    if (room <= 0) { app.toast(`Up to ${ATTACH_LIMIT} images per message`, 'err'); return; }
    const urls: string[] = [];
    for (const f of files.slice(0, room)) {
      try { urls.push(await downscaleImage(f)); } catch { app.toast(`Could not read ${f.name || 'image'}`, 'err'); }
    }
    if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, ATTACH_LIMIT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const captureScreen = async () => {
    try {
      const url = await captureScreenFrame();
      setImages((prev) => [...prev, url].slice(0, ATTACH_LIMIT));
      app.toast('One frame captured. Nothing is recording.', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|denied|cancel/i.test(msg)) app.toast(`Capture failed: ${msg}`, 'err');
    }
  };

  // Anything shared into the PWA from another app (share sheet) lands here as
  // text plus optional images, editable, never auto-sent.
  useEffect(() => {
    void drainShareInbox().then((p) => {
      if (!p) return;
      setImages((prev) => [...prev, ...p.images].slice(0, ATTACH_LIMIT));
      const line = sharePrompt(p);
      if (line) setDraft((d) => (d ? `${d}\n${line}` : line));
      requestAnimationFrame(() => { taRef.current?.focus(); grow(); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A prompt handed over from another screen lands in the composer, focused and
  // editable, rather than being sent on the user's behalf.
  useEffect(() => {
    if (!app.pendingPrompt) return;
    setDraft(app.pendingPrompt);
    app.setPendingPrompt('');
    requestAnimationFrame(() => {
      taRef.current?.focus();
      grow();
    });
  }, [app.pendingPrompt]);

  // Slash-command autocomplete. Suggestions appear only while the draft is
  // still just "/word" - once an argument is typed the list gets out of the way.
  const suggestions = useMemo(() => suggestCommands(draft), [draft]);
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [draft]);

  const commandCtx: CommandCtx = useMemo(
    () => ({
      remember: (text, kind) => app.addMemory({ text, kind, tags: ['slash'], source: 'command' }),
      recall: (q, limit) => {
        const needle = q.toLowerCase();
        return app.memory.filter((m) => m.text.toLowerCase().includes(needle)).slice(0, limit);
      },
      capture: (title, body) => app.saveIdea({ id: uid('idea'), title, body, tags: ['captured'], created: Date.now() }),
      toolNames,
      setMode: (id) => {
        if (!MODES.some((m) => m.id === id)) return false;
        app.setSettings({ mode: id });
        if (app.activeId) app.setConversationMode(app.activeId, id);
        return true;
      },
      modeIds: () => MODES.map((m) => m.id),
      go: (route) => navigate(route),
    }),
    [app],
  );
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LoopStep[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [leak, setLeak] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const conv = app.active;
  const mode = modeOf(conv?.mode ?? app.settings.mode);
  const messages = useMemo(() => conv?.messages ?? [], [conv]);

  useEffect(() => {
    if (!app.activeId && app.conversations.length === 0) app.newConversation();
    else if (!app.activeId && app.conversations[0]) app.openConversation(app.conversations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveSteps.length, busy]);

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, []);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim() || (images.length ? 'What is this?' : '');
      if (!body || busy) return;
      const convId = app.activeId ?? app.newConversation();
      const shots = images;
      setImages([]);

      const findings = detect(body);
      if (findings.length) {
        setLeak(findings.map((f) => `${f.label} (${f.count})`));
      }

      setDraft('');
      requestAnimationFrame(grow);
      const userMsg: Msg = { id: uid('m'), role: 'user', content: body, ts: Date.now(), ...(shots.length ? { images: shots } : {}) };
      app.appendMessage(convId, userMsg);

      const botId = uid('m');
      app.appendMessage(convId, { id: botId, role: 'assistant', content: '', ts: Date.now(), pending: true });
      setBusy(true);
      setLiveSteps([]);
      const ac = new AbortController();
      abortRef.current = ac;
      const t0 = Date.now();

      // A built-in slash command runs on device with no model call at all.
      const cmd = matchCommand(body);
      if (cmd) {
        const out = cmd.spec.run(cmd.arg, commandCtx);
        app.patchMessage(convId, botId, {
          content: out.text,
          pending: false,
          via: 'local',
          degraded: !out.ok,
          receipt: { ms: Date.now() - t0, mode: 'on device', offline: true },
        });
        app.addTrace({ kind: 'command', label: `/${cmd.spec.name}`, ms: Date.now() - t0, ok: out.ok, via: 'local' });
        setBusy(false);
        abortRef.current = null;
        return;
      }

      // A leading slash may also run a saved skill, still with no model call.
      const skillHit = matchSkill(body, app.skills);
      if (skillHit) {
        const res = await runSkill(skillHit.skill, skillHit.input, { runTool: app.runTool, signal: ac.signal });
        app.patchMessage(convId, botId, {
          content: `**${skillHit.skill.name}** ${res.ok ? 'completed' : 'stopped'}\n\n${res.output}`,
          pending: false,
          via: 'skill',
          degraded: !res.ok,
          calls: res.steps.map((s, i) => ({ id: `${botId}-${i}`, tool: s.tool, args: {}, ok: s.ok, summary: s.summary, ms: s.ms })),
          receipt: { ms: Date.now() - t0, mode: 'skill', tools: res.steps.length, offline: true },
        });
        app.addTrace({ kind: 'skill', label: skillHit.skill.name, ms: Date.now() - t0, ok: res.ok, toolCount: res.steps.length });
        setBusy(false);
        abortRef.current = null;
        return;
      }

      try {
        const history = [...(app.conversations.find((c) => c.id === convId)?.messages ?? []), userMsg].filter((m) => !m.pending && m.content);
        let streamed = '';
        const result = await app.runTask(history, {
          mode,
          provider: app.settings.provider,
          privacy: app.settings.privacy,
          ctx: app.makeToolCtx(),
          signal: ac.signal,
          onStep: (s) => setLiveSteps((prev) => [...prev, s]),
          onToken: (t) => {
            streamed += t;
            app.patchMessage(convId, botId, { content: streamed, pending: true });
          },
        });
        if (shots.length) app.patchMessage(convId, userMsg.id, { images: undefined, attached: shots.map((u) => ({ kind: 'image', bytes: dataUrlBytes(u) })) });
        const { text: cleanText, hint, model: modelHint } = extractSwitch(result.text, mode.id);
        let applied = false;
        if (hint && app.settings.autoSwitchMode) {
          app.setSettings({ mode: hint.id });
          app.setConversationMode(convId, hint.id);
          applied = true;
          app.toast(`Switched to ${modeOf(hint.id).name} mode`, 'ok');
        }
        app.patchMessage(convId, botId, {
          content: cleanText,
          pending: false,
          via: result.via,
          degraded: result.degraded,
          calls: result.calls,
          switchHint: hint ? { ...hint, applied } : undefined,
          modelHint,
          receipt: {
            ms: Date.now() - t0,
            mode: mode.name,
            steps: result.steps.length,
            tools: result.calls.length,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            offline: result.via === 'reflex',
          },
        });
        // Learn in the background; never blocks the reply. Says what it kept.
        void app.learnFrom(body, cleanText).then((saved) => {
          if (saved.length) app.toast(`Remembered: ${saved.map((x) => x.text).join(' · ').slice(0, 140)}`, 'ok');
        });
        app.addTrace({
          kind: 'chat',
          label: body.slice(0, 60),
          ms: Date.now() - t0,
          ok: !result.degraded,
          via: result.via,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          toolCount: result.calls.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        app.patchMessage(convId, botId, {
          content: ac.signal.aborted ? '_Stopped._' : `Something went wrong before I could answer.\n\n\`${msg}\`\n\nThis is the real error, not a placeholder. If it mentions a key or a 401, check Settings.`,
          pending: false,
          degraded: true,
          via: 'error',
          receipt: { ms: Date.now() - t0, mode: mode.name },
        });
      } finally {
        setBusy(false);
        setLiveSteps([]);
        abortRef.current = null;
      }
    },
    [app, busy, mode, grow, images],
  );

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const providerName = specOf(app.settings.provider.id).label;

  return (
    <ChatShell
      title={conv?.title ?? 'Chat'}
      sub={`${mode.name} \u00b7 ${providerName}${app.providerReady ? '' : ' (not configured)'}`}
      actions={
        <>
          <IconBtn name="plus" title="New conversation" onClick={() => app.newConversation()} />
          <IconBtn name="menu" title="Conversations" onClick={() => setDrawer(true)} />
        </>
      }
    >
      <div className="chatlog" ref={logRef}>
        <div className="inner">
          {!app.providerReady && (
            <div className="card tight" style={{ marginBottom: 14, borderColor: 'color-mix(in oklab, var(--warn) 40%, transparent)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon name="info" size={17} />
                <div className="grow">
                  <b style={{ fontSize: '0.9rem' }}>No model provider configured</b>
                  <div className="muted" style={{ fontSize: '0.82rem', marginTop: 3 }}>
                    Tools, skills and the offline reflex core all work right now. For reasoning, add a free Groq or Gemini key &mdash; it takes about a minute.
                  </div>
                  <Btn size="sm" variant="primary" className="" onClick={() => navigate('/app/settings')}>
                    Add a key
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {messages.length === 0 && (
            <Empty icon="spark" title="What are we working on?">
              Ask anything, or start with one of these. Type <code className="inline">/</code> for commands and saved skills &mdash; those run on device, with no model call.
            </Empty>
          )}
          {messages.length === 0 && (
            <div className="stack sm" style={{ marginTop: -14 }}>
              {STARTERS.map((s) => (
                <button key={s} type="button" className="item" onClick={() => void send(s)}>
                  <span className="ico">
                    <Icon name="spark" size={17} />
                  </span>
                  <span className="txt">
                    <b style={{ whiteSpace: 'normal' }}>{s}</b>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              ))}
            </div>
          )}

          {messages.map((m) => (
            <article className={`msg ${m.role === 'user' ? 'user' : 'bot'}`} key={m.id}>
              <div className="av">
                <Icon name={m.role === 'user' ? 'user' : 'spark'} size={15} />
              </div>
              <div className="body">
                <div className="bubble">
                  {m.images?.length ? (
                    <div className="attach-row">{m.images.map((u, i) => <img key={i} src={u} alt="" className="attach-thumb" />)}</div>
                  ) : m.attached?.length ? (
                    <div className="attach-row">{m.attached.map((a, i) => (
                      <span key={i} className="attach-gone" title="Used for that turn only, then dropped from storage"><Icon name="image" size={13} /> image · {Math.round(a.bytes / 1024)} KB · not stored</span>
                    ))}</div>
                  ) : null}
                  {m.pending && !m.content ? <Dots /> : <Markdown text={m.content} />}
                </div>
                {m.role === 'assistant' && !m.pending && (
                  <div className="meta">
                    {m.via && <Pill tone={m.via === 'reflex' ? 'warn' : m.degraded ? 'warn' : 'ok'}>{m.via === 'reflex' ? 'offline core' : m.via}</Pill>}
                    <span>{fmtWhen(m.ts)}</span>
                    <CopyBtn text={m.content} />
                  </div>
                )}
                {m.role === 'assistant' && !m.pending && m.switchHint && (
                  <SwitchChip
                    hint={m.switchHint}
                    current={mode.id}
                    onSwitch={() => {
                      app.setSettings({ mode: m.switchHint!.id });
                      if (app.activeId) app.setConversationMode(app.activeId, m.switchHint!.id);
                      app.patchMessage(app.activeId!, m.id, { switchHint: { ...m.switchHint!, applied: true } });
                      app.toast(`Switched to ${modeOf(m.switchHint!.id).name} mode`, 'ok');
                    }}
                  />
                )}
                {m.role === 'assistant' && !m.pending && m.modelHint && <ModelChip hint={m.modelHint} />}
                {m.role === 'assistant' && !m.pending && m.receipt && <Receipt r={m.receipt} />}
                {m.calls && <ToolCalls calls={m.calls} />}
              </div>
            </article>
          ))}

          {busy && liveSteps.length > 0 && (
            <article className="msg bot">
              <div className="av">
                <Icon name="agent" size={15} />
              </div>
              <div className="body" style={{ width: '100%' }}>
                <Steps steps={liveSteps.slice(-6)} />
              </div>
            </article>
          )}
        </div>
      </div>

      <div className="composer">
        <div className="inner">
          <div className="chiprow" style={{ marginBottom: 6 }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip${m.id === mode.id ? ' on' : ''}`}
                onClick={() => {
                  app.setSettings({ mode: m.id });
                  if (app.activeId) app.setConversationMode(app.activeId, m.id);
                }}
                title={m.blurb}
              >
                <Icon name={m.icon as never} size={14} />
                {m.name}
              </button>
            ))}
          </div>
          {images.length > 0 && (
            <div className="attach-row" style={{ marginBottom: 6 }}>
              {images.map((u, i) => (
                <span key={i} className="attach-pv">
                  <img src={u} alt="" />
                  <button type="button" aria-label="Remove image" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}><Icon name="close" size={11} /></button>
                </span>
              ))}
              {!canSee(app.settings.provider.id) && (
                <span className="dim" style={{ fontSize: '0.74rem', alignSelf: 'center' }}>
                  {specOf(app.settings.provider.id).label} cannot see images &mdash; pick OpenAI, Gemini, Anthropic or OpenRouter in Keys, or the text goes alone.
                </span>
              )}
              <span className="dim" style={{ fontSize: '0.72rem', alignSelf: 'center', marginLeft: 'auto' }}>Sent with this turn only, then dropped.</span>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void attachFiles(imageFilesFrom(e.target.files)); e.target.value = ''; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void attachFiles(imageFilesFrom(e.target.files)); e.target.value = ''; }} />
          <div
            className="box"
            onDragOver={(e) => { if (imageFilesFrom(e.dataTransfer.items).length) e.preventDefault(); }}
            onDrop={(e) => { const fs = imageFilesFrom(e.dataTransfer.files); if (fs.length) { e.preventDefault(); void attachFiles(fs); } }}
          >
            <div className="attach-btns">
              <IconBtn name="image" title="Attach an image (or paste one)" onClick={() => fileRef.current?.click()} />
              <IconBtn name="camera" title="Take a photo" onClick={() => cameraRef.current?.click()} />
              {canCaptureScreen() && <IconBtn name="screen" title="Look at my screen: one frame of a window or tab you choose, then the share ends" onClick={() => void captureScreen()} />}
            </div>
            {suggestions.length > 0 && (
              <div className="slash" role="listbox" aria-label="Slash commands">
                {suggestions.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    className="slash-row"
                    role="option"
                    aria-selected={i === pick}
                    onMouseEnter={() => setPick(i)}
                    onClick={() => {
                      setDraft(`/${c.name} `);
                      taRef.current?.focus();
                    }}
                  >
                    <code>/{c.name}</code>
                    {c.arg && <span className="dim mono" style={{ fontSize: '0.74rem' }}>{c.arg}</span>}
                    <span className="d">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              value={draft}
              rows={1}
              placeholder={busy ? 'Working\u2026' : 'Message JARVIS, or / for commands'}
              aria-label="Message"
              onChange={(e) => {
                setDraft(e.target.value);
                grow();
              }}
              onPaste={(e) => {
                const fs = imageFilesFrom(e.clipboardData.items);
                if (fs.length) { e.preventDefault(); void attachFiles(fs); }
              }}
              onKeyDown={(e) => {
                if (suggestions.length) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPick((p) => (p + 1) % suggestions.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPick((p) => (p - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                    e.preventDefault();
                    setDraft(`/${suggestions[pick].name} `);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft('');
                    return;
                  }
                }
                if (e.key === 'Enter' && (app.settings.sendOnEnter ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button
              type="button"
              className={`send${busy ? ' stop' : ''}`}
              onClick={() => (busy ? stop() : void send(draft))}
              disabled={!busy && !draft.trim() && images.length === 0}
              aria-label={busy ? 'Stop' : 'Send'}
            >
              <Icon name={busy ? 'stop' : 'send'} size={17} />
            </button>
          </div>
        </div>
      </div>

      <Sheet open={drawer} onClose={() => setDrawer(false)} title="Conversations" sub={`${app.conversations.length} saved on this device`}>
        <Btn block variant="primary" icon="plus" onClick={() => { app.newConversation(); setDrawer(false); }}>
          New conversation
        </Btn>
        <div className="list" style={{ marginTop: 12 }}>
          {app.conversations.map((c) => (
            <div className="item" key={c.id}>
              <button
                type="button"
                className="grow row"
                style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
                onClick={() => {
                  app.openConversation(c.id);
                  setDrawer(false);
                }}
              >
                <span className="ico">
                  <Icon name="chat" size={16} />
                </span>
                <span className="txt">
                  <b>{c.title}</b>
                  <small>{c.messages.length} messages &middot; {fmtWhen(c.updated)}</small>
                </span>
              </button>
              <IconBtn name="trash" title={`Delete ${c.title}`} onClick={() => app.deleteConversation(c.id)} />
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={!!leak}
        onClose={() => setLeak(null)}
        title="That message contained sensitive data"
        sub="Flagged before anything left this device."
      >
        <p className="muted">
          I detected {leak?.join(', ')} in what you just sent. Credentials and key material are always redacted before transport, whatever your privacy level &mdash; but if that was a real secret, treat it as exposed and rotate it.
        </p>
        <ul className="muted" style={{ fontSize: '0.86rem', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Rotate the credential at its source if it was real.</li>
          <li>Delete this conversation to remove it from local storage.</li>
          <li>Switch to Strict privacy to redact contact details too.</li>
        </ul>
        <Btn block variant="primary" onClick={() => setLeak(null)}>
          Understood
        </Btn>
      </Sheet>
    </ChatShell>
  );
}


/** The one-tap offer a mode makes when another mode would serve the request better. */
function SwitchChip({ hint, current, onSwitch }: { hint: NonNullable<Msg['switchHint']>; current: string; onSwitch: () => void }) {
  const target = modeOf(hint.id);
  const already = hint.applied || current === hint.id;
  return (
    <div className="row wrap" style={{ gap: 8, margin: '6px 0 2px', alignItems: 'center' }}>
      <Pill tone={already ? 'ok' : 'info'}>
        <Icon name={target.icon as never} size={12} /> {already ? `Now in ${target.name}` : `${target.name} suggested`}
      </Pill>
      <span className="dim" style={{ fontSize: '0.78rem' }}>{hint.reason}</span>
      {!already && (
        <Btn size="sm" variant="primary" icon="chevron" onClick={onSwitch}>Switch</Btn>
      )}
    </div>
  );
}

/** Advisory model-tier recommendation. The runtime maps tiers to providers; nothing changes automatically. */
function ModelChip({ hint }: { hint: NonNullable<Msg['modelHint']> }) {
  return (
    <div className="row wrap" style={{ gap: 8, margin: '2px 0', alignItems: 'center' }}>
      <Pill><Icon name="layers" size={12} /> {hint.tier} model suggested</Pill>
      {hint.reason && <span className="dim" style={{ fontSize: '0.78rem' }}>{hint.reason}</span>}
    </div>
  );
}
