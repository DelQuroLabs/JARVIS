# What you asked for, and what actually happened

Every request from the last ~12 hours, in the order you made it, with an honest
status. **Done** means built and covered by a test. **Partial** means some of it
exists and the rest is named below. **Not done** means I did not build it.
**Not possible** means I tried and it cannot be done in a browser — with the
evidence.

---

## 1. Tools, models, agent mode

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 1 | More keyless public API tools | **Done** | 49 tools. 11 added, each CORS-probed and executed live. 3 candidates rejected for 429/no-CORS. |
| 2 | More free AI models | **Done** | 26 providers, 9 genuinely free. Chutes labelled paid, DashScope/DeepInfra/Novita labelled trial. |
| 3 | Agent mode as the default | **Done** | New installs open in Agent: 8 steps, 14 tool calls, all tool groups. |
| 4 | Debug and test everything, report failures honestly | **Done, ongoing** | 8 gates. Every failure this session is written up in `docs/charter.md`. |

## 2. Design direction

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 5 | Layout preview images to choose from | **Done** | 3 concepts rendered at desktop and phone, in `design/`. |
| 6 | Imperial units + a toggle | **Done** | Imperial default, metric toggle, converts with no refetch. |
| 7 | Whimsical, fun, futuristic | **Partial** | Aurora, tile lift/sheen, reactor halo, animated sky icons, jiggle-to-rearrange. **No boot sequence, no sound design, no audio waveform.** |
| 8 | Dashboard = buttons, not a side menu | **Done** | 18 tiles, drag to rearrange, hide and restore. |
| 9 | Remove the loading/landing screen | **Done** | `/` loads the dashboard. |
| 10 | Hide it, do not delete, call it the former landing page | **Done** | Parked at `/former-landing`, linked only from More. |
| 11 | Make all pages look like the dashboard | **Done** | Aurora moved into `Shell`; cards, list rows and items now share one surface treatment. |
| 12 | Cards are not mobile | **Done** | Big tiles 2-up, compact tiles 3-up on a phone. |
| 13 | Menu bar translucent | **Done — on the third attempt** | See the honesty note below. |
| 14 | Pop-out menu translucent | **Done** | Sheets and palette are glass; fixing it exposed a real containing-block bug. |

## 3. Home base, library, help

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 15 | Former landing page → immersive how-to in Help | **Done** | `/app/help`, six chapters, every number counted from the live registries. |
| 16 | A project library like the idea library | **Done** | `/app/library`. |
| 17 | Cards small and clickable, opening to full info | **Done** | Tagline, status, tags, about, rebuild spec, links, attachments. |
| 18 | Launch the app/site from the card | **Done** | Primary launch button plus extra links. |
| 19 | Full rebuild specs, about, tagline, full dump | **Done** | Markdown spec field; "Copy dump" exports the whole record. |
| 20 | Screenshots and attachments on cards | **Done** | Inline data URLs with a visible storage budget. |
| 21 | Explain what Modes does, and each mode | **Done** | Modes screen explains the four things a mode changes; each has a "Reach for it" line. |
| 22 | Same explanation for each category | **Done** | Every route carries a "What is this screen?" strip. A gate fails the build if one is missing. |

## 4. Weather

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 23 | A free weather API on the dashboard | **Done** | Open-Meteo, keyless. |
| 24 | Multiple sources merged into one picture | **Done** | Open-Meteo + MET Norway + US NWS, merged by median with the spread shown. |
| 25 | Conditions, radar, rain/snow | **Done** | All three, plus alerts and air quality. |
| 26 | A full weather dashboard | **Done** | `/app/weather`. |
| 27 | Default location Washington DC | **Done** | |
| 28 | Auto-refresh every 10 minutes | **Done** | While the tab is visible. |
| 29 | Live radar | **Done** | RainViewer over OpenStreetMap. |
| 30 | Radar zoom and move | **Done** | Drag to pan, zoom 3–10, recentre. |
| 31 | Radar history going back further | **Not possible** | The free feed publishes 13 frames = 2 hours, and the legacy endpoint returns nothing. The UI states the real span instead of implying more. |
| 32 | A predictive future radar section | **Partial** | RainViewer's forecast frames come back **empty**, so "What is coming" uses Open-Meteo's 15-minute forecast, labelled a point forecast rather than radar. If their nowcast ever returns frames the code already renders them. |
| 33 | Incorporate dashboard.openweather.co.uk | **Partial** | It is a **$250/month commercial product**, outside your $0 ceiling, so it is not a data source. I took two features their free tier supports: **map overlay layers** (precipitation, temperature, wind, cloud, pressure) using your own free OpenWeather key. **Their custom weather triggers/alerts are not built.** |

## 5. Data in and out

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 34 | Upload calendars like Google and Apple | **Done, by file** | `.ics` import, real Google export used as a test fixture. Handles all-day, zoned times with true DST offsets, and repeat rules. |
| 35 | Calendar subscribe by URL | **Not possible** | Google and Apple serve their feeds without CORS headers. Both tested from a real page: `Failed to fetch`. There is no URL box, because it could never work. |
| 36 | Memory import: paste, AI block, JSON, MD | **Done** | Paste or file, with a review step before anything is saved, and de-duplication. |
| 37 | Memory import: PDF | **Not done, deliberately** | PDF text lives in compressed binary streams and needs an engine this app does not bundle. It refuses with the reason and points at paste, rather than returning mojibake. |
| 38 | "All the files" | **Partial** | JSON, Markdown, CSV, plain text. **Not** PDF, DOCX, XLSX or images. |

## 6. Backend and infrastructure

| # | You asked for | Status | Where it is / what is missing |
|---|---|---|---|
| 39 | How to connect Supabase without exposing secrets | **Answered** | `docs/supabase-secrets.md`, summarised on the Cloud screen. The anon key is meant to be public; RLS is the protection; never paste `service_role`. |
| 40 | Something broke connecting Supabase via GitHub | **Fixed, unverified by you** | Default implicit OAuth returns the session in the URL **fragment**, which collided with the hash router. Switched to PKCE. I cannot confirm against your project because I have never run the SQL. |
| 41 | DuckDuckGo API as a browser | **Partial** | `ddg_answer` tool works. **An in-app browser is impossible** — DuckDuckGo sends `x-frame-options: SAMEORIGIN`, as does nearly every major site. |
| 42 | Features from JARVIS_Features.md | **Partial — most not built** | Built: hyperlocal weather + radar + air quality + NWS alerts, spoken briefing, proactive nudges, command palette, tool-use console, drag-resizable-ish tile grid, graceful degradation. **Not built:** wake word, voice input, markets/FRED, ISS, flights overhead, news summarisation, GitHub activity, calendar auto-sync, Spotify, sports, uptime, semantic memory with pgvector, scheduled cloud agents, threshold alerts, RAG over documents, multi-model router display, kiosk mode, boot sequence, sound design. |

## 7. Bugs you reported

| # | Symptom | Status | Cause |
|---|---|---|---|
| 43 | Crash: failed to fetch dynamically imported module | **Fixed** | I rebuilt while your tab was open; hashed chunk vanished. Now recovers with one silent reload. My first fix caused a 144-reload loop, caught before shipping. |
| 44 | Crash: cannot read properties of undefined (reading 'tone') | **Fixed** | I changed the persisted weather shape without a migration. `read()` now validates shape and discards stale payloads. |
| 45 | Fields accept one character at a time | **Fixed** | `Sheet`'s focus effect depended on the inline `onClose` prop, so every keystroke re-ran it and pulled focus. |
| 46 | Copy does not work | **Fixed** | `clipboard.writeText` was rejected in this context and the app claimed success anyway. Now tries the modern API, falls back to `execCommand`, and on total failure shows the text to copy by hand. |
| 47 | Sidebar still opaque | **Fixed** | See below. |

---

## The sidebar, honestly

You asked three times. The first two times I changed the CSS opacity of the rail
and it looked identical, because **nothing was behind it to see**. The rail
occupied its own 72px flex column, so the "translucent" panel was showing the
empty page background.

The fix was structural, not cosmetic: the rail is now a fixed overlay with zero
width in the layout, and the content area is padded to sit underneath it. I
measured it rather than eyeballing — a red band behind the rail now reads
**170/255** through the glass, where before there was nothing behind it at all.

The second time you asked, I also fixed the wrong bar entirely: I changed the
desktop rail while you were looking at the **bottom tab bar**, which was 94%
opaque and which I had never touched. That is now 48% with a 28px blur.

---

## Known gaps, in priority order

1. **Weather triggers and alert rules** — the main OpenWeather-dashboard feature
   still missing. Buildable with free data.
2. **Most of JARVIS_Features.md** — the widget grid (markets, ISS, flights,
   news, GitHub) is not built.
3. **PDF, DOCX and image import** into memory.
4. **The Supabase SQL has never been executed** against a live project, so the
   `projects` and `calendars` sync paths are written and reviewed but unproven.
5. **Nothing has been deployed** to your accounts.
6. One flaky test observed once (`privacy: STRICT`) and not reproduced in two
   subsequent full runs. Recorded rather than dismissed.
