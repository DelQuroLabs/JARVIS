/**
 * Calendar import.
 *
 * Import is by .ics file, and that is a deliberate choice rather than a
 * shortcut: Google and Apple both serve their calendar feeds without CORS
 * headers, so a browser cannot fetch them. Verified, not assumed. Offering a
 * "subscribe by URL" box for those services would be a button that can never
 * work, so the screen explains the export path instead.
 */

import { useMemo, useRef, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, IconBtn, SectionTitle, useConfirm } from '../components.tsx';
import { useApp } from '../state.tsx';
import { haptic } from '../fx.tsx';
import {
  UNSUPPORTED, eventsOn, fmtEventDay, fmtEventTime, upcoming, type CalEvent,
} from '../../core/ics.ts';

/** Every event across every imported calendar. */
export function useAllEvents(): CalEvent[] {
  const app = useApp();
  return useMemo(
    () => app.calendars.flatMap((c) => c.events).sort((a, b) => a.start - b.start),
    [app.calendars],
  );
}

export default function Calendar() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmNode, askConfirm] = useConfirm();
  const events = useAllEvents();
  const now = Date.now();
  const today = useMemo(() => eventsOn(events, now), [events, now]);
  const next = useMemo(() => upcoming(events, now, 12), [events, now]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr('');
    let added = 0;
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const cal = app.importCalendar(f.name.replace(/\.ics$/i, ''), text, f.name);
        added++;
        app.toast(`${cal.name}: ${cal.events.length} events imported`, 'ok');
      } catch (e) {
        setErr(e instanceof Error ? e.message : `${f.name} could not be read.`);
      }
    }
    if (added) haptic.success();
    else haptic.warn();
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Shell
      title="Calendar"
      sub={`${app.calendars.length} imported \u00b7 ${events.length} events`}
      actions={<IconBtn name="upload" title="Import a calendar file" onClick={() => fileRef.current?.click()} />}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".ics,text/calendar"
        multiple
        onChange={(e) => void onFiles(e.target.files)}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {app.calendars.length === 0 && (
        <Card>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="hero-ic"><Icon name="clock" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: '1rem' }}>Bring your calendar in</b>
              <p className="muted" style={{ fontSize: '0.85rem', margin: '5px 0 12px', lineHeight: 1.55 }}>
                Export an <code className="inline">.ics</code> file from Google or Apple and drop it here. Events then show
                on the dashboard and in your spoken briefing.
              </p>
              <Btn variant="primary" icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Reading\u2026' : 'Choose a .ics file'}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {err && (
        <Card tight>
          <div className="row" style={{ gap: 8, color: 'var(--danger-t)', fontSize: '0.82rem' }}>
            <Icon name="warn" size={15} />
            <span>{err}</span>
          </div>
        </Card>
      )}

      {today.length > 0 && (
        <>
          <SectionTitle>Today</SectionTitle>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {today.map((e) => <EventRow key={`${e.uid}-${e.start}`} e={e} />)}
          </div>
        </>
      )}

      {next.length > 0 && (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {next.map((e) => <EventRow key={`${e.uid}-${e.start}`} e={e} showDay />)}
          </div>
        </>
      )}

      {app.calendars.length > 0 && (
        <>
          <SectionTitle>Imported calendars</SectionTitle>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {app.calendars.map((c) => (
              <div className="card tight" key={c.id}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="hero-ic" style={{ width: 34, height: 34 }}>
                    <Icon name="clock" size={16} />
                  </span>
                  <div className="grow">
                    <b style={{ fontSize: '0.9rem' }}>{c.name}</b>
                    <div className="dim" style={{ fontSize: '0.75rem' }}>
                      {c.events.length} events &middot; from {c.source}
                    </div>
                  </div>
                  <IconBtn
                    name="trash"
                    title={`Remove ${c.name}`}
                    onClick={() =>
                      askConfirm({
                        title: `Remove "${c.name}"?`,
                        body: 'The imported events are deleted from this device. The original calendar is untouched.',
                        danger: true,
                        onYes: () => {
                          app.removeCalendar(c.id);
                          app.toast('Calendar removed', 'ok');
                        },
                      })
                    }
                  />
                </div>
                {c.warnings.length > 0 && (
                  <div className="dim" style={{ fontSize: '0.73rem', marginTop: 8, lineHeight: 1.5 }}>
                    {c.warnings.join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>How to export</SectionTitle>
      <Card tight>
        <div className="muted" style={{ fontSize: '0.82rem', lineHeight: 1.62 }}>
          <p style={{ margin: '0 0 8px' }}>
            <b>Google Calendar.</b> On a computer: Settings &rarr; Import &amp; export &rarr; Export. You get a zip;
            unzip it and import the <code className="inline">.ics</code> inside.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <b>Apple Calendar.</b> On a Mac: select the calendar, then File &rarr; Export &rarr; Export. On iPhone,
            share the calendar and choose Export.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <b>Outlook, Fastmail and others</b> all publish the same format, and are read the same way.
          </p>
          <p style={{ margin: 0, color: 'var(--ink-3)' }}>
            <b>Why not subscribe to a URL?</b> Because it cannot work from a web page. Google and Apple both serve their
            calendar feeds without cross-origin headers, so the browser refuses the request before it starts. I tested
            both: <code className="inline">Failed to fetch</code>. A URL box here would be a control that never works,
            so there is not one. An import is a snapshot &mdash; re-import to refresh it.
          </p>
        </div>
      </Card>

      <SectionTitle>What the reader skips</SectionTitle>
      <Card tight>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5, fontSize: '0.8rem', color: 'var(--ink-2)' }}>
          {UNSUPPORTED.map((u) => <li key={u}>{u}</li>)}
        </ul>
        <p className="dim" style={{ fontSize: '0.75rem', margin: '9px 0 0', lineHeight: 1.5 }}>
          Anything skipped is counted and reported on the calendar it came from, rather than disappearing quietly.
        </p>
      </Card>
      {confirmNode}
    </Shell>
  );
}

function EventRow({ e, showDay }: { e: CalEvent; showDay?: boolean }) {
  return (
    <div className="cal-row">
      <div className="cal-when">
        {showDay && <b>{fmtEventDay(e.start, Date.now())}</b>}
        <span>{fmtEventTime(e)}</span>
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <b style={{ fontSize: '0.88rem' }}>{e.title}</b>
        {e.location && <div className="dim" style={{ fontSize: '0.75rem' }}>{e.location}</div>}
      </div>
      {e.recurring && <Icon name="refresh" size={13} />}
    </div>
  );
}
