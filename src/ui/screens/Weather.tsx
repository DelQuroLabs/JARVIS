/**
 * The weather dashboard.
 *
 * Three independent forecasts merged into one reading, plus a rain/snow
 * timeline, government alerts, air quality and radar. Every panel states where
 * its number came from, and when the sources disagree the card says so rather
 * than hiding it behind an average.
 */

import { useState } from 'react';
import { useApp } from '../state.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { Btn, Input, Sheet } from '../components.tsx';
import { haptic } from '../fx.tsx';
import { condition, freshness, temp, tempLabel, windLabel, type SkyIcon } from '../../core/weather.ts';
import {
  SOURCE_LABEL, precipOutlook, type MergedWeather, type PrecipHour,
} from '../../core/wxmerge.ts';

const SKY_ICON: Record<SkyIcon, IconName> = {
  sun: 'sun', moon: 'moon', 'cloud-sun': 'cloud-sun', cloud: 'cloud',
  rain: 'rain', snow: 'snow', storm: 'storm', fog: 'fog',
};

/** Match a source's own words to an icon when it publishes no WMO code. */
function iconFor(w: MergedWeather): IconName {
  if (typeof w.code === 'number') return SKY_ICON[condition(w.code, true).icon];
  const l = (w.label ?? '').toLowerCase();
  if (/thunder|storm/.test(l)) return 'storm';
  if (/snow|sleet/.test(l)) return 'snow';
  if (/rain|shower|drizzle/.test(l)) return 'rain';
  if (/fog|mist|haze/.test(l)) return 'fog';
  if (/partly|fair/.test(l)) return 'cloud-sun';
  if (/cloud|overcast/.test(l)) return 'cloud';
  return 'sun';
}

/** Plain English, with the spread expressed in the unit on screen. */
export function agreementText(w: MergedWeather, units: 'imperial' | 'metric'): string {
  const ok = (w.readings ?? []).filter((r) => r.ok).length;
  if (w.agreement === 'none') return 'No source answered';
  if (w.agreement === 'single') return `${ok} source only \u2014 nothing to cross-check against`;
  const deltaC = w.spreadC;
  const delta = units === 'imperial' ? deltaC * 1.8 : deltaC;
  const shown = delta < 0.5 ? 'under half a degree' : `${delta.toFixed(1)}\u00b0`;
  return w.agreement === 'tight'
    ? `${ok} sources agree, ${shown} apart`
    : `${ok} sources differ by ${shown}`;
}

const AGREEMENT: Record<MergedWeather['agreement'], { text: string; tone: string }> = {
  tight: { text: 'sources agree', tone: 'var(--ok-t)' },
  loose: { text: 'sources disagree', tone: 'var(--warn-t)' },
  single: { text: 'one source', tone: 'var(--ink-3)' },
  none: { text: 'no sources answered', tone: 'var(--danger-t)' },
};

/* ------------------------------------------------------------ location UI */

export function useLocationSheet() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      setOpen(false);
      setQuery('');
      haptic.success();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.');
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  const node = (
    <Sheet open={open} onClose={() => setOpen(false)} title="Where are you?" sub="Used for weather only. It stays on this device.">
      <div style={{ display: 'grid', gap: 12 }}>
        <Btn block icon="target" disabled={busy} onClick={() => void save(() => app.useDeviceLocation())}>
          Use my current location
        </Btn>
        <div className="dim" style={{ fontSize: '0.76rem', textAlign: 'center' }}>or type a city</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) void save(() => app.setWeatherPlace(query));
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Washington" aria-label="City name" />
          <div style={{ marginTop: 10 }}>
            <Btn block variant="primary" icon="search" type="submit" disabled={busy || !query.trim()}>
              {busy ? 'Looking\u2026' : 'Find it'}
            </Btn>
          </div>
        </form>
        {err && (
          <div className="row" style={{ gap: 8, color: 'var(--danger-t)', fontSize: '0.8rem' }}>
            <Icon name="warn" size={15} />
            <span>{err}</span>
          </div>
        )}
      </div>
    </Sheet>
  );

  return { node, openSheet: () => setOpen(true) };
}

/* ------------------------------------------------------------- main card */

export function WeatherCard() {
  const app = useApp();
  const { node: sheet, openSheet } = useLocationSheet();
  const { units, weatherPlace } = app.settings;
  const w = app.weather;

  if (!weatherPlace) {
    return (
      <>
        <div className="wx-card">
          <div className="wx-empty">
            <div className="row" style={{ gap: 11 }}>
              <div className="sky bob"><Icon name="cloud-sun" size={26} /></div>
              <div>
                <div className="wx-cond">Weather, right here</div>
                <div className="wx-place">Pick a place and it lands on your dashboard.</div>
              </div>
            </div>
            <Btn icon="target" onClick={openSheet}>Set a location</Btn>
          </div>
        </div>
        {sheet}
      </>
    );
  }

  if (!w || w.tempC === undefined || !Array.isArray(w.readings)) {
    return (
      <>
        <div className="wx-card">
          <div className="row" style={{ gap: 12 }}>
            <div className="sky bob"><Icon name="cloud-sun" size={26} /></div>
            <div className="grow">
              <div className="wx-cond">{app.weatherBusy ? 'Reading three forecasts\u2026' : 'No reading yet'}</div>
              <div className="wx-place">{app.weatherError ?? placeName(weatherPlace)}</div>
            </div>
            {!app.weatherBusy && (
              <Btn size="sm" icon="refresh" onClick={() => void app.refreshWeather(true)}>Retry</Btn>
            )}
          </div>
        </div>
        {sheet}
      </>
    );
  }

  // Defence in depth: the store now rejects a stale shape, but a lookup like
  // this must never be the thing that takes the whole app down.
  const agree = AGREEMENT[w.agreement] ?? AGREEMENT.none;

  return (
    <>
      <div className="wx-card">
        <div className="wx-top">
          <div className="wx-now grow">
            <div className="sky bob"><Icon name={iconFor(w)} size={30} /></div>
            <div>
              <div className="wx-deg">{tempLabel(w.tempC, units)}</div>
              <div className="wx-cond" style={{ marginTop: 4 }}>{w.label ?? 'Conditions unknown'}</div>
              <div className="wx-place">{placeName(w.place)}</div>
            </div>
          </div>
          <button type="button" className="iconbtn" title="Change location" aria-label="Change location" onClick={openSheet}>
            <Icon name="target" size={17} />
          </button>
        </div>

        <div className="wx-facts">
          {w.feelsC !== undefined && <span>Feels {tempLabel(w.feelsC, units)}</span>}
          {w.humidity !== undefined && <span>{Math.round(w.humidity)}% humidity</span>}
          {w.windKph !== undefined && <span>{windLabel(w.windKph, units)}</span>}
          {w.air?.aqi !== undefined && <span>AQI {w.air.aqi} &middot; {w.air.band}</span>}
        </div>

        {/* the honest bit: how many forecasts, and how far apart they are */}
        <div className="wx-agree" style={{ color: agree.tone }}>
          <Icon name={w.agreement === 'loose' ? 'warn' : 'check'} size={12} />
          <span>{agreementText(w, units)}</span>
        </div>

        <PrecipStrip hours={w.hours} units={units} />

        <div className="wx-foot">
          <Icon name="check" size={12} />
          <span>Updated {freshness(w.fetchedAt, Date.now())}</span>
          <span className="grow" />
          <button
            type="button"
            className="iconbtn"
            style={{ width: 28, height: 28 }}
            title="Refresh now"
            aria-label="Refresh weather"
            onClick={() => void app.refreshWeather(true)}
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>
      {sheet}
    </>
  );
}

/* ------------------------------------------------------- rain/snow strip */

export function PrecipStrip({ hours, units }: { hours: PrecipHour[]; units: 'imperial' | 'metric' }) {
  const next = hours.filter((h) => h.t >= Date.now() - 3600_000).slice(0, 12);
  if (!next.length) return null;
  const o = precipOutlook(next, 12);

  const line = o.startsInH === null
    ? `No rain or snow expected in the next ${next.length} hours`
    : o.snowCm > 0.05
      ? `Snow starting in about ${o.startsInH === 0 ? 'the next hour' : `${o.startsInH} h`}`
      : `Rain starting in about ${o.startsInH === 0 ? 'the next hour' : `${o.startsInH} h`}`;

  return (
    <div className="wx-precip">
      <div className="wx-precip-head">
        <Icon name={o.snowCm > 0.05 ? 'snow' : 'rain'} size={13} />
        <span>{line}</span>
        <span className="grow" />
        <span className="dim">{o.peakChance}% peak</span>
      </div>
      <div className="wx-hours">
        {next.map((h, i) => {
          const amount = h.mm + h.snowCm * 10;
          const d = new Date(h.t);
          const hr = d.getHours();
          return (
            <div className="wx-h" key={h.t}>
              <b>{temp(h.tempC, units)}&deg;</b>
              <div className="wx-stack" title={`${h.chance}% chance, ${h.mm.toFixed(1)} mm`}>
                <div
                  className={`bar${amount > 0 ? ' wet' : ''}`}
                  style={{ height: Math.max(4, (h.chance / 100) * 34), animationDelay: `${i * 40}ms` }}
                />
              </div>
              <span>{hr % 12 === 0 ? 12 : hr % 12}{hr < 12 ? 'a' : 'p'}</span>
            </div>
          );
        })}
      </div>
      <div className="dim" style={{ fontSize: '0.64rem', marginTop: 6 }}>
        Bar height is the chance of precipitation. Filled bars are hours with measurable rain or snow.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- source panel */

export function SourcePanel() {
  const app = useApp();
  const w = app.weather;
  const units = app.settings.units;
  if (!w) return null;
  return (
    <div className="card tight">
      <div className="row between" style={{ marginBottom: 9 }}>
        <div className="section-title" style={{ margin: 0 }}>Sources</div>
        <span className="dim" style={{ fontSize: '0.68rem' }}>all keyless</span>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {(w.readings ?? []).map((r) => (
          <div className="wx-src" key={r.source}>
            <span className={`dot ${r.ok ? 'ok' : 'bad'}`} aria-hidden="true" />
            <b>{SOURCE_LABEL[r.source]}</b>
            <span className="grow" />
            {r.ok ? (
              <>
                <span className="val">{r.tempC !== undefined ? tempLabel(r.tempC, units) : '\u2014'}</span>
                <span className="dim">{r.label ?? ''}</span>
                <span className="dim mono">{r.ms}ms</span>
              </>
            ) : (
              <span className="dim" style={{ textAlign: 'right' }}>{r.error}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- alerts */

export function AlertPanel() {
  const app = useApp();
  const [openId, setOpenId] = useState('');
  const alerts = app.weather?.alerts ?? [];
  if (!alerts.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {alerts.map((a) => (
        <button
          key={a.id}
          type="button"
          className="wx-alert"
          onClick={() => setOpenId(openId === a.id ? '' : a.id)}
          aria-expanded={openId === a.id}
        >
          <div className="row" style={{ gap: 9 }}>
            <Icon name="warn" size={16} />
            <div className="grow" style={{ textAlign: 'left' }}>
              <b>{a.event}</b>
              <div className="dim" style={{ fontSize: '0.74rem' }}>{a.severity} &middot; US National Weather Service</div>
            </div>
            <Icon name={openId === a.id ? 'up' : 'down'} size={15} />
          </div>
          {openId === a.id && (
            <p style={{ fontSize: '0.8rem', lineHeight: 1.55, margin: '10px 0 0', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
              {a.description || a.headline}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function placeName(p: { name: string; admin?: string; country?: string }): string {
  return [p.name, p.admin, p.country].filter(Boolean).join(', ');
}
