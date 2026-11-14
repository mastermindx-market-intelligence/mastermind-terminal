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
