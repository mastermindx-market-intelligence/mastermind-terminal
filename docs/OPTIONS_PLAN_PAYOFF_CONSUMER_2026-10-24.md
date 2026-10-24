# Exact Plan consumer preparation

The owned delta is based on canonical Plan preparation PR1166 at
`1abd5ecbe1330e2dfcfc460322293f5c3cff5868`. It does not mount a second workspace,
create storage, or change Investigation admission. The existing release owner
keeps OptionsWorkspace and the authenticated deployment boundary.

`OptionsPlanPayoffPanel` composes the canonical editor with the private
`/api/options/plan/expiry` proxy. The authenticated host supplies `scopeKey` from
the non-secret account and retained selection; changing it remounts the editor,
clears results and makes old requests unable to publish. The host's
`onDraftChange` receives the unchanged canonical Plan payload for the existing
Investigation Save/reopen owner. No local/cloud Save or fake saved confirmation
is added.

Each leg needs authored buy/sell, whole quantity and USD premium per unit.
A dated discovery mark never supplies entry. A single root/expiry and ordinary
SPY/QQQ scope are required. Hypothetical underlying prices are explicitly
constructed for the expiry curve; there is no new pricing engine. Numeric
output is withheld unless the private API supplies the supported dated-reference
boundary, matching prices/expiry, exact capture/as-of/calculation clocks, and a
complete finite curve. Current terms and executable quotes remain unqualified.
The initial chart focuses existing server samples around strikes and server
breakevens so a bounded loss remains readable. It marks zero and breakeven,
labels USD profit/loss, and uses the user's global profit/loss color convention.
A toggle shows the complete hypothetical range; no P/L is recomputed or
interpolated by the view. The curve shows the incumbent model's worst/best expiry outcome and breakeven;
fees, early exercise and assignment are excluded.

Any input edit clears the old result immediately. The panel does not retry a
failure, substitute a reference mark, or accept a late response for changed
inputs/account. Missing terms leave the editable canonical draft in place with
plain unavailable copy. Visible dated-reference coverage gives the actual root,
contract count, expiries, as-of and capture, including on an unmatched selection.
It explicitly distinguishes the pilot from a current chain and asks the user to
choose a matching dated contract. The proxy verifies the actual Supabase bearer through
the incumbent billing auth reader, forwards to the fixed private Macro API,
rejects redirect/oversize/malformed response, and applies private/no-store.
Macro independently authenticates and checks uncached Options entitlement.

The only existing editor delta is optional safely rendered contextDescription,
applyLabel and onEdit props. All original defaults remain unchanged. The new
curve uses the established measured SVG chart primitives and Terminal tokens.
This is the separately governed Terminal workspace composition; no new route
archetype, token root or chart engine is introduced.

Verification: 29 focused unit/integration checks, targeted ESLint and complete
TypeScript compile passed. Six actual Chromium fixture journeys passed at
1440×900, 820×1180 and 390×844 in EN/ZH, zero retries/skips. They exercise exact
assumptions → curve → cleared-on-edit → unavailable while preserving entry,
canonical draft return and zero horizontal overflow. Desktop EN and mobile ZH
actual captures were visually inspected. After the risk-visibility and coverage
refinement, the four affected EN/ZH desktop and phone journeys passed again,
including the visible loss, server breakeven, USD axis and coverage assertions. The fixture route is always 404 in
production. It supplies synthetic source/response fixtures and does not prove
provider access, authenticated live data, persistence, full Paper parity or
production behavior. Terminal currently has no working light-theme surface;
no light screenshot was fabricated.

Release requires the qualified Macro private reader/install, canonical1166
composition, existing workspace mount, protected CI and the single release
owner. Authenticated live acceptance must select the actual matching exact
contract or observe honest unavailable; synthetic future SPY fixture math is
never current-chain acceptance. The existing Investigation owner still owes
durable Save/read/reopen.

The existing `/options?tab=screener` controller now mounts the consumer through
ContractShortlistTray → OptionsShortlistPlan. One or multiple retained pins go
through canonical createOptionsPlanDraft; side, quantity and entry all start
null. The row's dated midpoint remains only in the copied source snapshot.
Compare and Show-in-list retain their existing paths. Close or Back to shortlist
returns focus to the Plan trigger without changing the source table, filters,
sort or navigation. An incompatible expiry stays editable and makes no API
request; unavailable exact terms leave the canonical draft visible.

The incumbent browser Auth client's subject observations partition local
shortlist/draft/result lifetimes; they do not grant access. A→B→A creates new
lifetimes, hides old pins immediately and destroys the old Plan controller.
Same-account token refresh does not erase the user's work. A late initial user
read cannot overwrite a later Auth event. Changing the retained pin selection
also unmounts the complete draft; changing back does not revive old assumptions.
The private API remains the authority for authenticated Options entitlement.

Current IW2 owner source `0bfd26d56d6484df8500ab9d9a1bc23304b6be88` was read:
its v3 manifest validates the whole canonical option_plan, and its workspace
preserves a prior option_plan when revising a retained v3 question. It provides
no mounted incoming Plan admission callback. Accordingly this path is visibly
**draft only**. Optional onPlanDraftChange passes the complete canonical Plan
without curve/reference data; an eventual admitted receiver must bind its own
account lifetime. No v2 adapter, Save button, storage, SQL or grant was added.

Mount verification adds five focused integration/account-lifetime checks and
six actual /options browser journeys in EN/ZH at 1440×900, 820×1180 and 390×844.
They exercise source pin → blank assumptions → authored entry → matching curve,
Compare, Show-in-list, close/back focus, incompatible expiry without transport,
unmatched dated coverage, selection invalidation and A→B→A while a numeric result
is visible. These browser journeys intercept discovery, Auth and private API
transport with explicit local fixtures. The SDK's real subject-change observer
receives the fixture account event; no live authentication/provider/Save claim
is made. Test images are mounted-en-desktop.png and mounted-zh-mobile.png in the
same verification folder. The earlier two captures remain the isolated harness.

TypeScript and all newly changed small files' ESLint pass. The large incumbent
OptionsHubView has exactly the same baseline rule counts (17 errors/12 warnings)
at c48dd922 and the integrated source; no changed-area diagnostic was introduced.
Those pre-existing diagnostics were not presented as a lint pass or repaired
outside this scope.

Fresh writer reconciliation found no conflict. Delivery owner retained pending
1159 head479034248; later composition must preserve its accepted Hub saved-view
applyTapeView/onApply/history and OptionsTapeSavedViews mount (source SHA256
5c54df6f4939a966262323325f7abba196599abbce8a137882b8dc13068c72bb).
No edits were made to that owner's worktree, OptionsWorkspace or deployment.
Optional PR/release remains after the consolidated SharedShell1162 boundary and
actual10115/10146 merged source. No broad CI or deployment was launched.

The actual nested screener scroller exposed a desktop sticky-card clipping
issue that the standalone harness did not show. The payoff card now scrolls
normally with the existing results pane. All six final mounted journeys pass
with the SVG at least99% in view after ordinary scrolling (subpixel boundary
tolerance), and the refreshed captures show the whole loss/profit curve.

The mounted planning panel now opts into the editor's optional `layout="planning"`.
Existing editor callers retain the default full layout. Exact identity, source
as-of and a refresh-failure flag stay above the authored trade controls; the
panel explicitly states that current executable quotes are unavailable. Side,
quantity, entry and denomination come before native Original source details and
Optional research notes disclosures. Those disclosures retain the identical
original fields and controlled research values; closing them never discards or
rewrites the canonical draft. Notes added is visible for nonempty research.
Native keyboard-operable summaries have the existing44px minimum touch target.
Desktop keeps the two-column builder/payoff hierarchy; narrow planning fields
use two columns without inferring any initial assumption.

Affected verification:15 editor/panel/mount checks PASS, TypeScript PASS and
changed-file ESLint PASS. Six focused EN/ZH mounted journeys PASS in24.2s with
zero retries/skips; tablet was included because the disclosure layout changes
there too. They verify keyboard Enter/Space expansion, original midpoint values,
closed research serialization, compact phone control placement, and the existing
source/selection/account/focus paths. At390px the collapsed editor is under620px
and authored entry begins within350px of its top. Current full-page phone
captures are2495px EN and2341px ZH (the preceding ZH path was2887px); full-page
height also includes the unchanged workspace chrome, tray, payoff and source
table. Refreshed mounted-{en,zh}-{desktop,mobile}.png captures were inspected.
No source/private transport, canonical payload, persistence or effect ID changed.
