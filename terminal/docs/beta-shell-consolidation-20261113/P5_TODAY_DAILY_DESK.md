# P5 — Today daily desk refinement

## Customer outcome and scope

Today should let a member read the market's published assessment, understand the scope and age of the observations behind it, and resume their own work. Previously the source-authored market clauses were inside a closed disclosure, a large Intelligence banner repeated the market entrance, and a second country list competed with the global market selector.

This slice promotes the same complete bilingual clauses into the market panel, makes the existing native market overview the primary action, and keeps the personal desk visually separate. It does not create a summary, market score, price history, alert feed, research revision or portfolio comparison. The source's individual readings and dates remain intact.

## Input and ownership bindings

- Mastermind source law remains pinned at `8323d7a774a72da20d0e4db21c9080398da185e7`.
- Terminal protected input remains `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- The direct code parent is owned [PR1500](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1500), head `cff2126af4d9bf64e2b5beed49f73ffe33ab33fd`, tree `f9050f034e87c425b952c330eb68b46c403126ec`. Its Candidates lane is a genuine dependency of the new Today entrance. That PR in turn depends on [PR1495](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1495), head `627b87e1f0655cdf60999daa99ddf8c797627449`.
- Today is distinct from Prophet's Today lane. No `ProphetView.tsx`, Analysis, company search, generated route registry, engine, API or authentication owner is changed here.
- The existing `/today` member mount owns admission. `TodayWorkspace` owns the account reading scope; `TodayBreadthReading`, `TodayResearchAttention` and `TodaySinceLastVisit` retain their stable positions and request lifetimes. `TodayRiskEvents` still presents the same accepted personal brief. Watchlist membership retains its ordinary saved-list meaning.

## Existing Paper reused, then refined

The [9 November Daily desk candidate](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-4-0), board `3P3-0`, is the composition base. Its independent market readings above comparison/risk work and research continuation are retained. Older R1 board `1ZH-0` supplied narrow-layout context, but its generic attention feed did not replace the newer personal jobs.

Three new owned references are on [P5 · Today daily desk · Native refinement](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-7-0):

| Board | Purpose |
|---|---|
| `3ZE-0` | 1216px desktop content, dark EN; authored assessment above independent readings |
| `421-0` | 320px light EN; full-width actions, wrapping clocks and complete personal desk |
| `44O-0` | 390px dark ZH; summary-specific absence while usable observations and personal work remain |

All three screenshots were inspected. Personal dates gained their separate freshness qualifiers; comparison labels were aligned with the actual saved-reading semantics; the full Portfolio and brief actions were restored; the saved report uses its actual text-window concept rather than an invented revision ordinal. The boards are explicitly illustrative, not evidence of market observations or account holdings. Existing boards and held targets were not modified. All 291 current owned nodes had their working indicators released after readback.

The adapter observation guard is `703ef97f6a51235966e3e534f0abc03a5c61af6ae6b8d906c64b696a8c763397`, tokens `6234666b`. The unchanged active page is `p-2-0`; this guard is an active-file/page observation, not a content digest of every P5 node. Exact new node identities and screenshot readback provide the design binding.

## Implemented presentation and navigation

The Market snapshot keeps a short semantic heading and displays the source's complete topic/predicate/punctuation clauses in the selected language. English clauses receive separating whitespace; Chinese punctuation retains its natural concatenation. The text appears once, above the three featured Macro readings and independent breadth cell. When no clauses were published, the summary says so without declaring the other readings unavailable. Coverage and oldest dated reading remain visible; there is no aggregate live timestamp.

Source notes, omitted observations, period/calculation distinctions and publication evidence remain in their existing disclosures. Source clocks are not refreshed by changing the theme. The personal comparison, risk context and report continuation keep their separate scope and dates.

| Entrance | Destination and retained meaning |
|---|---|
| Open market overview | `/intelligence?workspaceMarket=us`, the existing native overview |
| Open Macro Command | `/macro_monetary.html`, preserving the deeper source sections |
| Prophet candidates | `/prophet?tab=candidates&workspaceMarket=us`, complete published candidate pool |
| Sectors & themes | `/sectors?sectorJob=explore&workspaceMarket=us`, incumbent native Explore owner |
| Risk backdrop | `/macro_context.html`, preserved because narrow Liquidity detail is not full risk parity |
| Company catalysts | `/discover?tab=catalysts`, incumbent engine |
| Full US stock workspace | `/us_stocks.html`, retained deeper capability while Prophet migration remains incomplete |

These entrances disable speculative prefetch. The old country link collection is removed from the research rail; market selection remains with the global shell owner. The existing Today US coverage boundary remains in force. This slice does not relabel US readings for China, Hong Kong or Canada, or claim those regional consumers are complete.

The personal holders are not duplicated for desktop and phone, keyed by a breakpoint, or replaced by a new controller. CSS reflows the same DOM. At 320px, the independent readings stack, both market actions fill the available width, and dates, source failures and continuation text wrap. Existing tokens provide light/dark contrast and focus treatment.

## Qualification

Local focused qualification passed **109 tests in six files**: daily-desk composition, native destinations, independent source/account failures, accepted comparison storage, saved research continuation, and the personal brief adapter. Targeted ESLint, qualifier syntax and diff whitespace checks passed before publication. The initial destination test used a pathname where the existing Prophet codec requires its `canonical` mount discriminator; that test input was corrected and the complete focused set passed. The product URL itself was unchanged by that correction.

The new settled-reader composition test accepts the real-shaped personal brief and comparison contracts, records the one owner-envelope digest write, and preserves the exact saved report hashes and segment. Opening source details, resizing, changing theme presentation and rendering Chinese leave the same personal DOM holder, request list, accepted digest and saved revision intact. The fixture data is original and synthetic.

The existing authenticated `qualify_shared_shell_intelligence.cjs` gains a Today journey at 1440, 820 and 320px; no workflow, browser runner, identity service or polling loop is added. It records source hashes and exercises visible EN/ZH clauses, source disclosure keyboard focus, personal holder identity, digest write count, exact resume URL, independent unavailable states and real navigation to native Overview/Candidates/Explore with browser return. The complete fixture contracts are in `lib/__tests__/fixtures/todayDailyDesk.ts`; no private capture is included.

### Original-head hosted browser receipt

The existing authenticated qualifier passed **18 cells** in run `43579891771`, including the Today journey at 1440, 820 and 320px. Artifact `14109095060` has ZIP SHA256 `1eb44239254431eef69f5e87a3cac037bfa5ae91a102b990f8cb67676fb1b1b8`. Its test merge `9b3f36fcf1cad665ea92f67022e4299b035860e6` has parents `cff2126af4d9bf64e2b5beed49f73ffe33ab33fd` and the original P5 head `c6f115fd3e8651857ed0dd55a787022f517d53d6`; tree `2ad386155b466c8f169cf42f49c79f8cd32b9284` is identical to that P5 head.

The report records `presentationKeptReaderIdentity=true`, one accepted presentation digest write and zero report-body requests. The saved revision keeps its source/text hashes, extractor version and segment 7. Errors, external requests, fixture writes and tracked working changes are all empty. Root inspected the desktop reading, 320px light reading and 320px independent-summary-absence screenshots: authored text, source coverage and dates wrap, the observed readings remain visible when only the summary is absent, and the personal desk is distinct from the market panel.

This is `LOCAL_FIXTURE_BROWSER_NOT_PRODUCTION` evidence. The context uses the existing fixture CSP bypass; production CSP, served sources and real account acceptance remain unproven. This original-head receipt does not substitute for the repaired merge head's hosted qualification. The local Chromium socket/ptrace refusal is preserved; no local relaunch was attempted.

### Originating CI correction and inherited visual repair

Original run `43579891771`, unit shard1 job `132402404817`, found two obsolete
`/macro.html` link expectations in `readingWorkspaces.test.tsx`. They now assert
the intended `/intelligence?workspaceMarket=us` destination. All coverage,
source-date, Business period, account and separate Macro Command assertions
remain intact. The full affected suite passed **59 tests** locally after this
two-selector correction. These are additional affected-suite checks, not a
substitute for hosted qualification of the repaired head.

This stack also incorporates parent P4's `dc8039571b40a0d0ce3765b92560f4cbf7d195d5`
responsive repair: the candidate Inspect action stays in normal phone grid flow,
and the existing qualifier checks one-line labels, target geometry and decision
separation in EN/ZH. P5's Today fixture and journey are retained in the composed
qualifier. The published merge must name both the original P5 head and repaired
P4 parent; no force replacement of an unrelated writer is involved.

## Release and remaining parent acceptance

This owned stack is reviewable source, not a release into its feature base. After dependencies land, retarget and qualify against protected master through the existing permitted release path. Macro11246 supplies the P3 Liquidity reader and Macro11248 supplies P4 Candidates; their served authenticated contracts and Terminal production consumption still require proof. Do not merge this stack into another feature branch as a release shortcut.

No legacy engine is retired. The wider P0–P17 mission still includes full Macro, Prophet and Cycles depth, supported regional adapters, route-by-route production/browser acceptance and eventual removal of superseded sources after parity. Next safe source phase: P6 Discover and its existing tools, starting with the question-to-workspace entrance and preserving actual filters, universes and return context.
