# Returns Study v2 — product, design and implementation contract

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


Status: DESIGN_AND_IMPLEMENTATION_IN_PROGRESS. This document is a build contract, not production acceptance.
Date: 2026-10-05. Implementation owner: Terminal PR #814, branch `sol/returns-calendar-20261004`.

## 1. Commission and source identity

Chris's current commission is a complete Returns redesign: retain the existing Mastermind visual language, substantially improve the Paper design, reassess placement, audit the calculations/data architecture, prepare and verify the implementation before integrating it, and complete authorized integration where possible.

The protected procedural source was pinned to Mastermind `7eac3ec252475600147ec9a376b8ca16403ac4c5`: INDEX, ACTIVE_EXECUTION, SESSION_RELIABILITY and the Paper workflow/connection companion. These procedures are not reproduced here. Implementation census began at Terminal `efa52d7e0fe5985939d5e54012514ec7abe4763d`. PR #814 is open, not merged. Its synthetic merge ref is not evidence of a merge. Existing v1 test results do not prove this redesign.

DONE_WHEN: the editable Paper specimens, functional responsive study, precise and defensive calculations, independent data-state handling, compact existing-shell entry, existing-workspace integration, executable regression evidence, independent review, and permitted release/browser verification agree. A source commit, a static specimen, or a passing helper test alone does not satisfy this outcome. Production credentials, vendor display rights and release admission remain separate gates.

Scope excludes portfolio/trade decisions, new providers or purchases, a new data/control plane, universal historical completeness, raw-trade extrema, and unrelated Terminal redesign.

## 2. Product placement — one study, existing hosts

The full calendar should not consume the stock rail indefinitely or live beneath the complete research stack merely because that location avoids a file hash lock.

Use two presentations of one daily model:

1. **Compact Returns entry** in TerminalShell's shared detail rail/native dossier: latest observed month, price return, up/down counts and the last five observed daily moves; one Open returns study action. It reads the already-loaded daily bars and makes zero intraday/overnight requests.
2. **Full Returns study** in the existing fundamentals/research host, through `FinPage = "returns"`. `finPages.ts` remains import-free. `MegaPane.tsx` hosts the full study; `ResearchWorkspaceNav` and the standalone analysis route use the same page identity. Preserve existing `?pane=` Terminal and `?page=` analysis ownership instead of inventing a second router. Inspect every exhaustive FinPage map before adding the member.

`MegaPane` is already dynamically mounted. The full study and its session loader must not create an eager import edge from TerminalShell into that heavy graph. Preserve StockAnalysis's existing evidence surface where possible; do not edit locked evidence manifests merely to quiet a failing test.

## 3. Visual system and editable Paper

Paper file `01M3P1TW5Y3XWQC37ADDS8K5AG`, page `p-7-0` (Returns Calendar — Terminal + Dossier).

New editable specimens:
- `AXL-0`: Returns v2 / Desktop Study / 1440 x 900.
- `B4J-0`: Returns v2 / Mobile Study / 390, vertically scrollable content specimen.
- Compact entry and expanded/failure specimens are pending at this checkpoint; record exact IDs when created.

Original v1 boards AOD-0, AT2-0 and AWJ-0 remain historical reference, not the v2 implementation target.

Art direction: editorial instrument panel, not a wall of identical cards. Existing graphite background (#0F1115), panel (#181B21), text (#D7DCE3), muted (#8B93A1), gain (#45B873), loss (#E06464), selection blue (#5B9BF0). Inter for prose/headings and Menlo/tabular numerals for prices. The monthly result, daily selection and secondary technical detail have distinct scale and weight.

Scoped Paper heat tokens were added without changing the existing semantic colors:
- up soft #1A2325; up mid #1D2B29; up strong #213A31;
- down soft #222025; down mid #302429; down strong #402A2F.

Paper's HTML import dropped color-mix fills, so explicit tokens were used in the specimen. Browser CSS may derive equivalent tints from the existing up/down tokens, preserving light-theme and East-Asian up/down preferences. Never bake a second global green/red policy into this module.

Desktop: title/breadcrumb, month summary, calendar with equal-width weekday columns, and a selected-day inspector alongside it. The inspector includes daily return/change, O/H/L/C, a low-to-high range with open/close markers, opening gap and open-to-close factors, followed by expandable session rows.

Mobile: 44px navigation/export/session targets, five readable weekday columns, date and return in the grid, full prices below in the selected-day panel. Do not cram 7px H/L strings into phone cells. The specimen is a scrolling content view inside existing app chrome, not a second native navigation shell.

Positive/negative text is signed. Blue outline and selected-state text/marker distinguish selection without relying on color alone. Focus is separate from selection. No gradients, glow or animation may obscure values or consume idle compute. Reduced-motion preferences suppress transitions.

All October 2026 values in these specimens are explicitly **illustrative**, including future dates. They are generated from one coherent fixture, not fabricated live evidence. Base close is 250; 22 daily observations produce a displayed +10.47% monthly price return, 14 up/8 down days. Selected Oct 14 has previous close 259.0982, open 262.1037, high 270.3928, low 260.5311, close 269.0476. Rounded day return +3.84%, opening gap +1.16%, open-to-close +2.65%. The range marks must be computed from those same values.

## 4. Daily model and numerical meaning

For positive, finite and consistently based daily prices:

```
day_price_return = close / previous_observed_close - 1
opening_gap = open / previous_observed_close - 1
open_to_close = close / open - 1
(1 + opening_gap) * (1 + open_to_close) - 1 = day_price_return
```

Display percentages only at the presentation boundary. Never sum rounded factors. The daily price series is not dividend-reinvested total return. Source split adjustment is not evidence of total-return adjustment.

Monthly price return uses the latest observed close in that month divided by the immediately preceding observed close before the month. When the prior-month reference is absent, withhold the monthly percentage; the first in-month open or close must not silently replace the denominator. Show reference/end dates and observation count. An in-progress or incomplete month is an observed interval, not a certified full-month return.

Daily records are sorted by validated session-date keys, deduplicated deterministically, and checked for finite positive O/H/L/C, nonnegative volume where present, high >= max(open,close), low <= min(open,close), high >= low. Exact duplicates may collapse; contradictory same-date rows must be disclosed/withheld rather than selected by array order. Invalid rows cannot create a zero price or denominator. A gap between consecutive valid observed dates is explicitly an observed-date gap; do not label it a single-session result without calendar evidence.

Up/down/flat counts use unrounded returns. Best/worst ties resolve deterministically by date and are described as best/worst observed moves. The first observation without a denominator is not counted as a flat day. Avoid NaN, Infinity, negative zero, invalid Date exceptions, and gigantic spread-operator argument lists.

Weekday-only presentation is for exchange-traded daily series. A 24/7 crypto series needs seven columns; otherwise weekend records disappear while still changing returns. Derive this from the existing market classifier; do not offer the US session breakdown for crypto, macro, daily-only FRED or non-US equities.

## 5. Session model — observations, not a false decomposition

Use the existing 30-minute grain for US session studies. It aligns with 04:00, 09:30, 13:00, 16:00 and 20:00. An extended-hour 09:00–10:00 bar cannot be split into premarket and regular data after aggregation.

For selected date D, overnight observations are prior wall-date >=20:00 plus D <04:00. Premarket is D 04:00 to the canonical regular open. Regular is the canonical [open,close) projection. After-close observations are canonical regular close onward within the existing vendor collection window. Explicitly fence bars by BOTH date and half-open minute range; matching clock time on the wrong day is not sufficient.

Per-session observed move is last usable observed close / first usable observed open - 1. Its extrema are qualifying aggregate-bar H/L. Inter-session price gaps are not included. These four percentages neither add to nor generally multiply to the daily close-to-close return; after-close is outside that daily close boundary.

The UI must expose first/last observed timestamps and valid bar count when a row is expanded. Do not equate a sparse/no-trade interval with a network failure. Do not infer completeness by requiring a trade in every 30-minute bucket. Session H/L is not an all-printed-trade extreme.

The NYSE projection owns regular hours and early closes. A null closed-day window and missing/unavailable calendar metadata are different states. Do not claim this feature removes the session projection from all browser bundles: other existing modules already import it. The new study itself should not add a runtime dependency on the large projection.

**Correction to v1:** a regular early close does not establish that every venue's late session runs to 20:00. NYSE documents some early-close late sessions ending at 17:00. Label the feature After close and show observed coverage; the existing 20:00 vendor collection fence is not universal exchange-hours authority.

## 6. Ownership and request economy

Keep existing owners:
- daily bars: getBars / TerminalShell or analysis host;
- canonical daytime history and rate/auth/source gates: `/api/intraday`, intradaySources and intradayStore;
- BOATS credentials and overnight history: Quote Hub only;
- regular-session truth: existing usEquitySessionClock projection.

The full study requests only its selected date, at 30m. The prior-wall-date request uses `overnight=only`, skipping Massive/store work that the client would discard. Opening a compact rail entry alone must not request historical sessions. Changing ticker/date cancels or safely detaches old subscribers; late responses cannot overwrite the current selection. No per-calendar feed, socket, polling daemon, event bus, or independent broker credential store.

Reuse existing request/cache machinery where adequate. Any bounded coalescing needed inside the current history owner is an implementation detail, not a new runtime lifecycle. Completed caches have entry limits and TTL; in-flight entries have bounds and are removed in finally. Repeated same-key requests share upstream work. Network errors and 429s do not generate tight retries. No refresh while hidden/unmounted. Manual retry must be explicit and finite.

## 7. Transport and identity contract

Consumers validate unknown JSON before use. Bind the response to the requested symbol, timeframe, wall date and source. Wrong symbol/date responses are unavailable, not transferable data. Validate Bar6 shape and coherent positive OHLC; Number(null), empty strings, booleans and malformed arrays must not become prices. Reject or disclose conflicting duplicate timestamps.

A future server revision should emit a versioned study metadata object, including:
- identity: symbol, date, tf, display-clock convention;
- canonical regular window and calendar status;
- per-source status, observed count, rejected-row count, first/last observation;
- assembly timestamp/cache state and basis labels;
- explicit coverage/failure reasons without raw provider error bodies or secrets.

Maintain backward compatibility for ordinary `/api/intraday` consumers. Validate study flags before executing providers. Duplicate/unknown modes must fail closed; overnight-only needs ext=1, valid date, supported minute grain and US-equity scope. Do not treat an ignored illegal parameter as a successful alternative mode.

## 8. Failure isolation and honesty

Current-day and prior-evening calls are independent. A failed prior BOATS request must not blank valid premarket/regular/after-close results or the daily layer. The component needs independently settled requests, not one Promise.all failure path for all sessions.

If one overnight half fails while the other contains bars, mark the overnight row PARTIAL; retain observed extrema/timestamps with that label, but withhold the full-session percentage rather than making a half-session look complete. Explicit empty half plus successful other half is different: no eligible bar may legitimately exist. Missing identity or unavailable evidence is not explicit empty.

A cold failure of recent Massive/store assembly must still allow an independently authorized overnight read. A failed date fallback reports unavailable, not empty. The existing canonical bar trace must not be attached unmodified to a newly merged BOATS response: scope it to canonical bars or recompute compatible evidence, and publish the overlay receipt separately.

Closed/unsupported, no observations, not configured, entitlement unavailable, transport failure, invalid data, stale and partial states must have product-facing language. Do not display raw exception strings, credential names or internal policy enums to users. Do not erase a last-good same-identity view while a retry is pending; never reuse last-good data for a different ticker/date.

## 9. Hub hardening requirements found in the v1 audit

The source adapter currently has a 60-second Map but no size cap or in-flight deduplication; arbitrary numeric timeframe strings, regex-only dates, weak provider payload validation, and an 8-second upstream timeout behind a 5-second proxy. Harden these in the existing owner.

Require strict real date/timeframe/symbol validation before provider calls. Bound cache entries and concurrency. Use one total request deadline covering headers and JSON/body consumption, with the proxy's deadline longer than the Hub's whole operation. Preserve the existing extended-hours kill switch and credential custody. Fail on unexpected pagination rather than silently calling a truncated response complete, or follow a strictly bounded page-token loop on the fixed allowlisted provider origin. A 30m one-wall-day overnight study should normally fit a single page.

Source selection must not follow a provider-supplied arbitrary next URL with credentials. Preserve split-basis compatibility; handle corporate-action boundaries cautiously. No source code or free-plan documentation proves production credentials, historical entitlement, coverage or commercial redistribution permission.

## 10. Interaction/accessibility contract

Month controls have precise labels, valid min/max bounds and a Latest month reset when meaningful. Date cells expose full date, signed return, selected state and missing-reference explanation. Use one keyboard tab stop in the month grid, arrow movement, Home/End for the row and PageUp/PageDown for month navigation; keep focus distinct from selection and preserve focus when a month changes. Selection updates the inspector without stealing keyboard focus. Provide a live selected-day announcement, not an aria-live wrapper around the entire data grid.

Expanded session detail uses native disclosure semantics where possible. Export produces real CSV from the displayed daily model with date, O/H/L/C, previous-reference date/close, return, basis and quality state; no inactive export button. Escape handling, scroll locking and overlay focus remain owned by the existing host, not duplicated by the study. Use the existing EN/ZH localization conventions. Respect reduced motion and theme-direction preferences. Keep the daily model memoized and the calendar bounded to one month.

## 11. Verification and integration sequence

A. Complete and screenshot-review desktop, mobile, compact entry and expanded/failure Paper states. Extract JSX/computed styles from those exact nodes. Preserve the old boards, finish only owned work.
B. Build reusable pure daily and session helpers, runtime JSON parser, full study, compact preview, scoped styles and deterministic fixture preview locally. The fixture preview has no provider credentials and never represents production data.
C. Test month denominator absence, compounding identity, duplicates/conflicts, invalid/zero prices, date overflow, wrong-day bars, weekends, early close, partial overnight, unsupported symbols, stale request identity, transport errors, abort/unmount, CSV escaping and keyboard navigation. Add property/metamorphic tests for sorting and scaling invariance.
D. Harden the existing Hub/proxy/route paths with tests for bounded caches/coalescing, kill switch, auth-before-cache, strict flags, total deadlines, failed cold assembly, and evidence scope. Ordinary chart APIs and quote demand must remain unchanged.
E. Integrate one FinPage and every exhaustive map/nav, then replace the large rail calendar with the compact entry. Do not create a second full calendar owner or a new top-level application route.
F. Run actual typecheck, focused and regression tests and real browser geometry/interaction tests at 390, 820 and 1440, in EN/ZH and light/dark where supported. A Paper screenshot is design evidence, not browser proof. A DOM count is not an accessibility or performance proof.
G. Persist exact tested source refs/digests, independent review findings, CI results and unresolved obligations to PR #814. Reconcile changed master overlaps before merge. Deploy only through the current exact-target release owner after required review/gates, then verify served source and browser behavior. Missing credentials or rights blocks only that source activation, not truthful unavailable-state delivery.

## 12. Primary-source research checked for this redesign

- Alpaca 24/5 historical BOATS and delayed access: https://docs.alpaca.markets/us/docs/245-trading-for-trading-api
- Massive extended-hours coverage and qualifying-aggregate limitations: https://massive.com/knowledge-base/article/does-massive-offer-pre-market-and-after-hours-data
- Massive custom aggregate bars, split adjustment and response contract: https://massive.com/docs/rest/stocks/aggregates/custom-bars
- NYSE regular/early/late trading sessions: https://www.nyse.com/trade/hours-calendars
- W3C ARIA APG date-grid keyboard/focus guidance: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/

These sources support the specific mechanisms above; none grants new account, data-distribution, deployment or trading authority.

## 13. Compact execution checkpoint

Confirmed: current PR recovered; MegaPane/finPages host identified; editable desktop and mobile v2 specimens created with coherent illustrative daily arithmetic; six scoped heat tokens created; repeated screenshot reviews corrected import contrast/fills and column geometry. Current Paper token hash 501cd923. Snapshot guard is not a file revision or collaboration lock.
Not yet proven at this checkpoint: complete Paper state set, executable v2 code/tests, integration, independent review, latest full CI, production/browser acceptance or BOATS activation. No v2 production mutation and no child worker have been dispatched. No uncertain modifying effect is outstanding.
DO_NOT_REDO: do not rebuild v1 or recensus unrelated systems; do not repeat denied credential-reading SSH effects; do not treat old v1 test counts as v2 evidence. Keep the same PR as the source carrier.
Next: finish compact/edge specimens and extract component styles, then execute the local implementation and discriminating tests before integration. Continue from this save; it is not a stop request.
