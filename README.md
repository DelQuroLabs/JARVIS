# JARVIS

An agent workspace that runs in your browser. It plans, calls tools, runs code in a
sandbox, remembers what you tell it, and shows you exactly what it did — including
when the answer came from the offline core rather than a model.

Installable as a PWA, mobile-first, works with no account and no API key.

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify     # typecheck + unit tests + build + honesty gate
npm run test:e2e   # 47 browser checks (needs a preview server on :4173)
npm run test:iframe # 8 checks inside a sandboxed, opaque-origin iframe
npm run test:contrast # WCAG AA for every text node, in both themes
npm run test:audit  # walks 21 routes at two widths and clicks every control
```

## What it actually does

| Capability | Status |
|---|---|
| Chat with tool use | Yes — 49 tools, results shown per call |
| Slash commands | Yes — 8 built-ins that run on device with no model call |
| Model providers | 24 selectable (26 including the keyless endpoint and the offline core), of which 9 are free tiers. Every endpoint CORS-probed from a browser — see `docs/providers.md` |
| Ranked fallback | Yes — active provider, then your ordered chain, then keyless, then the offline core |
| Optional tool keys | 4 (Tavily, GitHub, NASA, OpenWeather). Each upgrades a tool that already works without it |
| Command palette | Yes — ⌘K / Ctrl+K, or `/` outside a text field |
| Per-answer receipts | Yes — time, mode, steps, tools and tokens under every reply |
| Agent loop with step and tool budgets | Yes — budgets are enforced, not suggested |
| Agent mode by default | Yes — new installs open in Agent: 8 steps, 14 tool calls, every tool group unlocked. Nine modes in all; switch per conversation from the composer |
| Dashboard as the launcher | Yes — every destination is a button on the dashboard, in one modular grid |
| Rearrangeable tiles | Yes — tap Rearrange, then drag any tile onto another to move it. Tiles can be hidden and restored, and the layout persists per device. A tile added in a later release is appended to a saved layout rather than dropped |
| Expanding sidebar | Yes — the desktop rail is a 72px icon strip that widens to 226px on hover or keyboard focus. It overlays rather than pushes, so the page never reflows |
| Weather, three sources merged | Yes — Open-Meteo, MET Norway and the US NWS fetched in parallel and merged by median. Every source is listed with its own reading and latency, and when they disagree the card says by how much instead of hiding it in an average. Keyless. Defaults to Washington DC, imperial with a metric toggle, refreshes every 10 min while the tab is visible |
| Rain and snow timeline | Yes — 12 hours of precipitation chance and amount, with rain and snow distinguished |
| Severe weather alerts | Yes — live US National Weather Service watches and warnings, expandable to the full text |
| Air quality | Yes — US AQI with its EPA band |
| Spoken briefing | Yes — weather, alerts, due routines and system state, read aloud by the browser's own speech engine. No key, no model. Shown as text when the browser has no speech engine |
| Live precipitation radar | Yes — RainViewer frames over an OpenStreetMap basemap, keyless. Drag to move, zoom 3–10, recentre, scrub and play. The timeline states how far back it reaches: the free feed publishes two hours and no more |
| Precipitation forecast | Yes — a 12-hour chance-and-amount strip from Open-Meteo, labelled as a point forecast for your location rather than radar imagery |
| Memory import | Yes — paste a block or load a file: JSON (including chat exports), Markdown, CSV, plain text. Candidates are reviewed and de-duplicated before anything is saved. PDF is refused with the reason rather than returning garbage |
| Weather map layers | Optional — precipitation, temperature, wind, cloud and pressure overlays from OpenWeather, using your own free key. Without a key the layers are disabled and say why |
| Calendar import | Yes — .ics files from Google, Apple, Outlook or Fastmail. Handles all-day dates, zoned times with real daylight-saving offsets, and DAILY/WEEKLY/MONTHLY/YEARLY repeats. Events feed the dashboard and the spoken briefing |
| Calendar URL subscription | **No, and it cannot be done from a browser.** Google and Apple serve their feeds without cross-origin headers; both were tested and both fail with `Failed to fetch`. There is no URL box, because it could never work |
| Per-screen explainers | Yes — every route carries a "What is this screen?" strip: what it is, when to use it, and what it will not do. A gate fails the build if a route ships without one |
| Project library | Yes — one card per project: tagline, status, tags, about, full rebuild spec, launch links, screenshots and attachments. Attachments live in browser storage against a visible size budget |
| Help section | Yes — a six-chapter tour whose every number is counted from the live registries at render time, so it cannot drift as features are added |
| Web search | Partial, and labelled as such. `ddg_answer` returns DuckDuckGo Instant Answers (topics, definitions, calculations). There is no in-app browser: DuckDuckGo and most sites send `x-frame-options`, which forbids embedding |
| Sandboxed code execution | Yes — a Blob Worker with no `fetch` and a hard timeout |
| Visual workflows | Yes — 38 node kinds, cycle detection, per-node status |
| Multi-role crew reviews | Yes — 16 roles, 5 presets, sequential shared transcript |
| Saved skills (`/trigger`) | Yes — deterministic tool chains, no model call |
| Routines | Checked every 30s while the app is open — no background scheduler exists on the web |
| Memory | Yes — local, searchable, pinnable |
| Cloud sync | Optional — your own Supabase project, RLS enforced |
| Works offline | Yes — service worker shell plus the offline reflex core |
| Wake word / always listening | **No.** A web page cannot listen in the background |
| Controlling your OS or other apps | **No.** Browser sandbox |

The app never claims a capability it does not have. Where something cannot run, it
reports **blocked** with the reason — a blocked check is never upgraded to a pass.

## Architecture

```
src/core/     framework-free domain logic (no React) — unit-tested in plain Node
src/ui/       React 18 + a zero-dependency hash router
supabase/     schema, RLS policies, verification queries
scripts/      test.mjs (unit), e2e.mjs (browser), verify.mjs (honesty gate)
```

`src/core` imports no framework code, which is what makes the 130 unit tests possible
without a DOM. Hash routing means the app deploys to any static host with no rewrite
rules.

**Two traps, both guarded by tests:**

1. `tools.ts` must never import `store.ts`. That cycle (`tools → store → workflow`
   reading `TOOL_MAP` at module scope) blanks the entire app at boot. The shell calls
   `primeToolOptions(toolNames())` at init instead. `scripts/verify.mjs` fails the
   build if the import reappears.
2. Tap targets. Headless Chromium reports `pointer: fine` at every width, so the 44px
   floor keys off `@media (max-width: 820px)`, never `(hover: none)`.

## Models

Bring your own free key in Settings — Groq or Gemini both have free tiers. There is
also a keyless fallback endpoint, which is heavily rate-limited and single-turn, and
below that the **reflex core**: 27 intent rules, memory recall, and extractive
summarisation that run with zero network calls. Reflex answers are always labelled as
such and never pretend to be a model.

Cost ceiling is $0/month by design. Nothing in the app requires a paid plan.

## Privacy

Everything is stored in your browser's localStorage. Three levels:

- **Strict** — no network tool may run at all.
- **Guarded** (default) — network tools allowed, credentials and secrets redacted
  before anything leaves the device.
- **Open** — credentials are *still* redacted. That is not configurable.

18 credential and PII patterns are scanned on every outbound message. Your API key is
stored locally, is never bundled, and is excluded from exports — `scripts/verify.mjs`
greps the built assets for key shapes and fails the build if one appears.

## Cloud sync (optional)

The app is fully functional with no backend. To sync across devices, create your own
free Supabase project and paste the URL and **anon** key into Settings → Cloud. The
app refuses a service-role key outright.

Run `supabase/schema.sql` in the SQL editor, then `supabase/verify.sql` to confirm
RLS is active on all eight tables. Sync is last-write-wins on `updated_at`.

## Rebuilding this from scratch

`docs/REBUILD-HANDOFF.md` is a complete behavioural and architectural spec for
another agent: registries and exact counts, the provider and tool contracts,
every external service verified to work from a browser (and the ones that
provably cannot), the persistence rules, and 16 browser traps this codebase hit
in production. It deliberately leaves all UI design and layout to the rebuilder.

## Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | clean, strict mode |
| `npm test` | 411 / 411 |
| `npm run test:e2e` | 57 / 57 — all 25 routes at 390px and 1440px |
| `npm run test:iframe` | 8 / 8 — boots in a `sandbox="allow-scripts"` iframe |
| `npm run test:contrast` | clean — every text node meets AA in dark and light |
| `npm run test:audit` | 0 findings — 25 routes x 2 widths, every control clicked |
| `npm run test:functional` | 72 / 72 — behaviour, not rendering: data round trips, real tool calls, honest failures |
| `node scripts/verify.mjs` | 13 / 13 |
| `npm run test:deploy` | 5 / 5 — publishes a new build under an open tab and proves it self-heals |
| In-app Diagnostics | 19 checks against the live build |

The e2e sweep fails on any console error, any blank render, any horizontal overflow
on a phone, and any tap target under 44px. The iframe check exists because an opaque
origin throws a SecurityError on `navigator.serviceWorker` and silently refuses
popups — two bugs a top-level page load cannot see. The in-app Diagnostics screen runs the
same class of checks against whatever build the user is actually holding.

## Not done

- The Supabase SQL has been written and reviewed but never executed against a live
  project. It is unverified until someone runs it.
- Nothing is deployed anywhere.
