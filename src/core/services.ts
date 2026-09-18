// Optional third-party keys that upgrade a *tool* rather than the model.
//
// The rule every entry here obeys: the tool works with no key at all, and works
// better with one. Nothing in this file is required to use the app.
//
// Two services people ask for are deliberately absent:
//   - Brave Search sends no Access-Control-Allow-Origin header, so a browser
//     cannot read its reply no matter how valid the key is (probed 2026-09-04).
//   - NewsAPI blocks browser origins on its free plan for the same reason.
// Both would need a server proxy. Listing them would sell a key the user could
// not actually use from this app.

import type { ServiceId, ServiceSpec } from './types.ts';

export const SERVICES: ServiceSpec[] = [
  {
    id: 'tavily',
    label: 'Tavily Search',
    unlocks: 'Real ranked web results with snippets, instead of instant answers only.',
    withoutKey: 'web_search falls back to DuckDuckGo instant answers plus Wikipedia.',
    keyUrl: 'https://app.tavily.com',
    free: true,
    tools: ['web_search'],
  },
  {
    id: 'github',
    label: 'GitHub',
    unlocks: 'Raises the rate limit from 60 to 5,000 requests an hour and reaches your private repos.',
    withoutKey: 'github_repo works anonymously at 60 requests an hour.',
    keyUrl: 'https://github.com/settings/tokens',
    free: true,
    tools: ['github_repo'],
  },
  {
    id: 'nasa',
    label: 'NASA',
    unlocks: 'Replaces the shared DEMO_KEY, which is rate limited across every anonymous caller on earth.',
    withoutKey: 'nasa_apod uses DEMO_KEY and may be throttled.',
    keyUrl: 'https://api.nasa.gov',
    free: true,
    tools: ['nasa_apod'],
  },
  {
    id: 'openweather',
    label: 'OpenWeather',
    unlocks: 'Adds described conditions and feels-like temperature to the forecast.',
    withoutKey: 'weather uses Open-Meteo, which needs no key at all.',
    keyUrl: 'https://home.openweathermap.org/api_keys',
    free: true,
    tools: ['weather'],
  },
];

export const serviceOf = (id: ServiceId): ServiceSpec | undefined => SERVICES.find((s) => s.id === id);

/** Which optional keys are set, for the honest "N of 4 connected" line in Settings. */
export const connectedServices = (keys: Partial<Record<ServiceId, string>>): ServiceId[] =>
  SERVICES.filter((s) => (keys[s.id] ?? '').trim().length > 4).map((s) => s.id);
