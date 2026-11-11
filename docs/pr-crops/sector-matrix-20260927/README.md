# Sector Central R10 — exact selected-sector Industry × Market Cap Matrix

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

Predecessor: `48d296d84b99141b55dbf9d059abd3e34fcab27a`

## Capability

Discover now has two coordinated representations inside the existing `sectorWorkspace=discover` job:

- **Table** — the exact eleven-sector owner population and existing source metrics.
- **Matrix** — the selected sector's exact S&P 500 company population grouped by owner-supplied industry and deterministic market-cap bands.

The Matrix consumes the incumbent `heatmap` BFF only. It creates no collector, publisher, cache, BFF key, taxonomy, history store, save plane, alert plane or browser-computed market authority.

For the selected sector it provides:

- exact sector-label matching; no translated-name or neighboring-classification alias;
- Industry × Market Cap cells for `≥$200B`, `$50–200B`, `$10–50B`, and `<$10B`;
- durable `1D / 1W / MTD / 1M / 3M / 6M / YTD / 1Y` window state;
- advancing/observed counts, while zero remains zero and absent observations remain unavailable;
- a current answer derived from observed industry participation, never hard-coded industry names;
- one URL-bound selected cell and its complete exact company list with existing company links;
- explicit selected-sector depth and exact return to prior representation, cell, timeframe, group identity, scroll and focus;
- desktop matrix, tablet stacking and mobile summary-first inspector with the full 27-cell population available under a deliberate disclosure;
- EN/ZH UI copy, light/dark behavior, contextual Sources and access-loss clearing.

The localized sector display name is deliberately separate from the canonical source join. The Chinese UI can display `科技` while the Matrix still joins the owner-held exact `Technology` label. This prevents translated presentation from changing the source population.

## Exact owner boundary

Macro revision: `f94256971e49b6372645af3d329080d6e3747ea9`

| Owner file | Date | SHA-256 | Use |
|---|---|---|---|
| `site/sectordata/sector_central.json` | 2026-09-25 | `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1` | selected sector identity and outer workspace |
| `site/marketdata/sp500_heatmap.json` | 2026-09-25 | `beeadcf92f52b363ebed2ae458acf658702a8d0822e84ef3cc3531b278129961` | exact company, industry, market cap and performance observations |

The bound source contains exactly **79** rows labelled `Technology` and one separate row labelled `Information Technology`; the latter is not silently joined. The exact Technology cap-band population is **24 / 26 / 29 / 0** across the four bands.

This slice does **not** admit the separately rights-held Finviz/theme/bubble source plane. Bubbles, full-family themes, nested theme/subtheme heatmaps, overlap and historical trails remain separate owner-gated work.

## Verification

Final source checks:

- full Terminal unit suite: **399 files / 6,435 passed / 4 todo**;
- targeted Matrix + Discover + Rotation: **65/65 PASS**;
- related Sector surface: **164/164 PASS** before the final full-suite confirmation;
- Next route generation and TypeScript: **PASS**;
- scoped TypeScript/TSX ESLint: **PASS**;
- plain-language self-check and forward-only added-lines guard: **PASS**, zero new blockers;
- `git diff --check`: **PASS**.

Final exact-owner Matrix browser qualification: `exact-owner-r7`

- **81/81 PASS**;
- five captures, zero page exceptions;
- Chromium desktop/tablet/mobile and WebKit desktop/mobile;
- EN/ZH and light/dark;
- exact 79-name Technology population and 24/26/29/0 cap bands;
- separate `Information Technology` row excluded;
- derived market read, cell/member identity, durable timeframe, Table/Matrix parity, explicit depth return, focus return, Sources, access loss and no horizontal overflow.

Final Discover/Breadth regression: `journey-r10-regression-r2`

- **106/106 PASS**;
- ten captures, zero page exceptions;
- selection-in-place, explicit depth entry, full 14-company group journey, exact return state/focus, answer-first Discover and truthful breadth preserved.

These browser lanes use immutable exact-owner files through local interception. They are not authenticated production transport or served production proof.

## Failure chronology retained

The evidence is intentionally not rewritten as green-only:

1. `exact-owner-r1` reached a dev server without the required local Supabase fixture environment; no product verdict.
2. `r2` found a proof whitespace assumption after desktop/tablet had passed.
3. `r3/r4` exposed a real source-identity defect: Chinese display `科技` was being used as the exact heatmap join instead of canonical `Technology`.
4. `r5` passed the data journey, but visual inspection found the mobile 27-cell list too long before the selected insight.
5. `r6` passed after the mobile summary-first/collapsed-cell repair.
6. `r7` adds exact return-focus proof and is the final Matrix qualification.
7. The first R10 discovery regression exposed missing explicit-open focus restoration; `journey-r10-regression-r2` is the corrected final proof.

## Acceptance boundary

The Chairman explicitly waived an independent review requirement for this continuation. That removes the review as a process gate; it does not transform local proof into production acceptance. PR #754 remains draft, unmerged and undeployed. Normal exact-head CI, authenticated source delivery and non-Vercel production/browser proof remain required before release.
