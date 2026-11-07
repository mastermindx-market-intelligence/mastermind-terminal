# Returns Calendar — data contract and implementation note

## Current integration amendment — 2026-11-05

This amendment governs the recovered PR #814 implementation. The October transport narrative below is retained as historical design evidence; its Alpaca adapter, loopback endpoint, two wall-date requests, 60-second cache, split-adjustment claim and early-close 20:00 specimen are superseded by the existing owners now on Terminal master. Original feature acceptance remains the shared Terminal/dossier preview, one full Returns research page, observed daily/monthly price returns, selected sessions, bilingual disclosures, CSV and keyboard access.

### Current data and truth contract

- Daily records still come from the already-loaded canonical daily bars. Returns use the previous **observed** close, including explicitly reported calendar gaps. No missing value is estimated. The current input does not certify price adjustment or total return.
- One selected-date request uses `/api/intraday?sym=SYMBOL&tf=30m&ext=1&session=24h&study=returns&date=YYYY-MM-DD`. The existing 24H owner already includes the prior evening. No second `overnight=only` request or Alpaca Hub/proxy owner is installed.
- The existing daytime cache/single-flight owner scopes precise 5m storage to the selected wall date **before** resampling/capping. Unrelated history outside the calendar projection cannot prevent a valid selected-date lookup. If no precise local observations exist, one date-scoped request uses the incumbent Massive aggregate source. Normal chart acquisition is unchanged. The existing 45-second TTL, short failure cooldown, capacity bounds and source/access partitions remain; study mode is distinguished inside the same cache and pending-flight maps.
- Selected-study callers wait at most 10 seconds for the same owned work. The existing 8-second upstream deadline reaches the actual fetch/body through its abort signal. A caller's foreground timeout does not cancel or replace shared work, and it is not claimed to bound all subsequent filesystem work. Pending/failed acquisition is disclosed. Successful acquisition is **not** proof of full market-session coverage or freshness.
- Authentication remains before private demand and cache access. BOATS live demand requires a verified user; signed-in/private history remains partitioned from anonymous history. No auth, entitlement, collector or publication control is added.
- Existing `source_evidence` preserves per-source counts and store-read hashes. The consumer binds symbol,30m timeframe, selected trading date, display-epoch basis and returned-bar scope. It does not invent a top-level provider identity for a mixed-source response. The date helper refuses explicit provider ticker/count contradictions, malformed bars and truncated pagination.
- Existing Tiingo BOATS evidence is `complete:false`, `coverage:captured_vendor_bars_only`, and `price_basis:vendor_reported_unqualified`. Both observed overnight halves contribute OHLC/count, but the full overnight percentage is withheld even when observations exist. Valid daytime and daily data remain independent of overnight absence/failure. Daytime returns describe only the first-to-last observed eligible aggregate bars, not certified every-print extrema.
- The server's existing exchange calendar/phase owner supplies `regular_session_window {start_minute,end_minute,post_end_minute}`. Normal post-session end is 20:00; the current early-close owner ends it at 17:00. A known closure and unavailable calendar authority are distinct, and neither authorizes guessed hours or provider demand. The new Returns client modules do not import the calendar projection.

### Navigation, CSV and styling

Arrow keys move a separate roving focus through actual calendar slots; vertical arrows stay in the calendar column and skip absent observations. Home/End target the current row. PageUp/PageDown move month and restore focus to a real observed day, or to the empty-month group when there is none. Click/Enter/Space activate the selected day and its one data request. Focus movement alone does not reload the inspector. IME composition and modified shortcuts retain their normal behavior.

CSV exports only the displayed full year/month. The original nine fields are retained in order, followed by `return_basis` and `quality`. The basis remains `daily_price_return_adjustment_unverified`. Existing quality tokens `missing_prior_reference`, `observed_return`, and `observed_return_with_calendar_gap` retain their meanings. The additive token `unavailable_return` means that the prior reference exists but the derived percentage is not finite/available; the return field is blank while the observed prices and reference fields remain. A calendar gap includes intervening weekends/holidays and is not a claim of missing trading sessions. Null or non-finite numbers remain blank and actual zero remains 0. Daily, monthly and session percentages are checked after calculation, including percentage-conversion overflow. Withheld returns are excluded from Up/Down/Flat/Best/Worst and carry no gain/loss styling in either Returns surface; an available reference with an unavailable calculation is disclosed separately from a missing reference.

The two Returns surfaces use their own CSS module while retaining existing DOM/test class hooks. Global stylesheet bytes remain unchanged, preserving other evidence owners. Current research families, command-palette labels, shared navigation and ownership consumers remain the baseline.

### Evidence ceiling

Source recovery is tracked in [PR #814](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/814#issuecomment-6657539712). Pure model/parser, provider, store, cache and route probes execute actual source with controlled IO/clock boundaries; they do not certify native React/browser layout, a full project typecheck, provider credentials/entitlement, production data or deployed acceptance. Original historical evidence remains bound to its original source. Natural new-head CI and any genuine production proof keep their own receipts.

---

## Retained October design record


Date: 2026-10-04  
Owner surface: TerminalShell shared detail rail / native stock-dossier slice  
Implementation branch: `sol/returns-calendar-20261004`

## Product contract

The calendar is a five-column trading-week view. Each populated day shows:

- close-to-previous-close return;
- daily high and low from the canonical daily bar;
- a selectable detail state containing daily O/H/L/C;
- four U.S. session lanes: Overnight, Premarket, Regular, After hours.

Session boundaries are Eastern Time and half-open:

| Session | Trading-date assignment |
| --- | --- |
| Overnight | prior calendar day 20:00 <= t < selected day 04:00 |
| Premarket | selected day 04:00 <= t < 09:30 |
| Regular | selected day 09:30 <= t < 16:00 |
| After hours | selected day regular close <= t < 20:00 |

For a normal NYSE session, regular close is 16:00. On canonical early-close dates it is 13:00,
and the after-hours lane begins at 13:00. The **server-side intraday owner** reads this from the
existing `usEquitySessionClock` projection and returns only
`regular_session_window {start_minute,end_minute}` to the client. The large 2016–2028 projection
is therefore not bundled into Terminal's browser code, and the calendar does not maintain a second
holiday/half-day authority.

A session return is `session_close / session_open - 1`. A day return is
`daily_close / previous_trading_day_close - 1`. They are intentionally different metrics.

## Existing Mastermind data plane

No second market-data owner is introduced.

- Daily return and daily H/L use the already-loaded `Bar[]` already owned by TerminalShell.
- The calendar is mounted once in TerminalShell's shared detail rail, so the browser Terminal and
  native `?shell=app&dossier=1` slice use the same component/data contract.
- Selected-day session detail hydrates lazily through the existing authenticated
  `/api/intraday` route using `tf=30m&ext=1&overnight=1&date=YYYY-MM-DD`.
- Massive/store remains the canonical 04:00–20:00 intraday owner. The optional overnight lane is
  delegated over loopback to **Quote Hub**, which already owns all extended/overnight market data,
  Alpaca credentials, source selection, and singleton request capacity.
- Quote Hub exposes `/overnight-bars?symbol=...&date=...&tf=...` on localhost only. Its historical
  BOATS adapter requests one ET wall date, emits the app's ET display-epoch convention, returns only
  20:00–04:00 bars, uses split adjustment, caps current-date history 15 minutes behind now, caches
  for 60 seconds, and fails soft with a closed coverage status.
- `/api/intraday` merges those disjoint BOATS bars after date-scoping the canonical response;
  canonical Massive/store bars win any unexpected epoch overlap.
- Overnight is assembled in the component from the prior calendar day's >=20:00 BOATS bars plus the
  selected date's <04:00 BOATS bars. The prior-wall-date request uses `overnight=only`, which exits
  after the authenticated Quote Hub lookup and deliberately skips Massive/store work for data the
  client would discard. If Hub credentials/entitlement/data are absent, the API reports explicit
  `overnight_evidence` and the UI renders a dash rather than estimating.

The selected-day study deliberately uses **30-minute** bars. The existing extended-session resampler
anchors at 04:00 ET; 30 minutes lands exactly on 09:30, 16:00, and 20:00, while a 1-hour bar
would create a 09:00–10:00 bucket that straddles the premarket/RTH boundary. Publishing session
H/L from that 1-hour grain would be numerically wrong.

If the ordinary stored/recent assembly has no 30-minute bars for the selected date, the existing
intraday owner makes one **date-scoped Massive aggregate request** for that ET calendar date and
caches the result for 60 seconds. This is a fallback inside the same owner, not a second data plane.
If that precise request is empty or unavailable, the session stays blank rather than falling back
to a boundary-crossing hourly approximation.

This makes the feature useful immediately without increasing Terminal first-paint data cost.

## Provider findings

### Massive

Massive's U.S. equity trade/quote coverage spans 04:00–20:00 ET, covering premarket,
regular, and after-hours. Its aggregate bars are built only from qualifying trades; many
extended-hours prints do not update aggregate OHLC. Therefore the calendar describes these
values as **eligible aggregate-bar OHLC ranges**, not absolute tape extremes.

Relevant docs:

- https://massive.com/knowledge-base/article/does-massive-offer-pre-market-and-after-hours-data
- https://massive.com/docs/rest/stocks/aggregates/custom-bars

For an exact “highest/lowest printed trade” product, the correct future lane is raw
`/v3/trades` aggregation with sale-condition semantics, not relabeling aggregate-bar H/L.

### Alpaca / BOATS

Alpaca exposes overnight U.S. market data from 20:00–04:00 ET. Its historical bars API
supports the `boats` feed. Alpaca's current 24/5 documentation explicitly says the **Free Plan**
can request historical BOATS bars/quotes/trades on a 15-minute delay (the request `end` must be
at least 15 minutes old), which makes this the lowest-cost clean historical overnight source for
this product. The repo already contained an Alpaca overnight websocket path for live extended-hours
quotes inside Quote Hub. This implementation extends **that same owner** with a bounded historical BOATS
adapter and localhost endpoint; Terminal remains credential-free for Alpaca and only proxies the
selected wall date. The adapter is split-adjusted to match the canonical Massive aggregate basis,
15-minute-delay safe, fail-soft, and cached for 60 seconds.

Relevant docs:

- https://docs.alpaca.markets/us/docs/245-trading-for-trading-api
- https://docs.alpaca.markets/us/reference/stockbars
- https://docs.alpaca.markets/us/docs/historical-stock-data-1

### Alternative overnight sources considered

**Webull official API** now exposes explicit overnight fields on stock snapshots
(`overnight_required=true`, including overnight H/L/volume) and authenticated market-data
interfaces for historical bars/ticks. That is useful corroboration and a potential future vendor
adapter, but the public historical-bars documentation does not make the same clear historical
20:00–04:00 BOATS entitlement/retention promise that Alpaca does, and Webull's server API requires
app-key/access-token/signature machinery. The existing keyless Webull code in Quote Hub remains a
best-effort live fallback and is **not** promoted into a historical owner.

**Massive** remains superior for exact 04:00–20:00 tape work. Its own documentation warns that
aggregate OHLC excludes many condition-ineligible extended-hours prints and explicitly recommends
`/v3/trades` when the real extended-hours tape is required. If this product graduates from
eligible-bar extrema to absolute printed-trade extrema, the next implementation should aggregate
Massive raw trades with explicit sale-condition policy for premarket/RTH/after-hours; that is a
separate metric and should not silently replace today's aggregate semantics.

## Availability rule

The UI must distinguish **no eligible aggregate bar** from **zero range**. A missing value is
rendered `—`; it is never coerced to the regular-session open/close or copied from another
session.

For current Mastermind coverage:

- daily: canonical daily bars;
- premarket / regular / after-hours: existing Massive/intraday path where available;
- overnight: Alpaca BOATS historical bars when Quote Hub's existing `ALPACA_API_KEY` /
  `ALPACA_API_SECRET` are configured and entitled; otherwise `overnight_evidence` reports
  `not_configured` / `unavailable` and the lane is explicitly blank.

## Overnight hardening still required for guaranteed fleet-wide history

The selected-day product path is now wired, but coverage is not yet guaranteed across every
ticker/date. The next data-plane upgrade stays with Quote Hub + the existing intraday store:

1. verify production Quote Hub BOATS credentials and historical entitlement on the deployed Hub;
2. persist 1–5 minute overnight bars under the same point-in-time/session conventions as the
   current intraday store so dossier reads do not depend on an on-demand vendor call;
3. backfill the desired universe/date horizon;
4. add completeness checks around NYSE holidays, half-days, DST transitions, symbol changes,
   and no-trade intervals;
5. only then promote overnight from availability-aware to coverage-guaranteed.

## UX and performance decisions

- The calendar is owned by TerminalShell's shared detail rail and is placed immediately after the
  StockAnalysis research/market-data stack and before the trailing full-analysis / Ask-AI actions.
  This avoids invalidating StockAnalysis's locked visual-evidence packet while keeping one calendar
  implementation across browser rail and native dossier.
- Only the selected date triggers historical intraday requests.
- Empty weekdays/holidays are visually inert.
- Return direction uses color plus signed numeric text, so meaning is not color-only.
- H/L is visible in every populated cell; selected-day O/H/L/C and session H/L are shown below.
- Mobile keeps the five trading-day columns but reduces typography/padding and uses a 2x2
  session grid.

## Paper specimen

Paper file: `01M3P1TW5Y3XWQC37ADDS8K5AG`  
Page: `p-7-0` — **06 · Returns Calendar · Terminal + Dossier**  
Desktop artboard: `AOD-0` — **Returns Calendar · Stock Dossier · Desktop**  
Mobile artboard: `AT2-0` — **Returns Calendar · Native Dossier · 390**

Both specimens use the existing Mastermind dark tokens and explicitly show an unavailable
overnight lane so the product contract remains null-honest. The 390px specimen preserves the five
trading-day columns, stacks H/L inside each cell, and uses a 2×2 selected-session detail grid.
