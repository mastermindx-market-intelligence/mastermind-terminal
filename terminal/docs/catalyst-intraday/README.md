# Catalyst intraday comparison — authenticated Terminal consumer

**Status: BUILT_NOT_PROVEN.** This is the source-side capability only. It has no independent
review, no current-CI run and no production acceptance behind it. Nothing here is evidence of
real market behaviour; every test uses a deterministic synthetic owner fixture.

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
3. **Unknown is never zero.** A qualified row carries no change figure at all — not `0.00%`, not a
   blank, not an implied positive. Absent coverage stays unknown rather than becoming `0/0`.
4. **Source clocks keep their precision.** `feedSourceStamp` gives the intraday feed its full ISO
   `as_of_utc`; only the daily feeds keep the day-granular `sourceDate` behaviour. A transport
   receipt never substitutes for either.
5. **A stale or future endpoint loses only its claim to currency.** The owner status and both
   clocks stay readable so a reader can still judge recency; the figures are withheld.
6. **One bad basket does not discard the others.** Per-basket failure is reported in place; only a
   bad *envelope* rejects the feed.

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

## Verification actually run

All from `terminal/` in a disposable scratch checkout of the exact base, on an isolated port
(`CI=1 TERMINAL_E2E_PORT=3199`) so no foreign dev server could be reused.

| Check | Command | Result |
|---|---|---|
| Decoder unit | `npx vitest run lib/__tests__/sectorIntradayComparison.test.ts` | 55 passed |
| Mounted component | `npx vitest run lib/__tests__/sectorIntradayComparison.test.tsx` | 17 passed |
| Gateway + envelope + Options W2 contracts | `npx vitest run lib/__tests__/sectorOwnerGateway.test.ts lib/__tests__/sectorOwnerEnvelope.test.ts lib/__tests__/sectorAmalgamationNavigation.test.ts lib/__tests__/sectorHoldingsCoverage.test.ts lib/__tests__/rotationRelativeTrend.test.ts` | passing |
| Whole unit suite | `npx vitest run` | 968 files, 16405 passed |
| Browser journey, desktop | `npx playwright test e2e/sector-intraday-comparison.spec.ts --project=desktop --workers=1` | 10 passed |
| Browser journey, tablet + mobile | same, `--project=tablet --project=mobile` | 20 passed |
| Existing sector journeys (regression) | `npx playwright test e2e/sector-company-workflow.spec.ts e2e/sector-group-discovery.spec.ts e2e/rotation-relative-trend.spec.ts --project=desktop --workers=1` | 17 passed |
| Typecheck | `npx next typegen && npx tsc --noEmit` | clean |
| Build | `npm run build` | exit 0 |
| Plain-language guard | `node terminal/scripts/check_plain_language.mjs` | exit 0, zero findings in the new component |
| Lint | `npx eslint <every touched file>` | clean |

The browser journey covers the real mounted section at 1440×900, 820×1180 and 390×844 in EN and ZH:
observed new, retained settled close, correction, non-advancing clock, stale endpoint, missing
comparison capability, denied owner, unreadable envelope, keyboard disclosure and horizontal
overflow at each width.

**What this is not:** the e2e suite intercepts `/api/sector-intelligence` with synthetic owner
payloads, as every sector spec in this repository does. The authenticated BFF hop itself is proven
by the gateway unit suite (cookie filtering, session checks, fixed origin, redirect refusal,
content-type/size bounds, per-status mapping), not by a live paid-entitlement request. No
production market data was fetched and no live deployment was attempted.
