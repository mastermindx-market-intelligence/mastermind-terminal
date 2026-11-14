# P9A — Monitor lists and event evidence

## Outcome and remaining scope

Monitor now starts with the user's owned lists, then provides one explicit
event-evidence inspection and the existing saved-alert inventory. Symbol actions
are compact and readable. A return action restores the exact initiating list
control, or the persistent list heading when that control is no longer valid.
The same reading order works on desktop, tablet and phone. Account inventory
remains independent of the selected browsing market.

This slice improves the existing native Monitor composition. It does not add an
updates/unread feed, a news service, an alert evaluator, watchlist editing or a
second Company reader. The Alerts cockpit, Terminal watchlist interactions,
News, Portfolio and retained Company source viewer keep their existing owners.
P9 and the complete P0–P17 construction plan remain open until their real
consumer and production acceptance is proven.

## Source and custody

- Law pin: Mastermind `8323d7a774a72da20d0e4db21c9080398da185e7`.
- Protected Terminal input: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- Authoring parent: P7 `57e1abf3ab55887f097da1c6800c1bf3da3fa6db`, tree
  `6275feeb6ba7e897fb12d42c27a194c6d91aba12`. That published Ready PR1510
  and its eight changed files were read back exactly. It retains P0–P7 and the
  existing authenticated browser qualifier.
- Additional parent: P5 repair `bb0e95d9d67910fa5c7ee060fad0f2016fe94032`,
  tree `f9a1c47b6300914811ee3c1691f9e6b5b47f5690`. Its only residual code
  delta is a 15-second budget for the unchanged 50,000-user cache-cardinality
  test. Its documented original-run failure and successful local 12-test file
  remain in `P5_TODAY_DAILY_DESK.md`; there is no product or global CI change.
- Original `MonitorWorkspace.tsx`: `62dee7b67d53d3f29cee5bc6184c7726524372f6`;
  original CSS: `4658a1e42ef09ab244ffd6b4ea8b9b6257c92945`.
- Original `MonitorEventAttention.tsx`: `8d533b3d6204275232a2153820416797e8bc0059`.
- Unchanged Monitor inventory composition: `lib/sharedShellMonitor.ts`,
  `15310ac9e912d86c6d252153d0adecbc0371afcd`; unchanged member route:
  `app/(shell)/monitor/page.tsx`, `4bbfa18c23221d2ddff5919673dfcd64938b6c78`.
- Original Monitor unit contract: `cc600c62743635c04e685fa394cbc4cb24ceeef1`.

The complete 89-open-PR inventory and 29 relevant changed-file inventories
showed no direct Monitor composition/CSS/test writer collision. Preserved live
surfaces include News PR1210 at `5b99f88ef9c3c2cc994145a5cf753cc2133da815`
with its do-not-merge hold; Alerts PR662 at
`e1b8cddd73fe4cb337761e66bdcc02c542e88115` with its draft/production hold;
Terminal watchlist PR639 at `5a04c16e0bd432cb669e795c83b9eaaf8d159cae`;
retained Company PR1312 at `e931e69ab8a2acb7138cb99846e022baf94a94d9`;
Terminal/chart navigation PR1509 at `83c649e23a792450ad5d2d07d55d59302508577f`;
chrome PR1501 at `98f6080a65201af635db2dae689e56d6095fcdf7` and Analysis
PR1494 at `86c3df50097fdf028bdefcf5b37a6f49dec7e077`. Distinct RSPivot
Monitor PR1281 at `9c5ee4ef71e5e6ccadcc70a9810c5ba67c70b859` retains its
draft/holds. These are observed heads, not adopted or approved work.

`monitorEventAttentionOwner.test.tsx` belongs to the retained Company carrier
and is unchanged. The legacy `/watchlist.html` is Mastermind Portfolio, not an
owned-list editor; no guessed manage-list or News destination was added.

## Existing owner contracts retained

| Surface | Contract retained |
|---|---|
| Private inventory | Read-only `/api/watchlist` and `/api/alerts`, separate result states, existing account key, generation/abort boundary and 10-second response/body deadline |
| Lists | Only owned lists, original order and exact saved membership; shared-with-me and held positions are not substituted |
| Market | Existing URL `workspaceMarket` decorates Company, Alerts, Portfolio and retained-evidence destinations; it neither filters personal inventory nor relabels an instrument |
| Chart | Existing exact listing helper and full Monitor return URL, including query and hash |
| Event selection | Explicit Check event evidence for one verified list membership; no prefetch, implicit read, polling or replacement feed |
| Event source | Existing `loadCompanyRetainedContext` and `/api/investigations/baseline`; existing receipt and workspace validators |
| Source clock | `public_known_at` is the event source date; generation emission is not presented as last checked or new activity |
| Retained target | Preserve `ci_company`, `ci_event`, `ci_generation`, `ci_fingerprint`, `page=intelligence`, symbol and `ci_lens=sources`; market is added afterward |
| Alerts | Original saved conditions and recorded trigger state, source order, creation date and eight-row preview; no claim of current evaluation or delivery |
| Refresh | Withdraw accepted event evidence while membership refreshes; even unchanged membership requires another explicit check |
| Access | A local source restriction leaves independent inventory usable; any unauthenticated private read closes the existing account lifetime and clears all private branches |

The active flag is now labelled **Enabled**, with Chinese equivalent, rather
than implying that the condition was evaluated recently. Saved-alert count is
shown only after a successful inventory read. Failed reads do not show a false
zero or a successful-state evaluation qualification. A longer inventory states
that eight of its total conditions are being shown.

The return reference contains only the initiating DOM button, membership and
the exact accepted list-read object. It can focus that control only while the
read still matches, membership remains verified, the control is connected and
its disclosure is open. Otherwise it focuses the list heading. It does not
change the selection, list state, URL, filter or request generation. Locale,
theme and browsing market are absent from the event reader's identity and
request dependencies.

## Paper and implementation

Existing Paper file: `01M6Y2GT8S3YP4TK052PPESZEC`. The principal inspected the
SS03 desktop Monitor board `1O0-0` and service-unavailable phone board `2HL-0`;
the supporting state catalog was inspected without replacing its live page.
The desktop reference includes illustrative update/unread and shared-clock
features whose owners are not established. They were not copied into production.

New additive page: [P9 Monitor evidence desk](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-9-0).

| Owned board | State |
|---|---|
| `4EQ-0` | 1216px dark English, owned lists and selected event beside saved alerts |
| `4H3-0` | 320px light English, same DOM reading order in one column |
| `4JG-0` | 390px dark Chinese, event and lists usable while Alerts is unavailable |
| `4LB-0` | 820px dark English, refreshed inventory requires an explicit event recheck |

All four resulting board screenshots were visually inspected by the principal.
The desktop condition specimen was corrected to the existing helper's actual
output before implementation comparison. The 306 owned nodes were released
with an applied response and the final page readback contains 307 nodes,
including the root and four named boards. Active reference page p-2-0 stayed
unchanged. Observation guard
`6063e7ebf456717dd4e1569757002162c50cdea7544e9d1cbbee8f3f3aef0cad`
and token hash `6234666b` identify the observed active-file state, not a hash of
every board's content. Inventory and retained-event examples are explicit
fixtures, not a real user's account.

Implementation uses existing tokens and EN/ZH copy. Lists and alert conditions
are flat, separated rows; the selected evidence is the one raised panel.
Desktop uses two columns above 1100px, while the same ordered DOM stacks below
that width. Phone symbol actions move into normal vertical flow, retained-event
actions stack, long names wrap, and action targets remain at least 44px.
The source clock is visually separated from the fiscal period and account
conditions. The idle instruction has no panel shadow in either theme.

## Verification at publication

- The five affected owner/session/inventory/event suites passed **81 tests**.
  Coverage includes membership refresh/removal, independent failures, 401
  withdrawal, explicit reauthorization, deadline/late-response boundaries,
  exact four-pin targets and source clock semantics.
- New composition contracts cover EN/ZH reading order, duplicate-symbol list
  return identity, collapsed/removed/read-replaced fallback, unchanged URL/read
  counts, market-aware native links without account filtering, exact chart
  return and truthful alert counts. After extracting the existing specimens
  into one shared fixture, the two changed suites passed **54 tests** again.
- Full TypeScript checking passed after the local process's default 2GB heap
  exhausted; an explicit 6GB process heap resolved that capacity failure.
  No TypeScript or production configuration was changed.
- Scoped ESLint, qualifier syntax, whitespace and the nonempty added-lines
  plain-language guard passed. The language guard reported only existing
  nonblocking findings. Untouched test-only Link mocks in two owner suites
  warn about `prefetch=false`; actual Next Link supports the property.
- A bounded advisory source review found no account, event lifetime, focus or
  target-field regression. A separate design check caught the idle light-theme
  shadow specificity issue, which was corrected.
- Qualifier review caught an acceptance gap: recording an unexpected mutation
  was insufficient to fail this journey. The Monitor cell now asserts that its
  fixture-write count remains unchanged before it can record a pass.

The existing authenticated intelligence qualifier now adds a Monitor journey
at 1440/820/320px. It uses the same account authority fixture and extracts the
pre-existing Monitor watchlist/alert and AAPL retained-event specimens into
`lib/__tests__/fixtures/monitorDesk.ts`, reused by the unit suites. It checks
reading order, a single evidence region, keyboard selection/return, collapsed
fallback, actual top-menu country switching, EN/ZH light/dark geometry,
source-clock/immutable-link fields, no presentation-triggered reads, refresh,
partial inventory failure, source restriction, membership removal and 401
clear/reverify. It records source hashes, fixture hash, request observations
and screenshots in the existing artifact. It adds no runner, account service,
workflow, watcher or competing saved state.

Hosted browser results are still owed for this exact published head. The
local browser permission refusal remains fenced; no alternative local launch
was attempted. The destination check proves immutable link fields, not the
downstream Analysis consumer or real account source availability. Actual
deployed Monitor, real source access, production CSP, full Alerts/News/list
editing integration and the parent migration/retirement acceptance remain open.

## Next safe work

Continue P10 by inspecting the existing Research library, reading continuation
and active content owners. Improve a bounded composition seam only after its
Paper and custody checks. Keep the live Company page-selection repair and
public editorial archive separate. In parallel, reconcile existing P5/P6/P7
binding CI and original Macro release controllers at material milestones;
pending checks block only their release lanes. No accepted source or live
writer is replaced, and no phase or PR is treated as parent completion.
