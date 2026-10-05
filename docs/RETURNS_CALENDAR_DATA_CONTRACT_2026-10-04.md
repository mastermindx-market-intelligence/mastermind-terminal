# Returns Calendar — data contract and implementation note

Date: 2026-10-04  
Owner surface: Terminal `StockAnalysis` / stock dossier  
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

- Daily return and daily H/L use the already-loaded `Bar[]` supplied to `StockAnalysis`.
- Selected-day session detail hydrates lazily through the existing authenticated
  `/api/intraday` route using `tf=1h&ext=1&date=YYYY-MM-DD`.
- The route already owns server-side vendor credentials, source selection, stored-history
  stitching, U.S. session filtering, rate limiting, and cache semantics.
- Overnight is assembled from the prior calendar day's >=20:00 bars plus the selected
  date's <04:00 bars. If those bars are absent, the UI renders a dash and does not estimate.

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
data. The repo already contains an Alpaca overnight websocket path for live extended-hours
quotes, but historical overnight entitlement/retention has not been promoted to a canonical
Mastermind historical owner.

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
- overnight: first-class schema and UI lane, populated only when historical 20:00–04:00 bars
  are actually present.

## Recommended overnight hardening

The next data-plane upgrade should be made in the existing intraday market-data owner, not in
the component:

1. add a licensed historical overnight source adapter using Alpaca `feed=boats`;
2. persist 1–5 minute overnight bars under the same point-in-time/session conventions as the
   current intraday store;
3. expose source and coverage metadata through `/api/intraday`;
4. backfill the desired universe/date horizon;
5. add completeness checks around NYSE holidays, half-days, DST transitions, symbol changes,
   and no-trade intervals;
6. only then promote overnight from availability-aware to coverage-guaranteed.

## UX and performance decisions

- The calendar sits directly after the existing Performance block: aggregate performance first,
  day-by-day decomposition second.
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

The specimen uses the existing Mastermind dark tokens and explicitly shows an unavailable
overnight lane so the product contract remains null-honest.
