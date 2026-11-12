# Terminal Tactical Intelligence: pre-open session-chain evidence

Operation: terminal-tactical-intelligence-d0-20260917-sol-002, continuing the existing Terminal #601 carrier. The Chairman explicitly continued the approved price-first program and permitted Studio fabric use. Procedure pin: protected Mastermind b731149296a9d837d426730813f68d5acc6133ac; Skillpack 1.0.1 compatible. The prior D0 qualifier was extended, not rebuilt or replaced.

## Capability delivered locally

The offline qualifier now answers whether the previous regular session, previous after-hours window and current premarket can be inspected together at a given pre-open cutoff. It uses the existing calendar to cross weekends, holidays and daylight-saving changes, preserves every expected decision date, and refuses to invent early-close AH schedules or split hourly boundary candles. Machine JSON and the existing Markdown consumer both expose the result. There is no new provider fetch, event/replay store, calendar, registry, scanner, or production activation.

## Real input population and reproducibility

Reused the eleven non-INTC five-minute histories captured in the preceding D0 operation. All eleven file hashes were rechecked against that operation's recorded hashes and matched; no replacement input or fresh network fetch was used. Their first observed dates differ: AAPL/AVGO/JPM/QCOM/XOM June 2, 2025; MU June 3; AMD June 5; QQQ/SPY June 11; NVDA June 12; SMH June 16. All end September 11, 2026. This is a fixed-current pilot, not a historical investable universe.

The common observation-date range begins June 16, 2025. The report intentionally extends through September 16, 2026 to retain the already-known missing tail rather than silently dropping it. The existing calendar provides **315 scheduled decision dates per name**. The first date's predecessor lies outside the requested window. Three next-session chains have an early-close predecessor with unqualified AH scheduling. September 14, 15 and 16 have no current premarket observations. These are input/schedule facts, not trading failures.

| Symbol | Scheduled decision dates | Some observations in all three qualified legs | Every nominal five-minute slot in all three legs |
|---|---:|---:|---:|
| AMD | 315 | 308 | 110 |
| NVDA | 315 | 308 | 308 |
| MU | 315 | 308 | 171 |
| AVGO | 315 | 308 | 80 |
| QCOM | 315 | 308 | 13 |
| SMH | 315 | 308 | 2 |
| QQQ | 315 | 308 | 261 |
| SPY | 315 | 308 | 216 |
| AAPL | 315 | 308 | 71 |
| JPM | 315 | 308 | 0 |
| XOM | 315 | 308 | 0 |

These are counts of archived input windows, not independent trades, pattern occurrences, profits, or accuracy. Some observations in every leg does not establish enough liquidity or data to trade. Full nominal grid does not establish complete trade coverage. Eleven symbols times 308 dates is not 3,388 independent scientific episodes.

Every name has 312 prior-RTH full-grid legs within the requested window, but the extended-hours grids differ sharply. A complete-case rule requiring every premarket/after-hours candle for every name would leave no common pilot sample because JPM and XOM have zero fully occupied three-leg chains. This is a methodological warning, not a reason to discard those names or promote NVDA. Later registration must distinguish missingness, observed participation and quote-confirmed liquidity, retain sparse-session controls, and never smooth gaps into fictitious steady bidding. Date/ticker clustering and uncovered/delisted populations remain research concerns.

As-observed mode produced **zero full chains** because legacy files carry no per-observation availability receipt. Corrected-history coverage therefore cannot be relabeled as prospective or point-in-time evidence. The strict grid diagnostic is not being installed as an eligibility gate.

Reports (private existing evidence area; raw bars not committed):
- session-chain-corrected.json SHA256: 8b98d565d17ad9f19089b3a9da12ed058268b748e5c4945ffc3b5fe732514894.
- session-chain-as-observed.json SHA256: 1a3c0ce576e90fe2767edf243a36f26a815deebcfb164c2237aad33cd711b720.

Exact consumer: scripts/qualify_intraday_research.py, original captured inputs, --start 2025-06-16 --end 2026-09-16, each of --mode corrected_history and --mode as_observed. Outputs are create-only. Existing report hashes identify bytes before the later wording-only Markdown clarification; JSON source/content is unchanged.

## Verification

The first new library test failed because session_chain_inventory did not exist; the real CLI test failed because session_chains was not wired. After implementation, **65 focused tests passed** (the original 46 plus 19 new tests). The complete existing Python suite returned **1,144 passed, 8 skipped, 1 warning**. Skips and the warning are the previously disclosed unavailable golden/deep-store fixtures and migration-guard conditions. compileall and git diff --check passed. This is author verification, not independent review or hosted final-head acceptance.

## Studio fabric readiness: exact observed boundary

The installed com.mastermind.executive.mcp service was running. Its transport is native MCP on port 8443; the legacy /v1/tools/executive_state route returned 404 unknown Executive transport route. One harmless initialize request to the documented /mcp endpoint returned **HTTP 401, invalid_token, Authentication required**. App discovery exposed no authenticated Mastermind Executive action in this conversation. No token was read or copied, no service/auth settings changed, no raw provider spawned, and no review Job was submitted. This proves an authenticated-client boundary for this chat, not that the Studio fabric is offline.

The existing review operation terminal-tactical-d0-review-20260917-sol-001 on #601 remains unassigned and unstarted. Its eventual independent review must bind the new exact source head. Authentication is a human/connection ceremony, not work to route around through another provider or credential. The read-only service metadata and denial caused no modifying uncertainty.

## D1 source seam, not a new collector

Current source inspected at Macro 63fb8dd9fa7dbe43c02ca6eac84b22fbbc9706dd provides engine/entry_radar/vendor_minutes.py: a bounded per-name/session minute reader with injected transport, but its persisted C3 cache stores derived four-hour buckets, not a general one-minute archive. scripts/build_polygon_intraday.py normally accrues hourly prices with causal file receipts; it is not proof that one-minute histories already exist. Terminal's existing backfill_intraday.py supports an explicit 1m configuration (40-day default), but that source capability and the static 404s do not prove actual publication or entitlement. Preserve #595's existing writer/custody; its existing-only refresh cannot itself create absent one-minute histories.

## Remaining boundaries

Independent review and final-head checks precede code release. #7262 is the existing Agent OS continuation carrier. #595 retains history freshness repair. The previous platform-blocked INTC live operation and R1 scientific-source read remain held, with no alternate-carrier retry. No strategy outcome was computed, no registration budget consumed, no scanner/alert enabled, and no options profitability claimed. This input-quality capability does not complete the parent product.
