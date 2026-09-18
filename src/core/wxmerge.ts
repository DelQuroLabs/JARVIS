/**
 * Multi-source weather.
 *
 * Three independent, keyless forecasts are fetched in parallel and merged into
 * one picture:
 *
 *   - Open-Meteo    global, ECMWF/GFS blend
 *   - MET Norway    global, the Norwegian met institute
 *   - NWS           United States only, the official government forecast
 *
 * The merge is deliberately conservative. It reports the median rather than the
 * mean so one bad source cannot drag the number, and it always publishes the
 * spread between sources. When forecasts disagree the UI says so instead of
 * projecting false confidence -- a single averaged number hides exactly the
 * information you want on a marginal day.
 *
 * Every source is optional. A failure is recorded against that source and the
 * merge continues with whatever answered.
 */

import { condition, type WeatherPlace } from './weather.ts';

export type SourceId = 'open-meteo' | 'met.no' | 'nws';

export const SOURCE_LABEL: Record<SourceId, string> = {
  'open-meteo': 'Open-Meteo',
  'met.no': 'MET Norway',
  nws: 'US NWS',
};

export interface SourceReading {
  source: SourceId;
  ok: boolean;
  /** Why it failed, in plain English. Empty when ok. */
  error: string;
  tempC?: number;
  feelsC?: number;
  humidity?: number;
  windKph?: number;
  /** WMO code where the source publishes one. */
  code?: number;
  /** The source's own words for the sky. */
  label?: string;
  /** 0-100. */
  precipChance?: number;
  ms: number;
}

export interface PrecipHour {
  /** Epoch ms at the start of the hour. */
  t: number;
  /** Millimetres of liquid in that hour. */
  mm: number;
  /** Centimetres of snow in that hour. */
  snowCm: number;
  /** 0-100 chance of any precipitation. */
  chance: number;
  tempC: number;
}

export interface WxAlert {
  id: string;
  event: string;
  severity: string;
  headline: string;
  description: string;
  ends?: string;
}

export interface AirQuality {
  aqi?: number;
  pm25?: number;
  /** EPA category for the AQI value. */
  band: string;
}

export interface MergedWeather {
  place: WeatherPlace;
  fetchedAt: number;
  readings: SourceReading[];
  /** Median across the sources that answered. Undefined when none did. */
  tempC?: number;
  feelsC?: number;
  humidity?: number;
  windKph?: number;
  code?: number;
  label?: string;
  precipChance?: number;
  /** Largest gap between any two source temperatures, in Celsius. */
  spreadC: number;
  /** How well the sources agree, for display. */
  agreement: 'single' | 'tight' | 'loose' | 'none';
  hours: PrecipHour[];
  alerts: WxAlert[];
  air?: AirQuality;
}

/* ------------------------------------------------------------------ maths */

export function median(values: number[]): number | undefined {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function spread(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return 0;
  return Math.max(...v) - Math.min(...v);
}

/** Sources within 1.5C are "tight"; beyond that the UI shows the disagreement. */
export function agreementOf(count: number, spreadC: number): MergedWeather['agreement'] {
  if (count === 0) return 'none';
  if (count === 1) return 'single';
  return spreadC <= 1.5 ? 'tight' : 'loose';
}

/** The label most sources agree on, falling back to the first available. */
export function consensusLabel(readings: SourceReading[]): string | undefined {
  const labels = readings.filter((r) => r.ok && r.label).map((r) => r.label as string);
  if (!labels.length) return undefined;
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** US EPA bands. Anything above 300 is "hazardous". */
export function aqiBand(aqi: number): string {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy for sensitive groups';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very unhealthy';
  return 'hazardous';
}

/** Total liquid and snow over the next N hours, for the "is it going to rain" line. */
export function precipOutlook(hours: PrecipHour[], within = 12): {
  mm: number; snowCm: number; peakChance: number; startsInH: number | null;
} {
  const slice = hours.slice(0, within);
  let mm = 0;
  let snowCm = 0;
  let peakChance = 0;
  let startsInH: number | null = null;
  slice.forEach((h, i) => {
    mm += h.mm;
    snowCm += h.snowCm;
    peakChance = Math.max(peakChance, h.chance);
    if (startsInH === null && (h.mm > 0.1 || h.snowCm > 0.05)) startsInH = i;
  });
  return { mm, snowCm, peakChance, startsInH };
}

/* ----------------------------------------------------------------- fetch */

type Fetcher = (url: string) => Promise<unknown>;

const timed = async <T>(fn: () => Promise<T>): Promise<{ v?: T; err?: string; ms: number }> => {
  const t0 = Date.now();
  try {
    return { v: await fn(), ms: Date.now() - t0 };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
};

interface OmResponse {
  current?: {
    temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number;
    wind_speed_10m: number; weather_code: number; is_day: number;
  };
  hourly?: {
    time: string[]; temperature_2m: number[]; precipitation: number[];
    snowfall: number[]; precipitation_probability: number[];
  };
}

export async function fetchOpenMeteo(place: WeatherPlace, f: Fetcher): Promise<{ reading: SourceReading; hours: PrecipHour[] }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&hourly=temperature_2m,precipitation,snowfall,precipitation_probability&forecast_days=2&timezone=auto`;
  const r = await timed(() => f(url) as Promise<OmResponse>);
  if (!r.v?.current) {
    return {
      reading: { source: 'open-meteo', ok: false, error: r.err ?? 'no current conditions returned', ms: r.ms },
      hours: [],
    };
  }
  const c = r.v.current;
  const h = r.v.hourly;
  const hours: PrecipHour[] = [];
  if (h?.time) {
    for (let i = 0; i < h.time.length && hours.length < 48; i++) {
      hours.push({
        t: new Date(h.time[i]).getTime(),
        mm: h.precipitation?.[i] ?? 0,
        snowCm: h.snowfall?.[i] ?? 0,
        chance: h.precipitation_probability?.[i] ?? 0,
        tempC: h.temperature_2m?.[i] ?? c.temperature_2m,
      });
    }
  }
  return {
    reading: {
      source: 'open-meteo', ok: true, error: '', ms: r.ms,
      tempC: c.temperature_2m,
      feelsC: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windKph: c.wind_speed_10m,
      code: c.weather_code,
      label: condition(c.weather_code, c.is_day !== 0).label,
    },
    hours,
  };
}

interface MetResponse {
  properties?: {
    timeseries?: {
      time: string;
      data: {
        instant?: { details?: { air_temperature?: number; relative_humidity?: number; wind_speed?: number } };
        next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
      };
    }[];
  };
}

/** met.no symbol codes are like "partlycloudy_day"; make them readable. */
export function metLabel(symbol: string | undefined): string | undefined {
  if (!symbol) return undefined;
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  const words: Record<string, string> = {
    clearsky: 'Clear', fair: 'Fair', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy',
    fog: 'Fog', rain: 'Rain', lightrain: 'Light rain', heavyrain: 'Heavy rain',
    rainshowers: 'Rain showers', lightrainshowers: 'Light showers', heavyrainshowers: 'Heavy showers',
    snow: 'Snow', lightsnow: 'Light snow', heavysnow: 'Heavy snow', sleet: 'Sleet',
    snowshowers: 'Snow showers', thunderstorm: 'Thunderstorms',
  };
  return words[base] ?? base.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export async function fetchMetNo(place: WeatherPlace, f: Fetcher): Promise<SourceReading> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}`;
  const r = await timed(() => f(url) as Promise<MetResponse>);
  const first = r.v?.properties?.timeseries?.[0];
  const d = first?.data?.instant?.details;
  if (!d || typeof d.air_temperature !== 'number') {
    return { source: 'met.no', ok: false, error: r.err ?? 'no forecast returned', ms: r.ms };
  }
  return {
    source: 'met.no', ok: true, error: '', ms: r.ms,
    tempC: d.air_temperature,
    humidity: d.relative_humidity,
    // met.no publishes metres per second.
    windKph: typeof d.wind_speed === 'number' ? d.wind_speed * 3.6 : undefined,
    label: metLabel(first?.data?.next_1_hours?.summary?.symbol_code),
  };
}

interface NwsPoints { properties?: { forecastHourly?: string } }
interface NwsHourly {
  properties?: {
    periods?: {
      temperature: number; temperatureUnit: string; shortForecast: string;
      probabilityOfPrecipitation?: { value: number | null };
      relativeHumidity?: { value: number | null };
      windSpeed?: string;
    }[];
  };
}

/** US only. Outside the United States /points returns 404, which is not an error worth shouting about. */
export async function fetchNws(place: WeatherPlace, f: Fetcher): Promise<SourceReading> {
  const pts = await timed(() => f(`https://api.weather.gov/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`) as Promise<NwsPoints>);
  const hourlyUrl = pts.v?.properties?.forecastHourly;
  if (!hourlyUrl) {
    const outside = /404/.test(pts.err ?? '');
    return {
      source: 'nws', ok: false, ms: pts.ms,
      error: outside ? 'covers the United States only' : (pts.err ?? 'no grid for this location'),
    };
  }
  const hr = await timed(() => f(hourlyUrl) as Promise<NwsHourly>);
  const p = hr.v?.properties?.periods?.[0];
  if (!p) return { source: 'nws', ok: false, error: hr.err ?? 'no hourly forecast returned', ms: pts.ms + hr.ms };
  const tempC = p.temperatureUnit === 'F' ? (p.temperature - 32) / 1.8 : p.temperature;
  const mph = Number((p.windSpeed ?? '').match(/\d+/)?.[0]);
  return {
    source: 'nws', ok: true, error: '', ms: pts.ms + hr.ms,
    tempC,
    humidity: p.relativeHumidity?.value ?? undefined,
    windKph: Number.isFinite(mph) ? mph * 1.609344 : undefined,
    label: p.shortForecast,
    precipChance: p.probabilityOfPrecipitation?.value ?? undefined,
  };
}

interface NwsAlerts {
  features?: { id: string; properties: { event: string; severity: string; headline: string; description: string; ends?: string } }[];
}

export async function fetchAlerts(place: WeatherPlace, f: Fetcher): Promise<WxAlert[]> {
  const r = await timed(() => f(`https://api.weather.gov/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`) as Promise<NwsAlerts>);
  return (r.v?.features ?? []).slice(0, 5).map((x) => ({
    id: x.id,
    event: x.properties.event,
    severity: x.properties.severity,
    headline: x.properties.headline,
    description: (x.properties.description ?? '').slice(0, 600),
    ends: x.properties.ends,
  }));
}

interface AqResponse { current?: { us_aqi?: number; pm2_5?: number } }

export async function fetchAir(place: WeatherPlace, f: Fetcher): Promise<AirQuality | undefined> {
  const r = await timed(
    () => f(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&current=us_aqi,pm2_5`) as Promise<AqResponse>,
  );
  const c = r.v?.current;
  if (!c || typeof c.us_aqi !== 'number') return undefined;
  return { aqi: c.us_aqi, pm25: c.pm2_5, band: aqiBand(c.us_aqi) };
}

/* ----------------------------------------------------------------- merge */

/** Combine whatever answered into one picture. Never throws. */
export function merge(
  place: WeatherPlace,
  readings: SourceReading[],
  hours: PrecipHour[],
  alerts: WxAlert[],
  air: AirQuality | undefined,
  now: number,
): MergedWeather {
  const ok = readings.filter((r) => r.ok);
  const temps = ok.map((r) => r.tempC).filter((n): n is number => Number.isFinite(n));
  const s = spread(temps);
  return {
    place,
    fetchedAt: now,
    readings,
    tempC: median(temps),
    feelsC: median(ok.map((r) => r.feelsC).filter((n): n is number => Number.isFinite(n))),
    humidity: median(ok.map((r) => r.humidity).filter((n): n is number => Number.isFinite(n))),
    windKph: median(ok.map((r) => r.windKph).filter((n): n is number => Number.isFinite(n))),
    code: ok.find((r) => typeof r.code === 'number')?.code,
    label: consensusLabel(readings),
    precipChance: median(ok.map((r) => r.precipChance).filter((n): n is number => Number.isFinite(n))),
    spreadC: s,
    agreement: agreementOf(temps.length, s),
    hours,
    alerts,
    air,
  };
}

/** Fetch every source in parallel and merge. Slow sources cannot block the rest. */
export async function fetchAllWeather(place: WeatherPlace, f: Fetcher, now: number = Date.now()): Promise<MergedWeather> {
  const [om, met, nws, alerts, air] = await Promise.all([
    fetchOpenMeteo(place, f),
    fetchMetNo(place, f),
    fetchNws(place, f),
    fetchAlerts(place, f).catch(() => [] as WxAlert[]),
    fetchAir(place, f).catch(() => undefined),
  ]);
  return merge(place, [om.reading, met, nws], om.hours, alerts, air, now);
}
