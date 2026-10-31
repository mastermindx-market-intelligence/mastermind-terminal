# Factor Atlas — Terminal product and UX integration census

**Status:** Principal source-grounded design evidence, NOT an imported Session 5 specialist deliverable, independent review, native admission, or release authorization. **MISSION_COMPLETE=false.**

**Source basis:** Terminal PR #928, source at `e3446da05eae17d32c5a54cb589258927c595717`, combining native factor implementation `f2e991f4e27f92505a7a9342bc593ffdb6d369a0` and Terminal protected master `e0c405a09b6897df3b5e4a2f22344f3560b800a4`; protected Mastermind Skillpack 1.0.1 pinned to `25c4b7923734392b1013afae179966985819d847`. Parent commission Macro #8679. Source path names below were inspected in this worktree. Earlier attempts to recover a separate Session 5 original through project, GitHub, Slack and advisory context did not establish an owner/return; a bounded read-only local Codex census timed out without a usable result. The original missing Session 5 receipt is not represented as completed.

## 1. Grounded existing product capabilities and owners

| Capability | Verified source seam | Present state and restriction |
|---|---|---|
| Terminal shell, app identity, responsive chrome | `terminal/app/(shell)/layout.tsx`, `terminal/components/chrome/AppShell.tsx`, `terminal/components/AppNav.tsx` | A common shell resolves account identity and feeds existing top-level nav; Factor Atlas must not introduce another nav, identity, entitlement or layout owner. |
| Discover and controlled sub-navigation | `terminal/components/workspaces/DiscoverWorkspace.tsx`, `terminal/components/chrome/WorkspaceTabs.tsx`, `terminal/components/mounts/DiscoverWorkspaceMount.tsx`, `terminal/app/(shell)/discover/page.tsx` | Discover currently includes screener, heatmap, sectors, leaders, radar and RS pivot. `?tab=` belongs to the page, with keyboard-controlled tabs. Atlas is **not** currently a released Discover tab. |
| Sector intelligence and theme/context | `terminal/components/sector-intelligence/SectorIntelligenceWorkspace.tsx`, `terminal/lib/sectorIntelligence.ts`, `terminal/app/api/sector-intelligence/route.ts` | Existing views include rotation, discovery, breadth and drilldown; source receipts, member rows and feed failures are already modeled. Not evidence of qualified native Factor Atlas membership or PIT history. |
| Research/issuer drill-through | `terminal/app/(shell)/analysis/page.tsx`, `terminal/components/fin/CompanyIntelligencePage.tsx`, `terminal/app/api/company-intelligence/[symbol]/route.ts` | Reuse for authorized constituent drill-through after canonical security-ID mapping. Do not construct an issuer identity from display text. |
| Options product | `terminal/app/(shell)/options/page.tsx`, `terminal/components/OptionsHubView.tsx` | Existing Options product and option-risk owners remain canonical. Synthetic factor IV, constituent aggregates and observed traded ETF surfaces are separate objects. |
| User portfolio | `terminal/app/(shell)/portfolio/page.tsx`, `terminal/components/PortfolioView.tsx`, `terminal/lib/portfolio.ts` | Positions are not watchlist symbols; Factor Atlas must not create another portfolio, saving, P&L or holdings plane. |
| Current candidate history preview | `terminal/lib/factorAtlasHistory.ts`, `terminal/components/factor-atlas/FactorHistoryPreview.tsx`, `terminal/components/factor-atlas/FactorHistoryPreview.module.css` | Native React display of S1's synthetic-only `factor_atlas_read.v1` result. Exact NAV, gaps, source clocks, return fractions and source ceilings preserved. Not a production route or live data. |
| Development shell proof | `terminal/app/(shell)/admin/factor-atlas-preview/page.tsx`, `terminal/components/factor-atlas/FactorHistoryShellPreview.tsx` | `NODE_ENV !== development` returns 404 before a fixture can be used. Existing admin gate and language provider. Local browser passes are not real authentication or customer publication. |
| Shareable window candidate | `terminal/lib/factorAtlasLocation.ts` and its tests | Pure allowlisted presentation URL state with exact `faFactor` (repeated), `faStart`, `faEnd`, max eight selections; preserve unrelated navigation parameters. Link contents do not grant data/source rights. This path is pending exact-head publication and review. |

No source-derived evidence here proves an installed customer Factor Atlas page, a native rights-admitted factor data gateway, qualified microtheme constituents, identified institutional flows, traded synthetic basket IV, live predictive performance, portfolio trade economics or full production/browser acceptance.

## 2. Product journey to build, without prematurely altering current navigation

**Entry — Discover (future, after explicit product acceptance).** Place an Atlas entry adjacent to existing Sector Intelligence in the *existing* Discover workspace, rather than adding a new primary rail tab or changing incumbent tabs now. Use the existing `WorkspaceTabs` URL model, keyboard behavior, visible selection state and accepted EN/ZH language owner. This is a proposed IA choice, **not** a current source write or adopted finished design. A search preview may remain off-nav until source/rights admission.

**Browse — factor universe.** Search by qualified house factor identity; filter by source-defined group/region/type. Show original qualified count, active/omitted members, cohort status, as-of/known-at, universe and source/rights mode. Distinguish house baskets, themes, ETF proxies, long-short styles and economic factors. A 68-structural-microtheme dictionary is not a 68-qualified-basket price universe. Empty and withheld categories remain visible as withheld, not zero performance.

**Inspect — factor detail.** Put name, type, original construction and coverage immediately above a source-NAV chart. Controls are exact exchange sessions and reference/end dates, not calendar-day approximate nearest-price substitutions. Show realized vs modeled, complete vs partial vs unavailable. Beneath chart, make source methodology and observation table accessible. Do not display a percentage if the held-weight NAV path is incomplete or price basis is unqualified.

**Compare — up to eight active series.** Keep unrelated catalog entries searchable, with bounded visible choices. Preserve exact start/end anchor, cohort knowledge mode, currency, return basis, gross/net cost conventions and correction vintage. If two curves disagree in method, show separate curves with no cross-series point spread. Any difference is an observed return difference, not a financed long-short strategy. The location URL preserves selection and exact dates but never the source permission state.

**Investigate — contextual cards (separately admitted).** Capital pressure must say proxy, not institutional purchases. Options panel must disclose observed ETF surface vs constituent aggregate vs modeled synthetic portfolio. Catalysts must disclose exact source document span, publication clock and causation UNPROVEN. Macro/regime/intelligence comes from existing owners. Drill to issuer dossier by selected qualified security ID, not by normalized text in a factor label. No future forecast/rank/sizing without accepted out-of-sample evaluation.

**Save/use — incumbent user plane only.** The existing watchlist, saved research and Portfolio objects remain the only user-state/positions owners. Before access acceptance, offer only local/shareable view state; do not persist inferred holdings or export licensed member rosters. Any eventual save/share/export must reuse existing authenticated account ID and rights restrictions.

## 3. Architecture / typed customer read contract

The customer composite read should be a *view* over incumbent source objects, not a new data publisher:

- `factor_ref`, `cohort_ref`, `security_refs`, `membership_knowledge_mode`, `construction_ref`, `source_schema`, `result_digest`, `revision_ref`.
- `clock`: event/observed/known/published and selected correction version; separate `price_vintage`, `as_of` and `measurement_cutoff`. Consumer fetch time is not a source-known time.
- `measurement`: NAV levels, return fractions, exact exchange sessions, segments, cumulative/rolling return, denominators including omitted names, explicit gaps and basis.
- `modules`: history (S1), inferred pressure (S2), options risk (S3), economic event evidence (S4), future model evidence (S6). Every module carries its *own* coverage, clock, rights/use, selection and accepted-source receipt. Null means unavailable, never zero.
- `admission`: trusted server-side identity/entitlement/source-use decision from existing owners. A client-supplied flag, fixture type, `READY`, hash or browser-only withholding cannot grant distribution.

**Security:** Reuse existing Terminal server session, private no-store headers and incumbent rate-limit/entitlement checks. The server must withhold unauthorized payloads **before serialization**. A read-only synthetic client guard remains only defense-in-depth. Do not build a parallel API authentication plane, source store, user save, graph or retry queue to bypass source refusals.

## 4. Vertical-slice sequence and acceptance

**P0 — implemented local dependency (PR #928, held):** native presentation, exact-date source-NAV chart, gap segmentation, bilingual responsive labels, synthetic customer withholding, limited multi-compare. Unit, browser and current-base build evidence exists; no production release.

**P0.1 — shareable view state (implemented and locally verified; still held for review):** URL selection/exact dates, browser Back/Forward and reload, bounded factors and malformed-link refusal. Preserve existing `?tab=` and other query fields. This never saves/authorizes factor datasets. Tests include unknown IDs and empty selection.

**P1 — first rights-qualified history consumer (blocked):** S1 owner selects a real house cohort with verified PIT/current roster, every member, price vintage/action basis, rights, original clocks, source release receipt and corrected historical coverage. Reuse an existing authenticated Terminal transport owner after that selection. The gateway must prove 401 anonymous, 403 unauthorized, 503 source unavailable (or accepted equivalent) with **zero protected bytes** in all refusals. Prove server authentication and member rights separately, not just a page screenshot.

**P2 — integrated factor detail and comparison (blocked until P1):** put S1's admitted source behind Factor Atlas inside existing Discover navigation through agreed IA change, restore users' source and date selection across route changes, and expose list/detail/table and issuer drill-through. Browser proof must include real customer auth, another customer's denied response, correction refresh and no cache leakage.

**P3 — independent context modules (lane-specific gates):** pressure only after S2 qualified minute/trade/quote basis, options only after S3 IV/covariance rights, catalysts only after S4 grounded document use. Independent modules may be withheld while admitted S1 history remains usable.

**P4 — validated scenario intelligence:** do not promote S6's unactivated tests until Evaluation OS accepts a preregistered source-bound, clock-safe, correctly inferred incremental result against strong controls and adverse/negative evidence. No trade sizing.

Acceptance requires: exchange-session equality, deterministic anchors, drifted holdings without reweighting, no gap fill, complete denominators, method-incompatible comparison refusal, source clock/correction propagation, absolute source rights, exact authenticated negative responses, EN/ZH and mobile a11y, keyboard tabs and factor selection, production build, real Next integration and independent code/security/science review as applicable. Test status for P0 is not acceptance of P1–P4.

## 5. Ranked blockers and required owners

| Gate | Owner; falsifying positive receipt |
|---|---|
| 1. Qualified historical membership/identity | S1 + Data OS: collection-known basket roster, stable canonical security IDs, original known-at per alias; effective dates alone do not suffice. |
| 2. Complete adjusted price and corporate-action basis | Existing daily/R2/corporate-action source owners: explicit TRADJ vintage, true reinvestment method, all members and eligible session bars, no stale default. |
| 3. Rights and purpose | Existing dataset/license and Macro publisher owners: exact allowed selected-file origin, redistribution/use verdict, private/public purpose; no inference from broad enterprise license. |
| 4. Authenticated consumer | Existing Terminal authenticated gateway and entitlement owner: no raw unauthorized bytes, no invented runtime entitlement or new store. |
| 5. Pressure feed | S2 incumbent owner: one-minute time/source-basis/clock/sale-condition receipts and identified-versus-proxy limits, source rights and coverage. |
| 6. Basket volatility/risk | S3 options data/MSC owner: sufficient original IV/covariance and tenor/rights, no false full-basket risk under incomplete names. |
| 7. Catalyst evidence | S4/Company Intelligence: exact source bytes/version/span, trusted source_use, duplicate/conflict rules and correction behavior. |
| 8. Scientific and publication acceptance | S6/Evaluation OS + separate release owner: frozen valid dependence/power/practical margin and independent review; preview/unit test success does not authorize ranking, sizing, trading or production. |

**Next decision:** Close the held Terminal PR #928's exact-head checks and independent reviewer return; preserve the original S1/S2/S3/S4/S6 writers. Advance the qualified S1 → existing Terminal gateway binding only after source-owner evidence genuinely clears. Until then, keep the read-only Factor Atlas preview explicitly synthetic, off-nav and Draft/HOLD.
