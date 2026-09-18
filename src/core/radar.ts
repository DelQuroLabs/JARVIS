/**
 * Live precipitation radar.
 *
 * RainViewer publishes a free, keyless index of radar frames and serves 256px
 * tiles from a CDN. A dark Carto basemap sits underneath. Both are plain <img>
 * tiles, so this needs no mapping library and adds no dependency.
 *
 * The frame path is an opaque hash that changes every few minutes, so the index
 * must always be read -- a path can never be constructed from a timestamp.
 */

export interface RadarFrame {
  /** Epoch seconds for this scan. */
  time: number;
  /** Opaque path fragment from the index, e.g. /v2/radar/9d13685900cb */
  path: string;
  /** True for forecast frames rather than observed ones. */
  forecast: boolean;
}

export interface RadarIndex {
  host: string;
  frames: RadarFrame[];
}

export interface TileXY {
  x: number;
  y: number;
}

/* ------------------------------------------------------------- tile maths */

/** Web-Mercator tile coordinates. Fractional, so callers can centre precisely. */
export function tileFor(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** Inverse of tileFor. Exact, so a pan can round-trip without drifting. */
export function latLonFor(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const n = 2 ** zoom;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/**
 * Shift a centre by a pixel drag at a given zoom. Dragging the map right moves
 * the viewport left, so the pixel delta is subtracted.
 */
export function panBy(
  lat: number, lon: number, zoom: number, dxPx: number, dyPx: number,
): { lat: number; lon: number } {
  const c = tileFor(lat, lon, zoom);
  const next = latLonFor(c.x - dxPx / 256, c.y - dyPx / 256, zoom);
  return {
    lat: Math.max(-85, Math.min(85, next.lat)),
    // Wrap rather than clamp: crossing the date line is legitimate.
    lon: ((((next.lon + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * The grid of tiles needed to cover a viewport, plus the pixel offset that puts
 * the requested point at the centre. Tiles are wrapped horizontally and clamped
 * vertically, so a location near a pole or the date line still renders.
 */
export function tileGrid(
  lat: number,
  lon: number,
  zoom: number,
  cols: number,
  rows: number,
): { tiles: { x: number; y: number; col: number; row: number }[]; offsetX: number; offsetY: number } {
  const n = 2 ** zoom;
  const c = tileFor(lat, lon, zoom);
  const centreCol = (cols - 1) / 2;
  const centreRow = (rows - 1) / 2;
  const baseX = Math.floor(c.x);
  const baseY = Math.floor(c.y);
  const tiles: { x: number; y: number; col: number; row: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tx = baseX + col - Math.floor(centreCol);
      const ty = baseY + row - Math.floor(centreRow);
      if (ty < 0 || ty >= n) continue; // above the pole: nothing to draw
      tiles.push({ x: ((tx % n) + n) % n, y: ty, col, row });
    }
  }
  // Shift so the exact point lands in the middle rather than the tile corner.
  const offsetX = -(c.x - baseX - 0.5) * 256;
  const offsetY = -(c.y - baseY - 0.5) * 256;
  return { tiles, offsetX, offsetY };
}

/* ---------------------------------------------------------------- sources */

/**
 * OpenStreetMap standard tiles. Carto's dark basemap was the nicer fit visually
 * but it stamps "API KEY REQUIRED" across unkeyed tiles, so it is unusable on a
 * no-account build. OSM is darkened with a CSS filter instead.
 */
export const BASEMAP = (x: number, y: number, z: number): string =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/**
 * A radar tile. `colour` 2 is the universal blue-green-red scheme; smooth on
 * and snow off keeps it legible at small sizes.
 */
export const radarTile = (host: string, path: string, x: number, y: number, z: number, colour = 2): string =>
  `${host}${path}/256/${z}/${x}/${y}/${colour}/1_1.png`;

/* ----------------------------------------------------------- map layers */

/**
 * Optional OpenWeatherMap overlays, in the spirit of their commercial dashboard
 * but on the free tier. Their hosted dashboard is a paid B2B product; these
 * raster layers are the part a free account can actually use.
 *
 * Each needs the user's own OpenWeather key, which the app already carries as
 * an optional service key. Without one the picker says so rather than showing
 * a layer that silently renders nothing.
 */
export const OWM_LAYERS = [
  { id: 'precipitation_new', label: 'Precipitation' },
  { id: 'temp_new', label: 'Temperature' },
  { id: 'wind_new', label: 'Wind' },
  { id: 'clouds_new', label: 'Cloud cover' },
  { id: 'pressure_new', label: 'Pressure' },
] as const;

export type OwmLayerId = (typeof OWM_LAYERS)[number]['id'];

export const owmTile = (layer: string, x: number, y: number, z: number, key: string): string =>
  `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${encodeURIComponent(key)}`;

/* ------------------------------------------------------------------ index */

type Fetcher = (url: string) => Promise<unknown>;

interface RvResponse {
  host?: string;
  radar?: {
    past?: { time: number; path: string }[];
    nowcast?: { time: number; path: string }[];
  };
}

/** Read the current frame list. Throws a readable error rather than returning junk. */
export async function fetchRadarIndex(fetchJson: Fetcher): Promise<RadarIndex> {
  const r = (await fetchJson('https://api.rainviewer.com/public/weather-maps.json')) as RvResponse;
  const past = (r.radar?.past ?? []).map((f) => ({ time: f.time, path: f.path, forecast: false }));
  const nowcast = (r.radar?.nowcast ?? []).map((f) => ({ time: f.time, path: f.path, forecast: true }));
  const frames = [...past, ...nowcast].filter((f) => f.path && Number.isFinite(f.time));
  if (!frames.length) throw new Error('The radar service returned no frames.');
  return { host: r.host || 'https://tilecache.rainviewer.com', frames };
}

/** "3:45 PM" in the viewer's own timezone. */
export function frameLabel(time: number): string {
  return new Date(time * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The observed window the feed actually provides, in minutes. */
export function historySpanMinutes(frames: RadarFrame[]): number {
  const past = frames.filter((f) => !f.forecast);
  if (past.length < 2) return 0;
  return Math.round((past[past.length - 1].time - past[0].time) / 60);
}

/** How far back a frame is, relative to the newest observed one. */
export function frameAge(frame: RadarFrame, newest: number): string {
  if (frame.forecast) return `+${Math.round((frame.time - newest) / 60)} min`;
  const mins = Math.round((newest - frame.time) / 60);
  return mins === 0 ? 'now' : `-${mins} min`;
}
