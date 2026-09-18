# JARVIS — Rebuild Handoff

**For:** an AI agent rebuilding this application from scratch.
**Date:** 2026-09-05
**Scope of this document:** everything except the visual design.

---

## 0. How to read this, and what is deliberately absent

This is a **behavioural and architectural** specification. It tells you what the
app does, what it refuses to do, which external services actually work from a
browser, and the specific ways this codebase has broken so you do not repay the
tuition.

**The UI design and layout are explicitly yours.** Screen composition, visual
language, colour, typography, motion, navigation shape, component styling — all
of it is your call. Where this document mentions a screen it is describing the
*capability that must exist somewhere*, not a layout you must copy. Where it
mentions a CSS-level bug, that is a browser behaviour you will hit regardless of
how you style things.

Two things are **not** negotiable, because the whole product rests on them:

1. **Never claim a capability the app does not have.** This is the governing
   rule. It is worth more than any feature below.
2. **State the limit.** Every feature that has an edge says where the edge is,
   in the interface, in plain language.

---

## 1. What the product is

A local-first, installable personal agent workspace that runs entirely in a
browser. It is the operator's "home base": chat with an agent, run tools, build
automations, catalogue projects, watch the weather, keep notes.

**Design centre of gravity:** it works fully with no account, no server and no
API key. Adding a model key upgrades it from a deterministic tool-runner to a
reasoning agent. Adding a Supabase project upgrades it from one device to
several. Neither is required, and the app is honest about which mode it is in.

**Constraints inherited from the operator:**

- Free tiers only. A $0/month ceiling, including hosting, model APIs and data.
- Mobile-first, but the desktop experience must be first-class.
- Never deploy to their accounts without explicit authorisation.
- Never reintroduce capabilities the platform cannot deliver: no wake word, no
  always-listening, no OS control, no pricing tiers, no invented parameter counts.

---

## 2. Stack and shape

```
React 18 + TypeScript (strict) + Vite
Runtime dependencies: react, react-dom, @supabase/supabase-js   (that is all)
Dev: typescript, vite, @vitejs/plugin-react, esbuild, playwright
```

~17,800 lines of TS/TSX plus ~1,750 lines of CSS.

### The one architectural rule that matters

```
src/core/    pure domain logic. NO React, NO DOM, NO imports from src/ui.
src/ui/      everything that renders.
```

`src/core` is framework-free so the entire domain layer unit-tests in plain Node
with no jsdom and no bundler gymnastics. A gate enforces the boundary. Keep it.

Everything below in `src/core` is portable to any UI framework:

| Module | Responsibility |
|---|---|
| `types.ts` | Every shared interface. |
| `store.ts` | localStorage persistence, schema versioning, seeding, reset. |
| `tools.ts` | The tool registry (49 tools). |
| `ctx.ts` | Tool execution context (sandbox fs, memory, fetch, approvals). |
| `loop.ts` | The agent loop: plan → act → observe, budget-enforced. |
| `providers.ts` | Model providers, the fallback chain, wire-format adapters. |
| `reflex.ts` | The offline no-model answering core. |
| `intents.ts` | Intent routing, including honest refusals. |
| `modes.ts` | Agent postures and their budgets. |
| `privacy.ts` | Credential redaction and privacy levels. |
| `workflow.ts` | Graph execution, cycle detection, per-node status. |
| `crew.ts` | Sequential multi-role review. |
| `skills.ts` | Deterministic tool chains. |
| `routines.ts` | Scheduling while the tab is open. |
| `traces.ts` | Run log, estimates, pattern discovery. |
| `weather.ts` / `wxmerge.ts` / `radar.ts` | Weather, multi-source merge, radar tiles. |
| `ics.ts` | iCalendar reader. |
| `memimport.ts` | Bulk import into memory. |
| `library.ts` / `seedProjects.ts` | Project catalogue. |
| `dashboard.ts` | Launcher tile registry and layout reconciliation. |
| `explain.ts` | Per-screen explanatory copy. |
| `brief.ts` | Spoken briefing composition. |
| `commands.ts` | Slash commands. |
| `supabase.ts` | Optional cloud sync. |

---

## 3. The registries, with exact current counts

Counts are facts about the shipped build. **Never hardcode them in UI copy** —
derive them from the registry at render time. A gate enforces this, because
every earlier version of this project drifted into advertising numbers it did
not have.

| Registry | Count | Notes |
|---|---|---|
| Tools | **49** across **8** groups | 27 network, 4 approval-gated |
| Tool groups | compute, text, data, files, code, network, memory, agent |
| Providers | **26** (24 selectable) | 9 genuinely free tiers |
| Agent modes | **9** | budgets below |
| Workflow node kinds | **38** | |
| Crew roles | **16** in **5** presets | |
| Intent rules | **27** | 6 are honest refusals |
| Redaction patterns | **26** | |
| Slash commands | **8** | |
| Dashboard tiles | **19** | |
| Screen explainers | **22** | one per route, enforced |

### Tools by group

- **compute** — calculator, unit_convert, datetime, random
- **text** — text_transform, text_stats, regex_extract, json_tool, diff_text, word_lookup
- **data** — csv_summary, encode, hash_text
- **files** — fs_list, fs_read, fs_write, fs_delete
- **code** — code_run, code_review
- **network** — web_search, fetch_url, weather, http_request, currency_convert, crypto_price, earthquakes, hn_search, geocode, book_search, tv_search, space_news, github_repo, nasa_apod, stack_search, npm_package, pypi_package, world_time, weather_alerts, paper_search, air_quality, sun_times, wikidata_lookup, worldbank_stat, music_search, ddg_answer
- **memory** — memory_write, memory_search
- **agent** — plan_outline, run_skill

### Tool contract

```ts
interface ToolSpec {
  name: string;
  group: string;
  desc: string;
  params: ToolParam[];
  effect: 'A' | 'B' | 'C';   // A auto, B state-changing, C network
  network?: boolean;         // blocked entirely under STRICT privacy
  approval?: boolean;        // must show exact args and wait for consent
  run: (args, ctx) => Promise<ToolOutput>;
}
```

Authoring conventions that prevented real bugs:

- Helpers `ok(summary, data?, detail?)` and `fail(summary, detail?)`.
- **Validate raw user input before normalising it.** A currency tool that sliced
  before validating accepted `"dollars"` as a currency code.
- Network I/O goes through `ctx.fetchJson`, which throws `HTTP <status>`.
- Optional third-party keys via `ctx.serviceKey(id)`, returning `''` when unset;
  a tool must degrade to its keyless path, never fail because a key is missing.
- Clamp `limit`-style arguments. Map 404s to a plain-English `fail`.
- **`tools.ts` must never import `store.ts`.** That circular import blanks the
  entire app at module scope. Gated.

### Mode budgets

| Mode | Steps | Tool calls | For |
|---|---|---|---|
| agent *(default)* | 8 | 14 | Anything multi-step; verifies its own work |
| assist | 3 | 4 | Quick questions |
| build | 6 | 10 | Code in the sandbox |
| research | 5 | 8 | Retrieve before asserting |
| analyst | 4 | 8 | Numbers and data |
| writer | 2 | 1 | Drafting |
| brief | 1 | 0 | One short answer, no network |
| deep | 8 | 14 | Hard problems |
| private | 2 | 3 | Never touches the network |

Budgets are **enforced, not advisory**. When one runs out the loop stops and
says so.

---

## 4. Provider system

### The chain

```
active provider → user-ordered fallback chain → keyless endpoint (optional) → offline reflex core
```

`chatWithFallback(req, { allowKeyless, onAttempt, onHop, chain })` returns
`{ ...result, chain }`. Rules learned the hard way:

- `buildChain` dedupes, drops unconfigured providers, but keeps an unconfigured
  primary if the chain would otherwise be empty.
- Aborts rethrow. **Empty text with no tool calls counts as a failure**, not a
  success, and moves to the next hop.
- The chain always terminates at the reflex core with `degraded: true`.
- `readSSE` races reads against a 20s idle timeout → `StreamTimeout`.
- **Two distinct readiness predicates.** `isConfigured(cfg)` = "can we attempt a
  call" (used only by `buildChain`). `hasCredential(id, keyring)` = "did the user
  set this up" (used by every count, dot and label in the UI). Conflating them
  produces a UI that claims providers are ready when they are not.

### Wire adapters

Most providers are OpenAI-compatible: adding one is **one host row + one spec**,
and a gate enforces that pairing. Non-OpenAI adapters: Gemini (`?alt=sse&key=`),
Anthropic (needs `anthropic-dangerous-direct-browser-access: true`), and the
keyless endpoint.

`toWire()` degrades per provider capability: no `multiTurn` → send only the last
user message; no `systemRole` → fold the system prompt into the first user
message.

### The CORS rule for model endpoints

**A clean preflight is not enough. The 401 body must also carry
`access-control-allow-origin`,** or authentication failures surface to the user
as opaque network errors with no explanation. Two providers were rejected on
exactly this: Scaleway (403 body without the header) and Kluster (no preflight
response at all).

### Free-tier facts, verified 2026-09-04/05

| Provider | Reality |
|---|---|
| Groq, Gemini, Cerebras, Mistral, Zhipu, HuggingFace, SiliconFlow, Cohere, OpenRouter | Genuinely free tiers |
| Cerebras | 1M tokens/day, 30 RPM, permanent, no card |
| SiliconFlow | Some models permanently $0, **not available in EU/UK/CH** |
| Cohere | Trial key, ~20 RPM / 1000 calls per month, not for production |
| DashScope, DeepInfra, Novita, Nebius, Together | Signup credit or time-limited ⇒ label **trial**, not free |
| **Chutes** | **Paid** since 2026-03-15 ($5 deposit). Aggregator "free" lists are wrong about it. |

**Verify every claim before labelling a tier.** "Truly free" lists are unreliable.

---

## 5. External services that actually work from a browser

Every entry below was probed with `Origin:` set and confirmed. This list is the
single most time-saving artefact in this document.

### Keyless and CORS-clean — wired

`frankfurter` · `USGS earthquakes` · `HN Algolia` · `CoinGecko` ·
`open-meteo` (forecast, geocoding, air quality) · `zippopotam` · `datamuse` ·
`openlibrary` · `tvmaze` · `spaceflightnews` · `Wikipedia REST` ·
`api.github.com` · `NASA APOD (DEMO_KEY)` · `stackexchange search/advanced` ·
`registry.npmjs.org/{pkg}/latest` · `pypi.org/pypi/{pkg}/json` ·
`timeapi.io` · `api.weather.gov` (forecast + alerts) · `api.openalex.org` ·
`api.sunrise-sunset.org` · `wikidata wbsearchentities` · `api.worldbank.org` ·
`musicbrainz.org/ws/2` · `api.duckduckgo.com` (Instant Answer) ·
`api.met.no/weatherapi/locationforecast/2.0/compact` ·
`api.rainviewer.com/public/weather-maps.json` + `tilecache.rainviewer.com` ·
`tile.openstreetmap.org`

Per-service quirks that cost real time:

- **npm:** use `/{pkg}/latest`. The full packument for `react` is **~7 MB**.
- **weather.gov:** adding a `limit` param returns 400 with `parameterErrors`.
- **wikidata:** requires `origin=*` as a query parameter.
- **musicbrainz:** rejects some custom User-Agents with 403. Fine from a real
  browser, which sends its own. Do not "fix" this with a UA header — browsers
  forbid setting it anyway.
- **RainViewer:** the frame `path` is an **opaque hash** that changes every few
  minutes. Always read the index; never construct a path from a timestamp.
- **Carto basemap tiles** return 200 but are **stamped "API KEY REQUIRED"** when
  unkeyed. Unusable. OSM tiles are clean; darken them with a CSS filter.

### Rejected — do not retry

| Service | Why |
|---|---|
| `ipapi.co/json/` | 429 from shared IPs |
| `api.jikan.moe/v4` | 504 |
| `api.semanticscholar.org/graph/v1` | 429 **and** no ACAO |
| `api.scaleway.ai/v1` | 403 error body has no ACAO |
| `api.kluster.ai/v1` | no preflight response |
| Cloudflare Workers-AI public endpoint | 404 without an account |
| OpenRouter `:free` models without a key | still requires a key |

### Impossible in a browser — and why

- **Any in-app web browser.** DuckDuckGo sends `x-frame-options: SAMEORIGIN` and
  `frame-ancestors 'self'`. So does nearly every major site. You cannot embed
  them. Build search as a tool plus real-tab links.
- **Calendar subscription by URL.** Google and Apple both serve `.ics` without
  CORS headers. Tested from a real page: `Failed to fetch`. File import only.
- **PDF text extraction** without bundling a PDF engine. Refuse with the reason.
- **The DuckDuckGo Instant Answer API is not a search engine.** It answers
  topics, definitions and calculations. Ordinary queries return nothing, and the
  tool must say so rather than returning an empty success.
- **OAuth cannot complete inside an embedded preview iframe.** It needs a
  top-level window.

### The keyless model endpoint (pollinations), if you attempt one

Empirically established, do not re-probe: non-streaming → 402. `openai` alias →
402. OpenAI `tools` array → 402. `system` role → 500. Multi-turn history → 500.
User content ≥600 chars → 500. Any `Referer` header → 402. It currently returns
500 from many networks entirely. **A text/fenced-block tool protocol is required
if you want tool use from a model that cannot do function calling.**

---

## 6. The agent loop

```
for step in 1..mode.maxSteps:
    build prompt (system + history + selected tools)
    call provider chain
    parse tool calls
    if none: finish
    execute tools (respecting privacy, approvals, budget)
    append observations
```

- `selectTools(prompt, groups, max)` scores tools by keyword and group so a
  small model is not drowned in 49 definitions.
- **`parseToolCalls` must be tolerant.** Accept `tool | name | tool_name |
  command` and `args | arguments | parameters | input`, fenced or bare, via a
  string-aware brace scanner. Small models produce all of these.
- Every answer carries a **receipt**: elapsed ms, mode, steps, tool count, token
  counts, and whether it ever touched the network.
- Sub-millisecond durations render as "under 1 ms", not "0 ms".

### Effect classes and approval

- **A** — auto, no side effects.
- **B** — state-changing. `fs_write`, `fs_delete`, `code_run` are approval-gated;
  `memory_write` is auto.
- **C** — network. `web_search`, `fetch_url`, `weather` auto; `http_request`
  approval-gated.

An approval prompt must show the **exact arguments** before anything runs.
Denying is recorded as a blocked call with a reason so the agent knows it did
not run.

### Privacy

Three levels: `STRICT | GUARDED | OPEN`.

- STRICT blocks **all** `network: true` tools.
- 26 credential patterns are redacted before anything leaves the device.
- **Pattern order is load-bearing:** `sk-ant-` and `sk-or-v1-` must be tested
  before a loose `sk-`. Replace back-to-front so indices stay valid.
- Card numbers require a **Luhn check** so real cards are caught and order
  numbers are not.
- A bare 32–64 char hex string only counts as a credential if a key-ish word
  appears within ±40 characters.

### Honest failure semantics — do not soften these

- `runWorkflow` → `ok | failed | blocked`. Nodes never reached are **skipped**,
  not failed. Cycles → `blocked`, detected before execution.
- `runCrew` breaker: if a role returns `ok === false`, throws, or falls back to
  the reflex core, later roles are marked `{ skipped: true }` rather than
  pretending to have reviewed.
- Routines stamp `lastRun` **even on failure**, or they retry in a tight loop.

---

## 7. Persistence

`localStorage`, namespaced `jarvis.*`:

```
version  conversations  memory  workflows  workflow.runs  crew.runs
skills   routines       traces  ideas      settings       sandbox
dashboard  weather      projects  calendars  supabase
seeded    projects.seeded
```

### The rule that came from a shipped crash

`read<T>(key, fallback, isValid?)` — **JSON.parse only protects against corrupt
text.** It happily returns valid JSON in a shape the current build no longer
understands, which is exactly what a released schema change produces. Casting
that to `T` handed the UI an object with missing fields and killed the app with
`Cannot read properties of undefined`.

Therefore:

- Every loader passes a shape check. Failing values are **removed** and the
  caller gets the default.
- Rows are validated as "array of objects with a string `id`".
- **Any change to a persisted shape bumps `SCHEMA_VERSION` and adds a check.**
- **Caches may be discarded; user data may not.** Weather is derived and dropped
  freely. Conversations, memory and projects are only ever rejected on row shape.

Seeding: first-run content is guarded by its own marker per feature, not one
global flag — otherwise a feature added later never seeds for existing installs.
Seeding on "empty" alone is also wrong: it resurrects things the user deleted.

---

## 8. Feature contracts

Each of these must exist. **How they look is your decision.**

### Chat
Conversations with tool use, per-answer receipts, slash commands, a command
palette, and per-conversation mode. Slash commands (`calc`, `remember`, `recall`,
`idea`, `mode`, `tools`, `go`, `help`) run **on device with no model call**.
`sendOnEnter` defaults **false** — Enter inserts a newline, which is correct on
phones.

### Agent console
The same loop with its working shown step by step.

### Tools
Browse, search and run any tool by hand. Show effect class and network need.

### Skills
Deterministic tool chains with a `/trigger`. No model. Validation must block
saving with a **stated reason** ("Skill needs at least one step") rather than a
silently disabled button.

### Workflows
Visual graph, 38 node kinds, cycle detection, per-node status with reasons.

### Crew
16 roles, 5 presets, sequential shared transcript, honest skipping.

### Routines
Schedule a skill/workflow/prompt. Ticker: first run after 4s, then every 30s,
skipping when `document.hidden`, one routine per tick. **A browser tab cannot
wake itself — say so.**

### Memory
Facts with kinds, tags, pinning, search. **Bulk import** from a pasted block or
a file: JSON (including `{role, content}` chat exports), Markdown (bullets and
paragraphs, headings become tags), CSV, plain text. Always show a **review list
with de-duplication** before saving — importing straight in lets a malformed
file quietly poison every future prompt. PDF is refused with the reason.

### Project library
One card per project: name, tagline, status, tags, links, about, a full rebuild
spec, and attachments (screenshots) as inline data URLs against a **visible
storage budget**. "Copy dump" exports the whole record as Markdown.

### Weather
Three independent keyless sources — Open-Meteo, MET Norway, US NWS — fetched in
parallel and merged by **median, not mean**, so one bad source cannot drag the
number. **Always publish the spread** and whether the sources agree. A single
blended number hides exactly the information that matters on a marginal day.
Plus: rain/snow timeline, US NWS alerts, air quality with EPA band.
Refresh every 10 minutes while the tab is visible; never fetch while offline.
Default location Washington DC. Imperial default with a metric toggle —
**fetch metric, convert on the client**, so the toggle is instant and free.

### Radar
RainViewer frames over OSM tiles, drag to pan, zoom 3–10, recentre, scrub, play.
**The free feed publishes ~13 frames = 2 hours and no more.** Label the real
span. RainViewer's nowcast frames are usually empty; a forecast strip should come
from Open-Meteo and be labelled a **point forecast, not radar imagery**.
Optional OpenWeather overlay layers if the user supplies their own free key.

### Calendar
`.ics` file import. Handle RFC 5545 line unfolding, quoted parameters, escaped
text, all-day dates as **local midnight** (or the day shifts), UTC timestamps,
and `TZID` times converted with the zone's **true offset via `Intl`** — a fixed
offset silently breaks half the year. Recurrence: DAILY/WEEKLY(BYDAY)/MONTHLY/
YEARLY with INTERVAL, COUNT, UNTIL, EXDATE, **capped** so one unbounded rule
cannot hang the tab. Report what was skipped, per calendar.

### Briefing
A spoken summary from data already held — weather, alerts, next calendar events,
due routines, system state — via the browser's own `SpeechSynthesis`. Free, no
key. Degrade to text where no speech engine exists.

### Cloud sync (optional)
Supabase, user's own project. 10 tables, RLS enabled **and forced**, four
policies each keyed to `auth.uid()`. Row shape:
`{ id text pk, user_id uuid, updated_at timestamptz, payload jsonb }`.
Last-write-wins per item.

Two things that were wrong and must not be repeated:

- **Sync must write back what it pulls.** Reporting "N down" while only applying
  the key vault made the summary a lie.
- **Use PKCE for OAuth.** The default implicit flow returns the session in the
  URL **fragment**, which collides with a hash router: the redirect target is
  overwritten by `#access_token=...` and sign-in appears to fail even though it
  succeeded.

**The anon key is meant to be public.** RLS is the protection. `service_role`
must never reach the browser and there should be no field for it. Model API keys
are different — they are secret and they do live in the browser, which is a real
trade-off that must be stated plainly.

### Diagnostics
Live checks against the running build. **A check that cannot execute reports
`blocked` with a reason — never upgraded to a pass.**

---

## 9. Browser traps that will bite you regardless of design

These are platform behaviours, not styling opinions.

1. **`position: sticky` always creates a stacking context.** A child's `z-index`
   is resolved *inside* it. A sticky rail at `z-index: auto` sits below a sticky
   header at `z-index: 40`, no matter what its children say.

2. **`backdrop-filter`, `transform` and `filter` make an element the containing
   block for `position: fixed` descendants.** A modal rendered inside a blurred
   tab bar had its full-viewport scrim collapse to the tab bar's 63px box.
   **Portal every overlay** out to the app root.

3. **Any stacking context on a content wrapper traps overlays rendered inside
   it.** This bug occurred three times, on three different ancestors. Portalling
   is the durable fix.

4. **A translucent panel needs something behind it.** A sidebar occupying its own
   layout column has only the page background behind it; every opacity value
   looks identical. Make it an overlay and let content run underneath.

5. **`\uXXXX` escapes render literally in JSX text *and* in JSX attribute
   strings.** They only work inside JS string literals. This shipped four times.

6. **Duplicate `@keyframes` names silently override each other**, globally. A
   second `sheen` turned a button highlight into a white smear across the page.

7. **`navigator.clipboard.writeText` rejects in embedded frames.** Fall back to
   `execCommand('copy')`, and if both fail, say so and show the text.

8. **A modal that focuses itself in an effect must not depend on a callback
   prop.** Inline arrows change identity every render, so the effect re-runs on
   every keystroke and pulls focus out of the field — "one character at a time".

9. **Content-hashed chunks vanish on deploy.** A tab running the old build will
   fail a dynamic import. Recover with **one** guarded reload. Clearing the guard
   on mount instead of on successful load produces an infinite reload loop
   (measured: 144 reloads in 9 seconds).

10. **Any throw at module scope blanks the entire app.** Guard the entry point.

11. **A dragged element must get `pointer-events: none`**, or hit-testing finds
    the dragged element itself and the drop target can never be identified.

12. **Pointer capture on a container swallows clicks on its own child buttons.**
    Ignore pointerdowns that originate on a control.

13. **HTML5 drag-and-drop does not fire on touch at all.** Use pointer events.

14. **`elementFromPoint` ignores `pointer-events: none` elements**, so it will
    not find the overlay that is actually covering your button.

15. **A perpetually animating element is never "stable"** for automated clicks,
    and is harder to tap. Animate a child, not the hit target.

16. **Global tap-target floors stretch small buttons.** A 26px circle with
    `border-radius: 50%` becomes an ellipse. Keep the 44px hit area and draw a
    smaller visual with a pseudo-element.

---

## 10. Verification

Eight gates. The build is not done until all are green.

| Gate | What it proves |
|---|---|
| `npm run typecheck` | TypeScript strict, clean |
| `npm test` | **411** unit tests, domain layer in plain Node |
| `npm run test:e2e` | **57** browser checks, every route at 390px and 1440px |
| `npm run test:functional` | **72** behaviour checks: data round-trips, real tool calls, honest failures |
| `npm run test:iframe` | 8 checks booting inside `sandbox="allow-scripts"` |
| `npm run test:contrast` | Every text node meets AA in both themes |
| `npm run test:audit` | Clicks **every control on every route** at two widths; 0 findings |
| `npm run test:deploy` | Publishes a build under an open tab; proves one silent recovery reload |
| `node scripts/verify.mjs` | The honesty gate (below) |

### The honesty gate — the most valuable script here

`verify.mjs` fails the build on:

- Capability claims the app cannot honour (wake word, OS control, pricing tiers,
  invented parameter counts).
- **Hardcoded counts in UI copy** that do not match the registry.
- Route coverage drift — a route not visited by e2e, audit and contrast.
- A route with **no explainer**, or an explainer that does not state a limit.
- Duplicate `@keyframes` names.
- Duplicate export names across `src/core` (ambiguous under `export *`; this
  silently blanked a function and turned four passing tests red with no error).
- `\uXXXX` escapes stranded in JSX.
- `src/core` importing framework code; `tools.ts` importing the store.
- Credential-shaped literals in the bundle.
- Service worker caching a model or backend host.

### Testing lessons

- **Test the failure path, not just the happy one.** The reload-loop bug passed
  the happy-path test perfectly.
- **Make each scenario self-contained.** Shared state between scenarios produced
  more false failures than real ones in this project.
- **Triage harness bugs honestly but do not use "harness bug" as a reflex.** In
  one round, 11 of 11 failures were harness bugs; in the next, a real one hid
  among them.
- **Measure pixels for visual claims.** Two rounds of "make it translucent" were
  wasted reading the stylesheet instead of sampling the screen.
- Simulate a deploy by changing a **visible string** — comments are minified away
  and the chunk hash will not change.

---

## 11. What is deliberately not built

State these in the interface, not just in docs.

- No wake word, no always-listening, no OS control, no launching applications.
- No in-app web browser (impossible — see §5).
- No live calendar subscription (impossible — see §5).
- No PDF/DOCX/image import into memory.
- No background execution: routines and sync run only while the tab is open.
- No server. Model keys live in the browser; that trade-off is stated plainly.

Known gaps at handoff, in priority order:

1. Weather threshold alerts / trigger rules.
2. The wider widget grid: markets, FRED, ISS, flights, news, GitHub activity.
3. PDF/DOCX/image import.
4. **The Supabase SQL has never been executed against a live project.** The
   schema and sync code are written and reviewed but unproven.
5. Nothing has ever been deployed.

---

## 12. If you rebuild only three things correctly

1. **The honesty rule, enforced by a gate.** Every other quality in this product
   follows from refusing to claim what it cannot do. Build `verify.mjs` early.
2. **The React-free domain core.** It makes 411 unit tests possible without a
   browser, and it means your UI — whatever you design — is replaceable.
3. **The fallback chain ending in an offline core.** It is why the app is useful
   with no key, no account and no network, and why it never has to lie about
   why an answer is thin.

Everything else, including every pixel, is yours.
