# Shared Shell intelligence integration

Parent: Macro `research/market_os/SHARED_SHELL_WEBAPP_PRODUCTION_PLAN_2026-10-18.md`
and `WS:MARKET-OS`. This file is the implementation task tree, not a new program,
job queue, data owner, route registry or acceptance authority.

Current assignment: make Macro Dashboard, Prophet and Sector Cycles genuinely
usable from the beta Shared Shell, including a connected overview and real user
journeys. The current attended receiver owns this integration under the live
Chairman instruction of November 2, 2026. Historical authors are not approval gates.

Source: Terminal 350a61f9bae0ae61b2ab188ec99cc73552496ad2; Macro
aba2ddcfe4cb90e4d2106c4a02de3ccb306f0551. Procedure pin: Mastermind
 ea4f893103a1c0354f28843241848cae91336bd7, skillpack 1.0.1, bootstrap major 1.

## Outcome and boundaries

A member can find the three intelligence areas without knowing their old menu
locations, inspect source-backed readings, open the complete incumbent tools,
move to a company/chart, and return without losing the intended selection.
The shared overview is composition, not another signal engine or fused score.

Preserve Macro signal origination, sector-cycle calculation, Terminal charts,
account identity, paid entitlements, language/theme, watchlists and portfolio
owners. Null, stale, unavailable, signed-out and unentitled are not zero or quiet.
No engine retuning, ranking, trade sizing, entitlement expansion, infrastructure
redesign, provider installation or production-default shell flip belongs here.

## Frozen product structure

1. A first-class Market Intelligence navigation group in the existing desktop
   rail and mobile drawer, with Overview, Macro Dashboard, Prophet, Sector Cycles
   and Sector Intelligence. Both surfaces consume the same presentation module.
2. Native `/intelligence` overview composing the existing Macro Command read,
   canonical sector-cycle snapshot and Prophet plan read. Keep all three source
   clocks explicit; no inferred aggregate recommendation. A failed lane must not
   hide good readings from another lane. Never fetch or show private intelligence
   for a prior account after identity changes.
3. `/prophet` is a thin first-class native entrance to the existing Prophet lanes,
   under exactly the existing live-options entitlement and unavailable states.
   Macro Plans and Options Alpha stay separate. No cloned signal implementation.
4. `/sectors` is a thin member entrance to the existing native Sector Intelligence
   workspace. The actual cycle page `/sector_cycles.html` remains separately
   accessible: relative-strength rotation is not the full sector-cycle model.
5. Macro Dashboard keeps its full existing `/macro.html` implementation inside
   the supported document boundary. A modern summary does not claim full native
   migration of its charts. The original Macro Command drilldowns remain intact.
6. A compact contextual intelligence navigation bar connects the existing
   destinations. A Today entrance leads to the overview without replacing saved
   attention or the existing Macro read. No unrelated redesign of Today.
7. Native routes are added through Macro's existing page-registry overrides and
   export generator, then consumed as generated output in Terminal. No hand-edited
   second route allowlist. Existing query/fragment and safe-return contracts hold.

Visual implementation reuses the shipped Shared Shell graphite/light tokens,
Today card typography/spacing, and existing Prophet/Sector components. References:
`terminal/docs/pr-crops/shared-shell-attention-company-20261022/`,
`terminal/docs/pr-crops/terminal-visual-intelligence/`, and the existing
`components/chrome/shared-shell/shared-shell.css`. New styles are scoped modules;
no global token replacement, gradients-as-data or fabricated illustration values.
Overview structure: heading + purpose; contextual navigation; responsive reading
cards with source name, own as-of, reading, honest state, and a primary full-tool
link; then the existing company/chart handoff. Desktop three columns, tablet
one/two columns as space permits, mobile one column. Controls retain keyboard
focus and 44px touch targets. EN/ZH and dark/light are equal requirements.

## Task tree and evidence

- I1: recover current consumer contracts and relevant open-PR collision facts.
  Evidence: source census and actual live status. Do not repeat accepted shell
  foundation, A1A or A1B work.
- I2: implement first-class navigation, native entrances, overview composition and
  account-safe data reads using incumbent contracts. Add failing-first tests.
- I3: register native routes through the Macro source owner; regenerate the exact
  consumer projection and prove legacy routes and query contracts stay admitted.
- I4: independently review exact candidate source, repair findings, qualify unit,
  type/lint, responsive/browser, auth-negative and source-freshness behavior.
- I5: normal protected landing, beta-only release through the existing owner,
  then signed-in real-source browser journeys. CI/merge/deployment/acceptance
  remain separate. Never self-approve or bypass a required gate.
- I6: record exact results, remaining obligations and current receiver in the
  existing Agent OS workstream/handoff, with source-linked readback.

Active neighboring PRs at entry: 1236 (region navigation), 1235 (Today layout),
1228 (responsive search/chrome), 1232/1229 (Sector Intelligence), 1188/1191
(shell startup/document performance). Their changes must be preserved, not
silently replaced. Prefer new modules; reconcile small shared mount edits against
fresh source before release. No worker may modify another worker's live checkout.

## Acceptance falsifiers

- Navigation-only links do not prove integrated intelligence; the overview must
  render actual producer-shaped readings and navigate to the incumbent tools.
- A native alias cannot bypass its old route's membership/entitlement checks.
- Rotation cannot be labeled a substitute for the actual sector-cycle engine.
- A response from account A arriving after account B is selected must not render.
- Publication timestamps cannot be represented as proof of fresh source data.
- Missing, malformed, denied and stale payloads must never become zero signals,
  zero risk, no opportunities, or a green all-clear.
- Cold URLs, Back/Forward, full-tool drills and chart/company returns must work
  without reload-to-recover. Preserve valid query/fragment identity and reject
  credential-bearing or arbitrary-origin return URLs.
- 1440x900, 820x1180 and 390x844; dark/light, EN/ZH; 320px stress; no horizontal
  document overflow; visible focus and usable touch targets.
- Source tests and intercepted fixtures are not live beta evidence. Require exact
  deployed build/registry identity and authenticated source-to-consumer results.

## Current frontier

This is an initial implementation plan, not completed product work. The original
Terminal source carrier is `sol/web-beta-intelligence-integration-20261103-sol`.
The Fabric census request is `beta-intel-consumer-census-20261103-r1`, under root
`market-os-shared-shell-design-20260924-sol-001`; controller creation is observed,
worker execution and return remain to be verified. No deploy has been attempted.

## Implementation milestone (November 3 UTC)

The first implementation adds the shared navigation family, owner-keyed overview,
member/paid native entrances, and incumbent Macro/sector/Prophet drill links.
The UI remains research-only and preserves the existing full workspaces.

Actual source inspection found a 1,905,873-byte sector-cycle object and an
11,898,398-byte Prophet object. Instead of downloading those history stores into
an overview, the existing authenticated handlers now support an optional bounded
`view=intelligence` display projection. Their original auth, rate limiting,
upstream selection and cache stay authoritative; ordinary responses are unchanged.
There is no new endpoint, private proxy, cache, identity plane or signal engine.
The sector summary follows the incumbent `sector_cycles.js` published phase and
position, not the separately published v2 diagnostics. Prophet publication, source
and each plan's price-basis clocks remain distinct; active_count is not open_count.
The exact pinned-source projection receipt is retained beside the browser evidence.

Observed verification so far: 90 targeted contract, route, gateway and flow tests;
33 overview/Today/Research component tests; one exact pinned-owner snapshot test;
initial TypeScript check and scoped implementation lint. The Node 26 host's native
Web Storage interferes with existing jsdom suites; passing local component runs
use NODE_OPTIONS=--no-experimental-webstorage, without changing application or CI
configuration. The original red/green observations are not production evidence.

The Fabric implementation request beta-intel-native-integration-build-20261103-r1
was reconciled as REQUEST_REFUSED_BEFORE_LAUNCH, execution_absence_proven=true,
request_retained=true, same_run_replay_allowed=false. No worker wrote this branch.
The parent continued permitted direct implementation instead of replaying that
request. The original read-only census remains on its original run; its last
observation was ACTIVE_OR_WAITING, not proof of accepted execution or return.

Next: canonical Macro route registration/export, complete integration regression
and real-browser qualification, independent exact-head review, normal protected
landing and beta-only release. No deployment or final acceptance is claimed.

## Recovered original source and consumer defect - November 3 UTC

The current attended receiver resumed the same operation and verified Terminal
PR1244 at 844e5a68 and Macro PR10639 at ab88dac5. The managed Terminal owner
reused the original base350a61f9 workspace; no replacement branch or worktree was
created. The original census returned; its source-pin mismatch inference is not
accepted as a runtime defect: the bundled client/server registry tuple is the
actual compatibility boundary. No implementation worker wrote this source.

The existing Prophet cache invalidation repair passed 25 tests across the new
tool-lifetime suite and both incumbent flow-cache suites. It clears the existing
cache before new child reads and on departure, without creating another cache.

The local browser matrix rendered the six 1440/820/390 dark-English/light-Chinese
overview cells without overflow, but the complete journey remains NOT_ACCEPTED:
selecting MU under /sectors, opening Overview, then Back loses sectorCompany.
The installed Next history owner skips router synchronization when application
code forwards its private __NA/_N flags. The incumbent sector writer does that.
The next bounded repair must use application-owned history state, preserve the
newly merged PR1229 depth-return receipt, and prove Back without a manual reload.
This is a required integration repair, not a breadth redesign; PR1232 changes a
disjoint breadth-render hunk. The merged PR1235 Today ordering must also survive.

Macro PR10639 has one independent read-only Fabric review requested as
beta-intelligence-registry-review-20261103-r1 on the original root. Controller
creation is observed; reviewer execution/return/formal approval are separate.
A separate attempted implementation delegation was explicitly blocked and is
not being replayed. The original published source remains the delivery carrier.

The generated route working copy is provisional. Only the existing exporter
against the normally merged Macro registry/inventory can establish final route
publication. No beta deployment or authenticated product acceptance is claimed.

## History diagnosis correction and narrowed scope

The controlled counter-test restored the incumbent history-state behavior while
requiring the Overview URL and real source card to be visible before Back. It
passed the exact selected-company URL and inspector restoration, then reload.
The prior failed journey raced Back against asynchronous navigation; it did not
prove a product history regression. The proposed sector owner/helper changes
were therefore reverted, preserving the adjacent sector lane's original source.
The stronger committed-arrival, exact-query, inspector and reload assertions
remain in the harness. Both candidate and old-behavior control passed; neither
is authenticated production evidence. Control receipts are retained separately.

Macro review run beta-intelligence-registry-review-20261103-r1 returned
REQUEST_REFUSED_BEFORE_LAUNCH / EXECUTION_NOT_ELIGIBLE, controller exit75, with no
reviewer START or result. Result retrieval reports ROOT_UNVERIFIED; that is not
proof of why admission failed. The Executive root reader independently returned
backend_unavailable before sending its request. No same-effect reroute or replay
was attempted. Source implementation, tests and CI repair continue on the two
original PRs; independent review remains an explicit release gate.


## November 3 source/CI and joined-user-path repair

The November 2/3 resumed Chairman-assigned session reused the same managed
Terminal operation workspace and unpublished history-revert commit (3d2ec4b7a)
without resetting the branch or replaying denied Fabric requests. Current protected
procedure is Mastermind@b2326bbe30e9988d26199f5e774a482b9c09068a
(schema mastermind.sol_skillpack.v1, version 1.0.1). Branch-head/workspace and
remote PR identities were reconciled before the next source mutation.

Terminal draft PR #1244's CI failure run 41577716646 proved 31 failures in
four suites: the beta navigation's unconditional useSearchParams reached ordinary
investor-shell test mocks; new beta route segments lacked their own loading.tsx;
and two incumbent visual-evidence source locks were invalidated. The source
repair now isolates the query-sensitive intelligence nav into a beta-only
SharedShellPrimaryNav, preserves default AppNav/MobileNav behavior, and gives
/intelligence, /prophet and /sectors normal per-route loading boundaries.
Eleven explicit wrapper tests cover selected destination, options/discover query
identity, language, symbols and mobile override. The initially failing
investorShellPreview and adminPageStatusContract suites now pass: 88/88 focused
regressions, plus 49/49 paired new-nav/incumbent tests.
A TypeScript --noEmit run passed; scoped ESLint returned zero errors and one
pre-existing _isTerminal unused-binding warning.

Current joined-user-path fixture browser run (source plus uncommitted repair)
is saved as docs/pr-crops/shared-shell-intelligence-20261103/nav-source-bound-v3/.
The browser-qualification.json reports six 1440/820/390 dark-English/light-Chinese
cells, zero page errors, 320px overflow check, guest/denied simulation, real
native Prophet and Sector tool mounts, and exact chosen-sector MU ->
Overview source card -> Back -> reload continuity. This is actual Next +
intercepted local fixture, explicitly not authenticated beta production or
CSP proof. Unlike the earlier hurried Back diagnostic, the corrected harness
waits for the committed Overview route and source card before pressing Back.
No duplicate sector history writer or alternative router was introduced.

The earlier uncommitted Prophet/sector summary reader hardening rejects duplicate
identities, incoherent summary counts and invalid sector URL IDs; it adds
failing-first negative controls, not new signal/rank authority.
The generated route registry in this workspace remains PROVISIONAL and is
excluded from source publication pending Macro PR #10639's normal reviewed
protected landing and exact unchanged exporter. #10639 currently has a
separate formal GitHub review request to non-author mastermindx-2, but
request != submitted review or approval. The prior Fabric registry review
refusal remains bound to its original operation; no same-task Fabric retry.
Two legacy visual-evidence source locks need current-source recapture/
qualification under the existing immutable evidence law, not blind hash edits.
Normal CI, independent exact-head reviews, protected merges, beta-only release,
and authenticated live acceptance remain separate pending gates.


## November 9 original-branch source reconciliation

Current Chairman completion assignment continues the native intelligence family alongside independent Today PR #1381. Original remote input is 07f6c6aeca8b0c320fc414bc0533fff467cdf653; protected input is e33a4c3dd9f0965e7879fc5397175f6f49b0d751; common base is 3dd66dadc3ebca6126b07d12978fdab58e1a74ae. The original local 624dbc0 is an ancestor of remote (121 ahead, zero behind), positively reconciling that known immutable publication as applied/superseded, not the separate dirty unpublished objects.

The current guarded M2 checkout remains untouched. This is GitHub-native source authoring under adopted #2118 and current source pin 3652d8907df1738de551dd3032b42aa2a2acb482, on the SAME original branch. No original local bi-p1244 visual object, provisional stash, or refused Fabric operation is read/replayed/published. Existing committed evidence and generated registry blobs are preserved by identity, not imported from local files.

Three-way analysis found only CI-step ordering and the moved directory-title helper in conflict. Preserve protected-master ShellDirectory exactly; extend its current sharedShellDirectorySearch owner with the original intelligence labels and aliases. Retain the protected safe-summary reporter and original Intelligence hosted-browser qualification as separate, exactly-once steps. No weakened tests, artifact guard, access, route, search, focus or dismissal semantics. Added regression coverage binds display/search parity and separate Prophet stock-board versus paid model-plan/options scope.

Prepublication validation: YAML parsed; safe reporter retained; both intelligence steps occur once; 13 direct title/search/admission assertions passed through compiled TypeScript with explicit test dependencies. The next natural hosted CI must qualify the merged-source candidate and existing real browser journeys. This source reconciliation does not claim full CI, deployment, real authentication or product acceptance. #1381's product source already has 223 focused tests, TypeScript/lint, 23 browser fixture cells and a production-mode build; those are separate exact-source proofs, not tests of this integration head.
