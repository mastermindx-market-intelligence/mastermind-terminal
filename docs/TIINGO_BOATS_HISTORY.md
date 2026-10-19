# Persistent BOATS history in the existing intraday route

This source slice builds on Terminal #1059 (`59bcbab2a9d6dfcdd91f29d862d9713dc1f15706`).
It consumes the paired Macro offline `scripts/tiingo_chart_history.py` exporter.
No provider request, raw capture, scheduler, public data upload or service change
is part of this slice.

The existing `/api/intraday?sym=AMD&tf=5m&session=24h` route loads
`<TIINGO_BOATS_HISTORY_DIR>/AMD.json` only after its existing authentication gate.
The directory is private server storage, outside `public/`. With the variable
unset, the route records `boats_history.status=disabled` and serves the existing
provider path. Missing ticker files report `missing`; malformed files report
`malformed`; both preserve the existing provider. Regular/extended charts and the
second-resolution lane do not read BOATS history.

The strict schema `terminal.tiingo_boats_history.v1` preserves UTC minute OHLCV,
source receipts and per-bar receipt IDs. The reader converts UTC into ET display
epochs, applies the incumbent immutable NYSE calendar and resamples each overnight
phase separately. Missing minutes remain gaps; candles never span 04:00 into
premarket. A provider candle at the same epoch retains authority, and the response
reports collision exclusions. Two venues are never combined inside a candle.

The response includes exact input SHA256, receipt IDs and capture clocks under
`boats_history`, plus `tiingo_boats_rest` source counts in the existing
`source_evidence`. Capture time is not market-data freshness. Coverage always
remains `captured_vendor_bars_only`, `complete=false`, price basis
`vendor_reported_unqualified`, volume basis `vendor_reported_shares`. Unknown
volume refuses the file; it is never zero-filled. No raw/adjusted equivalence,
consolidated tape, PIT, dated instrument identity or full-session claim follows.

The [official BOATS REST documentation](https://www.tiingo.com/documentation/boats)
describes overnight-only historical OHLC and BOATS share volume exposed when
`columns=open,high,low,close,volume` is explicitly requested. Stream trade/break
messages are not inputs to this history adapter.

Activation belongs to the assigning delivery owner: land the paired source,
install the selected candidate files in private server storage, configure the
existing Terminal process, release through its git-gated normal path and verify
repeated API/browser loads. All-ticker coverage still requires accepted captures
for those tickers. A source-ready adapter and three local candidate symbols do
not establish all-ticker or production acceptance.

Integration validation 2026-10-19: the retained parser from Fabric operation
`tiingo-history-contract-01a152ae-20261018` was exported on its original carrier
and manifest hashes were checked. Parent integration aligned the ticker grammar,
rejected repeated/fragmented interval queries and duplicate per-bar lineage.
The real Vitest parser/store/route/evidence checks passed 70 cases before these
repairs; integrated validation then passed 88 cases and the final focused set
passed 44, including the real ChartPane settings hydration. TypeScript passed.
Private AAPL/AMD/SOXX candidates load at 1m, 5m and 12h with 687/720/14,277 input
bars, preserving complete=false. No data rows are committed.

The chart receives history availability from its accepted API response and keys
it by symbol/timeframe. Its EN/ZH notice distinguishes captured historical bars
from the live-observation fallback; settings describe venue-only historical
volume and unavailable live-observation volume. Source availability cannot leak
from the previously viewed ticker or timeframe. Browser and production release
remain separate from these local source checks.
