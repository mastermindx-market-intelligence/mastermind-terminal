# Terminal #1041 — current-owner navigation composition

This repair composes original head `982345a2841dd64f34e3107c8a676ad694593964`
on protected master `50713efda7cbd06c60b6dce2f88b31cea5c005a2`, retaining the
original branch and both parents. It heals source conflicts and the five
previously recorded accessibility defects. It does not claim Paper acceptance,
production delivery, or a fresh local browser capture. The PR remains Draft
and unarmed; its explicit design/Paper readback and production-proof holds stay.

## Preserved product intent and current ownership

- Standalone Analysis places the seven company families beside the ticker.
  Multi-view families get page-local controls; singleton families leave no
  empty local row. Existing phone/tablet local tabs remain.
- The existing `FinPage`, family table, default-page selection, ticker and URL
  state remain the only navigation authorities. `finPageFamilies.ts` and
  `fin.css` are byte-identical to current master.
- MegaPane uses local-only navigation solely for a standalone route-owned
  workspace. Chart-hosted workspaces and overlays retain combined family/local
  navigation, all current close handlers, Escape handling, scroll ownership
  and touch exits.
- Analysis retains current company/symbol search scopes, company identity and
  selection, shared-shell focus identity, active-symbol/Brain announcements,
  invalid-symbol handling, market context and the context-bearing Theses URL.
  The redundant standalone Back button is removed. The newer shared-shell
  Open current chart action still calls the authoritative `onClose`; it is
  available directly on narrow screens and in the existing medium-width menu.
- Saved research and company Theses remain direct narrow-screen destinations.
  Text wrappers allow existing icon styling without dropping accessible names.
  The new stylesheet stays scoped to Analysis; shared 320px controls retain
  their DOM labels while the compact family text can ellipsize. Rendered
  geometry still requires the authored browser checks.

## Accessibility repairs in the existing component

The current master Nav/MegaPane/fin.css blobs match the sources in the prior
[EX-04 audit](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1041#issuecomment-6350437091)
and [hydrated follow-up](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1041#issuecomment-6378419181).
The following repairs use the incumbent component, without a new dialog or
global navigation state owner:

1. Opening the family sheet schedules focus on the current family within the
   mounted dialog. Owned frames are cancelled on unmount and cannot override
   a later connected user focus choice.
2. Tab and Shift+Tab wrap among visible enabled dialog buttons. Focus outside
   the dialog is recovered on Tab. The pointer scrim is not a keyboard stop.
3. Selection, close and Escape return focus to the surviving visible family
   control. The sheet consumes Escape before the outer pane can also close.
4. Crossing above 860px retires the modal, removes listeners, clears expanded
   state and returns to the selected desktop family. Effect cleanup cancels
   its own entry frame without cancelling a newer return handoff.
5. The active panel gets its actual localized page name from the existing
   label table, replacing the unresolved `fin-tab-*` reference. It also works
   for a singleton page with no local tabs and for a compact chart-hosted pane.

Arrow-key moves query only this navigation instance. The October pre-hydration
Enter observation is not reclassified as an additional defect.

## Existing capture owners and historical evidence

The current B-F11-10 native reader remains strict and requires all six dark
captures: 1440/820/390 in EN/ZH. Its source membership and incumbent producer
now both require the original three files plus Nav, MegaPane, the new scoped
stylesheet and fin.css. The same four dependencies are added to the current
shared immutable visual-source inventory without removing any existing member.

The full-six producer is enrolled in `capture_ci_evidence.cjs`, using the
existing process and receipt helpers already composed on #1048. The registry
contains only this Analysis packet. The child proves owned server Ready and
HTTP 200, awaits server settlement, samples source/head identity before and
after the complete matrix, and binds actual generated image bytes to its
attempt. Import is side-effect-free. Permission/auth refusal terminates the
action. No development-indicator node is removed to manufacture absence.
Natural CI clears inherited capture filters and head/output overrides.

The full prior and returned packets are archived. Existing `history/` bytes
are protected, including the current document-language provenance. Capture
exit zero only means `CAPTURED_AWAITING_UNIT_VALIDATION`. The child has the
existing eight-minute bound inside the unchanged 54-minute overall and
55-minute workflow-step budgets. Native evidence validation follows capture.

The existing PL6 producer waits for the retained localized company Theses
control instead of the retired Back label. It still captures all 24 cases;
VI retains all 30, and the existing selected composition remains 50 cases
from two operations. The current Options five-case producer and strict
process owner are preserved. Workflow changes only add this Analysis packet
directory to the existing unit-evidence artifact upload.

No local capture ran. Current-master B-F11-10/PL6 manifests, PNGs and history
remain byte-for-byte intact in the source commit. The older original #1041
two manifests and ten PNGs remain available at the original first-parent
commit; they do not replace newer accepted master evidence. Natural CI must
produce new pixels and qualify the changed source. No historical hash is
restamped as a fresh capture.

## Verification and limits

- **18/18 actual focus-owner test bodies passed** through a local Node 24 VM
  assertion adapter. It executes the actual pre-render hooks/callbacks and
  family table with controlled commit, focus and frame ports. Entry in both
  projections/languages, Tab containment, Escape, selection, resize, later
  user focus, unmount, scoped arrow focus, hidden controls and real localized
  page names are covered. This is not React mounting or browser/DOM proof.
  The committed native test uses the repository's TypeScript transpiler for
  hosted Node 20; only the local adapter uses Node 24 type stripping.
- **55/55 native Node capture/process tests passed.** Controlled processes and
  synthetic packet bytes cover complete membership, attempt/head/source/image
  binding, prior/returned archives, immutable history, refusal and cleanup.
  They are not actual screenshots or a production server run.
- The four original navigation journeys remain. Added EN/ZH at 390/820 checks
  exercise modal entry, Tab/Shift+Tab, Market selection with ticker/page/focus,
  Escape and desktop resize. Singleton and chart-hosted panel names/family
  access are asserted. The standalone touch return uses the visible existing
  MobileNav Menu -> Chart route; the desktop MarketOntology case uses its
  visible desktop Chart link. Current touch exits and context assertions stay.
  These browser assertions are authored but unrun locally.
- Current Analysis mounted tests remain and add the retained shared-shell
  chart-action/return-context case; native React/Vitest execution is unrun.
- Full TypeScript, native Vitest/React/jsdom, Playwright, production build and
  live authenticated/product proof are unavailable locally and not claimed.
  Syntax, whitespace, workflow semantics and full-tree source conservation
  are checked separately during publication. The new head needs natural CI.

## Unchanged design and release boundary

The original [Paper reconciliation contract](ANALYSIS_NAV_R4_PAPER_MIGRATION_2026-10-17.md)
is retained as the dated design record. Its `UPSTREAM_SCHEMA_UNREVIEWED`
refusal, `accepted_for_write=false` and original-app custody are unchanged.
No retry, alternate carrier, catalog edit, canary, Paper mutation, deployment,
Ready transition or merge admission occurs in this repair. Required native
checks and the specific release holds must be resolved by their real owners;
Chairman's test-completion waiver does not manufacture those receipts.
