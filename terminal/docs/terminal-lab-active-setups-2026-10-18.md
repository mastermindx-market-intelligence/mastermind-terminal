# Terminal Lab: active setups

## Outcome and scope

The company Lab should answer what is active for the selected symbol, which supplied historical comparisons deserve inspection, and where to investigate next. The previous view rendered nonzero values in source-map order as large cards, including raw scores and conditions with no historical comparison.

The primary view now ranks eligible active conditions by supplied 21-trading-day win-rate lift versus the direction-matched baseline. Users can filter above/below baseline or missing comparisons, choose direction, sort by latest trigger or observation count, search, and expand a condition for its source definition, trigger dates, historical rates and a price-chart link. All research retains inactive and context-only profiles. On phones, secondary search/sort controls collapse initially so the first result is visible.

This is a presentation change. It adds no forecasts, trading actions, synthetic confidence, source calculations, persisted preferences, chart markers, or alternate data owner. The existing Analysis route, symbol selection, fetch and entitlement gates remain the integration boundary.

## Immutable source observations

- Terminal pickup: `d6515f47232538161af8d3d4c27064165eda40fe`.
- Initial compatible Mastermind procedure pin: `377ecc4ab06bb71a46e2069c8353e47fed91d5b2`.
- Review procedure refresh: `d65414e89ad3b930d84d614196a91d3cce8ba589`, compatible `mastermind.sol_skillpack.v1` / 1.0.1 / bootstrap-major 1.
- Macro producer snapshot audited: `084ac334a2bf4beb76bd22b5bf7d37a8eb93e051` (a source snapshot, not a claim about today's moving branch tip).

Relevant producers: [Terminal intel forwarding](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/d6515f47232538161af8d3d4c27064165eda40fe/ingest/pull_macro_intel.py), [Macro Lab builder](https://github.com/mastermindx-market-intelligence/macro/blob/084ac334a2bf4beb76bd22b5bf7d37a8eb93e051/scripts/build_tech_lab_data.py), and [canonical signal catalog](https://github.com/mastermindx-market-intelligence/macro/blob/084ac334a2bf4beb76bd22b5bf7d37a8eb93e051/engine/tech_catalog.py).

### Data meaning preserved

- Legacy events mark any nonzero latest value as state 1. That alone does not establish a discrete firing condition. Display eligibility follows the producer's screener rule: events or directional states, honoring supplied exclusions, with the catalog's explicit context exclusions mirrored because legacy `tech_events` does not export `screener_firing`. `return_1d`, `valuation_pctile`, `insider_power_state`, and `rs_repair` / `rs_deteriorate` / `rs_new_high` / `rs_new_low` remain context.
- The exported ticker must match the selected symbol. Absent coverage and unbound/wrong-ticker responses do not become zero active counts.
- `generated_utc` is publication time. The producer computes, but does not export, the final market-bar date. The UI says **Latest published snapshot**, never “live now,” and explains this distinction in details.
- Event fires are positive event bars; state fires are rising-edge transitions. Dates are validated, sorted and deduplicated; dates after publication are excluded. No continuous-active-duration claim is made.
- The producer passes catalog direction into forward metrics, computes `wr_21d` from direction-signed wins, complements the short baseline, and supplies `edge_wr = wr_21d - base_wr`. Displayed wins, baseline and lift therefore use the same basis. The UI does not infer that falling volume by itself predicts falling prices.
- Historical observations are pooled across the surviving research universe and can overlap. They are not this ticker's calibrated probabilities or independent confirmations. Observation count and trigger date break equal-lift ties; no arbitrary minimum sample or confidence threshold is invented.
- Missing, nonfinite, out-of-range, contradictory or unreported-direction comparisons cannot rank. Genuine active conditions without usable history remain available under **No comparison**.

## Implementation

| Path | Responsibility |
| --- | --- |
| `components/fin/TechLabPanel.tsx` | Ranked workspace, filters, responsive disclosure, bilingual copy, detail and chart navigation |
| `components/fin/TechLabPanel.module.css` | Scoped token-based styling, compact rows, three responsive sizes, touch targets and focus treatment |
| `lib/techLabView.ts` | Typed display projection, source eligibility, identity/date/stat validation and deterministic sorting |
| `lib/__tests__/fixtures/techLab.ts` | Explicitly synthetic counterexamples; no production data is modified |
| `lib/__tests__/techLabView.test.ts` | 29 discriminating model tests |
| `e2e/tech-lab.spec.ts` | Real Next Analysis route workflow at all three contract viewports |

## Local verification

All of the following passed on the candidate files on 2026-10-18:

- `npm test -- lib/__tests__/techLabView.test.ts`: **29 passed**.
- `npx next typegen` and `npx tsc --noEmit --pretty false`.
- Scoped ESLint over the component, display model, fixtures and tests; `git diff --check`.
- `TERMINAL_E2E_PORT=3187 LAB_CAPTURE=1 npm run test:e2e:responsive -- e2e/tech-lab.spec.ts --workers=1`: **18 passed**, 42.6 seconds on the reviewed responsive candidate.

Browser checks cover ranking raw-win-rate counterexamples, deterministic ties, evidence/direction/sort filters, keyboard disclosure, dates and rate basis, chart-link destinations, missing comparisons, context research, search/reset, wrong-ticker coverage, zero horizontal overflow, mobile first-result visibility, and the distinct treatment of tiny positive/negative lifts and exact-zero comparisons. Fresh Playwright contexts exercise the real page with the repository's existing isolated E2E auth seam and deterministic data. The connected production browser's sign-in wall was not bypassed.

The first run exposed an inaccessible exact label on select controls; explicit accessible labels fixed it and the same workflow then passed. The visual review also found filters occupying too much phone space; collapsing them brought the first row into view, now asserted by the test.

### Visual evidence

All images below are **synthetic test fixtures rendered by the actual implementation**. Their fields match the production Lab shape, which exports `display_en` only. Chinese UI controls and interpretations are localized; curated names are translated locally, and other names retain the readable English source label. They are not market recommendations or live-production screenshots. The shipped app shell is dark. “Light specimen” is a test-only token override for contrast review; this change does not add a second theme preference.

| Viewport / language / theme | Ranked view | Expanded condition |
| --- | --- | --- |
| 1440×900 / EN / dark | [Ranked](pr-crops/terminal-lab-active-setups/desktop-en-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/desktop-en-dark-detail.png) |
| 1440×900 / EN / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/desktop-en-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/desktop-en-light-specimen-detail.png) |
| 1440×900 / ZH / dark | [Ranked](pr-crops/terminal-lab-active-setups/desktop-zh-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/desktop-zh-dark-detail.png) |
| 1440×900 / ZH / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/desktop-zh-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/desktop-zh-light-specimen-detail.png) |
| 820×1180 / EN / dark | [Ranked](pr-crops/terminal-lab-active-setups/tablet-en-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/tablet-en-dark-detail.png) |
| 820×1180 / EN / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/tablet-en-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/tablet-en-light-specimen-detail.png) |
| 820×1180 / ZH / dark | [Ranked](pr-crops/terminal-lab-active-setups/tablet-zh-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/tablet-zh-dark-detail.png) |
| 820×1180 / ZH / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/tablet-zh-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/tablet-zh-light-specimen-detail.png) |
| 390×844 / EN / dark | [Ranked](pr-crops/terminal-lab-active-setups/mobile-en-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/mobile-en-dark-detail.png) |
| 390×844 / EN / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/mobile-en-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/mobile-en-light-specimen-detail.png) |
| 390×844 / ZH / dark | [Ranked](pr-crops/terminal-lab-active-setups/mobile-zh-dark-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/mobile-zh-dark-detail.png) |
| 390×844 / ZH / light-specimen | [Ranked](pr-crops/terminal-lab-active-setups/mobile-zh-light-specimen-ranked.png) | [Detail](pr-crops/terminal-lab-active-setups/mobile-zh-light-specimen-detail.png) |

## Additional review resolved

The complete read-only review of initial candidate `529fb91c8acdf52027b46b03bb8926048374c100` returned REQUEST_CHANGES. Main-session source verification accepted its findings report (Fabric run `lab-code-review-529fb91-01`, response digest `ef73fd927f6331a5939e63550c6df89019a1fc47968db974b7fdd22901a494aa`) and made these bounded repairs before release:

- Mirrored all four explicit relative-strength exclusions in [the pinned catalog module](https://github.com/mastermindx-market-intelligence/macro/blob/084ac334a2bf4beb76bd22b5bf7d37a8eb93e051/engine/momentum_context_signals.py). Four regression cases prove an active event with a valid history cannot promote those IDs into the active ranking.
- Removed the unused `display_zh` dependency and the fixture-only translation field. Regenerated all 24 screenshots from the real field shape and inspected Chinese fallback names at desktop, tablet and phone sizes.
- Added independent rounding examples from full-precision win/baseline means: the producer's six-decimal exports remain comparable, while a materially inconsistent four-decimal counterexample is rejected. Added an explicit comparison-first sorting test.
- Displayed small nonzero lifts as `+<0.1 pp` / `-<0.1 pp`, with above/below labels and exact-sign filtering. Exact-zero values remain in With history; the methodology explains that the two directional filters are subsets. The workflow tests cover all three cases.
- Matched the mobile control's accessible-name prefix to its visible label, guarded inherited name-map keys and unmounted disclosure targets, removed the unused window field, and removed the old external footer link after independently confirming HTTP 404. Ranking guidance remains available inline and the price-chart links are verified.

These changes passed the 29 model tests, 18 responsive workflow tests, TypeScript, scoped ESLint and diff checks. Acceptance of the review report is not a claim that the external reviewer approved the repair commit; the main session owns verification of the resolved findings and the release verdict.

## Review and release boundary

Principal product review found no redesign blocker after confirming direction and rate-basis alignment. Exact candidate code review and hosted required checks are recorded with the pull request. GitHub CI owns the full repository regression and responsive suites; local scoped passing results above do not substitute for those required checks.

At this pre-merge evidence checkpoint, release and authenticated production interaction remain unproven. The connected production Chrome tab opens the expected Analysis route but shows the sign-up/sign-in wall. Final delivery must name the merged SHA, git-gated deployment receipt and live generation, and must preserve any remaining authenticated-browser proof gap. No production completion is claimed by this document.
