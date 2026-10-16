# Screener viewport and request-scaling proof

Source commit: `8648a7e0a6a557f87f0d67c72880a70fc3527ed9`.

The mobile page-scroll layout previously let the table grow to 418,034 pixels for a 9,500-symbol manifest. Its measured height caused the existing virtualizer to mount every row. The repair caps the table at the dynamic viewport height while preserving its existing scroll container, filters and complete result set.

The original mobile regression failed with 9,500 mounted rows. The repaired source passes six real Chromium 149 browser cases: 100 and 9,500 symbols at desktop 1440×900, tablet 820×1180, and mobile 390×844. Tablet and mobile use touch-enabled contexts. Each case ran with one worker and no retries. A diagnostic-only height constraint reduced the original mounted count, and removing it restored the failure; that control is separate from the committed-source tests.

| View | Initial mounted rows, both dataset sizes | Table height | Last row reachable by scrolling |
| --- | ---: | ---: | --- |
| Desktop | 25 | 532 px | Yes |
| Tablet | 39 | 1,180 px | Yes |
| Mobile | 32 | 844 px | Yes |

The full count remains 100 or 9,500. The +3% filter returns exactly 50 or 4,750 symbols, preserving null, 2.999%, 3%, and 6% boundary behavior. Search finds the final symbol and its exact price; clearing filters and scrolling reaches the final unfiltered row. Row pitch and spacer arithmetic account for every result.

Each fixture case observed one successful whole-manifest response and one absent flow-index response before interaction, with no additional financial request after filtering, searching, sorting or scrolling. There were no observed per-symbol requests, external requests, or owner writes. A synthetic request verifies the request classifier separately. The fulfilled manifest bodies are 10,399 and 1,003,549 bytes; these are response-body sizes, not measured wire-transfer sizes or cache-attempt counts.

The six PNGs show the 9,500-symbol search result and the full-universe tail, and were directly reviewed. The existing mobile stylesheet hides columns five onward at widths up to 640 px, leaving Symbol, Last, Chg%, and $ Vol visible. There is no horizontal overflow in this fixture. The earlier horizontal-scroll description was incorrect; no all-column mobile acceptance is claimed. The 100-symbol cases have functional measurements but their screenshots are not claimed as visually reviewed here.

TypeScript passes. The new browser test has zero lint errors or warnings. Nine existing component lint errors remain identical to the baseline. Earlier harness mistakes, a startup 404/cache failure, and the first filter-transition timeout are retained in the original evidence capsule; no independent cause is claimed for the latter two failures.

This is local fixture evidence on a prewarmed development server with a fresh browser context per case. It does not establish production latency, provider traffic, cache deduplication, the complete saved-screen workflow, accessibility, or release acceptance. All release and live-access holds remain.

The original 403 image corpus and its manifests, capture recipes, evidence tests and before images are unchanged. Original receipts and raw measurements remain in the IW2 evidence capsule `fable-commission-20261013/screener-request-scaling/mobile-virtualization`.

## Additional keyboard proof

Native Tab navigation focuses the table without programmatic focus. End reaches `IW09499`, and Home returns to `IW00000`, on desktop, tablet and mobile with zero owner writes. Desktop and tablet passed in the initial run. The initial mobile run correctly failed an invalid horizontal-scroll assumption; the corrected mobile-only run passed after asserting the existing four-column responsive layout. No product source changed between these runs. Three keyboard-tail PNGs were directly reviewed, and `keyboard-measurements.json` retains focus, scroll geometry, tab paths and the evidence correction.
