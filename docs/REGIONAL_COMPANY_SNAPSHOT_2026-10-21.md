# Regional Company Snapshot (CN / HK / Canada)

**Date:** 2026-10-21 · **Lane:** Terminal · **Scope:** listing-backed Intelligence for regional listings

## The problem this solves

`AnalysisWorkspace` loads `<SYM>.fund.json` and MegaPane receives it, but the Intelligence tab
sent neither fund nor legacy intel into `CompanyIntelligencePage` / `SharedShellCompanyIntelligence`.
Both of those require a **verified earnings event and CI identity**. Most regional listings have
neither, so the tab rendered empty while the very same page already held usable reported
financials.

The snapshot turns the listing artifact that is **already loaded** into supported reported facts.

## What it is not

This is not a replacement for document-based company intelligence, and the code says so in more
than one place:

- It creates **no** issuer id, CIK, earnings event, transcript or holder.
- `/data/<SYM>.fund.json` is an **internal public data object**, not immutable CI evidence. The
  surface labels the evidence affordance with exactly those words.
- The retained-event path is untouched. `SharedShellCompanyIntelligence` and
  `CompanyIntelligencePage` still own every identity, event and authorization question.

## Shape

| File | Role |
|---|---|
| `terminal/lib/regionalCompanySnapshot.ts` | Pure typed selector. No React, no fetch. |
| `terminal/components/fin/RegionalCompanySnapshot.tsx` | EN/ZH presentation of the selector's states. |
| `terminal/components/fin/RegionalIntelligenceWorkspace.tsx` | View arbitration between snapshot and the incumbent event view. |
| `terminal/app/regional-company-snapshot.css` | Existing tokens and `.ci-*` geometry only. |
| `terminal/components/fin/MegaPane.tsx` | Composition only — the event child JSX is byte-identical. |

## Reuse, not reinvention

Every number and label comes from `finStatementMath`: the `incomeView` normalization point,
`priorComparableIndex` / `comparablePeriodChanges` for genuine annual comparability, and the family
label helpers. There is no second statement engine and no second place a bank's top line can be
called "Revenue".

Scope is deliberately narrower than `markets.groupFromSymbol`: **`.TO .V .HK .SS .SZ .BJ`** only.
`.NE` and every foreign venue stay on the incumbent event view.

## What is deliberately NOT synthesized

| Not done | Why |
|---|---|
| Interim figures | Interim columns are **coverage only** — period and end shown, figures not. Differencing a cumulative YTD ladder or forcing an HK half-year to read as a quarter publishes a number nobody filed. |
| EPS subtraction across YTD windows | Not recoverable by subtraction; per-share denominators differ per filing. |
| YoY without a comparable prior | Null when the prior is missing, zero, non-finite, the fiscal identity is ambiguous, or the statement currency is unknown. |
| Freshness claims | The fund contract carries no source retrieval time. The surface says "Source retrieval time unavailable", and `asof` is labelled "Artifact generated". |
| Legacy intel | `<SYM>.intel.json` is absent for Canada. Reading it would make coverage depend on the weakest market's field and would pull conviction / entry / sizing / signals / smart-money / inferred-score rows in as company facts. First release is fund-only; the exclusions are pinned by tests. |

A missing figure renders as the house dash placeholder — **never a zero**.

## The historical boundary

The rules are asymmetric and fail toward the event view, because silently showing current data
under a pinned historical URL is the worst outcome this surface could produce:

- **ANY** presence of `ci_event` / `ci_generation` / `ci_company` / `ci_fingerprint` forces the
  event view — including a blank or malformed value. Presence is the signal; validity is the
  child's business and it renders its own refusal.
- Retained pins therefore beat a contradictory `ci_view=snapshot`.
- `ci_view=snapshot` is honoured **only** when no pin is present.
- With no pin and no explicit view, the snapshot is the default and the event child is **not
  mounted** — mounting it to discover whether a pin exists would let the retained reader write
  pins into the URL and flash snapshot → event on a plain page load.
- Leaving the event view clears exactly the four pin keys plus `ci_lens` and `ci_evidence`, and
  preserves every other query parameter.

US symbols never reach this logic: MegaPane routes them straight to the incumbent event view.

### Why the wrapper reads `window.location` rather than only `useSearchParams`

`useSearchParams` supplies **reactivity** (Next's router navigations change it), but the App
Router does not observe `history.pushState` — the shell writes Intelligence URL state that way
deliberately, and the repo records that such a write is "invisible to Next's router (searchParams
stays stale)". So the values come from the live URL via `useSyncExternalStore`, subscribed to
`mmx:shell-location` and `popstate`. Every decision is a pure function of the URL the reader sees.

## Integration note for the ownership lane

`MegaPane` does **not** yet pass `fund` / `fundLoading` to `OwnershipPage`. That page is owned by
the ownership lane, whose PR adds those props as optional; wiring it before then would be a type
error against the current `{ sym }`-only signature. Integration is exactly one line, marked in
`MegaPane.tsx`:

```
<OwnershipPage sym={sym} fund={fund} fundLoading={fundLoading} />
```

## Verification

- `lib/__tests__/regionalCompanySnapshot.test.ts` — 37 cases: CAD-quote/USD-statement, HK
  semiannual + non-December fiscal year, CN old period with no fabricated freshness, exact-symbol
  mismatch, genuine annual comparisons only, zero / negative / non-finite priors, bank top-line
  family, missing values, estimates gating, legacy-field exclusion.
- `lib/__tests__/regionalIntelligenceWorkspace.test.tsx` — 26 cases pinning the historical
  boundary, the URL clearing rules, ticker transitions and the US pass-through.
- Full suite: **932 files / 15,812 tests** green. `tsc --noEmit` and `eslint` clean.
- `next build` succeeds.
- Responsive + zh proven by a temporary Playwright harness at **1440×900, 820×1180 and 390×844**
  (12/12), asserting zero horizontal document overflow, the long-description wrap, the zh strings
  with no EN leakage, and that a retained pin keeps the event child with no snapshot beneath it.
  The harness stubbed the listing artifact via route interception and was removed before delivery;
  it wrote nothing to `public/data`.

The Terminal is dark-only by the repo's own rule (`app/settings.css`), so there is no light theme
to prove — this surface uses tokens only and inherits whatever the shell provides.

## Non-goals for this lane

No collectors, generators or nightlies; no `CompanyIntelligencePage` /
`SharedShellCompanyIntelligence` / retained-context contract changes; no Macro, sourcejobs or
credentials; no `fund.ts` type edits; no `OwnershipPage` edits.

## Parent integration amendments

The parent integrated the complete worker branch (8 changed paths), connected OwnershipPage to the loaded fund, and added exact schema/calendar qualification, annual date-gap comparison guards, partial/mismatched-period estimate handling, actual annual source receipt display, and a pinned-URL SSR boundary. Missing source clocks remain unknown. The latest-report header now includes the newer interim endpoint. Parent qualification supersedes the standalone ownership-prop/type assumptions above.
