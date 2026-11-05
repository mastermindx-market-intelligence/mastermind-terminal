# D08B — exact matched-change inspection

## Result and scope

The existing **Options → Exposure → Changes** inspector now has **Compact / Exact USD** views, exact previous/current amounts and all three distinct change quantities. A semantic desktop table and labeled narrow-container cards consume the same ranked rows. The existing selected-strike callback, matched-contract comparison, source-session basis and source admission remain the owners of the result.

This is the Chairman-authorized continuation of [Terminal Draft #1266](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1266), returned through [D08B #10686](https://github.com/mastermindx-market-intelligence/macro/pull/10686) to [D08 #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649). **Built and locally verified; production remains BUILT_NOT_PROVEN.** No merge, Ready, un-draft, enqueue, held relabel, uncertain-operation retry or deployment is authorized.

The production write set is three presentation files: `ExposureChangeInspector.tsx`, its CSS module and its local EN/ZH strings. The existing component test is adapted without removing its five cases; one ten-case unit suite and one actual-route browser suite are added. The comparison/model/coordinator, parent map, backend, authentication, fetch/cache, shared selection, D08C Plan/Save and D08D replay remain byte-identical to the previous head.

## Exact source, design and custody

| Input | Bound identity |
| --- | --- |
| Protected law | Mastermind `70187bb1660e8a7c3038271bb9f8924b5e525cb0`; compatible bootstrap1 / skillpack1.0.1, required laws at the same SHA |
| Frozen interface | D08-OPTIONS/1.0.0 at macro `d0516e1bad9cb5982d43d20c4167d0355cb70e2c` |
| Previous Terminal head | `8d47a4557762e5d1d7e07617255b105cbc8a51a5` |
| Previous D08B design return | macro `2e0d13635f8c3424b054594732f6de16894b37ca` |
| Original component / CSS / strings | `e60c5feaec0cb468b31c1208a880038d98b68139` / `29db37566856e294df6c50043bf103dc294cd702` / `3619d2d1f2f91a339ad3c3dfdb29165fc91a084f` |
| Original component test | `04971cf2204843ea475d124bacdcd9ebb52790cd` |
| Original writer and publisher | Managed operation `d08b-surface-exact-values-20261104-c3`, branch `sol/web-d08b-surface-exact-values-20261104-c3` |
| Paper | Terminal file `01M3NSZGE8JWN2EZCSF0DT05RM`, candidate page `p-12-0`, B07 `1PBQ-0` and B16 `1REL-0` |

The exact Paper boards were inspected through actual screenshots; B07 JSX was extracted. B07 preserves the distinction between signed change and gross change, and B16 separates reported membership from qualification. Current Paper catalog `03cb81e960dab705b21b0695f3886d39c4792df629a6419163efef52338182e4` is not accepted for writes. This phase used read-only Paper operations and made no canvas mutation, foreground switch or alternate-carrier attempt.

The complete14-PR census in `ownership.json` found none of the six proposed presentation/test paths in the incumbents. It records material incumbent movement, including #1243's expanded file list. VRP #1248 and VolCompare #804/#1295 overlaps are explicitly excluded. Open-PR overlap is evidence of source integration risk; it is not asserted to be a live writer lease.

## Real user journeys

### Inspect a small real change without rounding it to zero

Open Exposure, retain the all-expiry source scope, and choose Changes. Compact remains the initial display. Choose **Exact USD** with touch, pointer, Enter or Space. The inspector shows the supplied JavaScript numeric value without display rounding, including literal signs and zero. The precision fixture's `−$0.000244140625` remains distinct from `$0`; its previous/current pair is `$0.00048828125 → $0.000244140625`.

The three quantities stay separate: signed net change, change in net magnitude and gross change. A second fixture deliberately has positive signed change and negative magnitude change. The incumbent small-change direction tolerance can still label a tiny value “flat”; that label does not replace its exact nonzero amount. No comparison or direction calculation is changed.

Exact means the admitted numeric representation, not reconstructed original serialized decimal bytes. No conversion, interpolation, extra rounding or new source method is introduced.

### Keep the intended strike and the supplied ranking

Both layouts derive from one formatted row list. Formatting does not move selection, reorder the supplied ranking or recalculate the matched population. A row action requests the exact strike through the existing parent callback and waits for the parent to update selection. Without that callback, the strike is read-only.

The existing appended selected row remains visible after the ranked set. “Outside the ranked set” now correctly describes `model.more`; it does not incorrectly imply that an appended selected row is absent from that count. A selected strike with no matched contribution receives an explicit unavailable-focus message. It is never replaced with a neighboring strike.

The real browser journey selects strike111 through the existing full exact-values tab and returns to Changes, proving the appended selection. Selecting unmatched strike100 preserves that named focus and its explanation. A live resize transfers keyboard focus from the hidden wide-layout control to its visible equivalent without invoking a selection callback.

### Understand the population behind a comparison

The native **Reported membership and qualification** disclosure exposes all eight supplied counts: matched, previous-only, current-only, qualification lost, qualification gained, observed previously, observed currently and unavailable in either session. It explains that categories can overlap and are not summed. It does not label supplied-row counts as complete market or source-collection coverage.

The population fixture has77 matched qualified contracts,40 reported only in each session, one qualification loss, one gain and three shared members unavailable in either session. Those excluded groups never enter the matched signed-change total. Both original session dates and the existing model's source/method qualifications remain visible.

### Continue on a phone or after access disappears

At an available inspector width of840px or less, each strike becomes a native named card with previous/current amounts and three labeled changes. At340px or less, pairs and change fields stack. At260px or less, the population grid and format controls also stack. Desktop retains a semantic five-column table with row headers.

Strike selection targets are at least48×48 CSS pixels. Other important controls and the disclosure meet the44px house target. Literal signs, selection borders, pressed state and visible focus supplement color. Forced-color rules preserve text and selection cues. There is no required animation or hover interaction.

On source access loss, the existing coordinator removes the inspector and its stale values and exposes its existing Retry source read action. Component-level non-data states similarly remove former numeric rows, population details and controls. Only the local format preference can survive recovery; it is not a new source or selected-contract owner.

## Verification and visual corrections

| Evidence | Observed result |
| --- | --- |
| Focused unit closure | **50 passed**: copy3, model11, comparator21, existing component5, new exact-value component10 |
| Combined actual-route browser run | **14 passed,7 intentional skips**; new inspector journeys plus six existing matched-comparison regressions across desktop/tablet/mobile |
| Final reflow check | **8 passed,7 intentional skips** after the840px correction; all six locale/viewport combinations plus parent/source-loss and extra-width/focus journeys |
| ESLint | Scoped production/test checks pass; final browser diagnostic is retained |
| Build | Production build passed before the final CSS-only840px reflow correction and EOF cleanup; the final browser run compiles that corrected CSS |
| Viewports and modes | 1440×900,820×1180,390×844; additional320px, CSS zoom2, reduced motion and a230px composed pane; EN/ZH, dark and actual scoped shared-shell light tokens |
| Final visual evidence | **59 viewport PNGs,59 capture-metadata records,12 contrast records;1,664 sampled text styles, minimum5.554996509050376:1** |
| Source and whitespace | `source-blobs.json` binds changed and preserved owners; `diff-check.log` records the final whitespace check |

The original320px ZH baseline did **not** horizontally overflow: the table was254px wide. Its headings reached112px high, signs and amounts fragmented, and strike buttons were approximately39×32px. `before/` preserves that actual observation. This is a readability and target-size correction, not a claim that this particular baseline reproduced horizontal clipping.

The first implementation passed the original44px checks. Raising precision selection to the design's48px requirement exposed the parent map's coarse-pointer44px rule overriding a less-specific selector. The bounded diagnostic recorded actual44px heights. A component-scoped selector corrects that override without changing the parent stylesheet. `browser-48px-first.log`, `target-diagnostic.log` and `target-diagnostic/` retain the failure and evidence.

Root visual QA then found that the otherwise passing tablet table could place the minus sign above a precise amount. The840px container transition now supplies labeled cards earlier; the final browser assertions require the precision fixture's complete signed values on one line. `before-tablet-reflow/` retains the superseded image. No comparison, source or selection behavior changed in either visual correction.

All final screenshots capture the actual viewport after scrolling to and hit-testing a bounded visible target, with adjacent viewport metadata. They do not claim that an oversized locator screenshot proves the correct scroll region. The shared light-token helper reads the real shell declaration, scopes it to this inspector and verifies the panel token; it does not activate the production shell's theme preference.

The browser inputs are explicitly synthetic fixtures passed through the real `/api/flow` consumer boundary, original source admission and async coordinator. The unchanged comparison chain was also exercised locally before integration. These are not live-provider, real-entitlement or freshness proofs.

## CI reconciliation and acceptance boundary

`previous-head-ci.json` corrects stale pending-CI prose for the preceding published heads. Terminal `8d47a455…` had21/21 successful checks and completed CI/CodeQL runs. Macro `2e0d1363…` had successful applicable workflow runs and active `ci-authority/main`; the rejected queue-pilot context explicitly said it was inactive. An empty legacy commit-status collection is not a pending Actions run. Branch-protection reads were403; no retry or alternate path was used, and formal release-gate eligibility is not certified. New commit checks require their own exact-head readback.

This phase adds bounded implementation evidence for R14/R15 and R55–R58, JourneyJ2, parts of A07/A08 and responsive/accessibility/failure-state criteria. It does not globally pass the26-case program table, establish full400% native zoom or assistive-technology certification, validate live source availability, deliver released F01/F02, or complete the parent A→B→C journey. Earlier accepted Surface, Skew, Term, History and Paper corrections remain intact.

Native helpers supplied a local draft, ownership census and fixture analysis. Root independently read source, integrated through the original writer, exercised actual routes, inspected rendered screenshots and repaired the observed layout defects. No optional reviewer or watcher is awaited. Formal repository CI, CODEOWNERS and any binding non-author approval remain separate from this bounded return.
