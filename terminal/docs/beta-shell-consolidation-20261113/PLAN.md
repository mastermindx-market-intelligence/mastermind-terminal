# Beta shell consolidation and native workspace delivery
Date: 2026-11-13 (America/Vancouver). Owner: assigned ChatGPT2 session.
Status: ACTIVE IMPLEMENTATION PLAN — no production completion claimed.

## Outcome and boundaries
Deliver one coherent Mastermind investing experience across the beta shell: one market context, one canonical workspace per capability, useful Macro intelligence preserved, deliberately designed native pages, reliable context and return journeys, and safe retirement of redundant presentations. The Chairman's current commission covers planning, Paper design, implementation, verification and authorized release. A plan, PR, CI pass or attractive screenshot is not completion.

The final acceptance is every eligible customer route/family mapped to a verified destination or an explicit justified exception; all core workflows usable across supported markets; production/browser receipts tied to deployed source; preserved entitlements, financial semantics and personal state. Public/editorial routes retain suitable public chrome. Internal/admin/withheld routes do not become customer pages through this project.

This is a task plan under the existing full-site charter and MARKET-OS consumer work. It is not a new runtime, workstream, route registry, admission policy, identity owner or data producer.

## Pinned inputs and lineage
- Mastermind law: master 8323d7a774a72da20d0e4db21c9080398da185e7; INDEX, ACTIVE_EXECUTION, DELIVERY_WORKFLOW, session review and plan continuity applied.
- Terminal starting source: master d575152907b581d20257a09ddde3c312e6b4133a.
- Macro source and design doctrine/system: main 15ba45d4d9d27b2a7966a85b5ac50cc0319ae679.
- Existing charter: Macro research/MASTER_PRODUCT_SHELL_MAKEOVER_MIGRATION_2026-10-08.md.
- Existing registry: Macro data/product_experience/page_registry.json; authored judgments config/product_experience/page_registry_overrides.yml; scripts/build_product_page_registry.py and scripts/export_shared_shell_routes.py.
- Existing consumer projection: terminal/lib/sharedShellRoutes.generated.json. Its source inventory predates this pin; it establishes admitted paths, not contemporary feature parity. Refresh through its owner when changing admission. Never hand-edit the generated catalog.
- Evidence: Chairman screenshots; live beta read-only inspection; actual Paper boards; cross-repository source analysis. In the live inspection Sector Cycles eventually loaded as an iframe. The reported failure is not asserted permanently reproduced.
- Independent reasoning: architecture advisor and design critic; no worker implementation or GitHub approval implied.
- Fabric preflight exposed no eligible adapter/manual route. Principal implements this bounded slice directly; no failed or denied worker effect is replayed.

## Ownership and existing work
Keep Terminal AppShell as the shell, existing authentication/entitlements and account preference delivery as owners, and Macro producers as intelligence owners. Do not transplant Macro CSS roots or duplicate data calculations.
Preserve active Terminal PR1494 (Analysis redesign), PR1493 (company logos/search) and Macro PR10780 (native Sector runtime). Recheck their current changed paths before overlap. These are active carriers, not permission to replace their work. Existing accepted MARKET-OS portfolio/watchlist truth and security_state work remain DO_NOT_REDO absent changed evidence.
Operation branch: sol/web-beta-shell-consolidation-20261113-c2. All mutations in this slice remain on that carrier. Do not self-approve or directly merge. Current repository merge-on-green/required CI/native queue and release holds govern release.

## Product decisions

### One global market context
Place a compact market selector in the top bar, following existing Shared Shell Paper SS01. Keep it visible on phone as a concise country code with an accessible full label. Remove the separate country rail/drawer group.
The reserved workspaceMarket query owns workspace market (the incumbent Intl market query continues to identify its selected country). The URL owns workspace market (e.g. /sectors?workspaceMarket=cn). A refresh, copied link and Back/Forward restore it. Reuse MarketId from terminal/lib/markets.ts; do not invent a competing market enum. International is the existing residual market bucket, not all markets. Crypto remains an existing taxonomy value; its selector exposure follows actual workspace support.
Workspace market does not write followed markets, enabled markets, home, theme, language or portfolio holdings. Company identity remains its exact listing, not a ticker relabelled to a new exchange.
Switch the market without changing the user's task. Preserve compatible view/window filters, remove incompatible market-specific selections with a visible explanation when necessary, and never retain a foreign market's response under the selected label.
Use an explicit closed binding from feature and market to qualified engine. Native regional coverage is not inferred from a similar page name. Unsupported pairs have a useful, designed coverage state and a direct existing market destination. Do not call that regional feature completion.
Requests and caches accepting regional data must bind identity, market/universe, feature/source, query, benchmark/currency when relevant and generation/session. Abort old requests and reject late responses. The first slice gates unsupported native consumers before they mount, so it cannot relabel US data.

### One destination per capability
Retain six primary workspaces: Today, Discover, Analysis, Monitor, Research, Portfolio. The intelligence shortcuts orient people to Macro, Prophet and Sector Intelligence; Catalysts joins the coherent discovery journey. Avoid adding another generic landing full of launch cards.
Canonical Sector entry is /sectors. /discover?tab=sectors and legacy links converge on the incumbent SectorIntelligenceWorkspace with their specific job/subject/window retained. A redirect that loses a legacy selection is a regression.
Current clean /sectors uses native Brief/Explore/Research/Watches; legacy mode exposes Rotation/Discover/Breadth. These are modes of one component, not three independent engines. Recompose that owner. Research/Watches placeholders are unfinished work, not production features.
Sector Cycles becomes a clearly named rotation/cycle workflow with intact deep-link mapping; do not send every cycle link to a generic Brief.
Full Macro Prophet lives at /us_stocks.html. Native /prophet is a separate model-plan/options desk, not parity. Preserve both meanings until the full feature inventory is reconciled and a true replacement is proven.

### Visual and interaction grammar
Use Terminal's current tokens, typography, primitives, theme and locale owners. Flat graphite/structured light surfaces; neutral even borders; strong type hierarchy and meaningful space. No colored container rails, decorative gradients, generic card walls or tiny data labels.
Reading order: subject and market; dominant observed assessment; useful next action; evidence and exploration. Market observations do not become unvalidated trading instructions.
One page heading, one task navigation level, one compact filter/display toolbar. Filters, subjects and visualization modes are separate concepts. Open inspectors only after selection; no empty permanent right column.
Dense tables and charts are work surfaces, not squeezed cards. Prefer a legible ranked view and details to meaningless decorative bubbles. Do not imply correlation from categorical clusters. Preserve complete data access through table/detail modes.
Freshness appears once at the relevant reading boundary, with material stale/partial conditions visible. Source detail, receipts and method are accessible depth. Missing data is not zero; errors do not erase independent working panels.
Desktop, reduced shell width, tablet and phone are designed compositions. Preserve keyboard/focus, touch targets, screen-reader structure, reduced motion, both themes and EN/ZH. Never count mere rendering as cold-reader comprehension.

## Existing Paper references
These are discovered editable candidates/reference sources, not automatic proof of acceptance.
| Family | Existing file | First target / role |
|---|---|---|
| Shell, Today, Monitor, Research, Search | 01M6Y2GT8S3YP4TK052PPESZEC | p-2-0 integration R1; 1K5-0 Today desktop; 2M4-0 presentation/market context; 1ZH-0 mobile; 30C-0 migration acceptance |
| Sector | 01M6FAXA774QT1VRDMAG7DFQ2W | R4 working design; inspect exact live page/boards before source changes |
| Prophet | 01M3NT5Y3G5HTJHVR0K5W2MDJM | reconcile complete board/detail lifecycle, not only options plans |
| Terminal/Analysis | 01M3NSZGE8JWN2EZCSF0DT05RM | preserve active Analysis work; relevant intelligence/company/chart pages |
| Breadth | 01M6Y3CRMC345RTB3ZDP3XSYRP | breadth command center |
| Catalysts | 01M6Y2VTQBVC9NA39HNG1DYWFH | catalyst decision desk |
| Macro | 01M6Y1NJ2SKGG89DZ13E4NVAE2 | macro structure stages |
| International | 01M3P1TW5Y3XWQC37ADDS8K5AG | region-specific core and responsive states |
| Research/news | 01M5EXPMQTSBFBAM8KKG83FTZH | News R3 |
| Market memory | 01M6Y2V2M0J28M2PYAHWZ8SB98 | evidence reading |
| Personal lists | 01M6Y309YH7PJZMF23R7EDH3CM | watchlists/save |
| Search | 01M6Y31C449F02KGRNPGK94Q8D | search comparison |
| Design system | 01M312VSDSZFVT45674GDVJVZN | current grammar/reference integrity |

Paper's default active-document inspection failed pre-effect, but explicit file binding succeeded. Do not infer a global outage. Use fresh exact file/page/snapshot bindings before any edit. Preserve existing boards; create additive missing-state designs with supported tool-scoped writes. No archive/delete or unsupported schema attempts. Every first-of-family packet records exact artboard, source screenshot, module dispositions, responsive/state compositions and resulting implementation comparison. No second design approval ceremony is invented under the attended Web waiver.

## Delivery graph and page-by-page work packages
Principal owns integration and acceptance. Native reasoning advisers provide bounded design/architecture critique. Implementation may be delegated only through actual eligible runtime grants; direct principal execution remains valid. A phase ends with verify -> save/readback -> reassess -> next ready task.

| Sequence | Pages / family | What users should be able to do | Implementation and migration action | Completion proof |
|---|---|---|---|---|
| P0 | Global chrome, desktop rail, phone drawer, All tools | Know their market; change it while staying in the same task | URL market context, header selector, remove country nav, context-aware links, coverage fences; retain existing directory/admission | Back/Forward/reload/share; no cross-market bleed; responsive EN/ZH light/dark; preferences unchanged |
| P1 | Sector Intelligence, Sector Central aliases | Understand leadership, explore sector/theme/company and return | One incumbent controller and header; reconcile Brief/Explore with legacy Rotation/Discover/Breadth; preserve admin-only Finviz | Canonical and old links reach correct job/subject; complete data/coverage parity; identity isolation |
| P2 | Sector Cycles US/CN; subsector/rotation details | Read cycle position and historical evidence, inspect constituents | Reuse native runtime/generation from current Macro carrier; port presentation and preserve sectorLegacyMap | No main workflow iframe; 24-anchor compatibility audit; real generation + stale/partial/failure; source family not silently substituted |
| P3 | Macro Dashboard, Market Intelligence overview, country regime dashboards | Read regime, drivers, what changed and what would change the read | Native composition over existing published sources; merge duplicate overview content; keep regional methodology | Real source-to-render proof; no invented history; timings/benchmarks correct; source/date and deep-link parity |
| P4 | Full Prophet US and country boards; setup/detail; native model plans | Find candidates, inspect lifecycle/evidence, retain selected view | Inventory full original board, counts, lifecycle/detail and options separation; native board/detail over incumbent engines | Population/count equality; plan vs setup boundaries; filters/share/return; denied/stale/empty states |
| P5 | Today | Understand today's market and own changes at a glance | Apply existing Paper desk composition; make market summary and personal attention distinct; remove repeated launch panels | Real market reading; honest missing comparison; holdings scope retained; resume reading/watchlist persistence |
| P6 | Discover, Screener, Heatmap, Leaders, Leader Radar, RS study, Confluence | Narrow a universe and inspect evidence without losing filters | Preserve engines; compact integrated workbench, ranked/table/map modes; link to canonical Sector/Catalysts | Market universes and listing IDs correct; filter equality; zero results vs no coverage; keyboard and responsive dense views |
| P7 | Catalysts, Defense, Biocatalyst and specialty theme desks | Distinguish an observed development from a confirmed causal event | Shared list/detail evidence flow, preserve domain data, methodology and company provenance | Disclosure/source lineage; no fabricated causal claims; selected case URLs; populated/partial/stale |
| P8 | Analysis, company dossiers, statements, ownership, earnings, technicals | Understand one company and move between evidence and chart | Integrate incumbent PR1494 and issuer-logo PR1493; unify shell/context/return, not reimplement their bodies | Exact issuer/exchange identity, deep sections, chart return; duplicate heading removal; existing tests + live path |
| P9 | Monitor, alerts, watchlists, news attention | Track own names and changes with reliable saved state | Apply existing Monitor/list Paper; preserve canonical watchlist/alert owners and mutation receipts | Save authoritative reread; cancel/error/retry; changed identity clears private data; no fake 'since last' data |
| P10 | Research library, reports, News, Market Memory, evidence/source reader | Find, read, cite and resume exact research | Editorial reading layout, useful facets, exact source revision and resume position; preserve entitlement | Real report body, revision/reading return; search no-result; denied/failure; citations |
| P11 | Portfolio and personal impact | See actual holdings and understand evidence in their scope | Preserve accepted population/sizing/import owners; compose coherent market context without filtering holdings implicitly | Existing accepted population contracts not redone gratuitously; changed paths only; persisted state/entitlement proof |
| P12 | Terminal chart, Options, replay, scripts, dislocations | Enter the exact instrument/workspace and return intact | Keep single native engines, reconcile presentation boundaries and handoffs; no duplicated chart or calculations | Exact return URL, symbol/venue, chart size/lifecycle, focus; options/model semantics retained |
| P13 | Bonds, FX, commodities, crypto, global/country detail | Use shared grammar with appropriate asset-specific intelligence | Existing regime archetype adapted to real source contracts; create missing Paper states first | Correct benchmark/session/currency, real engine response, domain deep links; explicit unsupported capabilities |
| P14 | Baskets, generated sectors/subsectors/stocks/rotation/report families | Follow every admitted deep link to equivalent useful depth | Migrate by owning template and distinct state, never per-ticker forks; retain alias mapping | Family enumeration/counts, representative dense/empty/error + all-link mapping; no orphan route |
| P15 | Account, auth, settings, plan-required, unavailable, not-found | Recover without losing task/context | Reuse existing owners and error designs; one coherent utility grammar | Auth return, session expiry, unavailable service; no entitlement bypass; safe contextual return |
| P16 | Public/editorial/learning/product/help/legal/calculators | Understand and access public content | Shared visual grammar with public chrome; preserve SEO/content and access | Anonymous routes remain public; forms/actions/links work; no investor rail imposed |
| P17 | Retirement and whole-product qualification | One clear destination for each capability | Switch canonical links only after parity; bounded rollback; archive obsolete presentation after consumer/deep-link proof | No unexplained duplicates/iframes in completed core families; registry disposition + production receipts for every eligible family |

### Market qualification sequence
US is the first complete native vertical because current sector generation validates SPY and current fixed feeds are US-specific. China follows with its actual macro/stocks/sector/cycle engines. Hong Kong, Canada and International follow through existing regional sources, with no US-label substitution.
For every feature/market pair record: engine/source owner; taxonomy/universe/benchmark; currency/session; entitlement; source freshness; native presentation status; direct existing fallback; exact consumer proof. This belongs in the existing migration packet/registry judgments, not a second dynamic capability service.
Regional visual reuse does not imply identical intelligence. Research, Portfolio and instrument identity retain their own scopes. A selected market is not an automatic account preference edit.

## Retirement rules and preservation
For each module choose RETAIN, IMPROVE, RELOCATE, MERGE-INTO, REMOVE-with-rationale or BLOCKED_DATA. Default to preserving useful analytical depth. Remove repeated presentation only after naming its canonical destination.
Each retirement requires source/template owner, ingress/deep-link inventory, user actions and data parity, generation/access contracts, production use proof, alias/redirect behavior and bounded rollback. Leave original source history intact. Archive code after proving consumers no longer need it; do not delete engines because a page was ugly.
Iframe replacement is incremental: inventory capability -> bind existing data seam -> native renderer -> real parity -> canonical entrance -> alias retention -> presentation archive. The current iframe bridge is a temporary compatibility owner, not the finished experience.

## Acceptance gates for each package
1. Source and custody: exact inputs, active writers, protected source, data contracts, no conflicting effect.
2. Design packet: before/after, Paper exact target, reading order, module disposition and landing, reduced-width/phone composition, actual state matrix.
3. Implementation: native owner reused; no parallel auth/state/data/control plane; correct market/request identity.
4. Focused evidence: meaningful unit/integration tests for changed behavior, types/lint, relevant existing responsive suite; no tests that merely assert CSS spelling.
5. Real browser: populated journey; empty/partial/stale/error/access states; keyboard and focus, URL/history/return, no page horizontal overflow; 1440/820/390 and 320 stress, both themes/locales for global changes. Identify human comprehension as untested until actually observed.
6. Release: source-qualified Ready PR, actual protected CI and binding approvals/holds, native permitted auto-merge, merged source and deployment readback.
7. Production: exact deployed marker and live journey, data/source parity, persistence readback where affected. Green CI does not satisfy this.
8. Durable continuation: evidence and next action saved/read back; start next safe independent package if release is waiting.

## First slice: bounded implementation packet
Owned: shared-shell market helper/selector/coverage boundary; AppShell composition; AppNav/MobileNav country group removal; SharedShellPrimaryNav/IntelligenceNav market links; focused tests and this plan.
No engine mutation, no new route admission, no Analysis/search/logo body edits, no Macro10780 runtime duplication.
Design source: actual SS01 board 1K5-0 inspected at file snapshot 91b959fac997b241bec8f283ddd67db8fa94e36cf162a992120b6f742ed96031. Its top market selector and flat shell guide this slice; this does not accept the whole file.
Keep market context derived from URL. Gate unsupported native consumers before mounting. Known legacy country routes may select their matching admitted region and preserve same-feature navigation. Maintain authoritative fixed route-market binding on direct legacy URLs.
Then simplify sector composition/aliases through the incumbent controller if current source remains disjoint. No blanket clearing of filters; preserve known legacy state and source family. If incompatible, keep the old deep link and record remaining debt.

## Progress and exact next action
- Completed diagnosis: protected pins, Paper exact-file access, live beta read-only inspection, active-PR collision census, incumbent-sector and market-taxonomy analysis.
- Durable plan: this file and derived appendix are the initial construction checkpoint.
- P0 source implemented: URL context, header selector, country-group removal, primary/search/directory/bridge context, and unsupported native coverage fence. No regional engine parity is claimed.
- Source qualification: 131 focused tests across eight suites passed; TypeScript passed with a larger heap after a pre-effect 2 GB heap exhaustion. The existing bridge tests include raw Intl query preservation and parent/source canonical separation.
- Local Chromium aborts before opening a page with process_singleton_posix socket() Operation not permitted. No flag/account/provider workaround is attempted for that local launch. The existing normal protected CI run independently executed its browser suite on P0: 33 passed, 15 skipped, 3 failed. All three failures were the same pre-existing company-search exact URL expectation at different viewport sizes; P1 updates it for workspaceMarket=us. Artifact 14100527655 (responsive-qa-43560921447-serial, digest sha256:77a604ea19252ac37dee6ad1b7cf4a9d91d8a2804818af810686f9003917a3d6) binds to P0 head 6c68b5fc37354692eb27f2ff803eed1f3da2f8f6. Desktop Discover dark/EN, 320px market coverage dark/EN, and tablet coverage light/ZH screenshots were inspected: the market control and existing header actions fit; content and recovery actions remain readable. This proves P0 geometry only, not P1 visual acceptance, engine parity, merge or deployment.
- Plan census: [ROUTE_WORKLIST.md](ROUTE_WORKLIST.md) enumerates all 320 named destinations and the generated families from the incumbent projection. Its source snapshot is explicitly historical; update actual registry judgments through the Macro owner before migration/retirement.
- Important integration correction: Intl owns market=JP and rejects unknown query fields. Bound legacy routes infer market by pathname; source iframe canonical URLs omit reserved workspaceMarket while the parent may retain it. Raw query commas, duplicate/empty fields and selected company hashes remain intact.
- P0 saved and read back on [PR1495](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1495), head `6c68b5fc37354692eb27f2ff803eed1f3da2f8f6`. The normal protected CI run is `43560921447`. Its production build/typecheck passed; four existing test suites needed updated router mocks or explicit `workspaceMarket=us` expectations. Those failures are repaired in the P1 slice, without weakening origin/issuer/scroll-lock assertions.
- P1 source implemented below. Next: publish this source on the same carrier, then begin the bounded P2 Cycle history consumer while existing CI qualifies the changed head. Complete native page migration, release and production acceptance remain owed.
- No external worker, watcher, daemon or automatic continuation is claimed. No Slack message or production personal-state mutation was sent.

## P1 implementation packet — one Sector workspace

Design reference: Sector file `01M6FAXA774QT1VRDMAG7DFQ2W`, page `p-L-0` (R6 Product), board `QNB-0`, snapshot `e53a46459fef9905e8ca7e4c461a25d251dec4bace6f014159890040fd36bc66`. Its screenshot was inspected. The single heading, measured comparison and connected investigation hierarchy guide this slice. The specimen headline “Strength is broadening” is not adopted: the current Brief has no supplied breadth-change payload.

Implemented dispositions:
- MERGE-INTO: new Discover sector actions open canonical `/sectors` with workspace context. The beta Discover tool tab strip no longer offers a second Sector Central destination. Ordinary Terminal retains its incumbent tab behavior.
- RETAIN: bookmarked `/discover?tab=sectors…` investigations keep their exact address and history state. They mount the same sector controller without the outer Discover strip. No forced redirect rewrites an investigation or depth return.
- REMOVE: the redundant outer Sector heading/navigation on verified canonical entry. The incumbent reading-scope gate still owns account verification, withdrawal and retry. The actual sector main owns the skip-link target. Dossier failures retain a page heading.
- IMPROVE: the existing shell presentation owner controls sector appearance, including Sources and dossier descendants. Standalone sector URL themes remain intact. No second preference store is created.
- FIX: low-specificity form resets allow the native primary/secondary button styles to render; the former parent selectors overrode their intended treatments.
- REORDER: measured leadership and its chart precede unavailable breadth. Missing-membership disclosure remains visible; detailed limitations remain available in a Data coverage disclosure. Disconnected Research/Watches promotions are removed from Brief.
- IMPROVE: Explore uses semantic column/row headers with a visible source-derived benchmark/total-return caption (explicit unknown basis when absent), preserves source order, omits the entirely unavailable participation column, and reserves inspector space only for a valid selection. Intrinsic wrapping responds to actual available content width; the comparison fills the stacked viewport.
- FIX: exact-zero relative returns are described as benchmark equality, not lagging; opposite-window copy requires actual opposite signs. Unmeasured values remain missing.
- RECOVER: unmeasured inventory has an Explore action; native connection failure may explicitly open the existing sector explorer. Access refusal, invalid evidence and loading do not offer that alternate-source action. No legacy value is substituted into native evidence.

Qualification: 216 focused tests passed across 16 suites, including route/identity/bridge, old investigation state, theme ownership without refetch, source-ordered comparison, exact-zero/empty states, and the incumbent rotation-focus fix. TypeScript passed. The final changed-area rerun passed 99 tests across eight suites, including four added denial/recovery tests and the source-derived measurement caption; TypeScript and diff checks passed again. Scoped Native/Discover lint passed (the existing LegacyPageHost dependency warning remains). The established `shared-shell-refinement.spec.ts` gains a beta browser journey; the existing native-sector suite is updated to assert semantic table rows. Actual browser execution on the changed head is still owed.

Base integration: preserve protected master `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40` (#1489 rotation snapshot focus) in this carrier; its four changed files are carried unchanged. Analysis PR1494, issuer-logo PR1493 and Macro PR10780 remain separate writers. This packet does not claim their acceptance or replace their work.

## P2 next safe slice — native Cycle history, bounded parity

Source inspection at Macro `ea49e249b7675f76a633013b4579e76cddfc78cb` found an authenticated retained history contract already consumed by Terminal's BFF: `/sectordata/sector_cycles.json`. The captured repository artifact is 2,425,129 UTF-8 bytes, SHA-256 `6921c685065b4923c89b761b7ab97a83bcd07746e950aa59cdc0a881a42e2665`, as of 2026-11-12, with 11 sectors and 252 RS observations per sector. This is source evidence, not live beta acceptance.

Proposed bounded route: `/sectors?sectorWorkspace=cycles`, inside the existing native pathname/controller, with host-owned selection and retained depth return. Reuse the current history/events BFF and incumbent SectorCycleLens. Bind to the authenticated history's own receipt/day/hash and actor/request epoch, with `publicationId:null`; never fabricate a native generation or deep Cycles publication receipt.

Resolve before exposing it: the lens currently labels TR RS series with the separate price-structure basis, understates stale history, and has no host selection callback. Correct those distinctions; retain strict parser/date/access gates and the shell's history ownership. No new native route admission, cookie filter, fetch owner, persistence service or widened payload cap is needed.

Full `/sector_cycles.html` and its legacy anchors remain available until deep publication, universe/oscillator/price/DNA/hazard/forecast and alias parity are proved. This native history slice must not be reported as complete Cycles migration. Macro main has newer projection work than PR10780; do not copy its older branch projection over main.


## P2 implemented packet — retained Cycle history

Source: the original PR1495 carrier remains authoritative. P1 head 1396787cbbeab35feba3c02da1c159a790d474d8 passed all three protected unit shards, TypeScript, production build and the existing company/browser checks. The serial Shared Shell presentation step failed its new Sector journey on desktop/tablet/phone because that anonymous harness rendered the actual member account gate. Artifact 14101184910 from run 43563426665 (SHA-256 2f169b3398a12410b09f0b37a629602f34d3306efc999f7bad4ef291da4d28ab) was downloaded, hash-verified and its failure screenshot inspected. Thirty-six cases passed, 15 skipped, 3 failed. This is a fixture-placement defect, not evidence of a member render defect or permission to weaken authentication.

The same assertions now run in the incumbent `e2e/tools/qualify_shared_shell_intelligence.cjs`, which already owns an isolated loopback account authority, browser context, real Next routes and teardown. Its ordinary CI step is unchanged. The anonymous presentation suite retains its market and public-shell assertions. The member qualifier uses the single sidebar Overview after P1 removed redundant context chrome; its expected return URLs retain `workspaceMarket=us`. Browser execution of this repaired candidate remains owed. No local browser relaunch follows the environment's prior socket/ptrace refusal.

### Reuse and custody

- Paper file 01M6FAXA774QT1VRDMAG7DFQ2W, page p-H-0 (R5 Full Cycles depth), board PM2-0, snapshot e53a46459fef9905e8ca7e4c461a25d251dec4bace6f014159890040fd36bc66. The 1440px desktop screenshot was inspected; PVU-0 phone, PXP-0 landscape and QIJ-0 tablet remain existing responsive references. The useful hierarchy is subject choice, dominant chart and leg depth. A specimen's price chart or deep publication is not fabricated from narrower history.
- PR1249 is a partly delivered donor with residual acceptance, not a replacement writer. Its reader/chart core landed through 1413 and native Signals mount through 1429. Current assignment takes responsibility only for the bounded direct-history residual described in [the source-linked residual record](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1249#issuecomment-6775303344). PR1249, its full acceptance and its previously refused typed publication-status effect are unchanged. This slice neither replays that effect nor claims the donor complete.
- Existing SectorIntelligenceWorkspace owns account/request epoch, fetching, refresh, URL, popstate and depth return. SectorCycleLens remains the chart/controller. No new route admission, endpoint, poller, cache, auth, publication, snapshot codec or private store is introduced.

### Delivered behavior and dispositions

- Add `/sectors?sectorWorkspace=cycles` as a native history mode of the existing controller. Direct entry waits for URL initialization and reads only the existing history/events feeds. Clean Brief and native connection/unavailability states expose an explicit history action; access refusal does not offer a substitute source.
- Accept only a ready history receipt for `/sectordata/sector_cycles.json`, a 64-hex content hash, matching source date and the incumbent parsed TR history. Bind actor/request epoch and receipt hash. The generation's publicationId stays null. Denied, malformed and late previous-owner responses never supply displayed data. Same-byte stale metadata updates the view; a changed hash retires the previous cursor.
- A local field-selected source capture retained all 11 sectors and 252 observations without recomputing values or order; it was used for local source-to-parser/render checks. Automatic approval review rejected uploading that private captured payload into Terminal as cross-repository data disclosure. That exact effect is DENIED and was not retried, re-encoded or moved to another carrier. No tree/commit/ref had been written at the denial. The capture remains local only. Published tests instead reuse one clearly synthetic contract fixture with generated observations, public sector identities and deterministic weekday coordinates; it contains no copied market data and proves no real exchange calendar or financial parity.
- Correct chart semantics: rolling RS uses the actual total-return basis; separate price-cycle turns remain labelled as such. Range presets count actual supplied trading observations, not calendar days. Leg counts require retained pivot/end anchors and count only observations in that leg. A change in rolling relative wealth is never labelled a price return.
- Present the chart before unavailable deep panels. Methods and coverage preserve that depth without a wall of empty analytics. Use neutral Recovery wording; show one family without a redundant one-option tab list. Phone/tablet use the existing compact series picker rather than five phase columns above the chart.
- Comparison draft is explicitly one radio choice or No comparison, matching the incumbent single comparisonId. Apply, reopen and chart legend agree. Price-structure differences do not disable comparable TR observations.
- Host-owned series selection and browser Back preserve selected sector. Explicit dossier Back and browser Back wait for accepted history, then restore the annotated visible opener through the existing focus owner. This proves destination/sector/focus continuity; range, cursor, comparison and Chart/Data-table mode are not claimed to survive a dossier unmount. Deep-publication capture correctly remains unavailable for this narrower generation.
- Reuse the shared dialog focus trap and scroll lock for picker, leg sheet and fullscreen; Cancel/Apply/Escape have real effects. Ready history exposes its existing Sources and method drawer. Unknown sector URLs remain explicit until an admitted subject is chosen.

### Evidence and remaining acceptance

Local qualification before fixture publication: 157 tests across 9 affected suites passed using the local source capture, including session windows, source/basis/date admission, stale/access/actor withdrawal, host URL ownership, one comparison, delayed return-focus restoration through both controls, missing leg anchors and incumbent deep-capture rejection. TypeScript and scoped lint passed; syntax and diff checks passed. After the rejected data-copy effect, the current synthetic fixture passed all 12 snapshot/adapter tests in a bounded single-thread runner. Component reruns were killed by workspace capacity (exit 137 before results), including after serializing and reducing the heap; those changed-input component results remain owed to the existing CI unit lane. No green result is inferred from a killed process. Syntax and diff checks passed again. Source-to-render results from the local capture are not relabelled as synthetic CI proof. Read-only design/architecture critique identified concrete fixes, which were applied; these are not GitHub APPROVED or browser proof.

The member browser qualifier retains desktop 1440, tablet 820 and 320px stress assertions for one heading/main, no native-history iframe, semantic comparisons, Sources receipt, precise 21-session table, Cancel/Apply, keyboard containment, real browser Back, both dossier return paths and light/ZH rendering. Existing standalone Cycles mobile assertions now verify single selection and the true RS basis. The published browser inputs are synthetic and are explicitly identified as such. Actual rendered results, full-screen transition geometry and authenticated production/source parity remain owed.

Full `/sector_cycles.html`, its 24 legacy anchors, CN cycles, universe/price/oscillator/DNA/hazard/forecast depth, same-close basket comparison and authoritative deep publication remain unretired. This is useful native history, not complete Cycles parity. No merge, deployment or whole-program acceptance is claimed.

Next safe source phase: P3 native Macro detail over the existing authenticated Macro command/validated workspace reader. Current summary alone cannot replace `/macro.html`; inspect the existing rich Liquidity Regime view, published state and actual dated changes, preserve missing-history semantics, and bind the exact existing Paper board before implementation. Continue the remaining P0–P17 acceptance graph.

## P2 qualification repair — original CI receipts

PR1495 head `a243b08a59a74d3222b11882539c9e7b4728c989`, [CI run 43566949906](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43566949906), passed all three unit shards with the published synthetic fixture, TypeScript and the production build. This resolves the locally capacity-blocked changed-input unit qualification; it does not establish production acceptance.

The original serial member qualifier and mobile-4 failures were diagnosed from their original logs and hash-verified artifacts, without rerunning a browser or weakening assertions/authentication:

- Serial job `132363031186`: the 320px Brief measured 608px page width. Its chart's initial 560px width sized an unconstrained stacked flex child; the side column also retained a 300px minimum inside the 292px content area. The repair constrains stacked Brief/dossier/rank columns to the available width and clears their minimum widths so the existing ResizeObserver can measure the actual container. No global overflow hiding or chart clipping is added.
- Mobile-4 job `132363031302`: four EN/ZH Cycle cases still chose the hidden rail at phone width. The product now deliberately uses the existing series picker for every width at or below 980px. Both test helpers now drive that picker, retaining draft, Apply, selected-state and history assertions.
- Serial artifact `14103134121`, ZIP SHA-256 `14357938a70277817b945114572885b6d97b7210a5a5b0b3082b3909fcaf22f6`; the failure screenshot was inspected. Its qualification receipt identifies runner checkout `a0ba5f0ce150d80414cbd2d1f132581b1a98dcf5`, while the workflow artifact metadata identifies PR head `a243b08a…`; those identities are not conflated.
- Mobile artifact `14103495092`, ZIP SHA-256 `cf56280fb05c7326ef0fe2fc081f2db7f88b90eeecd9bcdaea64e2453a31c862`, matched the published digest. These are original failed-run receipts, not repaired-run proof.

The bounded repair stays on the original PR/carrier. Browser qualification of the corrected head is still required. Native P3 Liquidity design and implementation continue independently; no merge, deployment, full Cycles parity or parent-program completion is claimed.

### P2 corrected-head browser evidence and remaining assertion repair

Run [43569814218](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43569814218) at head `b8b33a72e8ba9f76be20f0896e3c040bead9aa86` passed the serial native-route qualifier, typecheck, all three unit shards and production build. The qualifier used merge commit `d8c0f5eb733b1ddc01eeabda0de7af4679fa3f02`, whose verified parents are protected `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40` and this PR head; its tree equals the head tree. Artifact `14103923258` (`intelligence-beta-qa-43569814218-1`) archive SHA-256 `edaeff00232bbfdc730c6f5ddf55293ed93c0cdf02fb90dced1d92dedb01882e` reports passed, zero browser errors, zero external requests and zero fixture writes. It includes native Sector and Cycle journeys at 1440, 820 and 320px. The 320px Cycle screenshot was visually inspected. This is synthetic authenticated loopback fixture proof, not production/CSP or complete source parity proof.

Broader mobile-4 and desktop-5 jobs progressed beyond the repaired picker and then failed the same old 64-row assertion for a 63-session range. Their original logs show 63 actual rows. The source now correctly counts supplied observations; the old test also expected 22 observations for 21 sessions. Both assertions now require exactly 63/21 observations and verify the fixture's exact first/last dates. Chart-to-table equality, fullscreen, keyboard subject switching and browser return checks remain. No rerun or waiver is used in place of the source repair; the next owned head must pass these journeys.

## P3 implemented candidate — native Liquidity detail

P3 now has a native US Liquidity view at `/intelligence?macroWorkspace=liquidity_regime`, within the existing Intelligence route. Its additive backend dependency is [Macro PR11246](https://github.com/mastermindx-market-intelligence/macro/pull/11246), head `80ca3040ab0e841a4af1b95bd98bbba99d2ec9ae`. [The Macro packet](https://github.com/mastermindx-market-intelligence/macro/blob/80ca3040ab0e841a4af1b95bd98bbba99d2ec9ae/docs/beta-shell-native-liquidity-20261114.md) contains the full reader contract, exact source inputs and pending Business overlap. Both code and evidence remain on their original owned carriers.

### Paper design and semantic corrections

Created four owned boards in the existing [Macro D06 file, P3 Liquidity page](https://app.paper.design/file/01M6Y1NJ2SKGG89DZ13E4NVAE2/p-6-0): `33Z-0` desktop dark EN, `3A4-0` phone light ZH, `3HT-0` partial comparison and `3KB-0` no-prior publication. Existing boards were preserved. All four screenshots were inspected; final desktop/phone corrections were read back and visually inspected. The adapter guard `342048f91f2483e7f839f8ca2e74d2dba24270ab77cc52bc023c18717d619d27` binds the active file/page observation; it is not represented as a content revision of every new board. Token hash `6234666b`; final working indicators were released.

The hierarchy is published regime, separate coordinates, actual dated comparison, grouped drivers, implications and source/method disclosure. The partial comparison retains the eligible D-to-D state row while withholding the absent numeric change. Driver impact has no supplied unit/target in the source view; primary rows therefore show value, unit and coverage. Unqualified model impact remains in the method disclosure. Coordinate values use the producer's formatted value and the matching metric's supplied unit, which avoids both an invented unit and an oversized combined numeric string on the phone. Design specimens and browser fixtures are original synthetic values, not captured market data.

### Existing owners and useful behavior

- Extend only the incumbent reading BFF's closed `today` query with `workspace=liquidity_regime`. The backend reuses `/api/macro/command`, the existing registered-user dependency, qualified served root, `SUITE_PAGES`, schema/digest/manifest reader and decision-first view builder. No additional engine, endpoint, auth authority, producer, cache or publication lifecycle.
- The existing owner-keyed Intelligence session retains `useReadingScope`, refresh sequencing and one display clock. Each overview/detail visit receives a request tag; a late response from a departed visit cannot populate a later visit. Detail fetches only its selected Macro view. Invalid/duplicate selections make no private source request and never substitute the overview.
- Entering the detail focuses its heading. Explicit Back and browser Back preserve market/context query and restore the overview's visible Liquidity opener immediately, independently of source loading. The single page has one heading/main and no iframe. The Sources control opens and focuses its real disclosure; inherited Macro-only fragment links are not copied.
- The decoder binds the selected US Liquidity identity, generation, canonical digest, artifact path/size and manifest contract. The backend remains the schema and financial authority. Browser code never reclassifies the raw coordinates, computes a replacement change or upgrades admitted transport to current evidence.
- Preserve the supplied state/stability explanation, source-declared worst freshness, independent observation dates, eligible comparison block/rows and typed history/implication absences. Zero remains visible. Missing prior readings keep useful current evidence and withhold the change. The method explains that the canonical content digest is not the raw-file hash.
- Keep `/macro.html` and `/macro_liquidity_regime.html` as full-depth destinations. This does not establish full Macro Dashboard parity or native coverage for another market.

### Qualification and release ordering

Ninety-nine targeted frontend tests passed across the decoder, authenticated BFF proxy, Intelligence workspace and existing market-owner suites, including EN/ZH rendering, zero/missing values, strict query/refusal behavior, source/generation mismatch, selection lifetime, refresh, account expiry, typed stale/absence states and immediate return focus. Source review found and repaired a task-loss gap: the existing market switch now retains the Macro workspace selector, while the current coverage boundary still unmounts unsupported US consumers. A separately generated original synthetic input was projected through Macro's real composer and view builder and accepted by the Terminal decoder; no private captured payload was committed. Syntax and diff checks passed. Full local TypeScript checking exceeded workspace memory (exit137, then bounded-heap exit134), so full type qualification remains owed to the existing hosted CI lane; neither termination is a pass.

The incumbent authenticated browser qualifier now includes native Liquidity at 1440, 820 and 320 pixels, with actual navigation/Back/Forward, US→CN coverage→same US task round trip and no extra US read while CN is selected, focused Sources receipt, selected-only reads, partial and no-prior states, light/ZH rendering, invalid selection and page-overflow assertions. It shares one original synthetic fixture with unit tests and records its content hash. Browser execution of this candidate is still owed; no local browser launch was attempted after the earlier socket/ptrace refusal.

Macro API checks: 15 new tests and 40 distinct affected tests passed locally with the real composer/reader; two assembled-app auth checks remain for repository CI. Macro PR11246 is Ready, with no release opt-in yet. Its three exact published files were read back. The API must be qualified, merged through its normal controller, deployed and verified before this native Terminal selector is released. PR10674's separate Business-clock bytes, operation26751 uncertainty and original hold remain untouched; P3 is not recovery of that bundle.

Parent acceptance remains open. Continue source-led P4 Prophet inventory while these existing CI lanes run. Protected Terminal already contains native Today/Screener/Plans lanes; inventory their actual depth before adding any opportunity-board presentation. The compact preview is not full Macro Prophet parity, and an iframe bridge is not a completed migration.

### P3 browser evidence and original-carrier language repair

Run [43572234118](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43572234118) executed PR head `e8cfa85476c75afc445a4395a98982667787a095` through merge commit `7e0018be2816d9a3ce4ff5b56f93126ac8e99243`, whose parents are protected `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40` and that head. Its tree exactly equals the published candidate tree `a5f890a845e009814d10ef7de7a378b34fbe6e0a`.

Native browser artifact `14105716084` (`intelligence-beta-qa-43572234118-1`, ZIP SHA-256 `057c8094d46dd23798df187c504a232cbe6b830be687b25948b75c84a3e591d1`) reports `passed:true`, no page errors, no external requests, no fixture writes and no tracked working changes. Native Liquidity and Sector/Cycle journeys passed at 1440, 820 and 320 pixels. The 320px dark EN Liquidity and 1440px light ZH partial-comparison images were visually inspected: controls, source dates, supplied coordinates and the missing-prior state remain legible. The qualifier explicitly records `LOCAL_FIXTURE_BROWSER_NOT_PRODUCTION`; its isolated context bypasses CSP for its loopback fixtures, so production CSP, actual served sources and deployment acceptance remain owed.

All 36 other originating jobs succeeded. Job `132380462364`, step 21, was the single originating failure: the plain-language guard did not recognize the inline bilingual `Liquidity regime` ternary. Both translations existed. This repair moves the same EN/ZH strings into this component's existing `COPY` dictionary and renders `c.openLiquidity`; URLs, focus return, data and the guard stay unchanged. The aggregate job's failure was consequential. Qualification of this repaired head is still required; the prior exact-tree browser evidence is not claimed as a deployment receipt.

## P4 implemented candidate — complete eligible pool and source detail

The first bounded P4 slice is implemented in an owned stack on PR1495 repaired head `627b87e1f0655cdf60999daa99ddf8c797627449`. [The P4 contract, Paper binding, source inventory and qualification packet](./P4_PROPHET_CANDIDATES.md) is the complete brief. It adds Candidates to the existing native Prophet lanes, using the unchanged Macro candidate projector through [Macro11248](https://github.com/mastermindx-market-intelligence/macro/pull/11248), head `8a45c12ee4d9379beefda8c18552847a0a45371e`. Model plans, Today selection, full eligible population and options remain distinct objects. No `ProphetView.tsx` bytes owned by574/668 are changed.

The implementation preserves all eligible rows and counts; distinguishes screening position, main-list membership, zero score and unscored status; uses source-labelled detail and actual company continuation; and retains the full legacy workspace. Existing URL, identity, request, market, cache and preference owners remain authoritative. Search is bilingual and local; selected detail and return focus stay in the same accepted response. Country switches preserve the feature while clearing source-specific context. No fourth Prophet engine or another identity lifecycle is added.

Four owned Paper boards on [PROPHET page p-L-0](https://app.paper.design/file/01M3NT5Y3G5HTJHVR0K5W2MDJM/p-L-0) cover desktop, bilingual phone, detail and six availability/return states. Final screenshots were inspected and all owned working indicators released. Local focused tests167 passed; hosted full type/build/browser proof and actual production source proof remain owed. The existing authenticated qualifier now contains the corresponding native candidate journey.

P3 repair is saved on PR1495 at627b87e1; its real added-lines language guard passes and repaired-head CI43576950807 is running. PR1495 is Ready, with no release opt-in while backend/deploy acceptance is pending. Macro11246's exact80ca3040 binding checks concluded success; the installed controller excludes the deliberately inactive pilot context for main while retaining active main authority. Its single `merge-on-green` opt-in was read back, with no native auto-merge and no merge/deployment claim. Macro11248 follows its own CI and rollout; its inactive pilot receipt is likewise not a candidate failure.

Next safe source phase is P5 Today, using existing `TodayWorkspace` and its stable reader composition. Its source-authored market clauses currently sit in collapsed detail while a large launch banner repeats navigation. Promote the real market reading, separate personal comparison/watch/research work, remove the duplicate country list, and preserve `/api/portfolio-changes` and owner-storage write counts across responsive reflow. Do not conflate Today with Prophet's Today lane, invent market history, remount the comparison holder, weaken regional coverage or imply that source-complete candidates equal full Prophet parity.

## P5 implemented candidate — Today daily desk

[The full P5 packet](./P5_TODAY_DAILY_DESK.md) binds the newer 9 November Paper composition, three new owned desktop/phone refinements, existing data/reader owners, exact native destinations, proof and remaining gates. Code parent is owned PR1500 at `cff2126af4d9bf64e2b5beed49f73ffe33ab33fd`; the new candidate entrance is a genuine stack dependency. Existing private-reader holders and the US market boundary are unchanged.

The complete source-authored market assessment is now visible above the independent observations. A missing summary has its own message; source dates and unavailable breadth retain their meanings. The large duplicate launch banner is removed, the primary action reaches native Intelligence, the research rail reaches native Candidates and Sector Explore, and the second country list is removed. Macro Command, full US stock and risk depth remain reachable. The personal desk keeps exact comparison scope, risk dates, saved revision and text window.

Local focused qualification passed109 tests. It proves the settled comparison writes its accepted digest once and does not read/write again solely for a source disclosure, language change or responsive presentation change. Existing authenticated browser qualification now includes the corresponding Today journeys; changed-head hosted execution, screenshot readback and production proof remain owed. The prior local browser refusal was not retried. No legacy engine or full family is accepted/retired by this presentation slice.

The original release lanes remain independent: Macro11246 has one read-back `merge-on-green` opt-in, not a merge/deploy receipt. Macro11248's original CI pack2 exposed an originating deploy import-closure failure for newly imported `engine/us_candidate_lanes.py`; repair of that exact restart dependency is being diagnosed on its original carrier, with the check and release controller retained. Terminal1495/1500 keep their original exact-head CI observers and no release opt-in. CI/release waiting does not stop P6 source work.

Next safe source phase: P6 Discover, beginning with the existing Paper and source workbench entrances, canonical Sector/Catalysts links and preserved screener/heatmap/leader engines. No filter, data coverage or market universe is invented or silently replaced.

## P6A — Discover chooser and integration reassessment, 14 Nov

The first P6 slice implements the existing Paper chooser's next refinement:
compact questions, differentiated tool rows, a separate timing study and explicit
native candidate/theme entrances. BioCatalyst and the full US stock workspace
remain named depth destinations; Signal Board no longer implies transfer of the
current native screen. The existing engine, filter, URL, focus, market and
personal-state owners are retained. See [P6 source/acceptance packet](P6_DISCOVER_CHOOSER.md).
The21 affected chooser/focus tests, targeted lint and nonempty language guard
pass. New Paper board48N-0/48V-0/493-0 onp-8-0 were visually inspected and their
owned indicators released. Authenticated browser execution remains owed on the
published head; full P6 workbench and all-market acceptance are still open.

### Material receipts and current release boundaries

- PR1495's repaired head627b87e1 has an exact-tree browser receipt: run43576950807,
  artifact14107458273, ZIP SHA-256
  `85e8e7f15fe10cc17eec6c5140c48b5c5bb6c870a23e0c42e9f60b7d9bfbe0c2`.
  Tested merged24cc0b7 has parentsc67a68ee/627b87e1 and the same
  `6d448e71566fe4941a9742913e2f5f2fec165eaa` tree. All12 recorded cells pass,
  with no page errors, external requests, fixture writes or tracked source
  changes. Phone EN and desktop ZH Liquidity images were read back. This is
  fixture proof; deployed source, real account reads and production CSP remain.
- Macro11246 retains its single merge-on-green opt-in at80ca3040. Original
  full sweep43579102282 explicitly deferred its required proof refresh because
  no effective CI workload slots were available. A later green sweep without
  a per-PR verdict is not a merge. The existing controller owns refresh/merge;
  no duplicate rearm, manual refresh or additional observer is created.
- Macro11248's actual restart-closure failure is repaired at
  `ffd95ec212dbffb7144e87df995e9a063cc68d89`, tree
  `b65ea6e459c095e085d4076b2a3e58878289be5a`. Only the exact imported candidate
  module was added to the incumbent restart predicate. The unchanged closure
  test passed with all app/engine/lib Python dependencies materialized; Bash
  syntax passed. Both published files and the original branch were read back.
  Binding CI43580506806 is separate from release and served API acceptance.
- Terminal1500's sourcecff2126a passed15 recorded fixture-browser cells in
  artifact14107094187. Visual QA nevertheless found a one-character-wide ZH
  Inspect label at320px. Original carrier repair
  `dc8039571b40a0d0ce3765b92560f4cbf7d195d5` places the action in normal grid
  flow and adds label/target geometry proof. Exact remote source was read back;
  its CI43580992587 must qualify the repaired head.
- P5's original CI43579891771 found two stale reading-workspace expectations
  for the old Macro entrance. The two selectors now assert the intentional
  native overview, with all source-clock and qualification assertions retained;
  the full affected59-test suite passes. The P5 carrier composes the P4 visual
  fix without replacing its Today fixture or journey. Repaired-head hosted
  acceptance is still owed. The composed repair is published and read back at
  `6a83fb906b4ee2d449c333657f59775d34129b25`, tree
  `5bd6697cc25e9503637b0151b1644cb8519f5a4c`; P6 uses that parent.
- P5's original browser artifact `14109095060` passed all 18 cells in run
  `43579891771`. Test merge `9b3f36fcf1cad665ea92f67022e4299b035860e6`
  has original P4/P5 parents and the exact P5 tree `2ad386155b466c8f169cf42f49c79f8cd32b9284`.
  ZIP SHA-256 is `1eb44239254431eef69f5e87a3cac037bfa5ae91a102b990f8cb67676fb1b1b8`.
  Root read back desktop and phone images, including the separate summary-absence
  state. The report preserves reader identity, one accepted digest write and
  the exact saved report revision, with no report-body request or reported
  error/external request/fixture write/source change. This is fixture evidence
  for the original head; repaired-head, production CSP and served acceptance remain.

### Existing work to integrate, without duplicate owners

| Scope | Current carrier and disposition | Acceptance still owed |
|---|---|---|
| Full Macro Dashboard beyond selected Liquidity detail | PR1503 at6aba1efb is the active continuation; preserve its native overview/history/factor/release/health work | Companion Macro11253 now publishes source at2943a7ce and is enrolled in its existing controller; protected merge, produced/served artifact and immutable T → protected R → produced/served P → exact-R catalog → consumer proof remain |
| Native complete Prophet population | PR1500 + Macro11248 remain this plan's foundation | Repaired browser geometry, real complete payload size, served authenticated endpoint and protected release |
| Prophet observations, canonical save, comparison and setup refinements | Useful deltas in live PR1505 atca0b9229 | Reconcile its second candidate endpoint/decoder/read lifetime onto one owner before integration; preserve independent observation identity and personal-save receipts. Companion setup-detail source is now published in Macro11254 at38c45cd3; no served acceptance is inferred |
| Global tool directory/rail/mobile chrome and Market Reference | Live PR1501 atf58e7c47 | Existing writer's exact-head proof and compatible integration; P6 does not reproduce these surfaces |
| Company Analysis and chart integration | Live PR1494, currently664e7011 | Its existing owner/proof path; do not recreate its bodies |

PR1505 and1500 have six candidate-related changed-file collisions. A mechanically
clean merge would not resolve the duplicate consumer. Preserve the live source,
compose useful research deltas explicitly and retain one transport, accepted
population, account lifetime and URL owner. Neither branch is overwritten or
released as a consequence of this inventory. PR1503's query-free macroDashboard
resource must compose additively with the existing selected Liquidity query and
candidate resources in readingProxy; no older baseline may erase them.

The next safe lane is the existing P7 Catalyst/Defense evidence journey, starting
with source/custody and Paper inspection. Full engine migration, regional
coverage, production proofs and retirement remain governed by the original
P0–P17 DONE_WHEN. Pending CI and release capacity block their affected lanes,
not this parent construction mission.

## P7A milestone — native Catalyst evidence and repaired-stack receipts

The earlier next-action paragraph has now been acted on. The bounded source,
Paper, implementation and state packet is [P7_CATALYST_EVIDENCE.md](P7_CATALYST_EVIDENCE.md).
The native watch list and selected evidence are composed as one desk. Event,
economics and entry evidence remain honest unavailable states. Continuations
follow actual case links; the independent Defense reader and active Bio work
retain their owners. Existing Paper LK-0/QE-0 was inspected and additive
p-9-0 boards2L9-0/2LQ-0/2M6-0 were created, visually verified and released.
Local affected qualification is75 passing tests plus targeted lint, nonempty
language guard and syntax/diff checks. Hosted and real served acceptance remain.

### Stack proof read back at this milestone

- P0–P3 PR1495 remains at `627b87e1f0655cdf60999daa99ddf8c797627449`.
  Its run43576950807 concluded successfully with43 successful check runs.
  This does not remove its explicit Macro11246 protected merge/deploy and
  served selected-resource dependency. Macro11246 was enrolled once and remains
  with its existing controller; capacity deferral is not a reason to rearm it.
- Repaired P4 PR1500 at `dc8039571b40a0d0ce3765b92560f4cbf7d195d5`
  has authenticated artifact14109530457 from run43580992587. The downloaded
  ZIP SHA-256 is `eca44d0365973ae9c44199144beae7c5104ae996218b4fb72ed1f828ff59ae55`.
  Report source merge `c7380c5a18809483b11b3c76378040b2387bb8b5` has that
  exact candidate head as a parent and tree
  `0cc7db97d12c99e16a6374a0c627f0d58fb0ae0b`, equal to the repaired head.
  All15 cells pass with no reported errors, external requests, fixture writes
  or tracked working changes. The320/390px Chinese screenshots were viewed;
  the390px Inspect label is readable in normal flow, and the320px journey checks
  its off-screen action's geometry. This is fixture-browser evidence, not whole
  CI completion, deployment or production CSP acceptance.
- Repaired P5 PR1504 remains at `6a83fb906b4ee2d449c333657f59775d34129b25`.
  Original-head18-cell fixture proof and its exact repaired source readback are
  preserved above; repaired-head hosted acceptance is still tracked separately.
- P6 PR1508 is published at `2ad0e7fa8bc802b0d0f8322ec88c5dc9c5603d51`,
  tree `772f675ed00b41b1ea7adf390d50524862b1d899`. The Ready PR, body,
  branch and all seven changed files were read back exactly. It is the P7 input;
  its incumbent run43582423756 owns hosted qualification.
- The latest finite custody inventory has global chrome PR1501 at
  `75314215839ab3821fcbafcf5a31e3d9efd34acd` and Analysis PR1494 at
  `664e701121ddfea1c93ce44a82304f4e42531b84`. These update the earlier
  historical inventory without adopting or overwriting either live carrier.

Next safe independent work is P9 Monitor source/custody and existing Paper
inspection. P6 dense engines and specialty P7 depth remain open; P8 integration
waits on its actual owner's compatible proof. Pending PRs block only their
release lanes. Complete regional engines, full Macro/Prophet parity, real
production journeys and safe retirement are still required by the parent plan.

## P9A milestone — Monitor composition and precise evidence return

The prior P9 next action has been executed. The complete bounded packet is
[P9_MONITOR_EVIDENCE_DESK.md](P9_MONITOR_EVIDENCE_DESK.md). Owned lists now lead
one native evidence workflow, followed by the saved-alert inventory. The exact
list-read/membership return binding, market-aware native destinations and
single-column phone reading order retain the original private owners. Alert
enablement is distinguished from evaluation; failures do not display a false
zero. No updates feed, list editor, evaluator or Company transport was created.

Paper's existing Monitor and account-service states were inspected. Additive
page p-9-0 in file01M6Y2GT8S3YP4TK052PPESZEC contains verified/released boards
4EQ-0/4H3-0/4JG-0/4LB-0, covering desktop, 320px EN, 390px ZH partial failure
and 820px refreshed-membership states. The local 81-test owner/composition
qualification passed; the 54 tests in the two edited suites passed again after
their original specimens were extracted for shared browser use. Full typecheck,
scoped lint, nonempty language guard and qualifier syntax/diff checks passed.
The incumbent hosted qualifier now includes Monitor at1440/820/320px. Exact-head
browser and real production/account acceptance remain separate outstanding work.

### Source and proof advances retained in this composition

- P7 PR1510 is published/read back at
  `57e1abf3ab55887f097da1c6800c1bf3da3fa6db`, tree
  `6275feeb6ba7e897fb12d42c27a194c6d91aba12`, with all eight changed files,
  branch and Ready PR body verified. It is the first P9 parent. Its browser
  results and protected release are not inferred from publication.
- P5's repaired6a83fb90 head has authenticated artifact14109093824 from
  run43582239344/serial job132409703014. ZIP SHA-256:
  `2a63c837cd12fd79dea2151f6b6acc25067b909230c3b931bc821595649f88e3`.
  Report merge `ade4d74ad07d37180097be502e490bc4708497c2` includes that
  candidate parent and exact tree `5bd6697cc25e9503637b0151b1644cb8519f5a4c`.
  All18 cells passed; reported errors, external requests, fixture writes and
  tracked changes were empty. Root viewed320px light and1440px dark images.
  Reader identity, one accepted digest and exact saved revision/segment7 were
  retained without a report-body request. This remains fixture-browser proof.
- That same P5 run's unit shard1 found only the inherited50,000-user cache test
  exceeding its5-second budget (5,331ms), with7,789 other tests passing and40
  skipped. The identical test passed on P6's shard; the runner cause is unproven.
  The original P5 carrier now has `bb0e95d9d67910fa5c7ee060fad0f2016fe94032`,
  tree `f9a1c47b6300914811ee3c1691f9e6b5b47f5690`: a single15-second test
  budget, unchanged50,000-user/5,000-entry assertions, and documented evidence.
  The full affected12-test file passed. Both files/branch/PR were read back.
  This is P9's additional parent; new-head binding CI remains owed. P6/P7 were
  not pushed merely to inherit the repair, and older artifacts are not relabelled.
- P6 PR1508 remains at `2ad0e7fa8bc802b0d0f8322ec88c5dc9c5603d51`. Its
  finite CI43582423756 inventory had all unit shards/typecheck/build passing
  while browser lanes still ran; no completion or artifact was inferred.
- The P9 custody inventory preserves active News1210, Alerts662, Terminal
  watchlist639, retained Company1312, chart navigation1509, chrome1501 and
  Analysis1494. Their observed heads and held effects are recorded in the packet.

Next safe work is P10 Research entry/library composition, beginning with the
existing source/reader and Paper inventory. Active retained-page selection and
public editorial archive work must keep their original owners. P6 deep engine
work, P7 specialty depth, P8 integration, regional engines, full Macro/Prophet
parity, deployed journeys and safe retirement all remain in the original parent
DONE_WHEN. Existing release controllers are observed and repaired within their
own carriers; a pending PR does not stop this construction mission.

## P10A milestone — exact Research continuity and qualified release receipts

The bounded implementation is [P10_RESEARCH_CONTINUITY.md](P10_RESEARCH_CONTINUITY.md).
Market-only navigation and equivalent query ordering now retain the selected
research revision, passage evidence, reader DOM and browser progress. A request
accepted after a market switch uses the then-current context. Actual revision
or segment changes still read; duplicate pins remain invalid. Clear filters keeps
the submitted search/order and restores useful loaded results with heading focus.
Existing source-page and editorial designs are retained. All76 targeted tests,
full typecheck, scoped lint, nonempty language guard and syntax/diff checks pass.
The same hosted qualifier now includes a1440/820/320px Research journey; its
published-head result and real production acceptance remain outstanding.

The exact Research Paper read was unavailable. One supported same-carrier
prepare of file01M2WGNCX9475G79JRKJTCM08P returned
PAPER_DOCUMENT_TRANSITION_UNCONFIRMED with retry_allowed=false. No design
mutation occurred. Do not replay through another file/tool or claim a new Paper
composition. This correctness slice uses the accepted historical library/reader
captures; larger entry/resume composition awaits an available intended document.
That boundary does not block source diagnosis or other already designed work.

### Exact receipts retained in this composition

- P7 PR1510 head `57e1abf3ab55887f097da1c6800c1bf3da3fa6db` has verified
  artifact14110053623 from run43584849198. ZIP SHA-256
  `f2fca93edb19b249fd6551655d681a72a1bf1cfede18832df50c95fae8d1c121`.
  Report checkout `69b90a40b23e9c8ce157a6a34977c42e4dbeca64` has the
  candidate parent and exact tree `6275feeb6ba7e897fb12d42c27a194c6d91aba12`.
  All24 cells passed; errors, external requests, fixture writes and tracked
  changes were empty. Root viewed Catalyst1440px EN, Catalyst320px ZH and
  Discover320px EN captures. This is fixture-browser proof, not protected
  release or live-source acceptance.
- P6 PR1508's original2ad0e7fa artifact14110290244 failed at the existing
  Discover hydration boundary. The original carrier was repaired and fully
  read back at `ce55946034d4060919926c790efe98f4f036569a`, tree
  `9a6097462b30fe8727e49e40817412acc14c12a4`. Wait for the Search button's
  actual enabled state before focus; all assertions/time budgets remain.
  That commit is this composition's additional parent. Its historical failed
  artifact is not relabelled, and new-head hosted proof remains owed.
- P9 PR1512 was published/read back at
  `06f372502e7a81bc916b7bee494456b88a9f823c`, tree
  `c0d6b43bac057e309f598ce87c2ad48baa93893e`. Artifact14111447502 from
  run43587343813 has ZIP SHA-256
  `e2ecf722e51a108afe98426a83d019662f18c04763cd1e0bb5d95f5b353a58f8`.
  Its report checkout `7774ce968dd0949627fc4d29357735e3514f90ae` has the
  exact candidate tree, but **failed at Discover1440px before Monitor** after
  ten completed cells. A distinct serial-standalone job success was not the
  qualifier's verdict. No Monitor browser pass is claimed.
  The same diagnosed readiness fix was applied on P9's original carrier and
  both files/PR head were read back at
  `8317d537882ad95fc2def4b17e64c2448e2be160`, tree
  `5c050a4b02a8e5843ab55f2a91def405f20efdd1`. It is this composition's
  first parent. P9's new hosted Monitor proof remains owed.
- P5 PR1504 remains `bb0e95d9d67910fa5c7ee060fad0f2016fe94032`. Its
  cache-test repair passed shard1. In run43585154012, unchanged
  genFundamentalScan.test.ts:133 exceeded5s at7,270ms in shard2
  (8,456 passed,4 skipped); there was no reported assertion mismatch.
  The same20-test file passed in62ms on the prior P5 run with identical
  test/script/producer/parser/fixture blobs. Real fsync/atomic-publish contracts
  remain unchanged. Scheduling/IO delay is a hypothesis, not proved cause.
  The latest finite run read was still in progress at attempt1; no rerun,
  assertion weakening, timeout change or success substitution occurred.
  Reconcile the original completed run before considering one failed-job retry.
- Macro11248 head `ffd95ec212dbffb7144e87df995e9a063cc68d89` passed
  all scheduled packs, ci-gate, fence and active main authority in
  run43580506806. The existing controller classifies the inactive pilot
  authority as nonbinding for main. Compatible exact-head/readiness/hold checks
  and a concrete refreshed PR body were read back, then **one additive
  merge-on-green opt-in** was accepted and read back. It remains open/unmerged,
  with no native auto-merge. Preserve the incumbent controller; opt-in is not
  deployment or served candidate proof. Macro11246 retains its prior single
  opt-in and original controller/capacity boundary, with no duplicate enrollment.

### Integration and next action

P10 does not adopt held1312 or public-report1507 source. The packet records the
precise future1312 join: loaded-window start versus selected-passage position,
context-preserving history publication before observation, preserved evidence
and position, and a joined second-passage/market/Back/Forward proof. News,
Investigation, Market Memory and Options memory remain distinct owners.

Continue P11 Portfolio from accepted holding/population contracts and actual
active-writer custody. Keep P6 deep discovery engines, specialty Catalyst depth,
Analysis integration, regional engines, full Macro/Prophet parity, deployed
journeys and retirement in the parent acceptance. No phase or queued PR closes
the mission; CI/release boundaries affect only their dependent lanes.

## P11A — Portfolio research context, 2026-11-14

The [Portfolio continuity packet](./P11_PORTFOLIO_CONTEXT.md) records the complete
source/design/custody binding, changed behavior, fixture contract and remaining
production proof. This candidate is based on P10 PR1513,
`b71c0f9fa8be8c33dab72aaf5704b73fc19e867c`, whose eight files, commit/tree,
parents, branch and Ready PR were fully read back. P10 is published, not accepted
in production; its current run43589674862 remains in progress.

Only same-page Portfolio market changes use the existing native-history path and
location event. The selected market changes research context without replacing
the server seed for the account-owned book. Strict parsing prevents duplicate
history for an identical valid market while preserving repair of ambiguous query
fields. Other engine routes retain router navigation. EN/ZH accessible copy
explains holdings/currency scope without adding a new layout or Portfolio owner.

Active Portfolio1502 and1506 retain their held allocation/import/controller
work; source-bound brief1216/Macro10551 and EventImpact804 remain separately
owned. No held effect or competing financial state is adopted. The exact Paper
transition from P10 remains unconfirmed and retry-disabled. This slice uses the
accepted native Portfolio design and does not claim a new Paper composition.

All28 targeted selector/market-boundary/helper tests pass; full TypeScript,
scoped lint and script checks pass. The original six-record responsive fixture
is shared with the existing authenticated qualifier. The new journey checks
the real canonical fixture store at1440/820/320px: market and history changes,
exact duplicated-ticker record, retained query/non-default filter, modal focus,
current chart return links, book identity and zero context-triggered writes or
book/RSC navigation. Hosted execution and actual-account production proof are
still owed. Optional evidence remains explicitly unavailable in this fixture.

### Earlier lanes reconciled during P11

- P5 PR1504 remains `bb0e95d9d67910fa5c7ee060fad0f2016fe94032`.
  After the original run completed, one failed-job retry was accepted for
  job132418198212. Run43585154012 now reports attempt2 completed success.
  No source/timeout/assertion weakening and no second retry occurred. Root
  verified browser artifact14110428865:18 cells passed,41 recorded source hashes
  matched, exact candidate tree, no errors/external requests/fixture writes or
  tracked changes. Root viewed the Today1440px reading capture. All exact
  artifact/checkout/ZIP hashes are in the P11 packet. This supersedes the earlier
  pending-run observation without erasing the original failure.
- P6 repaired PR1508 `ce55946034d4060919926c790efe98f4f036569a` has
 21 passing browser cells in artifact14111396937 from run43587853302. Its tested
  merge includes the existing P5 doc/test repair; all45 qualifier source hashes
  match P6. The report records one unrelated ticker-news screenshot change, so
  it is not described as a clean working tree. Root viewed phone EN and desktop
  ZH Discover captures. Full binding CI/deep-engine parity/release remain open.
- P9 repaired run43589237107 is in progress. The finite artifact inventory did
  not yet contain an intelligence qualifier result; serial-standalone results
  are not substituted for it. New-head Monitor proof remains owed.
- Macro11246 and11248 remain singly enrolled with their original release
  controller. Sweep43589602483/job132431315778 explicitly deferred both refreshes
  after relevant main changes because the hosted CI pool had no admitted slot.
  No update-branch write occurred. Do not bypass that capacity decision through
  caller merge-main, a new watcher, another opt-in or direct merge.

### Parent reassessment

P11's context repair is a bounded step, not completion of Portfolio's held
imports/allocation/source-bound brief or of the beta shell. Next safe work is
P12's existing Options→Terminal→Options consumer path, after verifying active
Options1266/navigation1509/Analysis1494 custody. Retain all original P0–P17
acceptance, missing Paper compositions, full native engine parity, market-specific
coverage, production/browser evidence and duplicate/iframe retirement gates.

The P12 custody read additionally binds held Options1248 at
`1b2d4da5e784063c7c0c2b1a1c8f9394b1c0c0b2`, Draft/merge-blocked. Root
read comment6767578188: the original native evidence-tree effect remains
TREE_EFFECT_UNKNOWN_NO_REPLAY, expected4140c0b7f69b24d068023e5cc6bbc0ef6975fa85,
with a separate GMI EPERM hold. No retry, target query through a replacement
carrier, prepared-source adoption or competing Options rewrite was attempted.
Keep that lane fenced while diagnosing the next path-disjoint consumer.

## Monitor market-commit repair across the owned stack

P11 is published/read back at Ready PR1516, original head
`3bb22d3577eacb1b074ac047b3f95728208a833d`. The next finite artifact reads
found the same genuine Monitor failure in P9 run43589237107/artifact14112546230
and P10 run43589674862/artifact14111344676:12 completed cells, then expected
Canada destination context but observed China. Neither report reaches Research
or Portfolio. Exact candidate-tree, archive/report hashes and the source-bound
cause are preserved in [P9](P9_MONITOR_EVIDENCE_DESK.md#committed-market-navigation-repair--14-november).

Original P9 PR1512 is repaired at
`37bf903cd7fbba20dc46b819dcbcc9a91a12d7ff`, tree
`dc9f44afe91b85ac016de2ad7aea038fe7c70644`; original P10 PR1513 composes it
at `b80e58a2b254ed49eb9e573c1131cf09e13e18af`, tree
`8bf8905ea89edfb581272a9623c2a693c7e1b2da`. All changed contents, trees,
parentage, branch heads and PR bodies were read back. The new regression fails
on the preimage and passes with committed-layout URL reflection. It retains
exact return encoding/hash, list/evidence identity and the two inventory reads.
Affected P9 suites pass101 cases; combined Monitor/Research suites pass107.
Full P9 TypeScript, scoped lint, syntax, nonempty-diff language and whitespace
checks pass. The qualifier still requires all immutable pins and unchanged reads;
it waits for real consumer destinations without a synthetic refresh or sleep.

Compose that same repair through this P11 carrier, preserving the existing
Portfolio source/read and fixture contracts. Continue P12's bounded IEX/Futures
navigation work while new binding hosted results are pending. No protected
release, production acceptance, Paper recovery or parent completion is claimed.

## P12A — Equity replay and exact chart return

[The P12A packet](P12_EQUITY_REPLAY_CONTEXT.md) records the bounded next native
consumer repair. `/options/equity-replay` previously rejected the market context
added by the shell, discarded context/hash on instrument choice, retained a stale
local symbol on traversal, and opened an unspecified chart. It now shares one
strict page/client query decoder, follows the URL's accepted symbol, preserves
market-only source/control continuity, and retires old data before a restored
instrument's new read. Price chart carries the actual equity and exact return;
the incumbent validated return owner names Equity depth replay in EN/ZH.

This builds on read-back P11 PR1516
`a310840a858fab271a429b40065913f40cb46fb2`, tree
`8ca88896cbe77154a3215a6708682eb7df6e669b`. Combined Monitor/Portfolio
mounted checks pass41. The P9/P10 failed browser receipts and their original
repairs stay canonical; new hosted results remain owed. P12's final affected
unit run passes66, including pending-symbol/denied-restoration and exact return
boundaries. Existing API, source math and share units remain unchanged.

The exact seven-file custody comparison preserves held Options1248. Current
navigation1509 `65f020dedc3a35e1265e82276cb0ff8d3aaff7a1` changes no IEX
consumer or return-label file. Its qualifier appearance/nav changes have an
explicit future three-way composition seam; P12 only appends an IEX journey to
the existing owner. Hosted proof must click the real chart, verify its rendered
QQQ subject, and return to the exact context-bearing URL at responsive widths.
No new runner, authority, workflow or Paper transition is introduced.

Next safe P12B work is Futures context admission and navigation. Its page,
control URL writer and history handler all need the same page-only adapter;
the strict API parser and account/request polling key must stay unchanged.
Enable reciprocal IEX/Futures context links only after that seam is repaired.
The full Options suite, all remaining P0–P17 scope and deployed acceptance remain
open. No duplicate engine or legacy route is archived on fixture evidence.
