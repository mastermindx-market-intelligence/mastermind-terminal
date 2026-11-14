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
