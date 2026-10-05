# Returns Calendar — data contract and implementation note

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
| After hours | selected day 16:00 <= t < 20:00 |

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
  selected date's <04:00 BOATS bars. If Hub credentials/entitlement/data are absent, the API reports
  explicit `overnight_evidence` and the UI renders a dash rather than estimating.

The selected-day study deliberately uses **30-minute** bars. The existing extended-session resampler
anchors at 04:00 ET; 30 minutes lands exactly on 09:30, 16:00, and 20:00, while a 1-hour bar
would create a 09:00–10:00 bucket that straddles the premarket/RTH boundary. Publishing session
H/L from that 1-hour grain would be numerically wrong. Where 30-minute history is unavailable,
the session stays blank rather than falling back to a boundary-crossing approximation.

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
supports the `boats` feed, and Alpaca documents historical BOATS availability for overnight
data. The repo already contained an Alpaca overnight websocket path for live extended-hours quotes
inside Quote Hub. This implementation extends **that same owner** with a bounded historical BOATS
adapter and localhost endpoint; Terminal remains credential-free for Alpaca and only proxies the
selected wall date. The adapter is split-adjusted to match the canonical Massive aggregate basis,
15-minute-delay safe, fail-soft, and cached for 60 seconds.

Relevant docs:

- https://docs.alpaca.markets/us/docs/245-trading-for-trading-api
- https://docs.alpaca.markets/us/reference/stockbars
- https://docs.alpaca.markets/us/docs/historical-stock-data-1

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
