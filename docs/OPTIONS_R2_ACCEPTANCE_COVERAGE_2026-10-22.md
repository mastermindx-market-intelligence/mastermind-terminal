> Repository copy (2026-10-22) of the R2 acceptance coverage ledger. PR-1 = #1109, PR-2 = #1098, PR-3/4/6/7 = the lane branches consumed by the R2 wiring PR, PR-5 = the Discover scan table lane (#1112); wiring = #1116. All four are merged and deployed (master 4615f80dc). Every row stays SPECIFIED_NOT_PRODUCTION_ACCEPTED until the authenticated live journey (P76) is recorded against a deployed master.

# R2 acceptance coverage ledger — 2026-10-22T02:35Z

Status vocabulary: SHIPPING (in an open/merged Terminal PR of this program), LANE (a fabric lane is building it),
INCUMBENT (an existing owner already satisfies it; evidence = existing tests/live), HELD (needs an owner outside this
program's reach — Macro producer, Discord adapter, sharing/export owner — recorded as a hold with the reason).
Nothing here closes a row: every row stays SPECIFIED_NOT_PRODUCTION_ACCEPTED until the authenticated live journey (P76).

| Row | Feature | Disposition | Where |
| --- | --- | --- | --- |
| P01 | Any optionable ticker lookup | INCUMBENT + PR-2 | GexDeskView root catalog; PR-2 shell shows typed refusals for unadmitted roots |
| P02 | Quick picks and watchlist | INCUMBENT | existing watchlists (owner-scoped storage) |
| P03 | RTH / extended quote separation | PR-2 | clocks strip: price · book · session shown independently (pin §4) |
| P04 | Economic expiry filters | INCUMBENT + PR-2 | `selectedProjectionCells` lenses all/today/next-live/week/one; PR-2 lens rail |
| P05 | Coverage and freshness | PR-2 + PR-1 | coverage counts per metric; partial never totals (reducer `knownGross`) |
| P06 | GEX heatmap | INCUMBENT + PR-2 | qualified projection cells; field restyle |
| P07 | VEX heatmap | INCUMBENT | projection vanna lens (`usd_delta_per_1vol_point`) |
| P08 | DEX heatmap | PR-1 (#1109) | qualified per-cell DEX extension validator V1–V10 |
| P09 | Calendar charm heatmap | INCUMBENT | projection charm lens (`usd_delta_per_calendar_day`) |
| P10 | Combined response | INCUMBENT + PR-6 | `scenarioGrid` owner; the scenario slice never sums raw units |
| P11 | Net, gross and sides | PR-1 | reducer net/gross/knownGross; sides reconcile (`invalid_metric`) |
| P12 | All observed strikes and expiries | PR-2 + PR-7 | field window never changes totals; surface clipping law |
| P13 | Spot strike and cell detail | PR-2 | spot row + selected node styles; inspector |
| P14 | Signed palette and zero | PR-2 | `--exposure-positive/negative`, unknown ≠ zero; never inverted by locale |
| P15 | Zoom, reset and scroll | PR-2 | sticky axes; keyboard ±/0 on the field (pin §5) |
| P16 | Change since baseline | INCUMBENT | GexMarketMemory matched report (board 04 Compare = restyle of the same owner) |
| P17 | Node velocity | HELD | needs an irregular-interval history owner with source comparability; not built in this program |
| P18 | All-expiry dominant node | PR-1 | reducer dominant with tie set |
| P19 | Filtered dominant node | PR-1 | scope identity on the reduction (`basis`) |
| P20 | Contested concentration | PR-1 | runner-up ratio ≥ 0.9 contested; tie policy by sign |
| P21 | Call/put walls | INCUMBENT | gex_engine/levels_engine (Macro) |
| P22 | Zero gamma and regime | INCUMBENT | repriced gamma curve owner (Macro); Terminal shows regime sign only |
| P23 | Wall corridor and distance | INCUMBENT | ExposureDistance (points / percent / EM) |
| P24 | Intraday level history | INCUMBENT + PR-3 | stored `gex_at` books; replay frames carry stored values with their clocks |
| P25 | Level-crossing alerts | HELD | alerts engine event contract not in this program |
| P26–P28 | Daily / weekly / monthly expected move | INCUMBENT | moves owner (`options_hub.moves/v1`) |
| P29 | Annual reference | HELD | no versioned annual anchor owner exists |
| P30–P31 | Intraday range cone / model explanation | HELD | calibration owner (Macro); Terminal shows no probability wording |
| P32 | 5-minute RTH candles | INCUMBENT | shared ChartPanel; separate source clocks (PR-2 clocks strip) |
| P33 | GEX and VEX bubbles | INCUMBENT | exposure chart primitive |
| P34 | Levels and weighted center | PR-1 | reducer `center` from absolute weights |
| P35–P36 | Daily averages / SMA34 | INCUMBENT | ExposureDivergence averages; replay hides current-day averages (P41) |
| P37–P38 | Divergence matrix / annotation | INCUMBENT | ExposureDivergence |
| P39 | Path to node | HELD | no approach/away scenario owner; the scenario slice carries no path claim |
| P40 | Intraday heatmap scrubber | PR-3 | frame mode; MISSING column with reason (no fabricated 9:30 book) |
| P41 | Chart replay and prior session | PR-3 + INCUMBENT | `onLoadSession` → GexDeskView archived session (no current badge leakage) |
| P42 | Retained sessions | PR-3 | `selectReplaySessions` reads the actual `gex_dates` index; frames ≤ 7, sessions listed as available |
| P43 | Hybrid fallback | PR-3 | kinds observed / reconstructed / aggregate; nothing projected |
| P44 | Change attribution | INCUMBENT + PR-7 | matched report first; surface provenance only on equal population ids |
| P45–P47 | Quad board | INCUMBENT | ExposureBoard (restyle only) |
| P48 | Open/close scan snapshots | HELD | needs a producer-side immutable schedule record (Macro) |
| P49 | Broad market universe | PR-5 | eligible / unscored / unadmitted denominator shown; never "51 scanned" |
| P50 | Pull/concentration rank | PR-1 + PR-5 | oracle `scanner_score` port; scanner table |
| P51 | Distance, regime and strength | PR-5 | from the same frozen book as the rank |
| P52 | Contested / node moved flag | PR-5 | original scan frozen; refresh = versioned updated row |
| P53 | Within-horizon mode | PR-5 | candidate eligibility 0.1 < d ≤ 2.0 EM; far nodes stay in concentration view |
| P54 | Drill to complete book | PR-5 + INCUMBENT | exposure chart link fingerprint |
| P55 | Strike-expiry surface | PR-7 | SVG surface over projection cells |
| P56 | Single-expiry signed bars | PR-7 | expiry cap 1 → one row of signed columns (lens `one`) |
| P57 | Horizon and navigation | PR-7 | rotate / elevation / window / cap never change a cell |
| P58 | Tooltip and selection link | PR-7 | inspector + `Open in Exposure`; SVG means no WebGL fallback is needed |
| P59 | Session selector and completeness | PR-3 + PR-4 | session list from the index; partial totals withheld |
| P60 | Open-to-close level journey | PR-4 | first/last touch, excursion, close vs level per session |
| P61 | Next-session setup | HELD | needs the moves owner's target expiry + anchor in a recap card; not built |
| P62 | Share image/link | HELD | sharing/export owner with rights checks; deferred by every slice |
| P63–P67 | Bot | HELD | Discord adapter is undiscovered; no delivery owner in this program |
| P68 | Contextual guidance | PR-2…PR-7 | every slice carries its caveat copy; no overclaim |
| P69 | Scenario shocks | PR-6 | local linear value; repricing held and labelled |
| P70 | Saved investigation continuity | INCUMBENT | investigations resolver |
| P71 | Plan/watch/review handoff | INCUMBENT | watch / MarketMemory; no broker action anywhere |
| P72 | EN/ZH, keyboard, responsive | PR-2…PR-7 | strings files, 44px controls, 390/820/1440 e2e |
| P73 | Live quality and withdrawal | INCUMBENT + PR-2 | failure-state truth; last good keeps its timestamp |
| P74 | Performance and shared identity | PR-7 (partial) | window/cap bound the drawn set; 13k-contract profile NOT run → stays open |
| P75 | Calibrated claims | HELD | prospective validation owner (Macro) |
| P76 | Production end-to-end proof | PENDING (human sign-in) | master 4615f80dc (#1109, #1098, #1112, #1116) is live: LIVE_MATCH 2026-10-22T06:52Z (`.gitsrc`, deployment marker, anon `/options` 200, `data-dpl-id`). The authenticated journey through the Exposure map tabs (Replay / Review / Scenario / Surface) and the Discover scan table needs a signed-in session; anonymous production shows the paywall, so no row closes on this evidence |

Held rows (P17, P25, P29–P31, P39, P48, P61–P67, P75) are reported as holds with their missing owner — never as done.
