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
