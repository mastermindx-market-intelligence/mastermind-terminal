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
