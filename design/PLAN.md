# Dashboard & navigation — plan (nothing built yet)

Status: **proposal only.** No file under `src/` has been touched. Everything here
lives in `design/`, which is not part of the build.

---

## 1. Weather: we do not need a new API

The app already ships a free, keyless weather path. `src/core/tools.ts` line 588,
the `weather` tool, calls **Open-Meteo**:

- `api.open-meteo.com/v1/forecast` — current temp, humidity, wind, weather code,
  plus a 3-day min/max and precipitation probability
- geocoding via `geocoding-api.open-meteo.com` (already wired)
- no key, no account, no rate ceiling we would realistically hit
- re-probed today from a browser origin: **HTTP 200, `access-control-allow-origin: *`**

There is also an optional OpenWeatherMap key that only upgrades the text
description. It is not required and I would not push anyone toward it.

So the work is **not** "add a weather API". It is "surface the weather we can
already fetch on the dashboard, and keep it fresh". That is a smaller, safer job.

### What surfacing it honestly requires

| Question | Answer |
|---|---|
| Where does the location come from? | Ask once, store locally. `navigator.geolocation` with a visible prompt, or a typed city that hits the existing geocoder. **Never** silent IP lookup. |
| What if the user declines? | The card shows a "set a location" state, not a fake city. |
| How often does it refresh? | On app open, then every 30 min while the tab is visible — reusing the existing routine ticker pattern, which already skips `document.hidden`. |
| What happens offline? | Last reading is cached with its timestamp and labelled `updated 2 h ago`. It never shows a stale number as if it were live. |
| Where does it appear? | Depends which layout you pick — see below. |
| Does it cost anything? | No. Stays inside the $0/month ceiling. |

One caveat worth stating now: Open-Meteo returns Celsius by default. A °F toggle
in Settings is about twenty lines, but it is real work, not free.

---

## 2. What is actually wrong with the current overview

From the baseline screenshot (`current-desktop.png`), at 1440px:

1. **Dead gutters.** The sidebar takes 236px, then the content column is capped
   narrow and centred, leaving roughly 270px of empty space on each side. Over a
   third of the window does nothing.
2. **Three stacked headers.** `JARVIS` in the rail, `Overview` in the appbar, then
   a full-width `Good morning`. The same idea announced three times before any
   content.
3. **The widgets are mostly zeros.** `Runs 0`, `0%`, `$0.0000`, `no runs yet`.
   Four cards of prime space telling you nothing happened. A dashboard should earn
   its space on day one, not only after heavy use.
4. **The sidebar is a long scan.** 15 destinations in 4 groups. It is honest and
   complete, but it is a lot of chrome for an app whose primary surface is a phone.
5. **Weather has no natural home** — which is part of why you are asking.

None of this is broken. It all works and it all passes the gates. It is a density
and hierarchy problem, not a correctness one.

---

## 3. Three directions

Rendered from real HTML using the exact tokens in `src/styles.css`, so the colours,
radii, type scale and tap targets are the shipping ones — not an artist's
impression. Desktop sheet: `concepts-desktop.png`. Phones: `concepts-phone.png`.

### A · Command deck
Sidebar shrinks to a **64px icon rail**; a top command bar takes over search and
status. Content goes **full-bleed in two columns** — no gutters. Weather sits in
the greeting hero with an hourly panel beside it.

- Best if: you want maximum information per screen and you like the cockpit feel.
- Cost: icon-only nav needs tooltips and careful `aria-label`s; discoverability
  drops for the 15 routes.

### B · Focus column
**No sidebar at all.** A horizontal nav carries the same five destinations as the
phone tab bar, and everything lives in one centred 720px column. Weather is a slim
strip under the greeting.

- Best if: you want the phone and desktop to be genuinely the same product, and you
  find the sidebar itself to be the problem.
- Cost: deep routes (Diagnostics, Providers) move behind a **More** menu — more taps
  on desktop. Wastes width on very large monitors.

### C · Split cockpit
Icon rail **plus a permanently docked agent thread on the right**. The overview
holds the middle. Weather is a status-bar pill that expands into a conditions card.

- Best if: you think the agent is the product and the dashboard is context around it.
- Cost: the biggest build of the three. Needs a real responsive strategy for the
  third pane, and chat state has to be shared between the docked pane and `/app/chat`
  without duplicating it.

---

## 4. Honest effort estimate

| Direction | Files touched | Risk |
|---|---|---|
| Weather on the dashboard | new `Weather` card, 1 settings block, `Home.tsx` | Low. The fetch path already exists and is tested. |
| A | `Shell.tsx`, `styles.css` rail + grid, `Home.tsx` | Medium. Nav markup changes, so the e2e tap-target and route sweeps need re-running. |
| B | `Shell.tsx` (rail deleted), `styles.css`, `Home.tsx` | Medium. Route coverage check in `verify.mjs` will flag the routes pushed behind More. |
| C | `Shell.tsx`, new pane, chat state refactor, `styles.css` | High. Shared chat state is the part most likely to introduce a real bug. |

Whatever we pick, the gates re-run before I call it done: 227 unit, 49 e2e,
8 iframe, 10 verify, contrast AA, 34 functional, audit 0 findings.

---

## 5. What I need from you

1. **Layout: A, B, or C** — or a hybrid (e.g. A's rail with B's column width).
2. **Weather location:** browser prompt, or a city you type in Settings?
3. **Units:** °C, °F, or a toggle?

I will not touch `src/` until you say which one.
