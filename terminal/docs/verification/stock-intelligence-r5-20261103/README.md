# R5 Stock Intelligence · First-glance design and browser qualification

**Owner:** Terminal issue #612, original operation `stock-intelligence-evidence-20261103-c3`, PR #1252. This revision extends R4 source-accuracy fixes without creating a new signal engine or route.

## Design artifact

Paper file `01M3NSZGE8JWN2EZCSF0DT05RM`, page `p-I-1`. Retained predecessor R4 artboard `1MX1-0`. New editable R5 boards: desktop command-deck **`1NT3-0`** (1600×980) and mobile decision overview **`1NXH-0`** (390×844). Both were read from the actual Paper file and screenshotted after editing. Their current-entry explanation, dated-source hierarchy and mobile fitting were visually inspected.

The R5 desktop **chart curve is a schematic design specimen**, visibly labeled in the artboard. It is *not* a live AMZN price chart, backtest or backend integration receipt. The **shipped Terminal chart remains the real, existing chart**, which the revised Intelligence drawer overlays without changing chart width or competing with the watchlist. No second charting library, calculation, source or control plane was introduced.

## What changed in the running code candidate

The Summary prioritizes one source-qualified current Oracle entry verdict; the user can tell in one glance when the current entry source is not available. Dated Oracle and Research observations follow as distinct navigable rows with source-specific metadata. Prophet retains its own early-evidence/permission state, and its absence does not imply a source-backed recommendation. Historical backtest statistics are a discrete linked sample, not current entry permission. Source-owner market risk and complete activity remain accessible. Oracle, Research, Activity and chart jumps retain all their established semantics.

R5 CSS preserves the existing Noir/Day theme tokens and adds visual hierarchy, evidence grouping, responsive typography, focal card contrast, finite metric cards, streamlined detail/filters and accessible touch/keyboard focus. No source clock, signal score, freshness rule or user permissions were changed by these R5 visual edits.

## Browser evidence

The screenshots below are produced by local Playwright against the real Terminal Next.js route and fixture responses (test symbol COST), **not** authenticated production. They must not be used as proof that new code is deployed or that every external data producer is available.

- `desktop-summary-en.png`: 440px dock, first-glance qualified entry, Oracle/Research/Prophet rows and historical sample.
- `desktop-summary-zh.png`: analogous Chinese/translation and source-unavailable state.
- `mobile-summary-en.png`, `mobile-summary-zh.png`: 390×844 bottom sheet; source qualification, scroll and copy fit.
- `tablet-summary-en.png`, `tablet-summary-zh.png`: 820×1180 bottom-sheet behavior.
- `desktop-oracle-en.png`: detail's strategy statistics, risk measures and history disclosure.
- `desktop-activity.png`, `tablet-activity.png`, `mobile-activity.png`: activity filters, chronological data and event pricing.
- `mobile-oracle-zh.png`: Chinese Oracle risk presentation.

Automated qualification during this R5 source wave:
- 179 focused source-verdict, Intel projection, Oracle entry and Activity unit tests passed.
- A TypeScript check passed after removing one corrupted ignored Next development-generated validator and regenerating route types with the project's normal `next typegen`. The quarantined file is in the operation's excluded cache, not committed source.
- The full Intelligence browser spec passed **14 cases with 4 expected skips** across desktop/tablet/mobile. It covers stable docking, preserved watchlist access, resize/keyboard/reduced motion, source qualification, English/Chinese, history curve gaps, Activity filters/pagination, focus and mobile dismissal.
- After the final historical-sample arrow correction, the EN/ZH desktop/mobile visual-state cases passed **4/4**. The previous isolated arrow wrap in the narrow desktop sample is fixed.
- The follow-up Activity journey passed **3/3** desktop/tablet/mobile cases after the final detail-styling changes, including filtered list pagination and capture generation.

## Release distinction

The earlier PR-head CI success `41604782073` applies to **R4 head `ed61ae2e...`** and cannot qualify this new R5 source revision without current-head checks. A genuinely independent non-author review on the new head, all mandatory PR/merge-group checks, git-gated merge/deployment and authenticated production evidence remain separate release gates. Do not bypass them or assert `PROVEN_LIVE` from Paper or local fixture captures. The previously failed Fabric reviewer invocation is governed by its original error/continuation owner; this visual wave did not retry it.

## Primary acceptance falsifier

With the drawer open, a user must see **current entry qualification** and understand that a **dated historical Starter** or Research posture is not a live instruction, without reading long source prose; tapping each evidence source must reach details without losing chart access, and identity/date/permission failures must never become an apparent actionable signal.
