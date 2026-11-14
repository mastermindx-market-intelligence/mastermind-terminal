# Analysis workspace redesign

Operation: analysis-redesign-20261113-c2
Owner: current Chairman-assigned ChatGPT2 attended session
Repository: mastermindx-market-intelligence/mastermind-terminal
Source baseline: d575152907b581d20257a09ddde3c312e6b4133a
Sol procedure: Mastermind@8323d7a774a72da20d0e4db21c9080398da185e7 (skillpack 1.0.1)
Design doctrine: macro@4a7c00b4b8ebcaa9b2ce42a49410118ba67bc16a
Source carrier: GitHub-native isolated branch sol/web-analysis-redesign-20261113-c2; cloud checkout is a test/staging copy.
Organization linkage: PLAN_NOT_ORG_LINKED; no exact incumbent Analysis-redesign workstream resolved in the bounded lookup.

## Outcome and completion ruler

Redesign Analysis in Beta Shared Shell and the shared Terminal fundamentals workspace into one coherent, flat, readable research experience. All seven families and their existing views remain in scope: Overview; Intelligence (Brief, Results, Call + Q&A, History, Topics, Sources); Financials (Statements, Statistics, Revenue, Dividends, Compare); Earnings (Results, Analyst, Transcripts); Market (Technicals, Seasonality); Ownership (Institutional, Insider); Lab.

DONE_WHEN: the implemented shared experience has clear company/section context, no duplicate primary chart actions, coherent parent/child navigation, useful research in the first viewport, flat neutral surfaces without colored edge decoration, legible typography and charts, compact truthful empty/partial/stale states, preserved deep links and source/data semantics, responsive keyboard/touch behavior, qualified CI, permitted protected release, and live browser evidence. A plan, mockup, PR, green test, or screenshot alone does not complete the parent outcome. Human comprehension remains unmeasured until an actual user test.

## Reading and interaction contract

- Shared Shell owns global navigation/search and its chart action.
- A compact company context and section navigator replace the existing Research Workspace masthead. Saved research and theses remain available in a secondary disclosure, outside the permanent primary header.
- Parent navigation never concatenates with the child tab list. The chosen family is explicit; its local views have their own unambiguous, compact location.
- Intelligence leads with the event period, main finding and evidence. One source-status control retains visible material limitations; generation/version/receipt mechanics live in Sources or accessible disclosure.
- Use existing Terminal tokens in globals.css/observatory.css and existing charts/data components. No new token root, parallel router, data store, signal math or backend authority.
- Neutral borders, flat panels, restrained radii, aligned numbers, sentence-case headings, meaningful chart space. Full focus outlines remain.
- Desktop 1440x900, tablet 820x1180, mobile 390x844; EN/ZH and supported light/dark. Preserve query state, symbol, event pin, transcript return and incomplete-data distinctions.
- Target useful Intelligence content within approximately 160px below outer shell; avoid large empty cards and repeated header/caveat layers.

## Phases

### P1 — Shared foundation and navigation (ready)
Inputs: AnalysisWorkspace.tsx, MegaPane.tsx, ResearchWorkspaceNav.tsx, fin.css, company-intelligence.css; supplied current-state screenshots.
Output: compact company context, coherent navigation, flat shared research primitives, no duplicated actions.
Proof: navigation/deep-link tests, keyboard and mobile control behavior, source-scoped responsive screenshots.

### P2 — Intelligence reconstruction (ready after P1)
Inputs: incumbent v1/v2/shared-shell intelligence components and source states.
Output: compact event/action toolbar, consolidated provenance, brief evidence hierarchy, useful transcript fallback, accurate history labels, searchable/filterable topics when available.
Proof: existing event/generation pin and access tests plus focused rendered journeys. Do not invent missing data, verified sources, claims, watchpoints or trade authority.

### P3 — Financials and Earnings (ready after shared foundation)
Output: unified controls and section hierarchy, readable statement/comparison tables, chart-first earnings/analyst views, compact missing-series states, usable transcript archive.
Proof: existing financial period/comparability tests plus representative responsive interactions.

### P4 — Market, Ownership and Lab (ready after shared foundation)
Output: flat summaries, no glowing gauges or edge stripes, compact metadata, consistent charts/tables and expandable depth.
Proof: preserve indicator calculations, coverage, sample windows and historical-versus-forecast distinctions.

### P5 — Release and real consumer proof
Output: self-reviewed exact source, relevant checks, Ready PR, actual required hosted checks, one permitted protected auto-merge/queue request, merged source deployment and live proof.
Respect all native protections, explicit holds, source writers and unresolved effects. No direct protected-branch merge.

## Initial evidence and constraints

- Open Terminal PR census on 2026-11-13 found no active Analysis navigation/Intelligence redesign PR. Adjacent held Investigation and transcript migration work is not being adopted or changed.
- Original Paper reference file found in committed Terminal receipts: 01M2WGNCX9475G79JRKJTCM08P. Studio catalog responds; exact-file read returned UPSTREAM_UNAVAILABLE. Same-carrier prepare returned PAPER_LOCAL_TIMEOUT; subsequent inspection returned DOCUMENT_UNAVAILABLE. No Paper design write has been dispatched. Keep that file-transition reconciliation on Studio; do not claim canvas changes or replay through another carrier.
- Fabric capability receipt reports adapter_available=false, manual_routing.available=false. Direct principal implementation is NO_ELIGIBLE_PRE_EFFECT_WORKER / PRINCIPAL_JUDGMENT; native child is limited to design reasoning, not substitute labor.
- User screenshots are private review inputs; do not commit their browser/network overlays.
- No production, account, authentication, data, or release configuration changes authorized by this plan itself.

## Current next action

P1–P4 source work is implemented. Qualify the exact delivery head in the existing native CI, review responsive artifacts, repair any proven regressions, then request the permitted protected release. Keep production and cold-reader acceptance open until actually verified.


## Implementation checkpoint — 2026-11-14

Source implementation is in progress; parent acceptance is NOT complete. This branch contains the unified company/family navigation, distinct in-flow local views, secondary research actions disclosure, compact Intelligence toolbar and source disclosure, populated-only brief composition, transcript-first fallback, searchable/sortable topic history, explicit history growth labels, flat research surfaces, statement-specific summary metrics, current-statistics availability repair, and flat analyst/technical readings.

Validation: initial TypeScript run hit the default 2 GB V8 heap limit. A 6 GB run identified two owned type errors (fixed in this checkpoint) and missing files from the sparse checkout; full qualification remains pending. Affected financial basis and unavailable-reading unit tests are running. Local Playwright reached route warmup after dependency recovery, but installed Chromium launch was denied by the environment's socket restriction. Do not retry that effect through alternate launch flags or carriers. The user-connected Chrome surface is blocked by an open extension UI; no alternate control attempt. Paper prepare timeout remains unreplayed, with no canvas mutations.

Next: complete local source qualification and substantive remaining layout refinements; publish a reviewable PR through the same GitHub-native branch carrier; use the existing native CI and responsive evidence workflow subject to actual holds. Browser proof and production acceptance remain owed. No production change has been made.


## Reviewable implementation — 2026-11-14

P1–P4 are implemented in source, pending browser and live acceptance. The source now also includes operating-performance-first Overview with three headline metrics and secondary profile context; compact share structure; institutional positions as a real scrollable table with clear holdings-versus-company-event dates; smaller Lab filter controls and rows; current ratios available independently of statement cadence; Results without repeated empty-state explanations; accessible mobile section dialog focus/Escape handling; and preserved meaningful labels on numeric brief takeaways.

Local verification:
- 149 focused tests passed across 13 suites: navigation/context continuity, section headings, financial snapshot alignment, earnings expectation boundary, technical missing/zero readings, brief evidence, topics and labels, institutional and reported-ownership boundaries.
- Existing thesis-entry capture helper: 65 tests passed, updated to exercise the real research-actions disclosure at every width while retaining identity and localization checks.
- Full Terminal TypeScript check completed with exit 0 using a 6 GB V8 heap after restoring exact original sparse-checkout dependencies. Default-heap failure was environmental; no compiler/test gate was removed.
- git diff --check passed.
- Browser contracts were updated to the new DOM while retaining route, data, accessibility, scope, and overflow assertions; added compact dialog/focus geometry and first-viewport brief checks. These Playwright changes are not yet claimed executed.

Self-review: SELF_REVIEWED. A separate reasoning-only source inspection surfaced six issues (fallback retry, stale labeling, mobile chart return, dialog Escape/focus, numeric takeaway meaning), all repaired in the same owned source. This is not a GitHub APPROVED review.

Acceptance remains open: Paper's intended file was unavailable after a no-replay timeout; no canvas edits. The original user Chrome action is blocked by extension UI. Local Chromium socket launch is prohibited by the execution environment. No further replay or alternate browser carrier was attempted. Existing GitHub CI is the independent repository verification path, not live-production proof.

Next proof/action: open one Ready PR from the existing source branch, obtain exact-head native required checks and responsive artifacts, inspect the designs and interactions, then use protected auto-merge if qualified and permitted. Do not claim deployment, production browser acceptance, award-level quality, or 10/10 before the corresponding evidence. Reassess the parent objective after each result.


## CI repair and visual refinement — 2026-11-14

Ready PR: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1494
Reviewed prior head: c4586881fb42669f4e4c43955eead06b7f25485d
Existing CI run: https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43557043797

The first CI pass produced real browser captures and identified integration contracts that needed updating. Statistics statement-currency/cadence provenance was the substantive omission; it is restored in a compact Statement source disclosure without substituting quote currency. Old gauge, placeholder-transcript, fixed-line-number, and CSS-geometry unit assertions have been replaced with checks of the current behavior. Retry counts, cache/race recovery, exact transcript identity, source availability, financial family exclusions and basis rules remain tested.

Current local qualification:
- 274 affected tests passed across 12 suites after repairing the first CI findings.
- Full Terminal TypeScript check passed.
- A further focused 40-test pass covers the final flat-card and truthful zero-activity Insider refinements.
- git diff --check passed.
- Browser contract changes are pending execution at the next exact head; no local Chromium replay was attempted.

Visual evidence inspected from the existing c458688 CI run:
- Serial artifact 14098843212: AAPL Brief, Results, Call/Q&A with transcript drawer, and company institutional/theme context screenshots. These are fixture-browser evidence, not production or user comprehension proof.
- F11 artifact 14098084126: mobile EN and tablet ZH navigation; the route fixture has no fundamentals, so these qualify surrounding chrome only.
- PL6 artifact 14098069231: reviewed its capture mapping; limited crops are not claimed as populated-page proof.
- These captures motivated two-column brief facts, accurate Commentary & context versus Company guidance labels, removal of a residual theme-card decorative orbit, and readable secondary theme labels.
- The artifact checkout records its PR merge ref; evidence must be rebound to the next head after the source refinements.

Additional presentation repair: Sources and Results now describe missing documents, estimates, guidance and event-price comparisons in user language. All IDs, coverage/access distinctions, source rights, exact event/generation pins and trade-authority limits remain explicit. The final semantic review also distinguishes missing structured guidance from guidance discussed in highlights, avoids attributing all remarks to management, and never invites transcript reading when no transcript is linked. Empty Q&A leads to the real transcript. Growth-rate differences are labeled percentage points. Insider 0-buy/0-sell fallback no longer asserts selling.

CI at the reviewed prior head: production build, typecheck, F11 and the three visual-evidence capture lanes, Quote Hub, PostgreSQL invariants, and serial-standalone succeeded. Three unit shards and serial browser failed on the now-repaired contracts; other native browser and Ingest jobs were still running when this checkpoint was written. No workflow gate was disabled, manual rerun dispatched, or protected release requested.

Next action: publish this repair/refinement to the same branch using expected-head CAS, read back the plan and commit, then obtain the existing native CI results and inspect current responsive captures. Repair any proven remaining failures. Qualify the Ready PR under actual protections before one permitted protected release request. Paper and live Chrome constraints remain as recorded above; no production acceptance claim. Parent DONE_WHEN remains open.


## Paper R3 alignment and statement exploration — 2026-11-14

Paper access is now partially recovered through read-only discovery, not by replaying the earlier uncertain prepare. The accepted build atlas at baseline d575152907b581d20257a09ddde3c312e6b4133a identifies a newer Terminal file: 01M3NSZGE8JWN2EZCSF0DT05RM. The incumbent Studio Paper adapter successfully read that file and its R3 page p-S-0; document snapshot d5fc3c6545f056a920c3a0422e9fd426baa82c0d5462cb8118d42e9057e72598. Actual screenshots inspected: Intelligence Brief 1BEK-0, Financials 1BKQ-0, Earnings 1BQC-0, Ownership 1C1K-0, plus R2 CH-0. No prepare/open or canvas mutation was attempted; the earlier old-file timeout remains unreplayed. The active Paper page was not changed.

R3 supplied a stronger composition: open narrative, prominent inline figures, context beside the analysis, and a selectable statement line with its history. The implementation now follows that composition using the application's real source-backed fields. It does not copy illustrative Paper numbers or invent watch subscriptions, forecasts, or unlicensed comparisons.

- Brief: open reading canvas; headline, all four available fact actions and distinct takeaways in a logical reading order; only populated guidance/commentary in the context column. Context collapses below the narrative on narrower screens. Original IDs, source callbacks, Chinese labels, source/footer regions and missing-data semantics remain intact.
- Financials: select a snapshot row to show its reported history and latest value beside the table. Rows use the canonical normalized income block or original balance/cash-flow arrays, retain exact period positions, missing values, signed cash flows and per-share EPS units. Incompatible statement/company selections fall back to that statement's first row. The full-statement link goes to the existing table, not another data owner.
- Financials secondary change labels increased from 8 px to 12 px and wrap rather than colliding. Table metric buttons support keyboard activation and visible focus.

Call navigation repair: the old layout displayed the complete verified count but capped navigable questions at eight. A call-scoped Show all questions control now exposes every available exchange; missing segment positions remain disabled, and original event/transcript/segment identity passes unchanged. Two EN/ZH interaction tests open the ninth exchange and verify identity/reset behavior. Results browser checks explicitly open Coverage limits and assert the source restrictions are visible before closing the disclosure.

Local verification: 111 tests pass across four affected suites, including the source-linked commentary checks, brief source actions, financial-period math, exact transcript identity, and new selected-metric identity/null/currency/sign tests. A further 70 tests pass across call layout/call-site, source-design and plain-label suites. Full Terminal TypeScript check passed. Browser assertions now check current heading and source labels while retaining evidence rights, event/generation pins, missing-consensus boundaries and route behavior. Financials EN and ZH selected-metric captures run in the existing desktop/tablet/mobile matrix. No test gate or production policy was disabled.

Current published head before this refinement: 847ddda2a2d4d2640360ce32e3ad76230b2aa4c4. Existing CI run 43558329579 passed production build, typecheck, Quote Hub, PostgreSQL invariants, two unit shards, F11 and visual capture lanes. One unit shard exposed four obsolete watchpoint-label/placement expectations; serial browser exposed obsolete guidance and beat/miss wording expectations. Those assertions are corrected without dropping their source-safety checks. Other native lanes are not yet claimed complete.

Parent acceptance remains open. Next: publish this coherent refinement through the existing branch with expected-head CAS; inspect its binding native CI and populated responsive screenshots; repair proven defects; qualify one protected release request; consume the incumbent master deployment receipt; verify the live shared-shell and standalone research path. The original Chrome panel block still prevents live browser acceptance. No alternate browser/carrier or release effect has been attempted, and no 10/10 or production completion is claimed.


## Populated Beta research qualification — 2026-11-14

The R3 product head 8907e01a3c0597199516084c4df5f8b7127bc187 now passes production build, TypeScript, all three unit shards, Quote Hub, PostgreSQL invariants, F11 and the three visual capture lanes in native CI run 43559589996. Its company-Intelligence responsive step also passed and the serial job proceeded to subsequent existing qualifiers. This does not yet establish a complete run, protected release, or production acceptance.

A concrete coverage gap was found: the ordinary research tests exercise standalone Terminal; the existing Shared Shell opt-in step did not exercise populated Analysis. The market Intelligence native qualifier covers Intelligence/Prophet/Sectors, not company Analysis. This update extends the existing shared-shell-refinement.spec.ts and its already-authorized CI step. No runner, workflow, auth owner, production flag, route or test gate was added or weakened.

Twenty-four additional responsive cases (eight per desktop/tablet/mobile project, split EN/ZH) qualify:
- Populated Overview, Financials, Earnings, Market, Ownership and Lab inside the actual surrounding Beta shell, using unchanged incumbent fixtures extracted into shared helper modules. No test data is served in production.
- One company/navigation bar, compact chrome, an in-bounds research scrollport occupying more than 65% of the viewport, document overflow, first-frame useful values and restored focus from the compact family menu.
- Selected statement metrics, balance/cash-flow summaries and statement-backed earnings; localized holding values; Lab's real ranking/filter interaction.
- The unpinned retained-owner availability failure into the separately published NVDA research path, matching the screenshot's actual state. Source limits are explicitly opened and inspected; Consensus remains unavailable without licensed estimates.
- The retained AAPL event through the actual /api/investigations/baseline reader, with a complete synthetic receipt around the existing golden workspace. Exact event/generation/company/fingerprint pins, context-only authority and guidance/source interaction remain intact. The real validator accepts this specimen in the existing HTTP/loader unit suite.
- A single chart destination per current shell, full research return context in desktop and mobile menu links, and one real desktop Analysis -> Terminal -> retained Analysis route journey.

Local qualification: full TypeScript check passed; 20 real baseline HTTP/reader tests passed including the added specimen validation; Playwright's test discovery accepted the affected specs without launching a local browser; git diff --check passed. Fixture extraction was read back against the previously published source and confirmed unchanged. These new browser cases are pending the next head's existing CI execution; neither test discovery nor fixture validation is browser proof.

Release guard remains: do not release before required exact-head checks and responsive evidence are qualified. The browser extension panel still blocks the original live Chrome surface. No alternate live browser, denied carrier replay, Paper mutation, merge/auto-merge or deployment has occurred. Parent acceptance remains open.

Next: read back this source/plan and the Ready PR; inspect binding CI results and retained screenshots, repair any demonstrated presentation/interaction defects, then make the single protected release request if eligible and consume the incumbent deployment receipts. Live Beta/Terminal acceptance remains required after deployment.

Publication reconciliation: the initial all-content tree request returned GitHub 422 input-size/processing timeout. Readback confirmed the branch remained at 8907e01a3c0597199516084c4df5f8b7127bc187. The same native GitHub carrier publishes immutable blobs separately, then assembles their hashes into one tree before the expected-head branch update. No commit/ref or alternate carrier was used for the failed request.


## Theme empty-state evidence renewal frontier — 2026-11-14

Native run 43559589996 exposed one remaining evidence lock failure after 253 evidence assertions passed: b_mi_g10_b4tThemeEmptyEvidence.test.ts correctly found that the committed Theme empty-state PNG packet still binds the earlier company-intelligence.css bytes. The existing capture controller does not register this specific B4 packet, and populated Theme screenshots do not prove its 404 empty state. Neither its source hash nor its lock was changed without a recapture.

The existing company-intelligence.spec.ts now captures the exact Theme 404/not_found card in the ordinary standalone browser projects at desktop 1440x900 and mobile 390x844, EN/ZH, both dark and requested-light. The existing serial CI job and test-results artifact carry the output; no runner, controller, workflow or release policy was added. Each case waits for fonts and visible geometry, observes the localized empty message, uses the incumbent 24px padded viewport clip, and writes actual PNGs before comparing dark/light hashes. It records checkout commit/tree, CI run/attempt, source and control hashes, requested/observed theme/language, actual card text, bounds, clip, PNG hash and byte length. The source hashes are checked again after capture. A differing light specimen fails honestly while preserving the captured bytes.

TypeScript and Playwright discovery pass for this capture addition. Browser execution remains pending. Next: consume its existing serial artifact, verify the PNG bytes and source/checkout binding, visually inspect the four supported dark cells and comparison receipts, preserve the historical packet, then commit the authentic replacement PNGs/capture-log/EVIDENCE provenance. The unchanged B4 test must pass against those real committed bytes. The current gate may remain red until that evidence renewal; this does not authorize a release, stale-hash update or alternate browser.

Assigned reasoning review confirmed this bounded existing-lane route. Two child-agent lazy Git fetches of absent historical JSON packets were refused by automatic approval review and stopped. Those effects were not retried or rerouted; the old JSON is unnecessary for producing new authentic captures. No user intervention is required for this independent repair.


## Responsive capture review and Statistics refinement — 2026-11-14

R3 serial artifact 14099814735 from run 43559589996 was downloaded and SHA-256 verified as dc0669fde52ca5f8269bbbba29926b323e8c454d790fe4eb652ea097a372b9a4. Actual AAPL Brief desktop/tablet/mobile, Results and mobile Institutional images were inspected; a reasoning-only visual review also checked Sources and transcript drawers. The product was unchanged from 8907e01 through 7055fc7; these are fixture-browser observations, not live acceptance.

The captures exposed four concrete residual layout defects. The component-scoped refinement lets context cards keep their natural height on tablet; a single or final odd mobile fact fills its row; long expectation-evidence labels and qualifications receive proportional wrapping columns; and mobile Institutional removes a repeated kicker, puts company-event metadata on one wrapping line and compacts noninteractive filing dates. The roster limitation and filing-lag explanation remain readable at 12px. The first manager identity now has an explicit initial-viewport assertion in the existing Beta journey. These changes preserve the locked Theme stylesheet bytes.

Statistics still used three wide stacked tables. Its source composition now orders valuation, profitability and company statistics, uses available width for current-only groups, keeps genuine historical valuation full-width, and retains the actual statement-source disclosure and per-group dates. Existing 320px current-value geometry, historical scrollport and no-extra-fetch assertions remain. The obsolete current-tables test's Quarterly/Annual interaction is replaced with the existing no-cadence contract; no data assertion or width protection is removed.

A related real data-visibility defect was corrected: eligible P/CF or EV/EBITDA history must not disappear when P/E/P/S/P/B are absent. Table history and drawable chart history now have distinct tests against published periods. P/B-only history does not reserve an empty P/E/P/S chart. Shorter arrays use the common source-period window, preventing independent tail slicing from shifting years. Six rendering tests cover those cases, financial-family exclusions and missing-period refusal. Together with the incumbent financial-period suite, 85 tests pass. The three affected Brief/Results/source-design suites also passed 42 tests. TypeScript and Playwright discovery passed; browser proof for this refinement remains owed.

Six additional existing Shared Shell cases (EN/ZH across desktop/tablet/mobile) exercise Statistics with current-only and published historical inputs. They preserve current P/E, actual period columns, first-frame values, source disclosure and no duplicate fund read. This raises the populated Beta addition to thirty cases without creating a workflow, runner or parallel data owner.

Current source parent before this refinement is 7055fc735eea2c5eac035b2fee62974c3dc27a9e. Its company-Intelligence browser step, including the exact Theme empty-state specimens, passed. Required evidence fan-in still correctly reports the old B4 source lock; actual packet bytes are pending the incumbent serial artifact. Keep this active proof lane alive until its output can be consumed, then publish the verified packet and these coherent refinements via the same expected-head GitHub carrier.

Current master advanced only by c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40 (#1489, sector-rotation keyboard focus and associated tests). Its paths do not overlap this work. The incumbent merge controller at that master explicitly supports a green behind-head entering the native queue; do not manufacture a branch update or parallel merge controller. The existing queue will own base revalidation. No merge-on-green label, native queue admission, deployment, alternate live browser or Paper write has occurred.

Next proof: consume the current serial artifact; validate and inspect the actual empty-state PNGs; renew the B4 packet with accurate source/run provenance; publish the owned refinement and read it back; qualify the next exact head in native CI and responsive captures; issue one protected native release request only if eligible; consume the existing master deployment receipt; then obtain live Beta/Terminal browser acceptance. The original Chrome extension-panel block persists and must not be routed around. Parent DONE_WHEN remains open.


Additional exact-head CI diagnosis: mobile shard 132345252988 passed 181 cases and exposed two obsolete Earnings coverage-label assertions. The existing tests now open the actual Coverage & reporting basis disclosure (EN/ZH) and inspect its visible definition list. The removed repeated beat/miss disclaimer is replaced by a behavioral check that statement-backed revenue with no estimate has neither an Estimate row nor a Surprise row. Matched EPS, actual revenue values, missing estimates, currency and overflow assertions remain. This corrects the test for the intended compact UI without weakening its financial boundary.

Capture-maintenance self-check: the opt-in Compare crops now assert their target against the actual .fin-pane > .fin-body scrollport and viewport, replacing a conditional check of the deleted bottom-tab selector. Overview's existing measured scrollport/region/occlusion checks remain; only the unreachable bottom-tab branch was removed. The current tablet shard also confirms the same obsolete Earnings label failure (227 passed, 129 skipped, one failed); it introduces no additional product regression. Earnings discovery passed 24 cases, and the three capture/navigation/Earnings files discover successfully. These assertions preserve their original financial and visibility acceptance.

The actual 7055 mobile financial-disclosure capture exposed NVDA truncation in the 320px standalone navigation. A narrowly scoped <=360px rule reserves 98px for company context, reduces bar padding/gaps, and lets the family selector use the remaining width. Chart/actions retain their 44px touch targets. The existing compact navigation journey now checks the full ticker and document bounds at 390px and 320px before exercising the native dialog, Escape/focus return and local arrow-key navigation. This does not change the 390px/1440px Theme capture layouts or either locked Theme source.

## Populated Beta findings and correction packet — 2026-11-14

The 7055 incumbent serial job completed its Company Intelligence step (55 passed / 35 skipped), News qualifier (14 passed / 7 skipped), and investor-shell qualifier (16 passed / 8 skipped). The new Shared Shell qualifier returned 38 passed / 13 skipped / 18 failed. Its failures are three distinct issues repeated across EN/ZH and desktop/tablet/mobile: annual statement actuals omitted by Earnings, compact-currency trailing-zero differences in the new expected value, and a one-request assumption incompatible with the existing dev StrictMode effect replay. It is not a production acceptance result. The ordinary shards additionally exposed obsolete Earnings/Statistics/Chart labels, an obsolete transcript-strip locator in the screener-to-statement consumer, and a real mobile Market seasonality placement issue. All owned causes are addressed below; final exact-head browser proof remains owed. An unrelated shell-mode OHLC check passed on the incumbent retry and is recorded as flaky, not altered.

- Earnings now uses the incumbent incomeView and statement-to-point builders for annual Revenue and basic EPS when that metric has no reported annual earnings actual. Available earnings actuals keep precedence. Estimate-only rows do not conceal actual statements and are not joined to statement actuals by label; missing estimate/surprise/report dates stay missing. Currency and period labels remain source-owned. The cumulative-period explanation follows the selected view. The populated Beta acceptance remains 130.00B Revenue and 2.95 basic EPS at FY2025. Six rendered financial cases plus an actual annual/interim switch cover precedence, mixed metric availability, estimate-only handling and note correctness.
- The retained reader is unchanged. A focused StrictMode unit case proves the first transport is aborted, its late receipt cannot render or pin, the surviving read exports all four identity fields, and a same-pin Sources lens update does not cause a third read. The Beta browser assertion allows only one or two initial attempts, requires every query to be exactly ?symbol=AAPL, and preserves the accepted count through Sources/Brief/evidence interactions.
- Institutional compact currency expectations now explicitly use zero minimum fraction digits, matching the incumbent formatter across Node/browser locales. Source values and formatting logic are unchanged.
- The mobile Market card now presents the existing bottom-pivot disclosure as a flat compact row, and its two rating readings use less padding. The seasonality-first geometry assertion is retained; no indicator math or data request changes.
- A second actual mobile defect was the Intelligence event selector showing only Q1 F. A scoped header module reserves 196px for the period selector and lets the actions wrap; retained-event secondary actions follow the principal actions. Both real Beta variants assert readable selector width. The full selected event/receipt remains unchanged.
- The screener consumer now proves the actual FY2025 statement column and its hand-checkable 1.20K Revenue / 180.00 net income, rather than expecting a transcript icon for a fixture with no transcript. The MarketOntology consumer uses the new Chart action label and retains its context-loss/return assertions.

Qualification after correction: 55 tests passed across annual Earnings, incumbent HK cadence/normalization and retained-reader suites; 56 passed across Brief/watchpoint/source/boundary/call-site suites; earlier 85 Statistics/financial-period and 42 affected-layout checks remain valid. Full TypeScript passed. Playwright discovery passed 216 cases across the six affected core E2E files; the MarketOntology label update is also included in the correction. No local browser was retried after its capability failure.

### Actual Theme packet renewal — verified locally; publication held

Consumed responsive-qa-43561176210-serial artifact 14100422884, ZIP SHA-256 380001b9a5331b7ad1cd598cbc52f05da29a6a072e411bb94a4919be199e50ca. Four original case receipts identify checkout c6a9b3d41b89396b15e234c386edd67074dc7299, tree a56adefab0a0c60461bfab6c784bdc4b8e666c9b. Native GitHub readback confirms its parents are master c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40 and PR source 7055fc735eea2c5eac035b2fee62974c3dc27a9e. Every controlling source hash, PNG SHA/byte length, run identity and actual dark/light comparison was verified. All four supported dark specimens were visually inspected. Four actual byte-identical light comparisons and four unmodified raw case receipts were prepared locally under terminal/docs/verification/analysis-redesign-20261114/theme-empty; unsupported light remains a documented gap. They are not included in this source publication.

The locally prepared B4 packet contains the four actual dark PNGs, aggregate capture-log and updated EVIDENCE.yml; the unchanged b_mi_g10_b4tThemeEmptyEvidence.test.ts passes all six checks against that local packet. The branch keeps its prior packet unchanged because screenshot publication was rejected by automatic approval review; therefore the native source-lock gate remains correctly blocked. The packet locks only its declared Theme sources and does not claim production acceptance or certify later whole-workspace refinements.

Next: publish the coherent source correction and plan by expected-head CAS on 7055, read back the owned files/plan, then consume the next exact-head CI and populated browser results. The evidence packet is excluded pending explicit screenshot publication authorization. Protected release and incumbent deploy still follow their original gates. Live acceptance still needs the original Browser extension-panel presence condition resolved; no alternate browser or authentication route is authorized by this checkpoint. Parent DONE_WHEN remains open.


### Final financial edge checks and screenshot-publication boundary

A focused reasoning review identified two annual fallback edges before branch publication. Revenue coverage now retains the selected-basis raw estimate-presence flag when statement actuals are displayed, so available but unmatched estimates read “Not matched to reported basis” rather than “Not published.” The final twelve-period statement window must contain at least one actual before it wins fallback; an old actual outside that window cannot suppress valid annual estimates. Interior nulls and exact period positions remain intact. Empty EPS wording is scoped to the displayed view, without claiming that the issuer has never published EPS or that unmatched historical estimates are forward estimates. Both cases have rendered regression assertions; the annual fallback and incumbent HK cadence suites pass 31 tests after these changes.

The sequential immutable blob upload completed 30 blobs, then automatic approval review rejected the 1440x900 English dark Theme PNG. The stated reason was potentially sensitive UI/organizational content and insufficient explicit authorization for that opaque payload's publication to this GitHub destination. No ref, tree or commit mutation had occurred. The denied image was not retried, re-encoded, sent through another carrier, or included indirectly. All image blobs, receipt JSON and renewed B4 manifest/log are excluded from this source commit; four earlier unreferenced image blobs remain unlinked objects. The branch's original evidence packet and unchanged lock test are preserved. This is an exact publication gate, not a missing design/test implementation.

Reviewable payload for any later explicit approval: the four generated dark Theme empty-state fixture crops (desktop/mobile, English/Chinese) from existing native CI artifact 14100422884, at docs/pr-crops/b-mi-g10-b4t-theme-empty in this same repository. The original artifact already contains all dark/light comparisons and raw receipts; no production session imagery or secrets are needed. Approval for the four dark files is sufficient; light comparisons can remain in the original CI artifact with their observed hashes. Until then, keep the required B4 source lock blocked and do not release. Continue all unaffected source, browser and production-build qualification.


### Source publication readback and final visual refinement

Published source correction b776ed29545ada72d51df1cdbb00452f972e249a (tree 73d009dcfe07bd89663bca77a4cadd378ac210c5), parent 7055. All 23 changed source paths and blob SHAs were read back exactly. The screenshot packet and this expanded plan were excluded from the commit. Automatic approval review separately rejected publication of the large internal plan, citing operational procedures and process metadata without specific egress authorization. The rejected plan was not replayed or copied to another external destination. A concise product-facing PR description, excluding those internal procedures, was accepted and read back.

A further visual review of the existing 7055 transcript capture found mobile source actions stacked above the quoted passage. Source head 8015a1cdedb8d37711b77cc1a7136fc9eb01a0c0 (tree c56f279476207c55e9a4eb25c9eac847dc589e96), parent b776, fixes that bounded defect with a component module: identity/speaker/passage precede a wrapping action row on mobile; desktop keeps its compact action placement. Exact transcript/segment/hash/query, verified attachment eligibility, receipt trigger and focus return are preserved. Existing responsive acceptance now checks passage-before-actions geometry and 44px targets. The Beta Market capture also waits for the fixture observation count and actual numeric RSI, eliminating a premature empty-state screenshot. All four changed files/blob SHAs were read back exactly.

After the transcript change, TypeScript, 19 existing source/search identity tests, 156-case Playwright discovery and whitespace checks passed. b776 CI run 43564622212 has passed production build, all three unit shards, TypeScript, Quote Hub, PostgreSQL invariants, F11, PL6, the VI capture jobs and the Company Intelligence responsive step; its remaining browser work was running at last observation. Latest exact-head CI 43565211881 is pending; CodeQL run 43565088021 is running. Do not equate either with completed acceptance. No merge/auto-merge, deploy or live proof has occurred.

Current canonical source is PR1494 head8015. The concise PR description has exact readback. This full plan update is NOT_CANONICALLY_PERSISTED; the last canonical PLAN.md remains at7055. This local file is a concrete review copy for the Chairman. The four actual dark Theme fixture crops are also prepared locally, with original CI artifact14100422884 and verified hashes above. They have not been committed. Explicit approval is required before publishing the blocked screenshot packet and expanded plan to the same Terminal repository. The original connected Chrome still needs its extension panel closed for live verification; no alternate browser/carrier has been used.

Final state: EXACT_HUMAN_GATE for evidence/plan publication and the live-browser presence condition. Parent DONE_WHEN remains open. On approval, reconcile original effects before any replay, publish only the approved artifacts through the original GitHub carrier, inspect exact-head CI and responsive artifacts, repair concrete failures, then follow the protected release and existing deployment flow and verify live Beta/Terminal. Do not redo accepted source changes or create a parallel workflow, controller, reviewer or runner.



## Approved resumption — 2026-11-14

The Chairman explicitly approved the four dark Theme QA images, verification metadata and reviewed plan update, then directed implementation to resume. The original source branch was reconciled at8015a1c; no held image or plan had been committed. The two previously uploaded Chinese image blobs are immutable and match the approved local bytes; the English image blobs were absent. Publication continues through the original GitHub carrier. Light comparison images stay in the original CI artifact; only the four approved dark PNGs and their receipts/manifest are included. The source-lock test is unchanged.

Exact-head CI43565211881 finished. Every regular desktop/tablet/mobile shard, all four production-build browser shards, production build, three unit shards, typecheck, Quote Hub, ingest and PostgreSQL checks passed. Company Intelligence passed55 cases, News14 and investor shell16. The Beta suite passed55 with13 authored skips and7 failures, which reduce to two test-isolation/readiness defects. The evidence fan-in failed only the unchanged old Theme stylesheet lock.

Statistics current/history inputs now run as separate tests with Playwright’s default fresh contexts. The application correctly preserves fresh company data in IndexedDB across reloads; mutating the same fixture URL within one context incorrectly reused the current-only record. All actual values, historical columns, chart bars, source disclosure and no-extra-read checks remain. Chart return now identifies the visible desktop/mobile chrome owner and awaits its actual control; a dynamic desktop toolbar had briefly been absent, sending one Chinese desktop case into the hidden mobile branch. Exact symbol and all retained return-context fields remain asserted. This expands the populated Beta coverage to36 cases.

Current visual review confirms populated desktop Market, mobile seasonality in the initial viewport, mobile first-manager visibility, and all three Lab rows. A count-aware English correction removes “1 buyers / 1 trimmers” and “1 tracked managers.” No new data calculations or source owners are introduced. Latest full responsive proof, protected release, existing deployment and live Beta/Terminal acceptance remain owed. The prior screenshot/plan publication permission gate is cleared by the Chairman; the original Chrome presence condition still requires a fresh observation.

## Approved evidence published; secondary-view acceptance — 2026-11-14

The approved four dark Theme captures, their actual provenance and raw receipts, this plan, the two Beta test-isolation/readiness corrections and singular ownership copy are published at 007c24fa0276624532a16236d397b4e43eb987c3 (tree 52714c8ae540555c26a5997e12cbe89a9b3d154d). All 13 file identities and the PR/branch head were read back. PR #1494 remains Ready. Its native CI run 43576354275 has passed the production build, TypeScript, all three unit shards, F11, the visual capture lanes and the unit/evidence fan-in, including the renewed B4 packet. Remaining browser/ingest jobs were still running at the last observation; no full-run success is claimed.

Read-only review of the actual 8015 captures found no blocking overlap, but narrow fallback-event and narrative-comparison selectors clipped their dates. A bounded CSS refinement widens the header selector and stacks comparison selectors with inline labels on phones (stacked labels below 360px). Their full fiscal/calendar labels, event IDs, transcript bindings and handlers are unchanged. The existing browser journeys now measure the complete selected text in the actual loaded font, rather than accepting an arbitrary minimum width. Comparison controls retain 44px touch targets. The locked Theme source files remain unchanged.

The acceptance audit also distinguished established standalone tests from Beta composition. Revenue cadence, full dividend paging, peer comparability, Seasonality controls and transcript comparison already have substantive responsive suites; they are not reimplemented. The existing Shared Shell qualifier now adds populated first-frame captures for Revenue, Dividends, Compare and source drilldown, full Seasonality, Analyst targets and estimate exploration, the transcript archive and Insider activity/filings. It exercises archive search with Q&A filtering and exact-call opening, historical-event selection and source identity, and the new Topics search/status/sort controls. Separate fresh-context inputs qualify unavailable estimates and zero reported insider activity. Figures and transcript excerpts are explicitly synthetic fixtures; there is no live-market evidence claim. The earlier “seasonality in the initial viewport” observation referred only to the Technicals summary, not the separate Seasonality page.

Local qualification for this delta: full TypeScript check passed; 180 Playwright cases in the two affected specifications were discovered; 21 focused tests across literal transcript identity/search, Topic behavior and the unchanged B4 source/evidence lock passed; whitespace checks passed. The new browser assertions and layouts still require the next exact-head native CI and actual screenshot review. Local Chromium and the original live Chrome extension-panel condition remain unreplayed. No Paper mutation, merge/auto-merge, deployment or production acceptance has occurred.

Release preflight at protected master c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40 found no explicit PR hold or formal approval requirement; native GraphQL reported Ready, reviewDecision=null, autoMergeRequest=null and mergeQueueEntry=null. The authenticated native user is chriswong6031-creator; all PR commits and the PR are authored by mastermindxryan. This is identity/custody evidence, not an approval. The active queue ruleset has no bypass actors. Requalify the final head and its evidence before the single protected release request; let the existing master deployment owner perform the rollout. Live Beta/Terminal proof still requires the Chrome panel to be dismissed by the user. Parent DONE_WHEN remains open.


### Secondary-view test correction and publication readback

Source head4f20a0a467540013a329f82f47f2454f1cf58f4e (tree dfdb330629a8818b4a555e76b4f516a450ad7b6e) published all eight intended files; every blob, commit/parent, branch and PR body was read back exactly. Its natural CI43577718154 started. The existing workflow concurrency owner superseded the earlier007c browser lanes; the earlier unit/evidence and four production-build browser lanes passed, but its Beta step had not started when cancelled. No caller cancellation or manual CI replay occurred, and no Beta Statistics-history proof is inferred from that incomplete run.

Read-only reasoning review caught a test/fixture mismatch: the seven-year Seasonality dataset renders inline year buttons; the new Beta test had requested the greater-than-twelve-year popover. The journey now selects an actual inline year by keyboard and verifies its selection/focus. The existing long-history seasonal-controls suite retains popover, Escape and focus-return coverage. The synthetic AMD peer now scales every annual statement consistently, preserving its 30B/40B/50B Revenue acceptance and exact source identity without showing impossible income totals in the source capture. Dividend accessible names, Analyst expansion, archive root/index/body and focus-return contracts, Insider formatting, Compare identity and Topics sorting were checked against the actual components; no further concrete mismatch was found. Full TypeScript passes after the correction.

Next: publish this bounded fixture correction through the same expected-head GitHub carrier, then consume its complete native CI and actual Beta screenshots before protected release. Preserve the original live-browser presence boundary. Parent DONE_WHEN remains open.


## Final visual refinement after 664 (2026-11-14)

- Canonical input: PR #1494 head `664e701121ddfea1c93ce44a82304f4e42531b84`, tree `0fafd187d362dab3a643822b06b9c12ea72be4ac`. All eight edited-file preimages were read from that exact GitHub commit and matched local blob identities. The assigned principal remains the sole code writer; native children supplied read-only visual/source reasoning only.
- Natural CI run [43578117236](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43578117236) passed the serial lane: Company Intelligence 55 passed/35 authored skips; Ticker News 14 passed/7 authored skips; Investor shell 16 passed/8 authored skips; Shared Shell Beta 86 passed/13 authored skips, zero failures. All four production-build browser lanes, typecheck, unit/evidence fan-in, Quote Hub, and Ingest + signal-layer passed. Ordinary browser shards were still running when this visual correction was prepared; no final aggregate or release acceptance is claimed.
- Actual serial artifact `14107708752`, ZIP SHA-256 `d89dbc6835eaa7d69c3a3dae6fe2ebff3e4c9bda84a84acaf7be50701ec21ea5`, was verified and inspected. Its checkout was synthetic merge `4595de7f0cd7206abed347bc1d792e940fdf3a65`, parents protected master `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40` and PR head 664. These are explicitly synthetic fixture captures, not live production evidence.
- Actual desktop EN / mobile ZH visual review found populated, readable Revenue, Dividends, Seasonality, published Statistics history, Analyst targets/estimates, transcript archive, Insider activity/filings, and truthful unavailable/no-activity views. Root also inspected final Intelligence Brief, mobile History, and mobile Topics. Two concrete Compare issues remained: all mobile values were below the initial viewport, and source captures were taken before smooth scrolling established a visible source position.
- Compare now keeps its full reporting frame and company controls visible, with one native keyboard-accessible settings disclosure containing period/alignment controls, metric choices, and methodology. Its always-visible summary states actual cadence, alignment, and selected count. No comparison math, refusal reason, period/source identity, cache owner, or peer-focus behavior changed.
- Source reveal reserves the sticky metric-column width before centering the selected period, preventing that column from covering a selected figure. The Beta journey now checks an actual company value before any repair scroll, exercises settings/metric selection by keyboard, and observes the automatic source reveal using exact company/period/row/value identity, real scrollport bounds, unobscured text hit tests, and settled geometry. Separate context and selected-row captures document the long source layout explicitly. Existing standalone Compare/crop interactions open the same disclosure; no parallel mobile controls were added.
- Transcript archive copy now uses singular segment/speaker labels for counts of one. Chinese labels and source metadata are unchanged.
- Local validation at this milestone: full TypeScript exit 0; 36 financial comparison/lexicon tests passed; whitespace check clean. Browser qualification for this final refinement remains pending its natural PR CI; no local browser denial/download or blocked Chrome navigation was replayed.
- Release remains held until this final owned change is qualified. No merge-on-green label, native auto-merge/queue request, merge, or deployment effect has been issued. Existing CI observation is read-only; no manual rerun or alternate deployment is authorized by a receipt alone.
- Live pre-release public status verified Beta enabled and regular production Shared Shell disabled, both build `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`. The canonical UI target is `https://beta.mastermind-x.com/analysis`. Final live browser proof still requires the user to close the open Chrome extension panel; the same original browser must be resumed after that presence change. No authentication or runtime-flag promotion is part of this mission.


## Persistent peer-source context (2026-11-14)

- Exact input is published/read-back head `2a1d8388658a186c2f7fe06524b27e3854481fba`, tree `9575ac26b60b9a43554d2453a3e4c347c5e9121b`. Its natural CI is [43580586696](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43580586696); production build, all three unit shards, Quote Hub and several evidence jobs were observed successful before this bounded correction. No final aggregate or release result is assumed.
- Following the selected-source reading path exposed a material contextual ambiguity: the embedded peer's company label and Close action were above the long statement page, while the outer workspace correctly continued naming the comparison anchor. A reader landing on AMD's exact value could see NVDA in the persistent workspace header without the peer identity nearby.
- The same source panel now keeps a compact, solid, locally sticky header containing the peer symbol, selected metric/period, and Close action. Noncomparable/unavailable sources keep a short refusal cue visible; the full reason, exact end date, and methodology remain in the body. The existing Statements renderer, controls, math and source binding are reused unchanged.
- Opening a source focuses its heading without moving the viewport, then performs the existing exact-cell reveal. Its scroll margin reserves the measured sticky header and fiscal-column heading. Close still returns focus to the exact comparison cell. The final Beta capture contract now requires peer identity, selected metric/period, Close and selected statement row/value to be readable together, with no test-driven repair scroll.
- Public Beta source preflight returned HTTP 200 for both NVDA and AMD funds (as of 2026-11-13). Both carry USD, distinct fiscal labels and exact period-end arrays, with actual Revenue/Net income values. SHA-256 receipts: NVDA `de87049d962b24c0cbe16fa5119921a1398a6294abdc4d9b4d5934a1daeb5b38`; AMD `3640cc434304505da42008683d245666a977a2f0345573caf1f6a3847f352b8f`. This supports the real data contract; it is not rendered UI or live acceptance.
- No Paper mutation, additional feature phase, runtime-flag promotion, manual CI rerun, merge request, or alternate deployment is introduced by this correction. The original Chrome presence gate remains outstanding. Final source/UI qualification and protected delivery remain the next acceptance work.

- Local validation for this correction: full TypeScript exited 0 and whitespace checks passed. Comparison math/localization remain unchanged from the 36-test passing qualification at 2a; the changed source interaction assertions require the next natural browser run.
