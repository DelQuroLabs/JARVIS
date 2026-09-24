/**
 * Live precipitation radar.
 *
 * Tiles are plain <img> elements: a dark OpenStreetMap basemap with RainViewer
 * radar composited on top. No mapping library, so this costs the bundle nothing.
 *
 * Two honest limits worth knowing:
 *   - The free RainViewer feed publishes about two hours of past frames at ten
 *     minute steps. There is no longer history available without a key, so the
 *     timeline says how far back it actually reaches rather than implying more.
 *   - Its forecast ("nowcast") frames are often empty. When they are, the
 *     forecast strip falls back to Open-Meteo's 15-minute precipitation
 *     forecast, which is a point forecast for your location, not radar imagery,
 *     and is labelled as such.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state.tsx';
import { Icon } from '../icons.tsx';
import { OpenLink } from '../components.tsx';
import {
  BASEMAP, OWM_LAYERS, fetchRadarIndex, frameAge, frameLabel, historySpanMinutes, owmTile, panBy,
  radarTile, tileGrid, type OwmLayerId, type RadarIndex,
} from '../../core/radar.ts';
import { precipOutlook } from '../../core/wxmerge.ts';

const COLS = 3;
const ROWS = 3;
const TILE = 256;
const SCALE = 0.62;

export function RadarCard({
  zoom: initialZoom = 7,
  height = 200,
  controls = false,
}: {
  zoom?: number;
  height?: number;
  /** Show zoom buttons and the "drag to move" affordance. */
  controls?: boolean;
}) {
  const app = useApp();
  const place = app.settings.weatherPlace;
  const [index, setIndex] = useState<RadarIndex | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  /** Null means "follow the saved location"; a value means the user panned. */
  const [centre, setCentre] = useState<{ lat: number; lon: number } | null>(null);
  const [layer, setLayer] = useState<OwmLayerId | ''>('');
  const owmKey = app.settings.serviceKeys?.openweather ?? '';
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const drag = useRef<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const moved = useRef(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const idx = await fetchRadarIndex(async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`The radar service answered ${r.status}.`);
        return r.json();
      });
      setIndex(idx);
      setI(Math.max(0, idx.frames.filter((f) => !f.forecast).length - 1));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The radar lookup failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const online = app.online;
  useEffect(() => {
    if (!online) return;
    void load();
  }, [load, online]);

  useEffect(() => {
    if (!playing || !index) return;
    timer.current = setInterval(() => setI((p) => (p + 1) % index.frames.length), 520);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [playing, index]);

  const view = centre ?? (place ? { lat: place.lat, lon: place.lon } : null);
  const grid = useMemo(
    () => (view ? tileGrid(view.lat, view.lon, zoom, COLS, ROWS) : null),
    [view, zoom],
  );

  /* ---------------------------------------------------------- pan by drag */
  const onDown = (e: React.PointerEvent) => {
    if (!view) return;
    // The zoom and recentre buttons live inside the map. Capturing the pointer
    // here would retarget their events to this container and they would never
    // fire a click at all.
    if ((e.target as HTMLElement).closest('.radar-zoom')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lon: view.lon };
    moved.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    // The plane is drawn at SCALE, so a screen pixel is more than a map pixel.
    setCentre(panBy(d.lat, d.lon, zoom, dx / SCALE, dy / SCALE));
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag.current) (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  if (!online) {
    return (
      <div className="card tight">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="bolt" size={18} />
          <div className="grow">
            <b style={{ fontSize: '0.9rem' }}>Radar needs a connection</b>
            <div className="dim" style={{ fontSize: '0.76rem' }}>
              Tiles are fetched live, so there is nothing cached to show while offline.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!place) {
    return (
      <div className="card tight">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="rain" size={18} />
          <div className="grow">
            <b style={{ fontSize: '0.9rem' }}>Radar</b>
            <div className="dim" style={{ fontSize: '0.76rem' }}>Set a weather location and the radar follows it.</div>
          </div>
        </div>
      </div>
    );
  }

  const frame = index?.frames[i];
  const observed = index?.frames.filter((f) => !f.forecast) ?? [];
  const newest = observed.length ? Math.max(...observed.map((f) => f.time)) : 0;
  const span = index ? historySpanMinutes(index.frames) : 0;
  const forecastCount = index?.frames.filter((f) => f.forecast).length ?? 0;
  const panned = !!centre && (centre.lat !== place.lat || centre.lon !== place.lon);

  return (
    <div className="radar-card">
      <div className="radar-head">
        <Icon name="rain" size={15} />
        <b style={{ fontSize: '0.86rem' }}>Live radar</b>
        <span className="dim" style={{ fontSize: '0.72rem' }}>{panned ? 'moved' : place.name}</span>
        <span className="grow" />
        {frame && (
          <span className={`radar-time${frame.forecast ? ' fc' : ''}`}>
            {frameLabel(frame.time)} &middot; {frameAge(frame, newest)}
          </span>
        )}
      </div>

      <div
        className={`radar-view${view ? ' grab' : ''}`}
        style={{ height }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {grid && (
          <div
            className="radar-plane"
            style={{
              width: COLS * TILE,
              height: ROWS * TILE,
              transform: `translate(-50%, -50%) scale(${SCALE}) translate(${grid.offsetX}px, ${grid.offsetY}px)`,
            }}
          >
            {grid.tiles.map((t) => (
              <img
                key={`b${t.col}-${t.row}`}
                className="radar-tile base"
                src={BASEMAP(t.x, t.y, zoom)}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{ left: t.col * TILE, top: t.row * TILE }}
              />
            ))}
            {layer && owmKey &&
              grid.tiles.map((t) => (
                <img
                  key={`o${t.col}-${t.row}`}
                  className="radar-tile owm"
                  src={owmTile(layer, t.x, t.y, zoom, owmKey)}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{ left: t.col * TILE, top: t.row * TILE }}
                />
              ))}
            {index && frame &&
              grid.tiles.map((t) => (
                <img
                  key={`r${t.col}-${t.row}`}
                  className="radar-tile rain"
                  src={radarTile(index.host, frame.path, t.x, t.y, zoom)}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{ left: t.col * TILE, top: t.row * TILE }}
                />
              ))}
          </div>
        )}
        {grid && <span className="radar-pin" aria-hidden="true" />}
        {busy && !index && <div className="radar-msg">Loading radar&hellip;</div>}
        {err && (
          <div className="radar-msg err">
            <Icon name="warn" size={14} /> {err}
          </div>
        )}

        {controls && (
          <div className="radar-zoom">
            <button type="button" onClick={() => setZoom((z) => Math.min(10, z + 1))} disabled={zoom >= 10} aria-label="Zoom in" title="Zoom in">
              <Icon name="plus" size={15} />
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.max(3, z - 1))} disabled={zoom <= 3} aria-label="Zoom out" title="Zoom out">
              <Icon name="down" size={15} />
            </button>
            {panned && (
              <button type="button" onClick={() => setCentre(null)} aria-label="Recentre on my location" title="Recentre">
                <Icon name="target" size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {index && (
        <>
          <div className="radar-foot">
            <button
              type="button"
              className="iconbtn"
              onClick={() => setPlaying((p) => !p)}
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause radar animation' : 'Play radar animation'}
            >
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <input
              className="radar-range"
              type="range"
              min={0}
              max={Math.max(0, index.frames.length - 1)}
              value={i}
              onChange={(e) => {
                setPlaying(false);
                setI(Number(e.target.value));
              }}
              aria-label="Radar frame"
            />
            <button type="button" className="iconbtn" onClick={() => void load()} title="Refresh radar" aria-label="Refresh radar">
              <Icon name="refresh" size={15} />
            </button>
          </div>
          <div className="radar-scale">
            <span>{span ? `\u2212${span} min` : 'past'}</span>
            <span className="grow" />
            <span>now</span>
            {forecastCount > 0 && (
              <>
                <span className="grow" />
                <span className="fc">forecast</span>
              </>
            )}
          </div>
        </>
      )}

      {controls && (
        <div className="radar-layers">
          <button type="button" className={`chip${layer === '' ? ' on' : ''}`} onClick={() => setLayer('')} aria-pressed={layer === ''}>
            Radar only
          </button>
          {OWM_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip${layer === l.id ? ' on' : ''}`}
              disabled={!owmKey}
              title={owmKey ? l.label : 'Needs a free OpenWeather key, added in Settings'}
              aria-pressed={layer === l.id}
              onClick={() => setLayer(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      {controls && !owmKey && (
        <div className="dim" style={{ fontSize: '0.7rem', padding: '0 13px 8px' }}>
          Overlay layers need a free OpenWeather key. Add one under Settings &rarr; Tool keys and these switch on.
        </div>
      )}

      <div className="radar-credit">
        <span>
          Radar RainViewer &middot; map &copy; OpenStreetMap contributors &middot; no key
          {index && span > 0 && ` \u00b7 ${span} min of history is all the free feed publishes`}
        </span>
        <span className="grow" />
        <OpenLink url={`https://www.rainviewer.com/map.html?loc=${view?.lat ?? place.lat},${view?.lon ?? place.lon},${zoom}`} size="sm" variant="quiet">
          Full map
        </OpenLink>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- forecast strip */

/**
 * What is coming. RainViewer nowcast frames are preferred because they are
 * actual radar extrapolation; when the feed has none, this falls back to the
 * Open-Meteo 15-minute forecast for the saved location and says so.
 */
export function RadarForecast() {
  const app = useApp();
  const w = app.weather;
  const hours = w?.hours ?? [];
  const next = hours.filter((h) => h.t >= Date.now() - 3600_000).slice(0, 12);

  if (!next.length) {
    return (
      <div className="card tight">
        <div className="dim" style={{ fontSize: '0.82rem' }}>
          No forecast data yet. It arrives with the next weather refresh.
        </div>
      </div>
    );
  }

  const o = precipOutlook(next, 12);
  const peak = Math.max(0.6, ...next.map((h) => h.mm + h.snowCm * 10));

  return (
    <div className="card tight">
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>Next 12 hours</div>
        <span className="dim" style={{ fontSize: '0.68rem' }}>Open-Meteo point forecast</span>
      </div>
      <p className="dim" style={{ fontSize: '0.75rem', margin: '0 0 11px', lineHeight: 1.5 }}>
        {o.startsInH === null
          ? 'Nothing expected to fall on your location in this window.'
          : `${o.snowCm > 0.05 ? 'Snow' : 'Rain'} expected, peaking at ${o.peakChance}% chance. Totals ${o.mm.toFixed(1)} mm.`}{' '}
        This is a forecast for your exact spot, not a radar image &mdash; the radar above only shows what has already happened.
      </p>
      <div className="fc-strip">
        {next.map((h) => {
          const amount = h.mm + h.snowCm * 10;
          const d = new Date(h.t);
          const hr = d.getHours();
          return (
            <div className="fc-col" key={h.t} title={`${h.chance}% chance, ${h.mm.toFixed(1)} mm`}>
              <div className="fc-bar-wrap">
                <div className="fc-chance" style={{ height: `${Math.max(3, h.chance)}%` }} />
                {amount > 0 && <div className="fc-amt" style={{ height: `${Math.max(6, (amount / peak) * 100)}%` }} />}
              </div>
              <span>{hr % 12 === 0 ? 12 : hr % 12}{hr < 12 ? 'a' : 'p'}</span>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 9, fontSize: '0.66rem', color: 'var(--ink-3)' }}>
        <span className="row" style={{ gap: 5 }}><i className="key-chance" /> chance</span>
        <span className="row" style={{ gap: 5 }}><i className="key-amt" /> amount</span>
      </div>
    </div>
  );
}

/** Radar as its own section: bigger, with zoom and pan controls. */
export function RadarPanel() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <RadarCard zoom={7} height={340} controls />
      <div className="dim" style={{ fontSize: '0.73rem' }}>
        Drag the map to move it. Zoom with the buttons on the map, then recentre with the target icon.
      </div>
    </div>
  );
}
