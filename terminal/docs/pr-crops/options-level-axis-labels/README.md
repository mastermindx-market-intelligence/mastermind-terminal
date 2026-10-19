# Options-level coverage and axis-label browser evidence

Current browser-capture source head: `c41f3578883fd77b48d99b8abef8bba3962d6cf1`

## Outcome under proof

The chart consumes three independent, root-scoped stores:

- `options_hub.gex/v1` remains authoritative for every signed level it actually publishes.
- `options_structure.gex_state/v1` fills only missing `call_wall`, `put_wall`, and `gamma_flip` values.
- `options_hub.moves/v1` remains the only source of `EM+` / `EM−`.

No missing value is fabricated and a payload belonging to another root is rejected. The six-line browser scenario deliberately exercises a no-level GEX payload plus current state fallback, expected moves, and an `ABS γ` strike.

The horizontal lines remain at the exact prices `[192.42, 192.44, 192.46, 192.52, 192.58, 192.60]`. Native canvas badges are suppressed; the shared DOM axis layer fans badges vertically and, when necessary, inward into additional lanes. It also clears the chart legend, visual-context trigger, and fullscreen control. PRE/AH/ON owns the countdown while extended-hours pricing is active; regular hours returns the timer to the current quote.

## Coverage census

`coverage-audit-summary.json` is a compact receipt from a complete public-plane audit of all 662 roots in the current `gex_state` index (index as-of `2026-09-16T16:00:00-04:00`):

- 319 roots had all three signed GEX fields absent but at least one current state level available.
- 24 more roots had a partial signed-level gap fillable from current state.
- 7 were published no-OI GEX shells rescued by state: `BABA`, `GOOG`, `INTC`, `NFLX`, `SPCX`, `UBER`, `WBS`.
- 34 missing fields were absent from both planes and therefore remain absent.
- 349 roots had a valid expected-move band; 313 did not and remain without EM labels.

`TSM` was not present in the audited state universe and had no sampled GEX/moves artifact. This change does **not** claim or invent TSM options levels.

## Browser captures

`manifest.json` binds five local browser captures and their SHA-256 hashes:

- `desktop.png`
- `tablet.png`
- `mobile.png`
- `desktop-left-percentage.png`
- `desktop-compact.png`

Every capture proves six visible option badges, exact native line prices, native axis-label suppression, no label/chrome rectangle overlap, extended-hours timer ownership, and no console/page error. The payloads are intercepted contract fixtures; this is UI/contract proof, not production market-data proof.

Capture command:

```bash
BASE_URL=http://localhost:35911 node docs/pr-crops/options-level-axis-labels/capture.mjs
```

Start that dev server with the `playwright.config.ts` `webServer.env` block (signed-in fixture
`TERMINAL_E2E_EMAIL`, `TERMINAL_E2E_ENTITLEMENT=unlimited`, `FLOW_FIXTURE=1`, the fixture Supabase
values, ...), copied verbatim rather than guessed. Without it the page renders as an anonymous
free-tier guest: the `MAX_ANON_IND` clamp overwrites the seeded `mm.inds=["optlevels"]` and the
free-tier gate keeps Option Levels off, which presents as six hidden badges, no price lines and
zero console errors — an environment mismatch that reads like a product failure.

Use `localhost`, **not** `127.0.0.1`. Next 16 refuses cross-origin dev resources, so a page
loaded from `http://127.0.0.1:<port>` gets its SSR HTML but never hydrates — the capture then
dies on `waiting for locator('.chart-wrap canvas')` with nothing in the browser console, which
reads as a product failure rather than an origin mismatch. (A dev server started with an
explicit `--hostname 127.0.0.1`, as `playwright.config.ts` does, is the exception.)

## Historical 2026-10-18 chart-control integration recapture

The October 18 five-capture manifest bound source `15ecb15aa37dfb54c7aab0b04239a1a61f4bdd02` and the unchanged capture owner. All five scenarios passed, including six exact price lines, native badge suppression, no label/chrome overlap, extended-hours timer ownership, and empty console/page/HTTP error lists. Manifest SHA-256: `6ac8122a329f4ddaa108d2872fdcad51f54328b2369946410837fa5e06267a3b`.

The canonical fixture environment and explicit `--hostname 127.0.0.1 --port 3568` server returned HTTP 200 for `/terminal?symbol=NVDA`, then ran `BASE_URL=http://127.0.0.1:3568 node docs/pr-crops/options-level-axis-labels/capture.mjs`. An earlier server attempt returned 404 before captures started; its log is retained, and its cause is not attributed to the product or user agent. The successful run changed no product assertions. The historical 662-root census above was not rerun or restamped. These remain deterministic local UI/contract fixtures, not live market or model proof.

## 2026-10-19 current integrated-source recapture

The unchanged capture owner actually regenerated all five scenarios at 2026-10-19T00:39:05.440Z on source `c41f3578883fd77b48d99b8abef8bba3962d6cf1`. The manifest SHA-256 is `b32ecd4aee5de4ffc23c4c56ab367f90875f86b642480442ffef925987a9d5e7`. Six exact price lines, native badge suppression, no label/chrome overlaps, timer ownership and empty console/page/HTTP error arrays remain verified. All seventeen assertions across the four affected source-bound evidence suites passed afterward.

The server used the current `playwright.config.ts` fixture environment and explicit `--hostname 127.0.0.1 --port 3568`; the command was `BASE_URL=http://127.0.0.1:3568 node docs/pr-crops/options-level-axis-labels/capture.mjs`. The owned fixture server was stopped after capture. The historical 662-root census was not rerun or restamped. This is deterministic UI/contract evidence, with no production-data or ordinary-model claim.
