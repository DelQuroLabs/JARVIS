/**
 * Dashboard weather.
 *
 * Open-Meteo is keyless, CORS-clean and free, so this needs no account and no
 * spend. Readings are always fetched in metric and converted on the client, so
 * flipping the units toggle is instant and never triggers another request.
 *
 * Nothing here imports React or touches the store -- it is pure enough to test
 * in plain Node.
 */

export type Units = 'imperial' | 'metric';

export interface WeatherPlace {
  name: string;
  admin?: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface WeatherHour {
  /** Hour of day in the place's local time, 0-23. */
  hour: number;
  tempC: number;
}

export interface WeatherSnapshot {
  place: WeatherPlace;
  tempC: number;
  feelsC: number;
  humidity: number;
  windKph: number;
  code: number;
  isDay: boolean;
  highC: number;
  lowC: number;
  precipChance: number;
  hourly: WeatherHour[];
  /** Epoch ms this reading was retrieved. Used to label staleness honestly. */
  fetchedAt: number;
}

/* ------------------------------------------------------------------ units */

export const cToF = (c: number): number => c * 1.8 + 32;
export const kphToMph = (k: number): number => k * 0.621371;

/** A temperature for display, already rounded, with no degree symbol. */
export function temp(c: number, units: Units): number {
  return Math.round(units === 'imperial' ? cToF(c) : c);
}

export function tempLabel(c: number, units: Units): string {
  return `${temp(c, units)}\u00b0`;
}

export function windLabel(kph: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(kphToMph(kph))} mph` : `${Math.round(kph)} km/h`;
}

/* ------------------------------------------------------------- conditions */

export type SkyIcon = 'sun' | 'moon' | 'cloud-sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

interface Condition {
  label: string;
  icon: SkyIcon;
}

/**
 * WMO weather codes as published by Open-Meteo. Anything unmapped falls back to
 * a plain-English shrug rather than inventing a condition.
 */
const CODES: Record<number, Condition> = {
  0: { label: 'Clear', icon: 'sun' },
  1: { label: 'Mostly clear', icon: 'sun' },
  2: { label: 'Partly cloudy', icon: 'cloud-sun' },
  3: { label: 'Overcast', icon: 'cloud' },
  45: { label: 'Fog', icon: 'fog' },
  48: { label: 'Freezing fog', icon: 'fog' },
  51: { label: 'Light drizzle', icon: 'rain' },
  53: { label: 'Drizzle', icon: 'rain' },
  55: { label: 'Heavy drizzle', icon: 'rain' },
  56: { label: 'Freezing drizzle', icon: 'rain' },
  57: { label: 'Freezing drizzle', icon: 'rain' },
  61: { label: 'Light rain', icon: 'rain' },
  63: { label: 'Rain', icon: 'rain' },
  65: { label: 'Heavy rain', icon: 'rain' },
  66: { label: 'Freezing rain', icon: 'rain' },
  67: { label: 'Freezing rain', icon: 'rain' },
  71: { label: 'Light snow', icon: 'snow' },
  73: { label: 'Snow', icon: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow' },
  77: { label: 'Snow grains', icon: 'snow' },
  80: { label: 'Showers', icon: 'rain' },
  81: { label: 'Showers', icon: 'rain' },
  82: { label: 'Violent showers', icon: 'rain' },
  85: { label: 'Snow showers', icon: 'snow' },
  86: { label: 'Snow showers', icon: 'snow' },
  95: { label: 'Thunderstorms', icon: 'storm' },
  96: { label: 'Thunderstorms with hail', icon: 'storm' },
  99: { label: 'Thunderstorms with hail', icon: 'storm' },
};

export function condition(code: number, isDay = true): Condition {
  const c = CODES[code];
  if (!c) return { label: `Weather code ${code}`, icon: 'cloud' };
  // At night a clear sky is a moon, not a sun. Everything else reads the same.
  if (!isDay && c.icon === 'sun') return { label: c.label, icon: 'moon' };
  return c;
}

/* --------------------------------------------------------------- staleness */

/** How old a reading is, in words. Never dresses a stale number up as live. */
export function freshness(fetchedAt: number, now: number): string {
  const ms = Math.max(0, now - fetchedAt);
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min === 1) return '1 min ago';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h === 1) return '1 hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** A reading older than this is shown, but explicitly labelled as stale. */
export const STALE_AFTER_MS = 90 * 60 * 1000;
/** How often the dashboard refetches while the tab is visible. */
export const REFRESH_EVERY_MS = 10 * 60 * 1000;

export const isWeatherStale = (s: WeatherSnapshot, now: number): boolean => now - s.fetchedAt > STALE_AFTER_MS;
/** Named for the domain: routines.ts already exports an isDue. */
export const isRefreshDue = (s: { fetchedAt: number } | null, now: number): boolean =>
  !s || now - s.fetchedAt >= REFRESH_EVERY_MS;

/* ------------------------------------------------------------------ fetch */

type Fetcher = (url: string) => Promise<unknown>;

interface GeoRow {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country_code?: string;
}

/** Turn a typed place name into coordinates. Throws with a readable message. */
export async function geocode(query: string, fetchJson: Fetcher): Promise<WeatherPlace> {
  const q = query.trim();
  if (!q) throw new Error('Type a city name first.');
  const r = (await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
  )) as { results?: GeoRow[] };
  const hit = r.results?.[0];
  if (!hit) throw new Error(`No place called "${q}" was found.`);
  return {
    name: hit.name,
    admin: hit.admin1,
    country: hit.country_code,
    lat: hit.latitude,
    lon: hit.longitude,
  };
}

interface ForecastResponse {
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
    is_day: number;
  };
  daily?: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
  hourly?: { time: string[]; temperature_2m: number[] };
}

/** One reading for a known place. Always metric on the wire. */
export async function fetchWeather(
  place: WeatherPlace,
  fetchJson: Fetcher,
  now: number = Date.now(),
): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=temperature_2m&forecast_days=2&timezone=auto`;
  const r = (await fetchJson(url)) as ForecastResponse;
  const c = r.current;
  if (!c || typeof c.temperature_2m !== 'number') {
    throw new Error('The weather service returned no current conditions.');
  }
  return {
    place,
    tempC: c.temperature_2m,
    feelsC: c.apparent_temperature ?? c.temperature_2m,
    humidity: c.relative_humidity_2m ?? 0,
    windKph: c.wind_speed_10m ?? 0,
    code: c.weather_code ?? 0,
    isDay: c.is_day !== 0,
    highC: r.daily?.temperature_2m_max?.[0] ?? c.temperature_2m,
    lowC: r.daily?.temperature_2m_min?.[0] ?? c.temperature_2m,
    precipChance: r.daily?.precipitation_probability_max?.[0] ?? 0,
    hourly: pickHours(r.hourly, now),
    fetchedAt: now,
  };
}

/**
 * The next seven readings at two-hour steps, starting from the current hour.
 * Open-Meteo returns local wall-clock strings, so the hour is parsed from the
 * string rather than from a Date, which would re-apply the browser's offset.
 */
export function pickHours(hourly: ForecastResponse['hourly'], now: number): WeatherHour[] {
  if (!hourly?.time?.length) return [];
  const nowHour = new Date(now).getHours();
  let start = hourly.time.findIndex((t) => Number(t.slice(11, 13)) === nowHour);
  if (start < 0) start = 0;
  const out: WeatherHour[] = [];
  for (let i = start; i < hourly.time.length && out.length < 7; i += 2) {
    const tempC = hourly.temperature_2m?.[i];
    if (typeof tempC !== 'number') continue;
    out.push({ hour: Number(hourly.time[i].slice(11, 13)), tempC });
  }
  return out;
}

/** "3p", "12p", "9a" -- compact enough for a phone column. */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'a' : 'p'}`;
}
