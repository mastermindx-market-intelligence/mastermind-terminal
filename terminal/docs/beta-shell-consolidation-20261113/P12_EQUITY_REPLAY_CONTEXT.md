# P12A — Equity replay, research context and exact chart return

## Product outcome and boundary

The native equity-depth replay can be entered from a market-scoped beta shell.
Its instrument chooser preserves that context and the fragment. Browser history
restores the URL's instrument rather than a stale local selection. A change of
research market retains the accepted archive, observation cursor, execution view
and price window without another source read. A change of instrument withdraws
the old archive immediately, including a return to a previously accepted symbol
while an intervening request is still pending.

Price chart now opens the replay's actual equity and carries the exact return
address through the incumbent Terminal return owner. That owner names this
destination **Equity depth replay** in English and Chinese. Related workspace
links wrap on narrow screens and have 44px keyboard/touch targets. An unavailable
IEX depth archive does not remove the independent ordinary price-chart action.
The page continues to identify IEX, historical observations and share units.

This is a bounded P12 navigation and state-continuity slice. It does not migrate
the held Options suite, change a trading engine, introduce consolidated depth,
activate a feed, infer a Futures contract from an equity, or claim live source
availability. A research-market selection accompanies the chosen instrument;
it does not relabel an IEX archive as Canadian, Chinese or Hong Kong data.

## Source, authority and custody

Law pin: Mastermind `8323d7a774a72da20d0e4db21c9080398da185e7`.
Protected Terminal input: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
Authoring parent: P11 PR1516 `a310840a858fab271a429b40065913f40cb46fb2`,
tree `8ca88896cbe77154a3215a6708682eb7df6e669b`. All seven composed files,
tree, ordered parents, branch head and PR body were read back. This retains
the original Monitor navigation repair through P10, including failed original
browser receipts. P11's Portfolio product source remains unchanged.

The original IEX implementation is merged PR1039; the page's current access
classification includes the merged PR1208 correction. The following exact
preimages match protected source, P11, held Options1248's public source and its
known prepared source `e1cfd3f02f71796ce8014ba13722b4f76be0b8f2`:

| File under terminal/ | Original blob |
|---|---|
| app/(shell)/options/equity-replay/page.tsx | `d0a00f166e6221ec04076abeda2f33523bf13e81` |
| components/futures/IexDepthReplayView.tsx | `8bdf3fa5268f2fd6f4e028ff663ca4cd8ad3981f` |
| lib/__tests__/iexDepthPage.test.tsx | `a4b11f64fa0968f1870875224dc3b312fa445eb4` |
| e2e/iex-depth-replay.spec.ts | `fdd08c589a4b03ae62bff9f26b914272502c7743` |
| components/futures/futuresLab.module.css | `11a5f7e701c06e645a49090ef7cc2808628d3a71` |
| lib/originNav.ts | `7484e1894b9282045a5bfec8e3d24846e40c0a61` |
| components/DashboardBackButton.tsx | `16d24c95b94196de33e4cfc2c49f629d10ede280` |

The first four file comparisons and the last three known prepared-source reads
were independently verified by the principal. They establish source equality
for this narrow change, not clearance of held Options1248's unknown effect.
Its public head stays `1b2d4da5e784063c7c0c2b1a1c8f9394b1c0c0b2`, Draft and
merge-blocked. `TREE_EFFECT_UNKNOWN_NO_REPLAY`, expected tree
`4140c0b7f69b24d068023e5cc6bbc0ef6975fa85`, and the separate GMI EPERM hold
remain fenced. No unknown target query, replay, alternate carrier or prepared
source adoption occurred. Its public file inventory is capped at 3,000, so
absence from that inventory is not used as proof.

Relevant complete inventories retain Options1266
`46782b0f767aae8400e320d9c57b85dbf16738e8` (1,055 files), Analysis1494
`86c3df50097fdf028bdefcf5b37a6f49dec7e077` (96), chrome1501
`98f6080a65201af635db2dae689e56d6095fcdf7` (37), and companion1514
`f77799f69ff227ad3d241cfa3f2c12de554e49d1` (15). Their held/active work is
not adopted. Navigation1509 advanced to
`65f020dedc3a35e1265e82276cb0ff8d3aaff7a1` (52 complete files). It does
not change the IEX/Futures paths or the two return-label files above. Its
TerminalShell, shared copy and Analysis-specific chart episode propagation stay
with that owner; this slice only names an exact destination through the existing
validated return resolver and existing button.

### Shared qualifier compatibility

The immutable 1509 qualifier `a688c952505b57e86ed18504db70ef10f2ce1d85`
contains an older integration base. Its owned changes are appearance helpers,
the Discover guide entrance, and navigation expectations in existing Sector,
Cycle, Liquidity and Overview journeys. Those product-dependent changes are
not applied prematurely here. This carrier preserves all P0–P11 journeys and
adds a uniquely named IEX journey, original fixture import/source hashes and a
sequential call after Portfolio in the existing width loop. No fixture authority,
server, runner, workflow, cleanup owner or watcher is added.

At the eventual three-way integration, retain both owners' additive coverage.
Do not replace the whole qualifier with the shorter 1509 version. Adapt affected
appearance controls to its product without reloading away same-mount continuity
assertions. The current ordinary IEX/Futures responsive configurations do not
enable the beta shell; they cannot substitute for this member-mode journey.

## Implementation decisions

| Boundary | Behavior |
|---|---|
| Page admission | Preserve verified denial, authentication verification and authority-unavailable states before query handling |
| Query selection | One shared page/client decoder admits absent or one valid workspaceMarket plus one exact uppercase symbol; rejects unknown keys, repeats and invalid/empty context |
| Default symbol | An absent symbol means the established NVDA default; a stale initial prop cannot become a fallback for a changed or invalid URL |
| URL ownership | Read accepted selection from Next's current query; chooser replaces only symbol in the live URL and retains context/hash through the existing History API integration |
| Source ownership | Existing account + instrument + explicit refresh binding, fetchLargeTrades client and strict IEX parser remain the sole read path; market context is excluded |
| Source transitions | Clear accepted archive and cursor before a changed/restored source can paint; obsolete requests retain the original abort guard |
| Chart launch | Use the actual selected symbol; beta launch requires reflected browser URL and current route/query to agree before exposing the return-bearing link |
| Ordinary Terminal | Keep a symbol-specific ordinary chart link without inventing beta return state |
| Return naming | Exact /options/equity-replay mapping only after safeMacroHref accepts the destination; no origin, credential, terminal-loop or redirect-policy expansion |
| Local controls | Cursor/mode/window survive a market-only change; the chart's hard-navigation return promises URL symbol, market and hash, not restoration of those local controls |

The counterpart `/options/futures` still rejects workspaceMarket on the
protected source. The IEX-to-Futures link therefore stays undecorated in this
slice. P12B must repair its page/navigation adapter before enabling reciprocal
context links. It must not relax the shared API parser or silently discard
invalid source fields.

## Design and Paper status

The existing native depth/execution composition, source limitations and shared
chart primitives remain. The additive related-workspace navigation uses the
existing module's typography, focus treatment and layout; only its link group
gains wrapping and minimum target size. This is not a newly invented Options
design or an assertion that the entire suite has achieved Paper parity.

The earlier exact Paper read and same-carrier document transition remain
unconfirmed with retry_allowed=false. No further Paper invocation, alternate
file transition or mutation was attempted. Complete missing Paper compositions
and visual refinement remain in the parent plan after that original transition
can be safely reconciled. Existing accepted visual work is not discarded.

## Verification and consumer proof

The original page/navigation regression run had17 failures and15 passes. After
implementation and the pending-source restoration correction,47 cases passed.
The final affected run passes66 cases across IEX page, mounted navigation,
source/parser math, validated chart handoff and existing return recovery suites.
It includes valid five-market context, invalid/duplicate query refusal, source
withdrawal, market-only read/cursor retention, restored-symbol selection, and
SPY → pending QQQ → restored SPY with a denied replacement read. A late obsolete
QQQ completion cannot restore or replace the selected source.

Full TypeScript, scoped ESLint, qualifier syntax and whitespace checks pass.
The language guard reads the actual nonempty21,512-byte changed-source diff
and reports zero blocking findings. Browser source holds are tied to the actual
Back action. The existing mm_e2e_rs30 and unique mm_e2e_wl fixture opt-ins align
the shell and Terminal on one synthetic account; no authentication source is
changed. These fixture identities do not establish production account access.

The existing ordinary IEX browser spec gains context-bearing entry and actual
chooser coverage. The incumbent authenticated beta qualifier adds1440/820/320px
journeys, with desktop English and phone Chinese. It exercises the real market
selector, retains the source DOM and observation controls without an IEX reread,
holds the obsolete symbol request, traverses Back to a separately held source
read, verifies withdrawal and refusal, then goes Forward. It clicks QQQ Price
chart, requires the real visible QQQ price tag and absence of an empty-chart
overlay, then uses the named incumbent return control to restore the exact URL.
Original synthetic IEX and committed QQQ price files are separately hash-bound.

Those new browser journeys have not yet produced a hosted receipt. The local
Chromium permission refusal remains fenced; no alternate local launch occurred.
Unit/static results are not browser or production proof. Actual entitlement,
published archive freshness, full-day/consolidated coverage, production CSP,
real account behavior and protected deployment remain outside fixture evidence.

## Next authorized work

Finish publication/readback and reconcile the existing hosted proof. Continue
P12B's bounded Futures page/navigation seam using its original parser and source
owner, then reciprocal tool links. Preserve active full Options, Analysis and
navigation carriers. P6 engine depth, P7 specialty depth, P8 integration, all
regional engine coverage, remaining page families, native Macro/Prophet parity
and safe duplicate/iframe retirement still belong to the original DONE_WHEN.

## Inherited Research request-fixture repair — 14 November

Compose corrected original P11 head `c3379c7736571f89ab2270e18bd1a346c7be9e34`
(tree `c6e52a10eb4b4ab1044afecac3e409a3819fd194`) as an additional parent.
The exact prior P10/P11 receipts stop at Research's third passage because the
fixture expects two query fields the real API rejects. The correction and
145-case local contract/reader verification are documented in
[P10](P10_RESEARCH_CONTINUITY.md#pinned-research-request-fixture-repair--14-november).
IEX product code, original source fixture, symbol/chart-return assertions and
P12A's prior66 local tests are unchanged. No denial or held Options carrier is
adopted; no local browser or hosted rerun is started.

At the finite milestone read, old P12A head
`f7fbcc9133bed5cd371ba178a3fb9a58c20485c6` had run43594757773 in progress,
without an intelligence artifact yet. No browser result is inferred from that
state. New-head hosted consumer proof remains required.
