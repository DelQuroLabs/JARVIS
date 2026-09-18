# Build charter and evidence record

Control record for the JARVIS rebuild, per MASTER-MOBILE-BUILD-AGENT-SCRIPT v15.6.0.

## Intake

| Field | Value |
|---|---|
| Product | JARVIS — local-first agent workspace |
| Runtime | Installable PWA, React 18 + Vite, mobile-first |
| Backend | Supabase (optional, user-owned project) |
| Cost ceiling | $0/month — free tiers only |
| Design authority | Delegated to the agent (amendment L-DES) |
| Deployment authority | **Not granted.** No Class-D action taken |

## Scope decisions

| Decision | Rationale |
|---|---|
| Hash router, zero dependencies | Deploys to any static host with no rewrite rules |
| `src/core` framework-free | Makes the domain layer unit-testable in plain Node with no DOM |
| Local-first, cloud optional | The app must be fully usable before any account exists |
| Free-tier key + offline reflex | BYOK-with-paid-key and paid-server-key were both rejected during intake |
| 5 mobile tabs, 2 as hubs | 16 app routes do not fit a tab bar; Build and More group the rest |
| Tests in-repo, not `/tmp` | The prior build's tests were unrunnable by anyone else. `npm test` now runs them |

## Effect classes in use

| Class | Meaning | Handling |
|---|---|---|
| A | Safe, reversible, local | Runs automatically |
| B | State-changing | `fs_write`, `fs_delete`, `code_run` require approval; `memory_write` is automatic |
| C | Network egress | `web_search`, `fetch_url`, `weather` automatic; `http_request` requires approval. All blocked outright under Strict privacy |
| D | Irreversible / external accounts | **None taken.** No deploy, no publish, no writes to user accounts |

Approval is a modal that shows the exact arguments before anything runs. Denial is
recorded as a blocked call with a reason, so the agent knows it did not execute.

## Evidence states

Every check reports one of: **passed**, **failed**, **blocked** (could not execute,
with the reason), **not run**. A blocked check is never reported as a pass. This is
enforced in the workflow runner, the tool layer, the Diagnostics screen, and the e2e
harness.

## Gate results

Recorded 2026-09-04 against commit-in-progress.

| Gate | Method | Result |
|---|---|---|
| Type safety | `tsc --noEmit`, strict | pass, 0 errors |
| Domain correctness | `node --test` | 227 / 227 |
| Route integrity | Playwright, 21 routes × 2 viewports | 42 / 42 |
| Interaction integrity | Playwright, 7 flows | 7 / 7 |
| No embedded credentials | grep 7 key shapes over built assets | pass |
| No false capability claims | line scan over 28 UI files | pass |
| Offline capability | service worker + airplane-mode load | pass |
| Install ability | manifest fields + maskable icon | pass |
| Circular-import trap | import graph assertion | pass |
| Text contrast | WCAG AA over every text node, both themes, 21 routes | pass |
| Whole-app sweep | 21 routes x 2 widths, every non-destructive control clicked | 0 findings |
| Gate coverage | every route declared in `Shell.tsx` is visited by every browser gate | pass |
| Tap-target floor | measured every control at 390px | 0 below 44px |

## Defects found and fixed during verification

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | Anthropic keys were redacted under the **OpenAI key** label — the looser `sk-` pattern was ordered first, so the finding misreported which credential leaked | Medium — honesty of the privacy report | Reordered `PATTERNS` so specific rules precede general ones; test added covering all six credential families |
| 2 | A failed model call in a workflow left the node `status: 'ok'` and passed the error string downstream as data | **High — the app reported success for something that failed** | Node now reports `failed`, or `blocked` when no provider is configured, with the real reason; the error string is no longer emitted as output. Three tests added |
| 3 | `.btn.sm` was pinned at 38px on touch widths, and workflow list rows measured 39.5px | Low — accessibility | Replaced the exception with a general 44px floor over `.content`/`.sheet` buttons; the e2e harness now fails the build on any control under 44px |
| 4 | The bottom tab bar was 88% opaque with no fallback, so content showed through where `backdrop-filter` is unsupported | Low — visual | Raised to 94% and added an opaque `@supports not` fallback |

| 5 | The Providers header read "2 of 18 connected" on a fresh install: `isConfigured` accepts the default `localhost` URL that gets merged into Ollama and LM Studio | **High — the app claimed connections that did not exist** | Added `hasCredential`, which only counts credentials the user actually saved. `isConfigured` still answers "can we attempt a call" for the fallback chain. Three tests, including one asserting a fresh install reports zero |
| 6 | `currency_convert` sliced input to three characters *before* validating, so "dollars" became a plausible "DOL" and was sent to the network | Medium — a wrong answer instead of a clear error | Validate the raw argument, then normalise |
| 7 | Every keyless-endpoint failure was reported as "(rate limited)", including 500s and 403s | Medium — honesty; it blamed the user's usage for an upstream outage | The status now picks the wording, and says nothing when the status implies nothing |
| 8 | Tone colours are tuned for a dark background and were reused unchanged in the light theme, so accent text sat at 1.5:1 and the `MAIN` tag at 1.07:1. White on the dark theme's coral danger button was 2.75:1 | Medium — accessibility, whole-app | Added text-only tone tokens (`--accent-t` and friends) overridden per theme, and pinned button ink to a token whose ratio is asserted. New `npm run test:contrast` gate covers every text node in both themes |
| 9 | The landing page's capability table forced 5px of horizontal scroll at 390px | Low — visual | Fixed table layout with wrapping cells |

Defect 2 is the one that mattered. It was found only because the e2e harness asserts
on run status rather than on the absence of a crash.

## Known limitations, stated in-product

- Model providers are only listed after their CORS preflight has been probed from
  a real browser origin; the probe date ships in the spec and is shown in the UI.
  GitHub Models (HTTP 410, retiring), NVIDIA NIM, SambaNova and Brave Search were
  rejected by that probe rather than listed hopefully. Evidence: `docs/providers.md`.
- API keys never leave the device unless the user connects Supabase *and* turns on
  key sync, which defaults to off. Exports strip every credential.
- Routines are polled every 30 seconds while the app is open, and one due routine
  runs per tick. There is no background scheduler on the web, so nothing fires with
  the tab closed. The Routines screen says so on the screen rather than in a footnote.
  A routine that throws still records `lastRun`, so a broken one cannot spin.
- The keyless model endpoint is heavily rate-limited (observed HTTP 403 during
  verification). This is surfaced as a failed node with the real reason, not hidden.
- `fetch_url` and `http_request` fail honestly on CORS-restricted origins.
- Cost figures on the Activity screen are estimates from a static price table and are
  labelled as estimates.

## Not verified

- **`supabase/schema.sql` has never been executed against a live project.** It is
  reviewed but unproven. The Cloud screen's RLS probe is the intended proof, and it
  cannot run until a project exists.
- No deployment has occurred to any account. Deployment requires explicit
  authorisation that was not given.

### Agent mode is the default posture

The app opens in **Agent** mode rather than a single-shot reply mode. Agent gets
8 loop steps, 14 tool calls and access to every tool group, and its system prompt
tells it to work the task rather than describe it. Every other mode is still one
tap away in the composer, and the budgets stay enforced rather than advisory --
a mode cannot exceed its own step or tool count.

Two consequences worth stating plainly:

- With no API key, Agent mode still ends at the offline reflex core. It answers
  what it can compute or look up locally and says it is offline for the rest. It
  does not pretend to have reasoned.
- A first answer can take longer than it used to, because the fallback chain is
  tried before the offline core takes over. The receipt under each reply shows
  where the time went.

### The dashboard is the navigation

The old 236px labelled sidebar spent a third of a 1440px window on chrome and
left the content in a narrow centred column. It is now a 72px icon rail with
hover labels, and every destination is a real button on the dashboard: four
large action tiles and a twelve-button grid for everything else. Nothing is
reachable only from a list on the side.

The marketing landing page is **not deleted**. It is parked at
`/former-landing`, nothing links to it except one entry under More, and `/`
now loads the dashboard directly. Restoring it is a one-line change in
`src/ui/App.tsx`.

### Weather

Open-Meteo, keyless and free, so this adds no account and no spend. Readings are
always fetched in metric and converted in the browser, which makes the
imperial/metric toggle instant and never costs a second request.

Honest states, all of which are reachable:

- no location set: the card asks for one instead of guessing from an IP address
- a location but no reading yet: says so, and offers a retry
- a live reading: labelled with how long ago it was taken
- a reading older than 90 minutes: still shown, but labelled stale in amber
- a failed lookup: shows the real error text

Location comes from the browser prompt or a typed city, is stored on this device
only, and is never sent to Supabase.

### Help replaces the landing page

The former marketing page is still parked at `/former-landing`. The help section
at `/app/help` took over its job: a six-chapter tour of what the app does and
what it refuses to do. Every count on that screen -- tools, modes, node kinds,
crew roles, providers, slash commands, redaction patterns, refusal rules -- is
read from the live registry when the page renders. Adding a tool updates the
tour with no edit, which is the only way a how-to survives an evolving app.

### Project library

One card per project. The card is deliberately small; opening it gives the whole
record: about, a full rebuild spec, every link, and screenshots or attachments.
"Copy dump" exports the record as Markdown.

Attachments are data URLs in local storage, capped at 1.2 MB per file and 3.5 MB
across the library, with the budget shown on screen. That is a real browser
constraint, not a product decision. A `projects` table with the same RLS as every
other table is in `supabase/schema.sql` for when the library outgrows the device.

### Radar and search: what is actually possible

- **Radar works.** RainViewer publishes keyless frames; the basemap is
  OpenStreetMap, darkened with a CSS filter. Carto's dark tiles were the better
  visual fit but stamp "API KEY REQUIRED" across unkeyed tiles, so they were
  dropped.
- **There is no in-app browser, and there cannot be.** DuckDuckGo returns
  `x-frame-options: SAMEORIGIN` and `frame-ancestors 'self'`. Nearly every major
  site does the same. Embedding one in a page is not possible, so the app does
  not pretend: `ddg_answer` fetches Instant Answers over a CORS-clean endpoint,
  and links open in a real browser tab.
- **The Instant Answer API is not a search engine.** It covers topics,
  definitions and calculations. An ordinary query returns nothing, and the tool
  says exactly that instead of returning an empty success.

### Cloud sync now lands what it pulls

Sync previously reported "N down" per table while only the key vault was written
back to the device. Pulled rows are now applied through `applySync`, so the
summary describes something that actually happened.

### The rail expands, it does not push

The desktop rail keeps a fixed 72px footprint and an inner panel widens to 226px
on hover or `:focus-within`. Widening the rail itself would reflow the whole
dashboard on every hover, so the panel overlays the content instead. Keyboard
focus triggers the same expansion, because a hover-only affordance is unusable
without a mouse.

### Modular dashboard

Tiles come from a registry in `src/core/dashboard.ts`; the saved layout is a list
of ids plus a hidden set. That indirection is the point: `normaliseLayout` drops
ids that no longer exist and **appends ids that are new**, so shipping a feature
never hides it from someone with a saved layout. There is a unit test for exactly
that case.

Rearranging is an explicit mode rather than a long-press. On a phone a tile is a
navigation button, and a drag gesture competing with a tap produces accidental
reorders and blocked scrolling. In rearrange mode the tiles take
`touch-action: none` so the browser hands the gesture over.

Three things that had to be right for the drag to work at all, each of which was
a real bug first:

- The dragged tile needs `pointer-events: none`. It is translated under the
  cursor, so otherwise hit-testing finds the dragged tile itself and the drop
  target can never be identified.
- Pointer listeners are attached synchronously in the pointerdown handler, not
  from an effect. An effect runs after the next render, and a fast drag can
  finish before that, leaving the tile stuck to the cursor.
- The hide badge must be excluded from the `pointer-events: none` applied to
  tile faces in rearrange mode, or its clicks fall through to the slot.

The badge keeps a 44px hit area with a smaller drawn circle; sizing the button
itself to 26px just let the global tap-target floor stretch it into an ellipse.

### Weather is merged, not averaged blind

Three keyless forecasts are fetched in parallel: Open-Meteo, MET Norway and the
US NWS. The merge takes the **median**, not the mean, so a single bad source
cannot drag the number. The spread between sources is always published, and the
card states whether they agree, differ, or whether only one answered.

That last part is the whole point. A single blended number looks confident and
hides exactly the information you want on a marginal day. `agreementText` says
"3 sources agree, 1.3 degrees apart" or "3 sources differ by 4.3 degrees".

Sources are independent and optional. NWS is US-only and reports "covers the
United States only" outside it, which is a fact rather than a failure. Any
source that errors is listed with its reason and the merge continues.

### Supabase: the key in the browser is the public one

`docs/supabase-secrets.md` is the long answer. Short version: the anon key is
designed to be embedded in a client, RLS is the actual protection, and the
service_role key must never touch the browser. The Cloud screen states this
inline and its security check proves RLS is on by querying anonymously and
expecting nothing back.

GitHub sign-in was broken by a flow mismatch: Supabase's default implicit OAuth
returns the session in the URL **fragment**, which collides head-on with this
app's hash router -- the `#/app/cloud` redirect target is overwritten by
`#access_token=...`. The client now uses `flowType: 'pkce'`, which returns
`?code=` in the query string instead. OAuth still cannot complete inside an
embedded preview frame; that needs a real browser tab.

### The stacking-context trap, now guarded

Twice a bottom sheet became untappable because an ancestor gained a stacking
context -- first `.dash`, then `.content` when the shared aurora was added. The
sheet's `z-index: 80` scrim was resolved inside that context and painted under
the `z-index: 50` tab bar.

There is now a functional scenario that opens a sheet on five screens and
asserts the element under its primary button is not the tab bar. It was verified
by reintroducing the bug and watching it fail.

### Surviving your own deploy

Vite content-hashes every chunk. Publish a new build and the previous hashed
filenames stop existing. A tab still running the old build will ask for one of
them the moment you open a screen you had not visited yet:

```
Failed to fetch dynamically imported module: /assets/Agent-Mp0UpwBb.js
```

That is not a crash, it is a stale tab, and it is entirely normal for a
code-split app. `src/ui/lazyScreen.ts` now wraps every lazy screen: a failed
dynamic import reloads the page once so the browser picks up the current
index.html and its current hashes.

Two details that matter, both learned the hard way:

- **The guard is spent only on a successful load.** The first version cleared
  the guards when the app mounted, which reset them before the failing screen
  retried. That reloaded the page 144 times in nine seconds. The guard is now
  cleared in the `.then` of a successful import, per screen.
- **A second failure is surfaced, not retried.** If the chunk is still missing
  after the recovery reload, the build itself is broken, and the error screen
  says the app was updated rather than claiming a crash.

`scripts/deploy-check.mjs` (`npm run test:deploy`) proves the whole thing: it
opens a tab, runs a real `vite build` that changes the Agent chunk hash, then
navigates the stale tab to that screen and asserts exactly one silent reload,
no error screen, and no uncaught errors.

### Persisted data outlives the code that wrote it

`read<T>` used to `JSON.parse` and cast straight to `T`. That survives corrupt
text but not the far more likely failure: **valid JSON in a shape this build no
longer understands**. Changing the weather cache from a single-source snapshot
to a merged one shipped exactly that, and any browser holding the old object
died with `Cannot read properties of undefined (reading 'tone')` -- unusable
until storage was cleared by hand.

`read` now takes an optional shape check. A value that fails is removed and the
caller gets the default, so a stale payload cannot be handed to the UI and
cannot sit there waiting for the next reader. Rows are validated as
"array of objects with a string id"; the weather cache additionally requires
`readings` and `agreement`, the two fields the old shape lacked.

Two rules that follow from this:

- **Any change to a persisted shape bumps `SCHEMA_VERSION` and adds a check.**
  A unit test asserts the version was bumped.
- **Caches may be discarded; user data may not.** Weather is derived and is
  dropped freely. Conversations, memory and projects are only ever rejected
  row-shape-wise, never silently emptied.

Defence in depth on top: lookups like `AGREEMENT[w.agreement]` now fall back
rather than returning `undefined` into a property access. A single missing field
should degrade one label, not take down the application.

`scripts/functional.mjs` seeds six stale payloads -- including the exact old
weather object -- reloads, and asserts the app boots clean with no uncaught
errors. Verified by reverting the fix and watching it fail.

### Radar: movable, and honest about its horizon

Drag to pan, buttons to zoom between levels 3 and 10, and a recentre control once
you have moved. Panning is exact rather than approximate: `latLonFor` is the true
inverse of `tileFor`, so a drag round-trips without drift, and there are unit
tests at five latitudes and three zooms to keep it that way.

Two limits are stated on screen rather than papered over:

- **Two hours of history is all there is.** The free RainViewer feed publishes
  13 frames at 10-minute steps. The legacy endpoint that once returned more now
  returns nothing. The timeline is labelled with the real span.
- **The forecast strip is not radar.** RainViewer's nowcast frames are usually
  empty, so "what is coming" is Open-Meteo's 15-minute precipitation forecast
  for your exact location. It is labelled as a point forecast, because animating
  it next to real radar would imply an observation that does not exist.

One bug worth recording: the zoom buttons live inside the map, and the map calls
`setPointerCapture` to drag. Capturing the pointer retargets every subsequent
event to the container, so the buttons never received a click at all. The drag
handler now ignores pointerdowns that originate on a control.

### Pop-outs are glass, and they escape their ancestors

Sheets and the command palette are translucent with a blur, backed by a scrim
that supplies the contrast.

Getting there exposed a third member of the containing-block family. The
quick-action sheet is rendered inside the tab bar, and `backdrop-filter` on the
tab bar makes it the containing block for `position: fixed` descendants. The
sheet's scrim, nominally `inset: 0`, collapsed to the tab bar's 63px box: it
dimmed nothing and the page showed straight through the menu.

Sheets are now portalled to `#root`. Not `<body>` deliberately -- `#root`
escapes the tab bar just as well while keeping every sheet inside the
application tree, which matters for anything that scrapes or screenshots `#root`.

### Every screen explains itself

`src/core/explain.ts` holds one entry per route: what it is, when to reach for
it, and what it will not do. `Shell` renders it as a collapsed strip, so the
copy cannot drift from the screen it describes and a new route without an
explainer is a build failure. The `limit` field is mandatory, checked by the
same gate -- a feature that claims no edge is a feature nobody has thought
about.

Modes additionally carry a `when` line in the registry, so the Modes screen can
say what each posture is actually for rather than only listing its budgets.

### The menu bar, on the third attempt

Asked three times to make the menu bar translucent, I changed the desktop rail
three times. The user was looking at the **bottom tab bar**, which was still
`--bg` at 94% -- a solid slab. The top appbar was 82%.

The lesson is about method, not CSS: I was reading the code I had touched rather
than measuring what was on screen. The fix came from putting a bright red band
behind each bar, screenshotting, and decoding the pixels:

| Bar | Red channel behind it, before | After |
|---|---|---|
| Bottom tab bar | 46 / 255 | 118 / 255 |
| Top appbar | 49 / 255 | 136 / 255 |

Both are now around 47% tint with a 26-28px blur, and text on them still passes
AA in both themes.

### Calendars: import, not subscribe

`.ics` import from a file, and deliberately no URL box. Google and Apple both
serve their calendar feeds without `access-control-allow-origin`, so a browser
cannot fetch them -- tested from a real page, both return `Failed to fetch`. A
subscribe-by-URL control would be dead for exactly the two services people
actually use, so the screen explains the export path instead.

The reader (`src/core/ics.ts`) covers what real exports contain: RFC 5545 line
unfolding, quoted parameters, escaped text, all-day dates as local midnight,
UTC timestamps, and `TZID` times converted with the zone's true offset via
`Intl` -- checked against New York in both July and January, since a fixed
offset silently breaks half the year.

Recurrence handles DAILY, WEEKLY (with BYDAY), MONTHLY and YEARLY plus INTERVAL,
COUNT, UNTIL and EXDATE, capped at 400 occurrences so one unbounded rule cannot
hang the tab. Everything it does not handle is listed on the screen and counted
per calendar, because an importer that silently drops a repeating meeting is
worse than one that admits it.

Tests run against a real 40-event Google Calendar export committed as a fixture.

### Three bugs from one report

**Fields accepted one character at a time.** `Sheet` focused itself in an effect
that depended on `onClose` -- almost always an inline arrow, so a new identity on
every parent render. Any keystroke that re-rendered the parent re-ran the effect
and pulled focus out of the field. Library was unaffected only because its editor
holds its own state. Fixed by keeping `onClose` in a ref and depending on `open`
alone.

**Copy claimed success while failing.** `navigator.clipboard.writeText` rejects
with NotAllowedError in an embedded frame, and the code reported "copied"
regardless. `src/ui/clipboard.ts` now tries the async API, falls back to
`execCommand`, and returns what actually happened; a total failure shows the text
in a selectable box instead of a false confirmation.

**The sidebar was never going to look translucent.** It sat in its own 72px flex
column, so there was nothing behind the glass. Two rounds of opacity tuning
changed nothing visible. It is now a fixed overlay with zero layout width, with
the content padded to run underneath. Measured: 170/255 of a red band now shows
through, where previously the answer was structurally zero.

The lesson repeated from the tab-bar episode: measure the pixels, do not read the
stylesheet.
