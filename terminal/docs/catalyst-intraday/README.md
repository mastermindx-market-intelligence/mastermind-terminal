# Catalyst intraday comparison — authenticated Terminal consumer

**Status: PARENT_REPAIRED_REVIEW_PENDING.** The parent repaired the six consumer-contract gaps
found in the initial candidate and independently ran the checks recorded below. Final-source
independent review, hosted CI and actual entitled production acceptance remain required. These
synthetic tests prove consumer behaviour; they do not establish market outcomes or live user acceptance.

**Repair parent:** `f441cafbb7feb515fd823efb01f4a5eb8f569619`
**Operation:** `catalyst-terminal-intraday-20261022` / Terminal #1132

**Exact base:** `443b3fc0491418bfbcb46653a139c8bdee7db3e7`
**Producer pin:** Macro `bc193e674b07d91acbfa319f5b7943d9996f81cc`,
`scripts/build_basket_pulse.py` blob `90ce4c735dfd63ee7559c55edc06d9ce7a3a64d5`
**Producer merge that left this as an obligation:** Macro #9196 → `90ce473ebb2f6f4e5581b061681e1696252e6f93`,
which names the Terminal React integration explicitly as remaining work.

## What this is

The accepted `basket_intraday_comparison.v1` object already rides inside the existing
`basket_pulse.v1` owner file. This change adds the missing *authenticated consumer* of it inside
the existing Sector Intelligence destination. It is a material factual-product continuation of
Catalyst Intelligence — **not** completion of WP09–11, fullintraday, allmarket, D0, ReleaseA or the
whole programme, and not a capability to recommend, size or notify on anything.

One new feed, `intraday`, is mapped to `/live/basket_pulse.json` on the same fixed Neural Web
origin, behind the same filtered Supabase cookie, through the same Macro entitlement gate, with the
same redirect policy, body bound, timeout and `private, no-store` response contract. There is no
direct browser fetch, no alternate host, no internal baseline access and no admin override.

## Exact input contract consumed

Per basket, `baskets[].intraday_comparison`:

| Field | Meaning |
|---|---|
| `schema` | `basket_intraday_comparison.v1` |
| `benchmark` | always `SPY` |
| `method` | always `matched_member_equal_weight` |
| `observation_kind` | `regular` or `settled_regular` |
| `settlement_tolerance_seconds` | `0` regular, `90` settled |
| `status` | one of exactly 16 owner tokens (below) |
| `reference_asof` / `source_asof` | the two **benchmark source clocks**; the interval is named by these, never by polling cadence |
| `elapsed_minutes` / `session_date` | derived from those two clocks; `session_date` must be the New York date of `source_asof` |
| `max_clock_skew_seconds` | disclosed sampling tolerance, at most `min(60, interval/10)` |
| `matched_members` / `total_members` / `coverage_pct` | matched-member coverage; the producer refuses to emit `observed` below `MIN_COVERAGE = 0.30` |
| `excluded` | per-reason exclusion counts; every member is matched or carries exactly one reason |
| `delivery_state` / `is_new_observation` | `new`/`true` for a fresh interval; `retained`/`false` for a redelivered settled close |
| `absolute_change_pct` | the observed interval change |
| `benchmark_change_pct` | SPY's change over the same interval |
| `relative_change_pct` | the owner's SPY-relative interval change |
| `positive_relative_breadth_pct` | share of matched members beating SPY |

The 16 owner status tokens are closed: `observed`, `membership_changed`,
`insufficient_matched_coverage`, `invalid_return`, `unsupported_session`,
`invalid_evaluation_clock`, `outside_regular_session`, `baseline_missing`, `baseline_invalid`,
`session_boundary`, `baseline_nonadvancing`, `baseline_corrected`, `benchmark_unavailable`,
`benchmark_nonadvancing`, `benchmark_basis_changed`, `benchmark_invalid_return`. A token outside
this set is a contract change and fails closed — it is never rendered as a reason we invented.

## Rules this consumer holds itself to

1. **It computes no comparative financial metric.** Every rendered figure is the owner's own
   admitted value. Field-to-field coherence is *checked* (so an incoherent row fails closed), but
   no displayed number is ever recomputed from another field or reconstructed from quotes.
2. **A retained closing observation is never a new event.** `delivery_state` and
   `is_new_observation` are read together and required to agree; a redelivery that claims novelty
   is rejected.
3. **Unknown coverage stays unknown; validated zero coverage stays zero.** An owner
   `insufficient_matched_coverage` row with zero matched members and a positive total remains
   visible with its validated exclusions. An `observed` row still requires 30% matched coverage.
   A zero denominator, inconsistent counts or incomplete coverage object fails validation.
   Qualified, stale, absent and invalid rows display no financial change or breadth figures.
4. **The clocks retain their distinct meanings.** `feedSourceStamp("intraday", ...)` reads a
   valid full zoned `source_asof`, then a full zoned `as_of_quotes`. It never falls back to
   `as_of_utc`, `built` or receipt time. A date-only `as_of_quotes` is displayed separately
   as a quote bar date. `as_of_utc` is validated and labelled as evaluation time. Each basket's
   benchmark reference/source endpoints remain the interval's evidence at full precision.
5. **An observation ages while the page remains open.** The workspace presentation clock
   updates every 30 seconds while visible and resynchronizes on focus or visibility change.
   It pauses while hidden and cleans up on unmount. This requalifies the already received
   snapshot without fetching, changing an owner clock or changing delivery novelty. Stale or
   future endpoints withhold financial figures while retaining validated owner evidence.
6. **Every admitted basket stays in producer order.** Missing/null comparisons have a consumer
   `absent` outcome; malformed present comparisons have `invalid`. These outcomes retain
   identity without fabricating owner status, coverage or clocks. No metric-based sorting is
   applied. A malformed envelope still rejects the feed; an all-absent snapshot retains its
   whole-capability message.
7. **Qualified evidence remains accessible.** Native keyboard-operable disclosures expose
   validated owner status, interval, coverage, exclusions, method and benchmark. Validated
   delivery state remains available when an observed row ages out. Missing owner interval or
   coverage has an explicit EN/ZH message; absent/invalid comparisons state that no validated
   comparison evidence is available.

## Retained capability boundary

Deliberately **not** built, and not implied by anything here:

- no frontend ranker, rescorer, score or composite;
- no new history or baseline sidecar, and no point-in-time replay;
- no alert model, notification path, entitlement logic or rights service;
- no localized basket-name source is connected — `basket_pulse.v1` carries only `id`, so the owner
  basket id is shown verbatim in both languages rather than a label we would have had to invent;
- no D0, no five-minute interval, no model output and no predictive metric of any kind. The section
  is labelled "Observed interval" / "观测区间" and says in its own footer that it is owner-measured,
  not a forecast, target or signal;
- no new top-level route, no duplicated state owner, no change to any other feed's transport.

## Parent verification on the repaired source

The parent ran these checks in the original managed workspace. Browser runs used the existing
local fixture authentication and isolated port `3271` with one worker and no retries.
The durable evidence manifest is [parent-repair-2026-10-22.json](./parent-repair-2026-10-22.json).

| Check | Command / scope | Result |
|---|---|---|
| Decoder + mounted component | The two `sectorIntradayComparison` unit files | 61 + 26 = **87 passed** |
| Sector and rotation regression | `npm test -- sector rotationRelativeTrend --reporter=dot` | **421 passed**, 17 files; includes the 87 above |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | ESLint on all ten touched TS/TSX files | exit 0 |
| Plain-language guard | `node scripts/check_plain_language.mjs` | exit 0; five inherited findings outside this change |
| Production build | `npm run build` | exit 0; 91.645 seconds; inherited tracing warnings retained |
| Intraday responsive matrix | 13 scenarios × desktop, tablet and mobile; `--workers=1 --retries=0` | Initial **38/39 passed**; failure retained below |
| Affected readiness cases | Correction, non-advancing clock and stale observation × all three viewports | **9/9 passed** after test-readiness repairs |
| Neighbor journeys | Sector company workflow, group discovery and rotation relative trend on desktop | **17/17 passed** |

The first responsive run failed before the mobile correction case mounted: the trace records a
404 for `/_next/static/chunks/components_0-vkode._.js`, and the browser remained on the
initial loading page without requesting the Sector feed. Negative-first assertions could
otherwise pass before mounting. The three affected scenarios now require positive panel
readiness and explicit correction/invalid/stale evidence. All nine affected viewport cases
then passed, with no timeout increase, retry or production-code change. This is coverage of all
39 distinct scenarios across retained runs, **not** a claimed single 39/39 clean run.

New browser witnesses cover mixed absent/invalid/zero-coverage rows in exact producer order,
source instant versus quote bar date in ZH, and an idle mounted page advanced 46 minutes. The
idle case withdraws observed financial figures while preserving source clocks and retained
delivery evidence; its Intraday request count remains exactly one. The original new/retained,
correction, invalid clock, stale, denied owner, invalid envelope, EN/ZH, keyboard and overflow
cases remain exercised at 1440×900, 820×1180 and 390×844.

Before repair, new witness tests reproduced the remaining contract defects. The parent preserved
those red results along with final test output, build logs, the initial failed browser trace,
screenshots and subsequent results under
`terminal/test-results/catalyst-parent-intraday-repair-20261022/` (ignored runtime evidence).

## Source and evidence custody

The initial author README at `f441caf` reported a full unit suite, build and browser results.
Those historical author claims are preserved in Git history; they are not represented as
checks rerun by the parent on this repaired source. The parent did not rerun the entire repository
unit or browser suite.

The separate repair worker `catalyst-intraday-contract-repair-20261022` (controller 68040)
did not return its patch bytes. Its single bounded artifact read (90001) ended with a provider
429 and no artifact. Neither that patch nor its claimed tests is adopted here.

Before the parent repair, the original managed workspace contained one completed partial decoder
edit with SHA-256
`638ed72bdae0acd65f31a4d403dafffdd357346c6ebd7961ac4b988f909bd605`.
Exact tool-history arguments reproduce that file, but the historical writer identity is unknown.
At 19:10:47 UTC the parent preserved the preimage, file, diff and tool receipt, checked the
original operation/HEAD binding and absence of a conflicting active writer claim, and explicitly
adopted the local partial source as the starting point. Subsequent parent writes used exact
preimage guards. That custody decision does not attribute the edit to the inaccessible worker
or adopt any remote test claim.

The previous hosted run `39831077385` belongs to `f441caf`, not this repaired source. It ended
in failure: tablet shard 3 reported an outside-test portfolio route-callback teardown error,
and the shard aggregator failed. A new exact-candidate CI verdict remains required.

## Remaining acceptance

The e2e suite intercepts `/api/sector-intelligence` with synthetic owner payloads. Gateway
tests cover cookie filtering, session checks, fixed origin, redirects, content-type/size bounds
and status mapping. Neither suite substitutes for a live paid-entitlement BFF/user request.

Final-source independent review, current hosted CI, accepted-source deployment and genuine
entitled-user evidence remain open. This change does not complete WP09–11, D0, full intraday or
all-market coverage, Release A or Catalyst Intelligence.
