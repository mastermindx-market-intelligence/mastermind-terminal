# P11A — Portfolio continuity across research markets

Date: 2026-11-14. Assigned owner: ChatGPT2. Status: implemented candidate;
hosted browser qualification, joined Portfolio releases and production acceptance
remain open. Parent scope remains the complete [beta shell plan](./PLAN.md).

## User outcome

The top market selector changes the research context while the user's Portfolio
keeps its actual book. Holdings, record filters, the selected record and recorded
currencies retain their existing owners. Chart links carry the current Portfolio
return address. This slice preserves the accepted Portfolio layout.

The existing selector used router navigation for a market-only Portfolio URL
change. Source inspection found that a new server seed is a reset boundary in
`PortfolioView`: optional analysis is withdrawn and the canonical read restarts.
The bounded repair uses native history only when both the live source and
destination are `/portfolio`. Other routes retain their existing router behavior.
This source diagnosis is not, by itself, a deployed reproduction or browser pass.

## Source and design binding

Mastermind law remains `8323d7a774a72da20d0e4db21c9080398da185e7`.
Protected Terminal inspection remains
`c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`. The implementation parent is
P10 PR1513 at `b71c0f9fa8be8c33dab72aaf5704b73fc19e867c`, tree
`89a8e218fa7694e8477f176d21d9820ffa120096`; its files, commit parents,
branch and Ready PR were read back. P10's hosted and production proof remain due.

| Existing owner | Protected source blob |
|---|---|
| Portfolio server page | `4cd0e187505443acd5f1daf6787cb30d0c2f85d4` |
| PortfolioView | `e5f8abbb848dc5a60c2d58f6b8a3c1ffe7b59ef6` |
| PortfolioWorkspace | `4d02aeab47c6d49f013d67e68aafe31609858d59` |
| Portfolio API | `e65e4b0e2a08c2cc4cf146cca7f9620ec0c7ab8f` |
| Portfolio snapshot service | `531eb68e761049097cef6f6bcd69aef4d2c7aec3` |
| PortfolioSectorContext | `644664f9819a70ae18aceebee199c6b469568d8f` |

The accepted native design is Paper file `01M2WGNCX9475G79JRKJTCM08P`,
page `p-1O-0`, as recorded in `PORTFOLIO_IMPLEMENTATION_AND_RESEARCH.md`.
Root inspected `design_refs/portfolio_personal_desk_paper_20261018.jpg`;
the existing desktop/tablet/phone EN/ZH captures remain the layout reference.
Overview, Holdings, Risk, Targets and the record inspector already have accepted
composition. The Research artboard is a future preview, not implemented parity.

The exact Research-file Paper transition from P10 remains unconfirmed with
`retry_allowed=false`. No new Paper call, transition retry or design mutation was
made in this slice. It does not claim a new live Paper composition.

## Existing work and integration obligations

The original PR file inventories were read in full before editing. No product
Portfolio controller, API, editor, position import or money calculation changes
are included here.

| Carrier | Observed head and state | Integration obligation |
|---|---|---|
| Terminal1502 | `0ed9642368263859fbda39816b1e0dc02e55d832`; Ready, merge-on-green and merge-blocked | Preserve allocation, editor, quote/currency and sample/empty work. Its Portfolio controller and CSS remain owned. |
| Terminal1506 | `03c11d93e4568c69844c7e8abb71f35b7f837c54`; Ready, merge-on-green and merge-blocked | Preserve brokerage import, execution timestamps and migration0054. Reconcile its overlap with1502 through those carriers. |
| Terminal1216 | `09f2f30edcedb001a1e5a08a2d4c875ef0316bd5`; Draft | Source-bound Portfolio brief and held Macro10551 remain separate. The protected brief only receives position kind/count; no exact-book brief binding is claimed. |
| Terminal1352 | `4894d61af59ad18cc2663f917c93e628f471105b`; Ready, merge-blocked | Preserve navigation recovery; no second retry/reload system. |
| Terminal1339 | `7ded5375caf0aa595ca740bf0df36b175471192e` | Its PortfolioSectorContext blob already equals protected source. Do not redo accepted context work. |
| Terminal804 | `27df56d997df0ae94a17b6b8e2d14867431bb394`; Draft, held | Preserve EventImpactPanel changes and hold. |
| Terminal1501/1509 | Live shell work | Do not overwrite sharedShellCopy or shared-shell-refinement.spec. The common qualifier receives only the owned Portfolio function, input hashes and invocation; reconcile those additions when joining1509. |

Neither1502 nor1506 changes `e2e/portfolio-workspace.spec.ts`; its original
manifest and six record examples are extracted unchanged to one shared fixture.
The record inspector's bare company-analysis link still needs a context-preserving
join in the live Portfolio carrier. Do not solve that overlap through a global
company-link rewrite. Existing sector-return snapshots remain URL-owned.

## Implementation decisions

1. Read the live browser address at interaction time. A stale rendered Portfolio
   pathname cannot apply the history shortcut after a real route change.
2. Use the existing strict `workspaceMarket` parser for a Portfolio no-op. One
   valid current market creates no duplicate entry. Conflicting or identical
   duplicate fields remain invalid and can be repaired by an explicit selection.
   Do not apply this guard globally: `/china.html?workspaceMarket=us` still owes
   a real engine-route correction to `/macro.html`.
3. Pass a fresh `{}` to native `history.pushState`. Installed Next16.4.6 copies
   its internal tree and synchronizes URL hooks for that external call; supplying
   copied `__NA` or `_N` markers would skip its external-update path. Do not clone
   the source entry's shell-search marker.
4. Dispatch the existing `mmx:shell-location` notification after the URL changes.
   Portfolio's current external-store subscribers then update chart return links.
   No synthetic popstate event, market-keyed remount or new state store is added.
5. Add a scoped EN/ZH accessible description and native select title. The copy
   explains that the Portfolio retains holdings and recorded currencies. This is
   programmatic/desktop-hover clarification; hidden text and a native title do
   not establish visible comprehension on touch devices. No banner is added.

Next's documented native-history support is consistent with the inspected
installed implementation: [Linking and navigating — native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api).
The bounded browser proof below is still required. This repair makes no claim
that arbitrary future Back/Forward traversals never fetch server data.

## Qualification

The initial selector tests failed four cases on the old behavior. The first
repair exposed the reordered-query duplicate history entry; the strict semantic
guard fixes it. All 28 focused tests now pass across the real selector, existing
market boundary and market-route helper. They cover fresh history state,
location notification ordering, identical selection, ambiguous identical and
conflicting fields, stale rendered path, regional route correction and EN/ZH
description association. Full TypeScript checking passed with a 6 GiB heap;
scoped ESLint, script syntax and diff checks passed.

The existing authenticated shared-shell qualifier now contains a 1440/820/320 px
Portfolio journey. It has not yet executed at the published P11 head. No local
browser retry was attempted after the established Chromium permission refusal.

The browser journey uses the incumbent `mm_e2e_wl` store and `mm_e2e_rs30=1`
fixture convention. Shell, Portfolio server page and Portfolio API derive the
same synthetic owner. Six deliberate test-only creates seed the real fixture
store before observing UI effects; the canonical positions response is never
replaced by a parallel browser fixture. Optional risk/history/targets/brief/event
reads return unavailable. No financial values or source certainty are invented.

The journey waits for an accepted canonical read, then exercises the second NVDA
record, a retained search, US→HK→CA, Back/Forward, exact current chart-return URL,
the open native record dialog across history traversal, Escape focus restoration,
and the non-default entry-details filter on the existing unsized RKLB record.
The native modal makes the background inert; the test never forces a selector
interaction through it. EN dark and ZH light captures include all six exact IDs.
The final canonical book is compared with the original store response.

Request accounting distinguishes legitimate quote polling from book navigation.
It requires no additional canonical positions, optional Portfolio reads,
non-prefetch Portfolio RSC/document navigation or browser-originated API mutation
caused by this bounded context sequence. Intentional fixture creates are counted
separately. Browser auth metadata still names the qualifier's synthetic subject;
the existing preference owner fence refuses that mismatched hydration. This
does not prove production entitlements, preference hydration, real customer
records, mixed-currency parity or downstream chart rendering.

## Reconciled earlier receipts

### Today P5

Run43585154012 ended attempt1 with only unit shard2 and its aggregate failed.
Root reverified PR1504 head `bb0e95d9d67910fa5c7ee060fad0f2016fe94032`,
the completed run and original job132418198212, then issued one failed-job
rerun. That same run now reports **attempt2 completed success**. No assertion,
source, timeout or fsync/atomic-publication contract was weakened. No further
rerun is owed or authorized by this receipt.

Its original-attempt browser artifact14110428865 was fetched and inspected:
ZIP SHA-256 `116b72488f8620f8592c566dbdf5b0dcb7103b857cd2ba4ea66d573994601066`.
Report checkout `dd2ff4a073b612b4e5ce032640c1a3d3039760b4` has parents
P4dc803957 and P5bb0e95d9, and exact P5 tree
`f9a1c47b6300914811ee3c1691f9e6b5b47f5690`. All 41 recorded source hashes
match the candidate. All 18 browser cells pass; errors, external requests,
fixture writes and tracked changes are empty; owned child closed. Root viewed
the 1440 px Today reading capture. This is fixture proof, not deployment.

### Discover P6

Repaired PR1508 head `ce55946034d4060919926c790efe98f4f036569a` has
artifact14111396937 from run43587853302. ZIP SHA-256
`5dce30a0d795cb2cd11fa7d985dfc1f52ab146bf9111135512b0098bd196bf63`.
Report checkout `0d1b85f8cb48999eb22b18f49156bf2fa889a3c6` has parents
P5bb0e95d9 and P6ce559460, tree
`077b489e2b4bf20e0816c7bdca82a6777731d9d7`. This is a tested merge tree,
not the standalone P6 candidate tree. Its only differences from P6 are the
already owned P5 packet and searchStatsExact test-budget repair. All 45 recorded
qualifier input hashes match P6 source. All 21 cells pass; errors, external
requests and fixture writes are empty; owned child closed.

The report explicitly records one tracked screenshot change:
`terminal/docs/pr-crops/ticker-news/unavailable-desktop-en-dark.png`.
No clean-working-tree claim is made. That unrelated image is not a qualifier
input. Root viewed Discover 320 px EN and 1440 px ZH captures. This proves the
repaired fixture journey, not full binding CI, deep discovery engines or release.

### Macro release capacity

Both Macro11246 and11248 retain their single `merge-on-green` enrollment and
remain open/unmerged. The existing full-sweep controller run43589602483,
job132431315778, completed successfully and gave explicit owned-PR verdicts:
checks clean, proof stale after relevant main changes, refresh deferred by
capacity. It observed 10 indexed PR CI runs against cap 8, no effective workload
slots, 7 queued hosted runs and 3 slow pickups in 3 mature runs; no update-branch
attempt was admitted. No caller-side merge-main, re-enrollment, watcher or queue
was added. Later incumbent sweeps own release progress. This boundary affects
their release lanes, not path-disjoint implementation.

## Next action and remaining acceptance

Publish/read back this owned candidate, inspect its existing hosted qualifier,
and repair only demonstrated failures on the original carrier. Join Portfolio
imports/allocation/source-bound brief only through the existing owners and their
holds. Verify deployed personal-book context with actual authentication before
claiming production acceptance.

Continue P12 Options/Terminal handoff diagnosis while CI runs. Protect active
Options1266, navigation1509 and Analysis1494 before implementation. The parent
still owes deep Discover, full Macro/Prophet parity, regional engines, remaining
page families, live-source proof and safe retirement of duplicate/iframe routes.

The next-lane inventory also found held Options1248. Root read its current PR
and [original effect receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1248#issuecomment-6767578188):
public head `1b2d4da5e784063c7c0c2b1a1c8f9394b1c0c0b2`, Draft and
merge-blocked; prepared source `e1cfd3f02f71796ce8014ba13722b4f76be0b8f2`.
Its native evidence-tree write remains `TREE_EFFECT_UNKNOWN_NO_REPLAY`, expected
tree `4140c0b7f69b24d068023e5cc6bbc0ef6975fa85`; no final proof commit/ref
started. Preserve its separate GMI EPERM qualification hold. This session read
only the existing PR/receipt; it did not retry, query the original target through
a new carrier, adopt the prepared source or mutate that lane. Bounded P12
diagnosis can continue; competing Options composition cannot.

## Original-carrier stack repair

P11 was published and read back as Ready PR1516, head
`3bb22d3577eacb1b074ac047b3f95728208a833d`, tree
`951abb2a6a6da88b334b6f50f9ad6007436e5735`, with all seven files verified.
Subsequent original P9/P10 browser receipts reached Monitor and failed when its
links retained China after the toolbar selected Canada. The P10 run stopped
before Research or Portfolio. These are failed receipts, not downstream proof.

This same P11 carrier now composes repaired P10
`b80e58a2b254ed49eb9e573c1131cf09e13e18af`, tree
`8bf8905ea89edfb581272a9623c2a693c7e1b2da`, as an additional parent.
Its original P9 repair is `37bf903cd7fbba20dc46b819dcbcc9a91a12d7ff`, tree
`dc9f44afe91b85ac016de2ad7aea038fe7c70644`. The precise cause, artifact
identities and regression evidence are in [P9](P9_MONITOR_EVIDENCE_DESK.md#committed-market-navigation-repair--14-november).
The five affected P9 suites pass101 cases; the combined mounted Monitor/Research
suite passes107. Portfolio product source and its accepted fixture contract are
unchanged. Fresh binding hosted proof is still required; no CI replay, release
enrollment or held-source adoption is implied by this composition.

## Inherited Research request-fixture repair — 14 November

The original observer's run43593801870/artifact14114555466 tests exact P11 tree
`8ca88896cbe77154a3215a6708682eb7df6e669b` at checkout
`7f6c98c5f858ff85dafe8ffd04f5001ada192a6a`. All 85 input hashes match.
It stops after13 cells at Research's third passage; Portfolio was not reached.
Archive/report hashes and the matching P10 failure are recorded in
[P10](P10_RESEARCH_CONTINUITY.md#pinned-research-request-fixture-repair--14-november).
No browser errors, external requests, fixture writes or tracked changes are
reported, and the owned child closed. This remains a failed receipt.

Inherit corrected original P10 head `d1aac6af06d86c4de2ec2def3491d86fe5cd3b0b`
(tree `90edd71a6ad9c4413b249f0894a76de26834d343`) as an additional parent.
Only the fixture's two inadmissible query fields are removed, while the exact
reader assertion is strengthened. Portfolio source, book identity, data and
journey remain unchanged. The upstream145-test reading verification is reused
for identical inputs; hosted qualification of this new dependent head is still owed.
