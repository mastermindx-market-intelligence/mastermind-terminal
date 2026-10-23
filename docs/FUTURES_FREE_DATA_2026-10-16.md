# Futures Terminal — zero-new-license data decision (2026-10-16)

Scope: extend the authenticated ES/NQ GEX, Depth and Footprint workspace without pretending that a freely accessible API grants third-party commercial redisplay rights. This is not a license approval.

## Shipped code in this branch: CFTC weekly positioning

- Official **CFTC Traders in Financial Futures, futures-only** Socrata dataset: https://publicreporting.cftc.gov/Commitments-of-Traders/TFF-Futures-Only/gpe5-46if
- CFTC public data/download policy: https://www.cftc.gov/data
- Fixed futures-only market codes: ES `13874A` (E-MINI S&P 500), NQ `209742` (NASDAQ MINI); the latter is not a Nasdaq-100 consolidated report, a micro contract, or NDX options.
- Position categories: dealer/intermediary, asset manager/institutional, leveraged money, and other reportables. Long, short, spreading, net and when two comparable weeks exist, change in net. All values in futures contracts, not dollars.
- Tuesday source *position date* is shown; CFTC typically releases Friday. The API does not expose record-level first-available timestamps, therefore this panel is **NOT replay eligible** and never maps COT to gamma, depth, options positioning or executed-volume cells. Report retrieval time is not publication time.
- Protected existing Options entitlement and rate limits apply. The route uses the official CFTC origin and fixed market codes, caches source fetches on a bounded cadence, returns `private, no-store` to clients, and refuses malformed/stale/unknown rows. The card remains visible when the separate CME futures publication is unavailable.
- Direct official data probe on October 16 returned report date October 13 with ES and NQ data. This proves the dataset is reachable, not live market-depth service.

## Other candidate sources and precise commercial boundaries

| Source | Free access | Data obtainable | Decision |
|---|---|---|---|
| LSEG delayed market data (https://dmd.lseg.com/) | Yes, 15m delay | Semicolon-delimited per-minute XLON, Turquoise and APA pre/post-trade files | **Internal source-format research only** without a distribution license; these are UK instruments, not ES/NQ and not a CME MBO reconstruction |
| LSEG Level 2 real-time | No general free distributor license | London full order-book depth | Do not publish commercially without agreement; delayed charged redistribution also requires a license: https://www.londonstockexchange.com/delayed-market-data/terms-and-conditions.htm |
| CME website delayed futures quotes | Browser viewing, at least 10m delayed | ES/NQ summary prices/charts, not true depth/footprint | Link to CME only until distribution rights established: https://www.cmegroup.com/market-data/browse-data/delayed-quotes.html |
| Coinbase Exchange WebSocket | No API-key needed on some market channels | Live spot crypto level2 and matches | August 2026 Market Data Terms prohibit end-user app/third-party distribution and derived works absent consent: https://www.coinbase.com/legal/market_data |
| Kraken WS v2 | Public access | Spot crypto level2/trades | Kraken requires prior permission for nonpersonal commercial public-endpoint data use: https://docs-legacy.kraken.com/api/docs/guides/global-intro/ |
| Binance Vision | Free downloads | Historical crypto trades and book-related datasets | August 2026 terms CC BY-NC-SA; no paid Terminal commercialization absent separate agreement: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md |
| Databento/CME GLBX.MDP3 | Public samples exist; licensed operational feed | Genuine ES/NQ MBO, trades, market status | Use existing historical test proof; **do not** promote a public sample or self-serve subscription to commercial redisplay authority: https://www.cmegroup.com/market-data/license-data/market-data-policy-education-center.html |
| Existing Macro ThetaData store | Existing access, not newly free | SPX/SPXW Greeks and OI EOD | Keep incumbent source publication owner; source-session, SPX/SPXW contract family aggregation, availability and distribution rights must be qualified. NDX/NDXW EOD shards not verified present. |

## Next in-scope unlock

Offer official weekly positioning as a free-source adjunct; never replace futures order flow with the COT report or London equities. For real live ES/NQ Depth/Footprint, the required data remains CME futures MBO/depth and executions under an authorized redistributor/subscriber-display agreement. Bring-your-own brokerage entitlement is not automatic commercial or non-display permission. Do not turn the historical sample into a live subscriber feed. Preserve actual source/rights/receipt failures as unavailable.
