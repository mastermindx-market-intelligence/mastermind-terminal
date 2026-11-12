# Large Trades — Data Inspector owner proof

**Accepted local synthetic desktop evidence.** Both journeys passed on source `3b18fd7360903f2a3a7097700f0d0182e6294386`. This packet proves that a table request returns to its AAPL bar after remount, while an old AAPL response cannot take over a subsequently selected NVDA chart.

| Journey | Actual result | Evidence |
| --- | --- | --- |
| Same-owner remount | Exact AAPL 09:30:10, index 2 | [Selected row](aapl-table-selection.png), [restored chart](aapl-restored.png), [native export](aapl-native-export.png) |
| Different-owner response race | AAPL request is replaced; NVDA retains ownership before/after old response | [Before](nvda-before-old-response.png), [after](nvda-after-old-response.png), [native before](nvda-native-before.png), [native after](nvda-native-after.png) |

The seven published PNG files are unmodified copies of recorded captures. The two native NVDA files were downloaded separately and have identical bytes. The independent reviewer opened all eight original files, including the second AAPL table screenshot retained in the original evidence. [manifest.json](manifest.json) records hashes, dimensions, source identity, actual observations, errors and cleanup; [history.json](history.json) retains earlier failed and unexecuted attempts.

## Meaning of the quantities

AAPL has 1,301/1,500/1,800/1,600 synthetic shares (6,201 across 7 reports). NVDA has 2,602/3,000/3,600/3,200 synthetic shares (12,402 across 7 reports). These quantities come from explicit fixture transaction records. Candle volume 7 is unrelated and is not used as executed quantity. Distinct orders are unavailable. Native export footers preserve that distinction.

## Verification scope

- Two 1440×900 desktop browser journeys; actual table selection, Show on chart, symbol picker, held responses and native PNG downloads.
- The visible picker verifies 5s twice per case. Startup observations remain preserved; saved-preference restoration is not certified.
- Zero page, console, route, failed HTTP-response and diagnostic-overflow counts. Separately retained aborted requests number 8/9; they are not described as a clean network.
- Source and runner bytes remain unchanged through the run. Both contexts/routes close, the browser disconnects, the server exits 143 after owned cleanup, and the final listener/fixture/unresolved census is 0/0/0.
- Independent review accepts the bounded result with one LOW visual issue: crowded right-side table headings. The selected row and Show on chart remain readable. The NVDA left circle is plot-clipped while its complete 2,602 label remains visible.

Whole-shell quotes and status values are ancillary fixtures, not coherent market-price evidence for the deliberately synthetic candles. Fixture envelope hashes are witness bindings, not authenticated vendor source. This packet adds no mobile, replay, live-feed, CME, empirical-absorption, current hosted-CI or production claim. Earlier real IEX evidence retains its separate historical scope.

Later integration `914b83d7` merges reviewed protected `e0c405a0` without altering these capture bytes or restamping their source. The combined checkout still requires its current hosted checks and native release gates.
