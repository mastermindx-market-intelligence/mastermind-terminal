# Options Superintelligence Masterplan — 2026-07-31

**Status:** ACTIVE program. Successor to `docs/OPTIONS_SUITE_PARITY_MASTERPLAN.md` (2026-07-24), the quanted teardown
(`Macro Dashboard: research/quanted_options/`), and the OEU program (`research/options_estate/OEU_MASTERPLAN.md`).
Those documents remain the reference teardowns; **this document is now the roadmap of record for the options estate.**

**Commissioning intent (operator, 2026-07-31):** stop cherry-picking. Reach *full* QuantData.us capability parity on the
intraday options suite, exceed it, restructure the IA so the suite reads as one coherent product, and upgrade Prophet
into a superintelligent signal system that consumes the entire options estate (intraday flow + EOD structure), the
Golden Oracle / GC-v2 stack, the Research Desk, technicals, and the macro labs — one brain across both repos.

---

## ⚡ EXECUTION LEDGER — live wave status (update this section IN THE SAME PR as your work)

> **⚠️ 2026-08-02 OPERATOR DIRECTIVES — read `docs/QUANTDATA_PARITY_HANDOFF_2026-08-02.md`
> FIRST.** It carries: (1) the rescission of the house-idiom + paraphrase-only laws —
> QuantData's layout/structure/IA are now explicit build targets, full parity structured to
> be better in every regard; (2) the intraday-transition mandate; (3) live data arriving
> ~08-04/05 with the marketing launch (re-gate data-gated items; ask which feed was bought);
> (4) the renewed priority order (IA restructure W1, promoted) and the MSC collision map
> (the intraday store is a shared keystone: build once here, MSC consumes).

**Coordination protocol (multi-session law):** chat memory does not travel between sessions or accounts — this
section is the shared truth. Before starting ANY options-estate work: (1) read this section + the sibling docs
below + the `options-suite-parity-program` memory ledger; (2) CLAIM your lane by editing this section (mark
`IN FLIGHT` + branch name) in your first PR; (3) flip it to `DONE` with PR numbers when merged. Unclaimed lanes
are fair game; claimed lanes are not.

**Sibling programs (do not duplicate their scope):**
- `docs/MARKET_STRUCTURE_CORE_MASTERPLAN_2026-08-01.md` — dealer-positioning / gamma-structure / vol-mechanics
  intelligence (MenthorQ/SpotGamma/VolSignals/IVolatility class). Division of labour: THIS doc = "see every
  print, replay every minute" (tape, filters, playback, IA); MSC = "interpret what the inventory does to price."
  MSC also wires into Prophet — **R6 spine design must be co-authored with MSC's signal layer, not built twice.**
- `docs/VOLLAND_PARITY_PLAN_2026-08-01.md` — Volland-class parity lane.

**Status vocabulary:** **MERGED / CODE-COMPLETE** means exact-head CI and merge only; **DEPLOYED** means the governed serving/host rollout was verified; **LIVE-EVIDENCE-PROVEN** means an observed production/scheduled artifact or public byte check passed. A later gate is never implied by an earlier label.

| Wave / item | Status (verified 2026-08-12) |
|---|---|
| R0.1 chain-heat relight | ✅ DONE 07-31 — relit on M1, artifact verified current on public R2 |
| R0 repair wave (seal, cadence, schema v2, two-tier, U-CHAIN, dead-man) | 🟡 PARTIAL LIVE — macro #4152 (+ #4222) repair plumbing is live; `meta.json` at 2026-08-10T19:17Z verified `delta_mode: time_window` + `two_tier: true`, but the 120 s liveflow-cycle target remains open. **MERGED / CODE-COMPLETE + DEPLOYED:** macro #5273 (`7c550326…`) bounded prior-OI memory; scheduler repair #5349 was squash-merged as `4e9bbb353375e388af152b439891dc692638defd` and deployed to the dedicated clean `/Users/chriswong/chainsnap-ops-wt` at that exact HEAD. The installed plist points its executable, working directory and `PYTHONPATH` at that checkout; `data/chain_snapshots` is an exact symlink to `/Users/chriswong/flow-ops-wt/data/chain_snapshots` (physical/link device+inode `16777234:292244470`). Pre/post state manifests were byte-identical at 2,103 rows / 202,960 bytes / SHA-256 `0a097cace4dd4efc58bcb91ba745212519e5f4c390e093e9dae75b1b270d5d79`; after 155 seconds the launchd label remained inert (`runs=1`, exit 0, no PID). **08-12 UNTOUCHED SCHEDULED RTH LIVE-EVIDENCE-PROVEN:** chainsnap ran from the exact #5349 deploy with one launchd writer and its receipt lock. All 27 unique 09:30–16:00 buckets closed as canonical `intent → decision → availability` triples (150 roots OK / 0 failed; 294,089 rows per bucket; first-bucket OI 291,533), with no incomplete receipt, competitor, lock regression, error or warning. The receipt ledger is 2,729,778 bytes / SHA-256 `a988bfc5af1ae6326e96502c78be67549c67b8c20023dc3c4ace16e322d98cbe`; real-sweep latency was 82.2 / 102.2 / 123.6 s min / mean / max, and one grid-edge idempotent skip wrote no source or duplicate receipt. Liveflow completed 27 cycles with all six RSS phases in every cycle, peak RSS 1,203,470,336 bytes (1.121 GiB; 89.2% below the 10.4 GiB baseline), and 534.8 / 872.9 / 1,214.1 s min / mean / max latency. All 11 changed event stages preceded their following dates index (0 violations); the final local event-stage ledger and public HTTP 200 object matched at 497,772 bytes / SHA-256 `85255d9ca4500fb3385d44a43dd76d8c935b54c3cdbd220f5873e0bc47d4c4fb`. Both labels exited 0 and were not running. **REMAINING GATES:** the 120 s liveflow cadence target is not met and U-CHAIN projection authority remains disabled. |
| R0.7 Prophet dormant wires | ✅ DONE + LIVE — terminal #282; public `prophet/index.json` carries `last_price` plus nested state/components/geometry/change reason (verified 08-10) |
| R0.10 dated GEX-ladder replay (slice 3) | ✅ DONE + LIVE 07-31 — terminal #283 deployed; macro #4153 (`dates.json` + self-heal); accrual holes healed |
| R3 Volatility tab | ✅ DONE + LIVE 07-31 — #287; extended by #314 (VRP regime level+trend+velocity, skew read, term slopes) |
| R3 Structure tab (OI suite) | ✅ DONE + LIVE — #291 (OI ladder / OI-time / max pain / OI change), extended by the R5 P/C OI history slice #385 |
| R3 Positioning / exposure profile / dealer heat | ✅ DONE under MSC — #298 (program of record + Positioning tab), #312 (production sweep + 40 audit fixes), macro #4219 |
| R1 tape-truth classifier (sweep/block/golden, 5-tier side, per-trade greeks) | 🟡 RAW CAPTURE SHIPPED / CLASSIFIER OPEN — macro #5112 retains exact Theta trade-quote provenance, but public `live_flow.feed/v1` still has no exchange/conditions/bid-ask sizes/5-tier side/consolidation/golden/opening/per-trade-greeks contract. Calibrate before dropping `~`; no synthetic open/close identity. |
| R2 intraday store extension (tier-1 roots) + universal playback wrapper | 🟡 CODE-ONLY + OPEN — macro #5259 merged receipt-bound `options.contract_eligibility/v1` projection, but canonical `options_structure_r2.enabled: false`, `activation_session: null`, and the public `options_structure/msc_intraday/index.json` is absent as of 08-10. Its packets are profile-matched eligibility subsets, not a full chain browser. Real M1 runtime/RSS/latency/writer-lock gates, the complete store, and universal playback remain open. |
| R2 slice-3 deep backfill (2017→ ladder reconstruction + ladder-level validation) | 🔓 OPEN — macro side; `audit_overlap` extension is the honesty gate |
| R3 remaining: Interval Map · multi-metric heatmap+MVC · Statistics suite · Vol Drift · Exposure-matrix VEX/UNUSUAL-equivalent lenses | 🔓 OPEN — Interval Map/Vol Drift require the governed intraday structure plane; Statistics needs a governed aggregate/display contract because exchange is retained raw but absent from public `live_flow.feed/v1`; VEX/UNUSUAL requires vanna-grid + 30d-baseline proof. Equivalent lenses belong on the **Exposure matrix** (PRISM retired — #344). |
| R4 Filter Groups + alert generalization + page/global filter bus | 🔓 OPEN — design pinned §4-R4; enriched schema (R1) is its vocabulary, but the engine + Supabase persistence can start against existing fields |
| R5 IA restructure (7 categories) + blind-spot surfaces (0DTE dash, largest-trades, chain browser, P/C history, exp-vs-realized, export) | 🟡 SIX SHIPPED SLICES LIVE-EVIDENCE-PROVEN (08-10) / TWO CORE CONTRACT-GATED — §5.3 PRISM→Exposure shipped in #344 and PR #164 was closed as superseded. **Tape CSV #380**, **Screener active-preset CSV #382**, **seven-category IA Stage A #383**, **honest 0DTE + Largest Events #384**, **P/C OI history #385**, and **Portfolio multi-watchlist #386** were merged, deployed, and publicly byte-verified; their stated display-only/receipt boundaries remain unchanged. **Chain browser GATED:** #5259 is disabled and publishes profile subsets, not a complete chain. **Expected-vs-realized GATED:** `options_hub.moves/v1` has a current expected band plus aggregate calibration, not per-session expected/realized history. |
| R5 P/C OI history | ✅ DONE 08-10 — PR #385; responsive display-only chart over the existing nightly `options_hub.oi_time/v1` fetch, deriving only `put_oi / call_oi`, retaining t-1 provenance, and leaving invalid denominators as gaps. No new fetch, API, producer, or authority. |
| 2026-08-03 continuation session | ✅ DONE 08-03 — P0 Tickers null-ATM-IV guard #342; Volatility/Structure card-height equalization #343; Surface granularity #346 + honesty/repaint follow-up #350; Exposure/PRISM merge #344; responsive/deep-link follow-ups #347/#349. All are ancestors of current master. |
| R6 Prophet superintelligence (spine, multi-lane origination, live re-score, distribution) | 🟡 WAVE 0 + R6.2-A LIVE; PIT + CANONICAL CAMPAIGN PUBLICATION LIVE-EVIDENCE-PROVEN; SPARSE-SELECTOR IMPLEMENTATION UNLOCKED / PROMOTION GATED — terminal #371 serves governed `options.prophet_shadow/v1` and #373 the private operator-reviewed `options.issue_desk/v1`; all automatic authority flags remain false. **MERGED / CODE-COMPLETE:** macro #5211 (`cadd31f…`) establishes immutable episode/H+60/session-outcome contracts; #5324 (`2a526d…`) durably lands the exact episode, H+60, session-outcome, and checkpoint blobs on `main`. **LIVE-EVIDENCE-PROVEN:** the 2026-08-10 RTH publication carried 384 decision + 384 availability rows (336,740 bytes; SHA-256 `fbc7f802cd6f999fdc600f25acccfe66a2f220de491b83b1d1d4ddebc0e8dd7f`), stage-before-index, strict pairing/clocks, and WAL=0; scheduled nightly run `31440972065` / engine job `93655174194` produced 384 episodes, H+60 301 total / 261 complete, session outcomes 270 total / 261 complete, zero rejects. **FAIL-CLOSED PUBLICATION SHIPPED:** #5338 final head `f2f892925c24ef50886d9a7f84932fee53a1f53c` passed all 12 exact-head CI packs (run `31509875496`) plus fences (`31509875379`), squash-merged as `4fb43412fdf82fb152947499fead87aced59ba43`, and production was verified at a current-`main` descendant. **LEGACY ONLY:** #5332 (`a77c565…`) remains an eight-row retrospective threshold cohort. **CANONICAL CAMPAIGN PUBLISHER SHIPPED:** #5362 final head `ba4119fa17ea08f525fcf147867ffcf267aa6901` passed 12/12 CI packs (`31535007985`) plus fences (`31535007753`), squash-merged as `d8e290032710d84e538c32af0d58358a16407c88`, and its exact production checkout was verified. Its prospective boundary is `2026-08-12T13:30:00Z`. **SCHEDULE RESTORATION SHIPPED:** #5421 final head `f8ece2e088aa1c032cd335fe647db5846c8812b6` passed 12/12 CI packs (`31565225536`) plus fences (`31565225450`) and squash-merged as `7d4adcd4f207f7a263e97febab5070fe20f4054b`; #5422 final head `a6e4192a0a9e418d3bae383322460c33044cd6d6` passed 12/12 packs (`31567031627`) plus fences (`31567031659`), squash-merged as `abf674d1e47b46cf04628aa5a993d857f0f3586d`, and production was verified at that exact merge. No manual workflow dispatch, rerun, or backfill is counted as evidence. **FIRST UNTOUCHED POST-RESTORATION NIGHTLY OIP LIVE-EVIDENCE-PROVEN:** the workflow-event head for `event=schedule` run `31649984834` was `c34b314b31b195ded170cb3c8bb6f6a434850f45`, a descendant of both restoration merges; engine job `94324330758` completed its exact OIP steps and terminal fail-closed integrity gate successfully, although the job was red from the unrelated broad engine-output publisher exhausting its push-contention budget. The durable narrow commits were episode `e97382797049c43dacd80a100a02b95829375bec` then campaign `481fecc70f299f3b480176b050b9dbae298a15c2`. The checkpoint binds 1,206 episodes, 969 H+60 outcomes and 1,456 session outcomes to 1,146 campaign revisions (2,393,165 bytes / SHA-256 `6353df028d7423d1da3005c53e48d61dea43046240c69c83856d4a94bda631ed`) and 2,277 anchored outcomes (5,361,827 bytes / SHA-256 `3ca48db40dec637a8cd89a6c873ddd4283da68e98c3b55fcba9a91568c47d3ae`); the checkpoint is 1,324 bytes / SHA-256 `026f40ac9ac91961a07c633f9a856c8e3cd51526477fe8a016972e3be8b04037`. Exactly 489 campaign revisions satisfy the preregistered campaign predicate, including 489/489 exact final-member episode links and zero contract, history or checkpoint mismatches; 657 are retrospective. Outcomes are 2,074 complete / 203 explicitly incomplete; option P&L remains unavailable. Legacy v1 stayed byte-identical at 8 rows / 10,492 bytes / SHA-256 `db326f5c772ab417c43b8579ad50abb0434916922bda3a13c2da5b8303813910`; all authority and training flags are false. **NEXT CANONICAL GATE:** preregistration #5376 (`6ba8e7f368a1674b7114d5bd867aa721bd0472f8`; rule digest `a98d3b92e1ebe069c141d5f79ee9260eeb2b8eeee4f90f574ef0069c062ad20b`) was hosted before the boundary, so these rows unlock only its research-only sparse-selector manifest/decision implementation. They do not prove selector replay, late-prefix supersession, optimizer, lifecycle, Today/Pulse, rank, sizing, trading or training promotion; all remain closed. |
| R7 dark pool / equities feed | ⛔ GATED — owner spend decision (Polygon TRF vs Databento) still open |
| R8 composability (My-Pages) | ⛔ GATED — after R5 |

---

## 0. Why the last program stalled — audit verdict (2026-07-31)

Fresh evidence: live logged-in walkthrough of v3.quantdata.us (all 7 built-in pages, the full Add-Tool catalog, Filter
Groups, Public Alerts, page/global filter system), 16 curated feature screenshots, and six parallel code audits across
charting-app, Macro Dashboard, and the M1 data plane. Conclusions:

1. **The frontend outran the data plane by design, then the data plane never caught up.** Every in-repo lane shipped
   within ~72h of the 07-24 teardown (P0, SSE spine, Phase-2 slices 1–2, OEU T-A..T-E). Everything else — poller
   cadence, condition capture, universe expansion, 1-min snapshots, per-date ladders, dark pool — was tagged
   "infra-gated", and when the infra unblock arrived (M1 Max ruled the data-plane host) the 07-25/26 window was spent
   on the migration itself, then attention rotated to onboarding/v7/native apps. **No parity commit after 07-26.**
2. **"Clean stopping point" was true only for the slice, not the program.** Phase 2 slices 1–2 (scalar session
   scrubber) shipped honestly; slices 3+ (per-date full ladders), Phases 3–5 (Interval Map, multi-metric heatmap,
   normalization modes, Filter Groups, alerts inheritance, statistics, dark pool, composability) are open.
   **And the slice-3 blocker itself was a false premise**: the 2026-07-26 session probed guessed R2 keys
   (`options_hub/gex/{DATE}/{ROOT}.json`), got 404s, and concluded per-date ladders exist nowhere. The real key
   family is **`options_hub/gex_history/{ROOT}/{DATE}.json`** (WP-GEX-SNAPSHOTS, macro PR #2615, accruing since
   2026-07-16) — full `by_strike` (gamma/delta/vanna/charm net per strike, ±20% of spot, uncut count disclosed),
   `by_expiry`, walls/flip/scalars, per session, **every hub root including single names** — verified live on
   public R2 this audit (SPY 2026-07-17→07-30). The date-picker ladder replay was buildable all along; what's
   actually missing is a `dates.json` index, self-heal for two accrual holes (07-18, 07-20), pre-07-16 backfill,
   ladder-level validation, and the Terminal consumer (`gex_at:` f-param + date picker).
3. **The honesty doctrine correctly vetoed ~7 features** (VEX/UNUSUAL lenses, LIVE badges on EOD data, IV percentile,
   GEX date-picker against 404 ladders, event markers on replay…). Those vetoes were *right* — the fix is to build the
   data that makes the features honest, which is what this plan sequences first.
4. **The migration left two live regressions** (found by this audit, must be repaired first):
   - **Chain-heat lane is dead**: `com.macro.chainheat` was parked in `dataplane-migration/m2-dead/`, never
     reinstalled on M1; prod `live_flow/chain_heat_current.json` is 8 days stale while the Flow Desk polls it every
     45 s. Script survives in `~/flow-ops-wt/scripts/build_chain_heat.py` — relight is a plist re-point.
   - **levelsseal degraded**: exit 4, "nothing to seal" for 2 consecutive sessions (store freshness at 04:30 PT
     suspect).
5. **Three fully-built capabilities are sitting dark** (build once, never lit):
   - **U-CHAIN 15-min chain snapshots** (`chain_snapshot_poller.py` + `com.mastermind.chainsnapshots` plist) — the
     intraday greeks plane — authored, tested, **installed on neither machine** (plist targets a nonexistent
     `~/chainsnap-ops-wt`).
   - **Two-tier poller cadence** (FC-R6) — coded, `LIVE_FLOW_TWO_TIER` unset ⇒ OFF.
   - **Incremental time-window pulls** — watermark machinery complete in the poller; inert because the deployed
     `ThetaTerminalv3.jar` (Jul-4 build) rejects time filters ⇒ `delta_mode: full_day`, measured cadence **~48 min**
     against a 120 s target. The cadence fix is a **vendor/terminal-build item, not poller code**.
6. **Prophet is a packaging layer, not a signal engine** — full trace in §6. Several of its inputs are already built
   and simply not wired (`macro_stance`/`futures_chg` params never passed; `components`, `last_price`, `geometry`
   computed nightly then stripped by the index whitelist, leaving three Terminal UI features dead).

---

## 1. QuantData v3 — the complete census (live walkthrough, 2026-07-31)

### 1.1 The 7 built-in pages
| Page | Tools |
|---|---|
| Dashboard | Consolidated + Unconsolidated Order Flow, Net Flow, Net Drift, News, Equity Prints, Dark Pool Levels, Gainers/Losers |
| Exposure | Exposure by Strike + by Expiration (GEX/DEX/VEX/CHEX), **Interval Map**, **Heat Map** |
| Flow Analysis | Net Flow, Net Drift (+ net-volume subchart), Net Premium Heat Map, Net Volume Heat Map |
| Dark Pool / Equities | Stock Price/Time (candles, 1-min), Dark Pool Levels (top-50 price levels by notional/count/volume), Dark Flow (cumulative dark notional vs price, 4:00–20:00), Equity Prints |
| Statistics | Contract Statistics (C/P premium-volume-count split), Contract **Trade-Side** Statistics (Above Ask/Ask/Mid/Bid/Below Bid), Market Share pie + table (per exchange, call/put/equity/index volume) |
| Open Interest | OI by Strike, OI by Expiration, OI Change table (prev→current per contract), Max Pain, Max Pain/Time, OI/Time (~18-month series) |
| Volatility Analysis | Volatility Drift (intraday ARV vs IV vs price), IV Rank (365-d lookback / 30-d maturity), Volatility Skew (by strike), Term Structure (IV vs DTE 0–800) |

### 1.2 The tool catalog (Add Tool: ~31 tools = 24 Options + 6 Equities + 1 News)
Options: Consolidated Order Flow · Unconsolidated Order Flow · Contract Price/Time · Contract Statistics · Contract
Side Statistics · Exposure by Strike · Exposure by Expiration · Interval Map · Heat Map · Gainers/Losers · IV Rank ·
Market Share · Market Share Table · Max Pain · Max Pain/Time · Net Drift · Net Flow · OI/Time · OI by Expiration ·
OI by Strike · OI Change · Term Structure · Volatility Drift · Volatility Skew.
Equities: Dark Flow · Dark Pool Levels · Equity Prints · **Exchange Notifications (REG SHO / LULD / halts)** ·
Market Map (sector treemap) · Stock Price/Time. News: tagged News Feed.

### 1.3 The control plane (what makes it feel a generation ahead)
- **Every exposure/time-series widget scrubs any 1-minute snapshot** — date-picker + intraday time slider (9:30→4:15)
  with play/pause + a crop/zoom brush. Historical sessions (365+ days) load in the same UI as live.
- **Exposure modes**: Per 1% move / Per $1 / Per 1 contract; net toggle; strike + expiration + ticker filters.
- **Interval Map**: bubble map of exposure snapshots per interval (aggregation 1min→4hr) × strike, net-exposure
  coloring, value-vs-change mode, price overlay.
- **Heat Map: 30+ metrics** (GEX/DEX/VEX/CHEX, net premium, net volume, OI…) × strike × expiration, full axis
  control, **MVC marker + MVC Proximity / MVC Shift alerts**.
- **Filter Groups**: named, saved, **shareable (My / Public library, one-click Duplicate)**; Field/Operator/Value
  rows with multi-chip values; vocabulary spans Trade (side, consolidation SPLIT/BLOCK/SWEEP, money type, premium,
  qty, sentiment, Golden Sweeps, opening positions, tied/cancelled/floor/auction trades), all **15 greeks per trade**
  (Delta Vega Theta Rho Omega Charm Gamma Vanna Veta Vomma Color Speed Ultima Zomma), Contract (DTE, expiration, IV,
  OI, strike, volume, Volume>OI, type), Underlying (ticker, sector, industry, index/ETF membership, penny program,
  stock price). Human-readable summary sentence renders above the rows.
- **Alerts**: per-widget, inherit the widget's active Filter Group, **throttle config** ("at most once every N s"),
  My/Public alert libraries, widget-specific types (Net Drift Cross, MVC Proximity/Shift, New Consolidated Flow…).
- **Page Tool Filters + Global Tool Filters**: one panel syncs ticker/expiration/session-date across a page or the
  whole app. **Tool Configuration**: global display toggles (axis titles, crosshairs, legends, status indicators,
  time sliders, tooltips, zoom sliders). **My Pages**: user-composed custom pages from the tool catalog.
- **Tape columns** (visible live): Time, Contract, Spot, Qty, Price, exec-side badge (A/B/AA/BB), Bid×Ask at exec,
  Premium, Sentiment, Exchange, **Type (OPRA condition: AUTO, EXT_HOURS, CANCEL, CANCEL_LAST, FLR, MULTI_FLR_PP,
  MULTI_AUTO_COB, ISO…)**, Consolidation (SPLIT/BLOCK), Moneyness, Volume, OI, IV, DTE, Sector, Industry + all 15
  per-trade greeks. Golden highlighted rows for repeat/notable prints.
- Session header gauges: Sentiment verdict, P/C ratio, P/C volume, P/C premium. Date-picker on everything.

### 1.4 What we will NOT copy (standing law, unchanged unless the operator overrules)
- **News feed** — `docs/DAYTRADE_SUITE_SPEC.md` §0: "No order execution, no P&L, no news feed."
- **Their visual design** — we keep the v5/v7 Terminal idiom; parity is capability parity.
- **Fabricated data** — every surface stays honesty-gated; we build the data before the control.
- Licensing red lines hold: no participant-tagged positioning without a license, no vendor-key exposure in the
  browser, dark-pool prints only from a licensed feed (§R7).

---

## 2. Ground truth on our side (verified 2026-07-31)

**Data plane (all on M1 Max now; M2 clean; rollback scripts armed):**
- ThetaData **PROFESSIONAL** (8 concurrent). Endpoints used: eod, open_interest, greeks/eod (51 GB full 1st/2nd/3rd
  order surface, 380+ roots, 2017→), trade_quote (bulk + per-contract), snapshot greeks 1st/2nd + snapshot OI (full
  chain ~1 s). **Unused entitlement**: trade conditions (fetched, dropped at parse), NBBO sizes (dropped), snapshot
  cadence headroom, ~380-root live universe (polling 122).
- Live flow poller: target 120 s, **measured ~48 min** (`delta_mode: full_day` — deployed ThetaTerminal jar rejects
  time-window filters; incremental watermark machinery ready and inert). Two-tier cadence coded, default OFF.
- Exec-vs-NBBO: quote-rule ±1 sign only; QuantData's 5-tier ladder (Below Bid/Bid/Mid/Ask/Above Ask) is computable
  from columns we already keep — not computed today.
- Stores: 60 GB EOD store (M1, `theta-ops-wt` symlink → `flow-ops-wt`); Flow-Surface per-strike net-premium +
  greek grids for SPY/QQQ/IWM at poller cadence, 10-session retention; hourly tape archives (24 h feed retention);
  nightly GEX scalars history (`history[]` — net_gex_bn/flip/walls/regime only); **dated per-strike ladders on R2
  since 2026-07-16** (`options_hub/gex_history/{ROOT}/{DATE}.json` — no index, two holes, no consumer yet); six
  weeks of full single-name chains in `data/polygon_gex/chains/{DATE}.parquet` (~370 underlyings, since 06-15);
  U-CHAIN 15-min chain snapshots authored, never run. Warts: `data/index_gex_history` parquets frozen at
  2026-07-02 despite the Sunday M1 lane; **no freshness dead-man's switch on any options R2 plane** (which is
  exactly why the gex_history holes and the chain-heat death went unnoticed).
- Dark pool: FINRA CNMS daily short volume + weekly ATS only (honest "not prints, not live" chip). No TRF feed.

**Terminal `/options` (11-tab hub)**: prophet · desk (Flow Desk) · tape · tide · tickers · screener · gex (Exposure)
· surface · leaders · radar (`prism` retired to a `?tab=prism` → Exposure alias, §5.3). SSE spine live on feed/gex/tide/hub-tape. Exposure desk: GEX/DEX/VEX/CHEX
switcher, by-expiration, dist-to-flip, EOD context belt, scalar session scrubber (#210/#211). Surface tab: the only
true replay (multi-day, ReplayBar, replayBus). PRISM: 6 lenses, VEX/UNUSUAL disabled-with-reasons. 15 IA defects
catalogued (tab aliasing `vol→screener`, tape/desk duplication, 3 unrelated "strike ladder" idioms, 3 expiry-term
renders, 4,599-line OptionsHubView monolith, dead GEX code, leaders/radar orphaned into Discover, chain-heat only on
one tab, cold-landing data deps, per-module formatter drift…) — full list in the 2026-07-31 audit (§IA-12 of the
terminal options audit report; the redesign in §5 resolves them structurally).

**Prophet**: nightly top-6 of `us_standouts` buy lane → R-multiple geometry (1.5R/3R, ATR/swing stop) → 0.60Δ monthly
call overlay priced EOD → 7-phase management confidence (ceiling 92, EMA-smoothed) → R2 `prophet/index.json` +
5-min live marks. BULL-only. No options/flow/GEX/technicals/macro input to selection, geometry, or confidence.
Renders only in the /options Prophet tab (+ delayed-winners landing teaser). Ledger accrues but is unsurfaced;
option outcomes never graded.

**Signal stack available to feed a unified brain** (already computed nightly, most with no Terminal surface):
GC-v2 scored stream + keeper/recipe tiers (aplus/quality/base) · macro T1–T4 confluence cascade (+HTF S1/S2) ·
`us_standouts` conviction/entry/act_level (+v2 shadow board) · entry_signal 12-state posture machine · subsector
ENTRY-NOW double gate · cohort rubber-band score · oracle rotation episodes (`oracle_state.v1`) · Tech-Lab 43–71
signal profiles + fire events · confluence_screener combo stats · seasonal_regime outlooks · bottom_sensors ·
stage_analysis · market_risk · NW market_plane · options_entry_state · vol regime · expected moves · darkpool EOD ·
GEX state/matrix/history. R2 is the proven bus; `model_slice()`/versioned-contract discipline is the delivery norm.

---

## 3. The gap matrix (QuantData capability → our status → root cause)

| # | Capability | Ours today | Root cause class |
|---|---|---|---|
| G1 | Sub-minute live tape, ~380 roots | ~48-min, 122 roots | Vendor terminal build (time-window), two-tier OFF |
| G2 | OPRA conditions + consolidation classes (SPLIT/BLOCK/SWEEP/golden sweep/opening) | dropped at parse | one parser change + classifier build |
| G3 | 5-tier exec-side sentiment + header gauges | binary ±sign | compute from retained columns |
| G4 | Per-trade greeks (15) in tape + filters | none | join tape ↔ snapshot/EOD greek surface |
| G5 | 1-min exposure snapshots, any date, every widget | 3-root flow-surface grids, 10 sessions | U-CHAIN never lit; store scope |
| G6 | Scrub/date-pick/crop on every chart | Surface tab only + scalar scrubber | shared playback wrapper never built |
| G7 | Interval Map | none (data lane #2638 built for it) | UI never built |
| G8 | Heat Map 30+ metrics + MVC alerts | 4-metric surface + 6-lens PRISM | metric engine + alert types |
| G9 | Exposure modes (1%/$1/unit) | raw only | arithmetic + UI toggle |
| G10 | OI suite (OI/Time, Max Pain, Max Pain/Time, OI Change) | oi_movers/hot rails only | builders + surfaces |
| G11 | Vol suite (Vol Drift ARV/IV, IV Rank, Skew, Term Structure w/ history) | vol payload in Tickers drill | dedicated surfaces + history depth |
| G12 | Statistics (contract/trade-side/market-share) | none (exchange captured, never aggregated) | aggregation builders |
| G13 | Filter Groups (saved/shared/public) | fixed preset chips | engine + Supabase persistence |
| G14 | Per-widget alerts inheriting filters + throttle + public library | 5 fixed opt_* conditions | alert engine generalization |
| G15 | Page/Global filter sync (ticker/exp/date) | per-tab state | workspace state bus |
| G16 | Custom pages / composability | fixed 11 tabs | deliberate (revisit post-IA) |
| G17 | Dark pool prints/levels/dark-flow live | FINRA EOD honest belt | licensing decision (Polygon TRF vs Databento) |
| G18 | Equity prints + exchange notifications (halts/LULD) | none | feed decision (same as G17) |
| G19 | Historical session library (365+ d, every widget) | 10-session surface + 30-session scalars | retention + dated publish |
| G20 | Blind spots neither product structured: 0DTE dashboard, largest-trades board, chain browser table, P/C ratio history, expected-vs-realized move report, flow export | partials scattered | never planned — now in R5 |

---

## 4. Renewed roadmap

Numbered R0–R8. Each wave states its host (M1 plane / macro repo / terminal repo), its honesty gate, and its exit
marker. In-repo waves follow the standing delivery chain (commit→PR→CI→merge→deploy→verify). Data-plane waves follow
the M1 ops discipline (never double-run against prod, rollback scripts, market-closed cutovers).

### R0 — Repair & relight (immediate; M1 plane + small repo diffs)
1. **Relight chain-heat**: point the parked plist at `~/flow-ops-wt` on M1, bootstrap `com.macro.chainheat`,
   verify `live_flow/chain_heat_current.json` asof goes current. (Terminal is already polling it.)
2. **Diagnose levelsseal** exit-4 ("no reconstructable board" ×2 sessions): check greeks/OI t-1 freshness at
   04:30 PT on M1; fix ordering or gate; verify a sealed board next session.
3. **Bootstrap U-CHAIN**: create the worktree the plist expects (or re-point it), load
   `com.mastermind.chainsnapshots` on M1 → 15-min full-chain 1st+2nd-order greek snapshots, ~150 roots. This is the
   intraday exposure store seed — everything in R2/R3 rides it.
4. **Parser keeps what we pay for**: retain `condition`, `ext_condition1–4`, `bid_size`, `ask_size` (+exchange codes
   already kept) in `bulk_trade_quote._parse_rows`. Version the feed schema; downstream tolerant-reader.
5. **Two-tier ON**: set `LIVE_FLOW_TWO_TIER=1` (tier-1 33 roots every cycle, tier-2 round-robin) — halves effective
   staleness for the names that matter before the vendor fix lands.
6. **Vendor ticket / jar upgrade probe**: newer ThetaTerminal build vs time-window filtering on PRO; if supported,
   flip `delta_mode` to `time_window` → the 120 s target becomes real. (This single item is the "feels alive"
   unlock; treat as R0-critical-path.)
7. **Prophet quick wires** (macro repo, 3 small diffs): pass `macro_stance` + `futures_chg` into
   `compute_management_state`; whitelist `components`, `last_price`, `geometry`, `change_reason` into the index;
   Terminal features (ConfidencePanel bars, GAINERS sort, T1-progress/P&L) light up with zero frontend work.
8. **thetadata-r2sync retry/backoff** for the nightly multipart flake; diagnose the frozen
   `data/index_gex_history` weekly lane (parquets stuck at 2026-07-02 despite E3c hardening).
9. **Freshness dead-man's switch**: add `options_hub/`, `live_flow/`, `levels/`, `gex_history` accrual to the
   `audit_r2` anchor set so a dead lane pages instead of silently serving stale data.
10. **Ship the GEX date picker now** (charting-app): `gex_at:{ROOT}:{DATE}` f-param over the *existing*
    `options_hub/gex_history/{ROOT}/{DATE}.json` + date picker on the Exposure desk — data verified live; macro
    side adds `dates.json` + self-heal for the two holes. This closes Phase-2 slice 3 for the accrued window
    (2026-07-16→) immediately; the 2017→ backfill is R2's job.

### R1 — Tape truth: the enriched print schema (M1 plane + macro engine + terminal)
Goal: every print carries what QuantData shows. New `flow.print/v2` schema:
`{ts, root, exp, strike, right, qty, price, prem, spot, bid, ask, bid_size, ask_size, exchange, conditions[],
side_5tier, consolidation (SPLIT|BLOCK|SWEEP|MULTI), golden, opening (vol>OI heuristic), moneyness, dte, iv,
greeks{delta…zomma} (from nearest U-CHAIN/EOD surface), sector, industry}`.
- **Classifier build** (macro `engine/`): sweep stitching (same root/exp/strike/side across exchanges in Δt),
  block/split from conditions + size, golden-sweep thresholds, opening-position heuristic, tied/cancelled tagging.
  Calibrate against QuantData's visible classifications for shared sessions (we have their UI as oracle).
- **5-tier side ladder** + header gauges (session sentiment verdict, P/C ratio / volume / premium) published in
  `meta.json`.
- Terminal tape/desk render the new columns (column-picker, not 30 visible columns); Filter-Group vocabulary (R4)
  keys off this schema. Honesty: classifier confidence tagged; heuristics labelled (`~sweep` until calibrated).

### R2 — The intraday store + universal playback (the keystone)
Goal: QuantData's defining capability — every widget can replay any minute of any session.
- **Store**: extend the Flow-Surface grid store from 3 roots to tier-1 (~35 roots) at poller cadence and all
  U-CHAIN roots at 15-min; nightly compaction to per-session parquet on the M1 store; dated R2 publish
  `intraday/{ROOT}/{DATE}/{metric}.json` with an index manifest. Retention: 90 sessions hot on R2, full history on
  the M1 store. Cadence honesty: the scrubber step granularity = actual snapshot cadence (1-min only when the
  cadence fix lands; 15-min meanwhile — the UI must say which).
- **Slice-3 deep backfill** (forward accrual + Terminal consumer already handled in R0.10): extend
  `build_index_gex_history.py` to persist the reconstructed full per-date ladder in the `options_hub.gex/v1`
  shape under the same `gex_history/{ROOT}/{DATE}.json` family (`reconstructed:true`), 2017→ for index ETFs
  (~300–400 MB R2); extend `audit_overlap` (existing validation primitive, net-GEX corr 0.94–0.998) to ladder
  level over the 2026-07-17→ live overlap **before** the picker exposes reconstructed dates (honesty gate);
  single-name recent history re-derivable from `data/polygon_gex/chains/{DATE}.parquet` (since 2026-06-15).
- **Universal playback wrapper** (terminal): one shared component (date-picker + time slider + play/pause + crop
  brush + LIVE-follow) adopted by Exposure ladder, PRISM, heatmaps, tide, net-flow — replacing the Surface-tab-only
  replay. replayBus stays the cross-pane time authority. Fix the stamp-index head-follow gap (poller missing).

### R3 — The missing analytics surfaces (terminal + small builders)
Interval Map (bubbles, value/Δ modes — U-CHAIN data) · multi-metric Heat Map (strike×expiry engine: GEX/DEX/VEX/
CHEX/net-prem/net-vol/OI/IV/…, MVC marker) · exposure normalization modes (1%/$1/unit) · OI suite (OI/Time from the
1.9 GB OI history, Max Pain + Max Pain/Time, OI Change table) · Vol suite (Volatility Drift ARV-vs-IV intraday,
IV Rank with configurable lookback, Skew, Term Structure — from the vol payload + U-CHAIN IV) · Statistics
(contract stats, trade-side stats, market share by exchange from retained exchange codes) · Net Flow/Net Drift
upgrade (click-reveals-largest-trades-per-interval, Net Drift Cross events) · **VEX/UNUSUAL-equivalent lenses turn ON, on the Exposure matrix** (PRISM retired, §5.3)
(vanna grids from U-CHAIN make VEX honest; the 30-d unusual baseline has accrued since 07-24 — verify, then light).

### R4 — Filter Groups, alerts, and the workspace bus (terminal + Supabase)

**2026-10-18 bounded slice IN FLIGHT** — `claude/ssd-options-product-integration-20261018-8bb2bf58397e9392` adds a versioned link to the existing Tape controls and sort order. Recipients use their current available feed and existing access; the link is neither a saved snapshot nor an alert. Unsupported links withhold results until explicit recovery. This does not close R4's saved-group AST, account persistence, public library, alert inheritance, or cross-page filter bus.

- **Filter engine**: Field/Operator/Value AST over `flow.print/v2` + contract + underlying vocabulary; applied
  server-side in the SSE spine (per-connection filter param) and client-side for instant refinement; human-readable
  summary sentence (their best UX idea).
- **Persistence/sharing**: Supabase tables (`filter_groups`, `alert_rules`) with owner RLS + public flag +
  duplicate; seed a curated public library (SPX big orders, golden sweeps, 0DTE whales…).
- **Alert generalization**: alert = filter group + event type + throttle; new types from R2/R3 surfaces (MVC
  proximity/shift, Net-Drift cross, wall-touch upgraded to intraday) joining the 5 existing opt_* kinds; delivery =
  existing alerts plane (5-min VPS cron) + SSE in-session toasts; throttle field honored.
- **Page/global filter sync**: ticker/expiration/session-date context bus across the options workspace (the
  QuantData Page/Global Tool Filters pattern) — replaces today's per-tab root state.

### R5 — IA restructure + the blind-spot surfaces (terminal)
Reorganize `/options` from 11 flat tabs into QuantData-shaped categories **in our idiom** (see §5): Command ·
Flow · Exposure · Structure (OI) · Volatility · Statistics · Prophet. Kill the aliases, extract the monolith,
unify the 3 ladder idioms + 3 expiry renders, cross-link tape↔desk, move leaders/radar fully into Discover.
Add the blind-spot surfaces neither product has as first-class: **0DTE dashboard** (dedicated tab of the Flow
category), **largest-trades board**, **chain browser table** (plain sortable chain — table stakes), **P/C ratio
history chart**, **expected-vs-realized move report** (moves data already exists), CSV export on tape/screener.

### R6 — Prophet superintelligence (macro engine + terminal; the flagship)
Full design in §6. Summary: multi-source origination (GC-v2 + cascade + standouts + options-flow triggers),
options-structure-aware geometry (walls/flip/expected-move), live intraday management (flow deltas re-score
signals mid-session), option-contract optimization + graded option outcomes, ledger surfaced (PERF tab real),
Prophet on charts/ticker pages/screener, bear-side lane behind its own pre-registration.

**Canonical R6 delivery order (2026-08-08; this is the QuantData overlay, not a parallel roadmap):** PIT
candidate/episode ledger → H+60 and multi-horizon outcomes → campaign aggregation → sparse selector with explicit
abstention → exact executable-contract optimizer → staged position lifecycle → Today/Pulse operator workflow.
Later stages may be scaffolded, but they cannot claim authority ahead of the evidence stage that precedes them.

### R7 — Dark pool & equities lane (owner spending decision required)
Decision gate: **Polygon TRF** (cheap, prints+levels) vs **Databento** (licensed depth, per
`docs/DATABENTO_INTEGRATION_DESIGN.md`, incl. pro/non-pro classification duty). Until decided, the honest FINRA
EOD belt stays. When decided: Dark Pool Levels (top price levels), Dark Flow (cumulative), Equity Prints, Exchange
Notifications (halts/LULD from the same feed family), Market Map. **No fabricated interim.**

### R8 — Composability (deliberately last)
My-Pages-style custom layouts over the R5 category surfaces (widget = extracted tab panes; layout persistence in
Supabase). Only after R5 proves the extracted-pane architecture; a fixed excellent IA beats a widget board until
every widget is excellent.

**Sequencing law**: R0 unblocks everything and is pure repair — do first, immediately. R1→R2 are the data spine and
strictly precede their UI consumers. R3/R4 parallelize after R2. R5 lands as its surfaces stabilize. R6 runs as its
own lane once R0.7 + R2 exist (its intraday inputs). R7/R8 are gated (spend / IA-maturity).

---

## 5. IA redesign — `/options` as one coherent product

Categories (workspace tab row), each hosting sub-views via the existing WorkspaceTabs pattern:

1. **Command** — the desk formerly known as `desk`: watchlist rail, session gauges (new R1 header verdicts),
   chain-heat rail (relit), tide compact, EOD context belt, Prophet receipt. The "open the market" home.
2. **Flow** — tape (enriched R1 columns) + Net Flow/Drift + 0DTE dashboard + largest trades. One filter system
   (R4), one preset library; card view (old Flow Desk) and table view (old Tape) become **view modes of one
   surface**, ending the duplication.
3. **Exposure** — the gexdesk suite + Interval Map + multi-metric Heat Map + universal playback; PRISM merged here ✅ §5.3 (PR #344): Matrix view + Confluence + HeatSeeker, one shared renderer with Positioning
   as the matrix view (one ladder idiom, one levels provenance, one expiry render).
4. **Structure** — OI suite: chain browser, OI by strike/expiry, OI change, Max Pain (+/Time), OI/Time.
5. **Volatility** — Vol Drift, IV Rank, Skew, Term Structure, expected-vs-realized moves.
6. **Statistics** — contract/trade-side/market-share (+ export).
7. **Prophet** — the R6 desk.
Screener + Tickers fold into **Flow** (screener) and a global ticker drill (Tickers' vol content moves to
Volatility). Leaders/Radar leave for Discover (they are equity boards). Every dead alias (`?tab=vol`) 301s.

Design doctrine unchanged: v5/v7 tokens, LEX i18n, `--up/--down` law, svgChart law, Tip primitive, honesty chips
(asof/cadence/provenance on every widget), responsive contract (1440/820/390 e2e).

---

## 6. Prophet superintelligence — architecture

**Principle (amended 2026-08-08)**: Prophet stops being a repackager of one upstream list and becomes the
estate's **governed evidence desk**. It is not one fused score. Macro-originated plans and options-originated
opportunities remain separate lanes with separate books, timestamps, provenance, calibration and authority.
Information, positioning and execution evidence may be displayed together but is never averaged into an opaque
"options confidence" number. Score-not-gate, display-tier, ledger-graded, and "validated" stays CI-forbidden.

### 6.1 The spine artifacts

Wave 0 ships `options.prophet_shadow/v1` as a fail-closed projection over the existing Flow Leaders and Pick Lab
books. Its `opportunities` are only actual same-session Pick Lab fires; its watchlist preserves source order and
never becomes a buy list. Direction and trajectory are withheld, Macro feedback is disabled with weight zero,
and the information/positioning/execution readiness receipts remain separate. This creates the independent
Options Alpha product surface and forward-measurement seam without manufacturing a model.

The later cross-estate document remains a versioned `prophet.spine/v1` per candidate symbol (macro nightly +
intraday patcher):
```
{sym, asof, sources:{
  oracle:   {verdict, quality_tier, keeper, reclaim, known_ts},        # GC-v2 scored lane
  cascade:  {tier, weight, fresh_ticks, htf_s1},                        # macro T1–T4
  standout: {conviction, band, act_level, entry_status, gate_go},       # us_standouts
  entry:    {status, buy_zone, chase_above, invalidation},              # entry_signal
  cohort:   {rubber_band_z, peer_washout_pct, subsector_gate},          # cohort/subsector
  rotation: {episode, complex_in_out},                                  # oracle_state
  options:  {net_gex, flip, walls, dist_to_flip, vex?, charm?,          # gex_state/matrix
             pcr, iv_rank, term_slope, expected_move,                   # vol/moves
             flow: {tide_z, unusual_z, sweep_bias_5t, oi_confirm}},     # R1/R2 intraday
  technicals: {ma_stack, rsi_regime, vol_squeeze, washout, extended},   # entry_primitives
  seasonal: {bucket_tilt}, market: {risk_verdict, regime},              # seasonal/market_risk
}, staleness per source, grammar tag per source}
```
Composed **from existing artifacts** over the R2 bus. Each source carries its own `known_ts`, source authority,
coverage/signing uncertainty and bar-grammar tag. The spine is an evidence envelope, not permission to score or
fuse a source. A consumer must honor each component's own promotion receipt.

### 6.2 Origination (multi-lane, provenance-tagged)
Lanes, each pre-registered with its own pick rule (macro `research/` prereg discipline):
- **L1 Standout** (today's lane, unchanged — continuity of the ledger).
- **L2 Confluence-of-confluences**: GC-v2 A+/quality BUY ∧ cascade T1/T2-fresh ∧ subsector tailwind.
- **O1 Flow-leader** (Wave 0 shadow): a `plab_flow_leader` Pick Lab fire, independently ledgered. A raw Board A
  member or `fire_a` flag is only a watch candidate.
- **O2 Flow-washout** (Wave 0 shadow): a `plab_flow_washout` Pick Lab fire, independently ledgered. A raw Board B
  member or `fire_b` flag is only a watch candidate.
- **L3 Flow-trigger research lane** (the operator's "sudden bullish shift" ask): buyer-initiated opening flow,
  delta/vega-weighted imbalance, acceleration/persistence and OI confirmation. Public gross volume/OI and
  conventional GEX do not satisfy this definition. The lane stays withheld until signing/open-close identity,
  PIT data and a prospective rule pass their own gate.
- **L4 Washout-reclaim**: rubber-band extreme + reclaim lane + flow confirmation.
Each plan records `origin_lane` + the immutable spine snapshot at origination (auditable forever). Lanes are
reported and graded separately; no cross-lane composite is created. Selection stays BULL-only until a bear-lane
prereg passes review (bear branches exist in the geometry code already).

#### 6.2.0 Canonical evidence-to-product sequence

This section is the single R6/QuantData execution overlay. Do not create a competing Options Alpha roadmap.

1. **PIT candidate and episode ledger:** one immutable candidate event with exact `decision_at`, `available_at`,
   source receipt IDs and episode identity. Repeated prints belonging to one thesis are not extra picks.
2. **H+60 and multi-horizon outcomes:** accrue H+60 first, then EOD/1d/3d/5d/10d/expiry in a separate outcome
   ledger. Outcome rows never inflate the candidate count.
3. **Campaign aggregation:** join related contract/root flow into point-in-time campaigns with recurrence,
   opening/closing evidence, persistence and decay; keep raw prints addressable.

The pre-existing #5332 cohort is a preserved legacy retrospective ledger; it is neither this canonical campaign contract nor evidence for selection or promotion. #5338 supplies fail-closed scheduled episode/outcome publication plumbing, but does not aggregate a canonical campaign or grant authority.

Macro #5362 deploys the canonical versioned campaign-revision, outcome and checkpoint writer with prospective boundary `2026-08-12T13:30:00Z`. #5421 restored exact five-file episode and three-file campaign publication; #5422 isolated the scheduled lane from its polluted concurrency namespace. No manual workflow dispatch, rerun, or backfill is counted as evidence.

The first untouched post-restoration `event=schedule` run, `31649984834` / engine job `94324330758`, published episode commit `e97382797049c43dacd80a100a02b95829375bec` followed by exact-three-file campaign commit `481fecc70f299f3b480176b050b9dbae298a15c2`. All exact OIP build/publish steps and the terminal fail-closed integrity gate passed; the engine job was red only because the unrelated broad engine-output publisher exhausted its push-contention budget. The checkpoint binds 1,206 episodes, 969 H+60 outcomes and 1,456 session outcomes to 1,146 campaign revisions and 2,277 anchored outcomes. Exactly 489 revisions satisfy `prospective_after_rule_freeze` with `formed_at == final member available_at >= 2026-08-12T13:30:00Z`; all authority and training flags remain false and legacy v1 is byte-identical. Preregistration #5376 (`6ba8e7f368a1674b7114d5bd867aa721bd0472f8`; rule digest `a98d3b92e1ebe069c141d5f79ee9260eeb2b8eeee4f90f574ef0069c062ad20b`) was hosted before the boundary. This closes campaign publication/accrual only and unlocks its research-only sparse-selector implementation, not selector evidence or promotion. Replay idempotency, late-prefix supersession, optimizer, lifecycle, Today/Pulse, Macro rank, sizing, trading and training remain separately gated.

4. **Sparse selection and abstention:** pre-register portfolio fit, regime, correlation/sleeve, cash, cooldown,
   minimum-hold and maximum-new-position rules. Zero is a valid answer.
5. **Exact contract optimizer:** choose a real OCC contract only from contemporaneous NBBO, spread, liquidity,
   IV/Greeks, capacity and cost receipts; keep underlying and option objectives distinct.
6. **Staged lifecycle management:** append-only issue, accumulation permission, trigger, fill, trim/roll/trail,
   invalidation and close events; never mutate the original issue receipt.
7. **Today/Pulse workflow:** only after the prior contracts are honest, expose the operator queue, active portfolio,
   management changes, abstentions and performance attribution as one workflow.

Macro owns the PIT/campaign/outcome/selection/optimizer builders and ledgers. Terminal owns the responsive
Today/Pulse, Issue Desk and managed-position views. Neither side may promote options evidence into Macro rank until
the paired incremental-attribution gate is separately reviewed and promoted.

#### 6.2.1 Operator-reviewed Issue Desk (R6.2-A speed path; built 2026-08-09)

User value must not wait for automatic options-model promotion. A separate `options.issue_desk/v1` workflow takes
current Macro candidates plus frozen options, regime and execution receipts into an explicit human approve/reject
decision, then a sparse Research Portfolio. The operator may add **0–4 positions per rolling three sessions**;
zero is valid. Every proposal, rejection and issued research plan records reviewer, exact `decision_at` and
`available_at`, reason codes, immutable inputs and resulting portfolio state. The desk evaluates allocation fit,
not four independent top scores. It cannot change Macro rank, cannot masquerade as automatic Options Alpha, and
does not waive executable-contract/risk disclosure.

The implemented v1 is deliberately private and request-driven. Macro serves authenticated
`GET /api/options/issue-desk` and `POST /api/options/issue-desk/reviews`; Terminal exposes operator-only same-origin
proxies and never fetches the desk through `/api/flow` or public R2. Macro persists 0600 append-only proposal and
decision JSONL beneath a 0700 API state directory, with a global process lock, fsync, strict duplicate-key/non-finite
JSON rejection, stable proposal revisions and idempotent review keys. A private offline projection tool may write
only below that state directory. There is intentionally no GitHub Actions producer, public `site/` artifact or R2
mirror containing proposal, rejection, contract, risk or position data.

V1 can append only `PENDING_REVIEW → ISSUED | REJECTED`; it does not expose a post-issue mutation actuator. The
longer lifecycle below is the frozen transport boundary for a later version, after management inputs and exact
marks exist. In the current version an ISSUED row is an operator-attested research plan, `brokerage_trade=false`,
with all five rank/gate/size/trade/automatic authority flags false.

The transport state machine is explicit: `ISSUED → PARTIAL_ALLOWED` (optional;
only when a frozen starter policy permits it) `→ ARMED → TRIGGERED → MANAGED →
CLOSED/CANCELLED/INVALIDATED`. Every issue freezes the underlying
trigger, no-chase and add rules, entry/reference, stop, T1/T2 partial-exit
fractions, minimum hold and horizon, plus OCC contract/strike/expiry, premium,
quote and fills. Dynamic validity/progress/pace/overlay readings are management
receipts, never a retroactive origination score or silent Macro-rank edit.

Acceptance fixture (transport completeness only, not a recommendation): an LMT issue can preserve a 582.74
underlying reference, separate 595 trigger, 525 stop, 700 T1, a 600-strike September 18 call and a 30-day minimum
hold without flattening those facts into one nightly Prophet row. The issue/partial permission/armed/triggered/
managed events and the option marks remain separately timestamped.

#### 6.2.2 Automatic sparse issued-model-portfolio slice (after evidence accrues)

The product sequence is **Research Watchlist → sparse Issued Model Portfolio → managed positions**. A Pick Lab
fire is not automatically an issued position. The later automatic slice owns a separate `options.model_portfolio/v1` artifact
and append-only portfolio decision/position/outcome ledgers. Portfolio construction must jointly enforce regime
alignment, correlation and sleeve caps, cash/abstention, maximum new picks, symbol/refire cooldown and a minimum-
hold policy. Its target is roughly three to four issued calls every few sessions when the environment permits,
never a mandatory quota or naive top-K truncation. Every issue, suppression and management action records exact
`decision_at` and `available_at`; outcome accrual is separate at 1h/EOD/1d/3d/5d/10d/expiry. Konseki Market Memory
may enter only as `context_only`, weight zero, with no rank/gate/size permission.

Underlying-plan P&L, option-contract P&L and allocation-weighted portfolio P&L
remain separate. `sum_of_trade_returns` is a descriptive aggregate and may never
be labelled portfolio return; the latter requires actual sizing, cash, overlap,
fills/costs and a time-indexed equity curve.

### 6.3 Geometry (options-structure-aware)
Macro-plan stops/targets may display walls, flip and expected-move context, but they do not automatically snap to
those levels until the paired path ledger shows incremental value. Gross-volume-derived GEX/vanna/charm are
labelled estimates and begin as volatility/trajectory-regime features, not directional alpha. Options Alpha keeps
target, time-to-target and exit window null until a PIT competing-risk/path model passes walk-forward and
prospective calibration. Exact take-profit clocks are prohibited; eventual output is calibrated first-passage
probability plus a time band.

### 6.4 Management (live, both directions)
- Nightly Macro engine remains the anchor. A future **intraday options re-scorer** may emit a bounded shadow delta
  only after the exact live feature pipeline passes signing, freshness and paired incremental-attribution gates.
  Until then Options Alpha cannot alter Macro admission, phase, rank, target or size.
- Intraday touch detection from the intraday store closes the "close-only scan misses T1/stop touches" gap.
- `macro_stance`/`futures_chg` wired (R0.7). Earnings-blackout veto joins management (no "Hold" through a report
  silently — chip + confidence haircut).
- **Option overlay graded**: add a point-in-time contract/quote/fill/lifecycle ledger before computing
  `option_result_pct`; separately freeze `macro_base`, `macro_plus_options`, and `options_originated` books so the
  added value of options evidence is measured rather than inferred from the stock outcome.
- **PERF tab goes real**: the ledger (already accruing, PIT-safe) renders as the desk's track record with the same
  delayed-winners law as the landing.

### 6.5 Distribution (Prophet everywhere it's relevant)
The Options workspace Prophet view begins with distinct **Macro Plans**, **Options Alpha**, and private **Issue Desk**
panes. The third pane is available only through the verified operator entitlement and Macro bearer API; it renders
pending reviews, immutable decisions and research-plan lifecycle receipts without reinterpreting a watch/fire row
as an issued position. Empty true-fire
states, source/gate readiness, stale state and forward-book accrual are first-class; watch candidates are capped for
scanning but preserve source order and are never relabelled as signals. Chart: Macro plan levels (entry/stop/T1/T2)
and a phase chip as an opt-in overlay (ChartPanel already draws level rails).
Ticker page: Prophet receipt block in StockAnalysis (plan state or "no active plan — nearest lane distance").
Screener: `prophet_phase`, `management_confidence`, `origin_lane` manifest columns. Watchlist rail: phase dot.
All read the same index — no second pipeline.

### 6.6 Golden Oracle upgrades (the entry-gate stays sovereign)
Oracle remains the entry authority (its no-cut/GC-v2 discipline is validated); upgrades are inputs, not overrides:
Tech-Lab combo stats + confluence_screener combos surface as graded context rows in OracleDash; the spine's
options block joins the OracleDash context (walls/flip/flow bias beside the verdict); the tri-desk relationship
becomes explicit in the UI: **Oracle = "may I enter?" · Research Desk = "is it worth owning?" · Prophet = "manage
the trade"** — one shared SignalButton popover surfaces all three with their disagreements disclosed (the existing
lane-disagreement pattern, extended). No merged composite score — DNR's fusion-score ban stays respected;
disagreement is displayed, not averaged away.

---

## 7. Execution operating model

- **Hosts**: M1 = all pollers/builders (launchd, `plane` env); macro repo = engine/classifiers/spine/Prophet;
  terminal repo = all surfaces; VPS = serving + alerts cron. R2 = the only bus. The `terminal-data` two-copies law
  and the 200-min macro nightly budget both apply (heavy new steps go to M1 launchd, not the GH nightly).
- **Cadence honesty**: every widget states its true cadence (1-min / 15-min / nightly) — the QuantData look with
  our honesty chips. Nothing ships against unvalidated reconstructed data (slice-3 gate).
- **Verification**: responsive e2e at 1440/820/390 per UI wave; fixture families per new f-param
  (`flow-fixture-family-authoring` rules); classifier calibration vs QuantData sessions before `~` prefixes drop.
- **Delivery**: standing chain per wave (commit→PR→CI→merge→deploy→marker-verify). Data-plane changes: staggered,
  rollback-armed, never double-running against prod R2.
- **Owner decision gates**: (a) ThetaTerminal jar upgrade / vendor ticket approval (R0.6); (b) dark-pool feed spend
  (R7); (c) news-feed law reconfirm (we keep excluding it); (d) bear-lane activation after prereg (R6.2).

*Reference audits for this plan (2026-07-31 session): terminal options suite, parity history, Prophet trace,
signal stack, data-plane reality, QuantData live walkthrough + screenshot catalogs.*
