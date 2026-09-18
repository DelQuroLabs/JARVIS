/**
 * The dashboard.
 *
 * This screen is the navigation. Every destination in the app is a real,
 * thumb-sized button here, so nothing is buried in a list on the side. The
 * rail still exists on desktop as an icon strip, but it is a shortcut, not
 * the primary way in.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { Btn, Card, Pill, SectionTitle } from '../components.tsx';
import { Reactor, Rolling, haptic, useSparkle } from '../fx.tsx';
import { useApp } from '../state.tsx';
import { navigate } from '../router.tsx';
import { useDragSort } from '../dragsort.ts';
import { hiddenTiles, visibleTiles, type DashTile } from '../../core/dashboard.ts';
import { WeatherCard } from './Weather.tsx';
import { alertNudge, buildBrief, canSpeak, precipNudge } from '../../core/brief.ts';
import { fmtEventDay, fmtEventTime, upcoming } from '../../core/ics.ts';
import { RadarCard } from './Radar.tsx';
import { activity, discoverPatterns, estimate } from '../../core/traces.ts';
import { modeOf } from '../../core/modes.ts';
import { specOf } from '../../core/providers.ts';
import { dueRoutines } from '../../core/routines.ts';
import { fmtWhen } from '../../core/util.ts';
import { TOOLS } from '../../core/tools.ts';
import { PROVIDERS } from '../../core/providers.ts';

/* Rotating prompt seeds. Deterministic per day so the dashboard feels alive
   without shuffling under the user mid-session. */
const SPARKS = [
  'Draft three subject lines for a launch email',
  'What is 18% of 2,340 plus 12?',
  'Summarise this into five bullets',
  'Compare Postgres and SQLite for a local-first app',
  'Turn these notes into a checklist',
  'Review this function for edge cases',
  'What should I wear today?',
  'Plan a weekend on a $400 budget',
];

/** Brand tones used as tile accents. Fills and strokes only, never body text. */
const TONE: Record<string, string> = {
  accent: 'var(--accent)',
  violet: '#a78bfa',
  sky: '#5cc8ff',
  amber: '#ffb454',
  ok: 'var(--ok)',
  rose: '#ff8fa3',
};

function greetingFor(h: number): { text: string; icon: IconName } {
  if (h < 5) return { text: 'Still up', icon: 'moon' };
  if (h < 12) return { text: 'Good morning', icon: 'sun' };
  if (h < 18) return { text: 'Good afternoon', icon: 'sun' };
  return { text: 'Good evening', icon: 'moon' };
}

function TileFace({ t, big }: { t: DashTile; big: boolean }) {
  return (
    <>
      <span className="ti">
        <Icon name={t.icon as IconName} size={big ? 24 : 20} />
      </span>
      <span className="grow">
        <span className="tt" style={{ display: 'block' }}>{t.label}</span>
        {big && t.sub && <span className="ts" style={{ display: 'block', marginTop: 2 }}>{t.sub}</span>}
      </span>
    </>
  );
}

function Tile({
  t, editing, dragging, over, itemProps, offset, onHide,
}: {
  t: DashTile;
  editing: boolean;
  dragging: boolean;
  over: boolean;
  itemProps: ReturnType<ReturnType<typeof useDragSort>['itemProps']>;
  offset: { x: number; y: number };
  onHide: () => void;
}) {
  const big = t.size === 'lg';
  const style: CSSProperties = { '--tile': TONE[t.tone] ?? TONE.accent } as CSSProperties;
  if (dragging) {
    style.transform = `translate(${offset.x}px, ${offset.y}px) scale(1.04)`;
    style.zIndex = 30;
    style.position = 'relative';
  }
  return (
    <div
      className={`tile-slot${big ? ' lg' : ''}${editing ? ' editing' : ''}${dragging ? ' dragging' : ''}${over && !dragging ? ' over' : ''}`}
      style={style}
      {...itemProps}
    >
      <button
        type="button"
        className={big ? 'tile-btn hero' : 'mini-btn'}
        // In rearrange mode the tile is a drag handle, not a link.
        onClick={() => {
          if (editing) return;
          haptic.light();
          navigate(t.to);
        }}
        tabIndex={editing ? -1 : 0}
        aria-label={editing ? `${t.label} (drag to reorder)` : t.label}
      >
        {big ? (
          <TileFace t={t} big />
        ) : (
          <>
            <span className="mi"><Icon name={t.icon as IconName} size={20} /></span>
            {t.label}
          </>
        )}
      </button>
      {editing && (
        <button
          type="button"
          className="tile-hide"
          title={`Hide ${t.label}`}
          aria-label={`Hide ${t.label} from the dashboard`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onHide}
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const app = useApp();
  const freeCount = PROVIDERS.filter((p) => p.tier === 'free').length;
  const est = useMemo(() => estimate(app.traces), [app.traces]);
  const patterns = useMemo(() => discoverPatterns(app.traces), [app.traces]);
  const hours = useMemo(() => activity(app.traces).map((b) => b.value), [app.traces]);
  const due = useMemo(() => dueRoutines(app.routines), [app.routines]);
  const mode = modeOf(app.settings.mode);
  const provider = specOf(app.settings.provider.id);
  const greeting = greetingFor(new Date().getHours());
  const recent = app.conversations.slice(0, 2);
  const { fire, node: sparkles } = useSparkle();
  const [editing, setEditing] = useState(false);
  const tiles = useMemo(() => visibleTiles(app.dash), [app.dash]);
  const hidden = useMemo(() => hiddenTiles(app.dash), [app.dash]);
  const sorter = useDragSort(editing, (dragId, overId) => app.moveTile(dragId, overId));
  const [speaking, setSpeaking] = useState(false);
  const nudge = alertNudge(app.weather) ?? precipNudge(app.weather, app.settings.units);
  const events = useMemo(
    () => upcoming(app.calendars.flatMap((c) => c.events), Date.now(), 4),
    [app.calendars],
  );

  const speakBrief = () => {
    const lines = buildBrief({
      now: new Date(),
      weather: app.weather,
      units: app.settings.units,
      dueRoutines: due.map((r) => r.name),
      runs24h: est.runs,
      providerLabel: app.providerReady ? provider.label : null,
      online: app.online,
      events: events.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay })),
    });
    const text = lines.join(' ');
    app.toast(text, 'info');
    if (!canSpeak()) return;
    try {
      globalThis.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      globalThis.speechSynthesis.speak(u);
    } catch {
      setSpeaking(false);
    }
  };
  const keyBtn = useRef<HTMLDivElement>(null);

  const daySeed = Math.floor(Date.now() / 86_400_000);
  const spark = SPARKS[daySeed % SPARKS.length];

  const [celebrated, setCelebrated] = useState(false);
  useEffect(() => {
    if (app.providerReady && !celebrated) {
      setCelebrated(true);
      fire(keyBtn.current);
      haptic.success();
    }
  }, [app.providerReady, celebrated, fire]);

  const peak = Math.max(...hours, 0);

  return (
    <Shell title="Dashboard" sub={`${mode.name} mode \u00b7 ${TOOLS.length} tools ready`}>
      <div className="dash">
        {sparkles}

        {/* ---------- greeting ---------- */}
        <header className="dash-hello">
          <span className="glow-ring">
            <Reactor size={42} busy={false} />
          </span>
          <div className="grow">
            <h1>
              {greeting.text}
            </h1>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '3px 0 0' }}>
              {app.providerReady
                ? `${provider.label} is wired in. Everything still lives on this device.`
                : 'Running fully on-device. Nothing has left this browser.'}
            </p>
          </div>
        </header>

        {/* ---------- status strip ---------- */}
        <div className="strip" style={{ margin: '13px 0 14px' }}>
          <Pill tone={app.providerReady ? 'ok' : 'warn'}>
            <Icon name={app.providerReady ? 'check' : 'warn'} size={12} />
            {app.providerReady ? provider.label : 'No model key'}
          </Pill>
          <Pill tone="info">
            <Icon name="shield" size={12} />
            {app.settings.privacy.toLowerCase()}
          </Pill>
          <Pill tone={app.cloud.serverUrl ? 'ok' : 'default'}>
            <Icon name="cloud" size={12} />
            {app.cloud.serverUrl ? 'cloud linked' : 'local only'}
          </Pill>
          <Pill tone={app.online ? 'default' : 'warn'}>
            <Icon name={app.online ? 'globe' : 'bolt'} size={12} />
            {app.online ? 'online' : 'offline'}
          </Pill>
        </div>

        {nudge && (
          <button
            type="button"
            className="nudge"
            onClick={() => navigate('/app/weather')}
            aria-label={`${nudge} Open the weather dashboard.`}
          >
            <Icon name="rain" size={15} />
            <span className="grow">{nudge}</span>
            <Icon name="chevron" size={15} />
          </button>
        )}

        <div className="row wrap brief-row" style={{ gap: 8, marginBottom: 14 }}>
          <Btn
            icon={speaking ? 'stop' : 'mic'}
            onClick={() => {
              if (speaking) {
                globalThis.speechSynthesis?.cancel();
                setSpeaking(false);
                return;
              }
              haptic.light();
              speakBrief();
            }}
          >
            {speaking ? 'Stop' : 'Brief me'}
          </Btn>
          <span className="dim" style={{ fontSize: '0.72rem', alignSelf: 'center' }}>
            {canSpeak() ? 'Spoken by your browser, no key needed' : 'Your browser has no speech engine \u2014 shown as text'}
          </span>
        </div>

        {/* ---------- weather + the one thing to do next ---------- */}
        <div className="dash-split" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {!app.providerReady && (
              <div ref={keyBtn}>
                <Card className="hero-card">
                  <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginBottom: 13 }}>
                    <span className="hero-ic">
                      <Icon name="key" size={20} />
                    </span>
                    <div className="grow">
                      <b style={{ fontSize: '1rem' }}>Give it a brain</b>
                      <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 0', lineHeight: 1.5 }}>
                        {TOOLS.length} tools, skills and the offline reflex core all work right now. For real
                        reasoning, connect one of {freeCount} free-tier providers &mdash; about a minute, no card.
                      </p>
                    </div>
                  </div>
                  <Btn block variant="primary" icon="rocket" onClick={() => navigate('/app/providers')}>
                    Connect a free model
                  </Btn>
                </Card>
              </div>
            )}

            <button
              type="button"
              className="tile-btn wide"
              style={{ '--tile': TONE.accent } as CSSProperties}
              onClick={() => {
                haptic.light();
                app.setPendingPrompt(spark);
                navigate('/app/chat');
              }}
            >
              <span className="ti">
                <Icon name="wand" size={18} />
              </span>
              <span className="grow">
                <span className="ts" style={{ display: 'block', color: 'var(--accent-t)', fontWeight: 700, letterSpacing: '0.06em', fontSize: '0.62rem', textTransform: 'uppercase' }}>
                  Try today
                </span>
                <span className="tt" style={{ display: 'block' }}>{spark}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {events.length > 0 && (
              <div className="card tight">
                <div className="row between" style={{ marginBottom: 8 }}>
                  <div className="section-title" style={{ margin: 0 }}>Next up</div>
                  <button type="button" className="chip" onClick={() => navigate('/app/calendar')}>All</button>
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {events.slice(0, 3).map((e) => (
                    <div className="row" style={{ gap: 10 }} key={`${e.uid}-${e.start}`}>
                      <span className="cal-when" style={{ width: 62 }}>
                        <b>{fmtEventDay(e.start, Date.now())}</b>
                        <span>{fmtEventTime(e)}</span>
                      </span>
                      <span className="grow" style={{ fontSize: '0.85rem', minWidth: 0 }}>{e.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {app.settings.weatherOn && (
              <>
                <WeatherCard />
                <RadarCard />
              </>
            )}
          </div>
        </div>

        {/* ---------- the launcher: one modular, rearrangeable grid ---------- */}
        <div className="row between" style={{ marginBottom: 9, gap: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {editing ? 'Drag to rearrange' : 'Start something'}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {editing && (
              <Btn size="sm" variant="quiet" icon="refresh" onClick={() => { app.resetDash(); haptic.light(); }}>
                Reset
              </Btn>
            )}
            <Btn
              size="sm"
              variant={editing ? 'primary' : 'quiet'}
              icon={editing ? 'check' : 'grid'}
              onClick={() => {
                setEditing((v) => !v);
                haptic.light();
              }}
            >
              {editing ? 'Done' : 'Rearrange'}
            </Btn>
          </div>
        </div>

        <div className={`launch-grid${editing ? ' editing' : ''}`} {...sorter.containerProps}>
          {tiles.map((t) => (
            <Tile
              key={t.id}
              t={t}
              editing={editing}
              dragging={sorter.dragId === t.id}
              over={sorter.overId === t.id}
              offset={sorter.offset}
              itemProps={sorter.itemProps(t.id)}
              onHide={() => {
                app.toggleTile(t.id);
                haptic.warn();
              }}
            />
          ))}
        </div>

        {editing && (
          <p className="dim" style={{ fontSize: '0.75rem', margin: '10px 0 0', lineHeight: 1.5 }}>
            Drag a tile onto another to move it there. The layout is saved on this device as you go.
          </p>
        )}

        {editing && hidden.length > 0 && (
          <>
            <SectionTitle>Hidden</SectionTitle>
            <div className="row wrap" style={{ gap: 6, marginBottom: 16 }}>
              {hidden.map((t) => (
                <button key={t.id} type="button" className="chip" onClick={() => { app.toggleTile(t.id); haptic.light(); }}>
                  <Icon name="plus" size={12} /> {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ height: 16 }} />

        {/* ---------- due routines ---------- */}
        {due.length > 0 && (
          <>
            <SectionTitle>Due now</SectionTitle>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {due.slice(0, 2).map((r) => (
                <div className="card tight" key={r.id}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="hero-ic" style={{ width: 34, height: 34 }}>
                      <Icon name="routine" size={16} />
                    </span>
                    <div className="grow">
                      <b style={{ fontSize: '0.9rem' }}>{r.name}</b>
                      <div className="dim" style={{ fontSize: '0.76rem' }}>ready to run</div>
                    </div>
                    <Btn
                      size="sm"
                      icon="play"
                      disabled={app.routineBusy.includes(r.id)}
                      onClick={() => void app.runRoutine(r)}
                    >
                      {app.routineBusy.includes(r.id) ? 'Running' : 'Run'}
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------- last 24 hours ---------- */}
        <SectionTitle>Last 24 hours</SectionTitle>
        <div className="hud" style={{ marginBottom: 16 }}>
          <div className="widget">
            <div className="wh">
              <Icon name="activity" size={13} />
              <span className="lbl">Runs</span>
            </div>
            <div className="big">
              <Rolling value={est.runs} />
            </div>
            <div className="sub">{est.toolCalls} tool calls</div>
          </div>
          <div className="widget">
            <div className="wh">
              <Icon name="check" size={13} />
              <span className="lbl">Succeeded</span>
            </div>
            <div className="big" style={{ color: est.runs ? 'var(--ok-t)' : undefined }}>
              {est.runs ? `${Math.round(est.successRate * 100)}%` : '\u2014'}
            </div>
            <div className="sub">{est.runs ? `${est.runs - est.failures} of ${est.runs}` : 'no runs yet'}</div>
          </div>
          <div className="widget">
            <div className="wh">
              <Icon name="bolt" size={13} />
              <span className="lbl">Answered offline</span>
            </div>
            <div className="big">{est.runs ? `${Math.round((est.offlineRuns / est.runs) * 100)}%` : '0%'}</div>
            <div className="sub">{est.offlineRuns} from the reflex core</div>
          </div>
          <div className="widget">
            <div className="wh">
              <Icon name="gauge" size={13} />
              <span className="lbl">Est. spend</span>
            </div>
            <div className="big">${est.costUsd.toFixed(4)}</div>
            <div className="sub">{est.costUsd === 0 ? 'free tiers only' : 'estimated, not billed'}</div>
          </div>
          <div className="widget w-wide">
            <div className="wh">
              <Icon name="pulse" size={13} />
              <span className="lbl">Activity</span>
            </div>
            <div className="spark-row">
              {hours.map((v, i) => (
                <span key={i} style={{ height: `${peak ? Math.max(4, (v / peak) * 100) : 4}%` }} />
              ))}
            </div>
            <div className="row between dim" style={{ fontSize: '0.68rem', marginTop: 4 }}>
              <span>24h ago</span>
              <span>now</span>
            </div>
          </div>
        </div>

        {/* ---------- noticed ---------- */}
        {patterns.length > 0 && (
          <>
            <SectionTitle>Noticed</SectionTitle>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {patterns.slice(0, 2).map((p, i) => (
                <div className="card tight" key={i}>
                  <div className="row" style={{ gap: 10 }}>
                    <Icon name="idea" size={16} />
                    <div className="grow">
                      <b style={{ fontSize: '0.88rem' }}>{p.title}</b>
                      <div className="dim" style={{ fontSize: '0.78rem', lineHeight: 1.45 }}>{p.detail}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------- resume ---------- */}
        {recent.length > 0 && (
          <>
            <SectionTitle>Pick up where you left off</SectionTitle>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {recent.map((c) => (
                <button
                  type="button"
                  className="list-row"
                  key={c.id}
                  onClick={() => {
                    app.openConversation(c.id);
                    navigate('/app/chat');
                  }}
                >
                  <div className="grow" style={{ textAlign: 'left' }}>
                    <b style={{ fontSize: '0.88rem' }}>{c.title}</b>
                    <div className="dim" style={{ fontSize: '0.76rem' }}>
                      {fmtWhen(c.updated)} &middot; {c.messages.length} messages
                    </div>
                  </div>
                  <Icon name="chevron" size={16} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
