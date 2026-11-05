# D08B Surface implementation and verification — 2026-11-04

## Outcome and scope

**Implemented and locally verified: exact 2D investigation, retained selection and truthful signed 3D rendering in the existing Exposure Surface. Production disposition: BUILT_NOT_PROVEN.** The Chairman's resume instruction authorizes this bounded implementation. The draft returns to [D08 macro #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649) alongside the [D08B design package #10686](https://github.com/mastermindx-market-intelligence/macro/pull/10686).

The 18-board design package remains the specification for exposure matrices, volatility, positioning and the separate published-chain Lab. This source change advances the independently writable Surface path. It does not claim implementation of all 18 boards or acceptance of all 26 program criteria.

No merge, Ready, un-draft, enqueue, held relabel or deployment is authorized. Formal RIG, F01/F02 release and parent integration remain outstanding. No Plan, saved-scenario, replay, source-cache, entitlement or admission owner is introduced.

## Exact custody and inputs

| Item | Binding |
| --- | --- |
| Managed operation | `d08b-surface-exact-values-20261104-c3` |
| Original workspace | `/Volumes/Mastermind/agent-workspaces/terminal/web/d08b-surface-exact-values-20261104-c3` |
| Original branch | `sol/web-d08b-surface-exact-values-20261104-c3` |
| Source base | `2ded360882b9c721e690907ff363b553781fb920` |
| Law pin | Mastermind `910803421beca53ca25145392725ab2d84c7a8e9`, bootstrap 1 / skillpack 1.0.1 |
| Protected-head delta checked | Mastermind `dcecfa65d07288e93f6935281f8d1b0868e6ced5`; Terminal `801e1c6818f454863bdf8020fa79a9198cb11721` |
| Shared interface | `D08-OPTIONS/1.0.0` at macro `d0516e1bad9cb5982d43d20c4167d0355cb70e2c` |
| Foundation input | `F01-F02-SHELL/1.0.0-candidate.4` at `8926b16af4e0c3e5310cdb4cf057390ec04d18ff`, unreleased |
| Design baseline | macro `a3356474cebbdd88e6448e05ffc3d2e44faa5ca6` |
| D08C interface read | macro #10687 at `291f21aa8e9d757466412549a8d6537d889ab4d8` |

The protected-head comparisons changed neither the required law paths nor the owned Surface/instruction blobs. The valid pin and original workspace were retained; no rebase, merge, alternate checkout or publication carrier was used. The final published PR commit identifies this tree without a self-referential hash in this document.

### Incumbents checked before mutation

All changed-file pages were inspected for relevant open PRs #640, #645, #646, #649, #678, #686, #768, #769, #799, #804, #1020, #1217, #1241, #1243, #1248 and #1258. No exact Surface file collision was found. This is a bounded relevant-PR census, not a claim to know every unpublished writer.

- #1243, head `e95a47d687d39b1152724bfbb7498d2d4bfe660f`, owns the gexdesk strike/MarketState/mobile work. Its latest verification README was consumed.
- #1248, head `98ffa891116ccc9e6be58a64148dbe45591e6ce8`, owns the Options workspace, hub/navigation and related Levels/Vol/Tape composition. Its latest verification README was consumed. Its `components/surface` family differs from this ExposureSurface.
- #804, Draft/HOLD, head `27df56d997df0ae94a17b6b8e2d14867431bb394`, owns `ExposureMap.tsx`, `FrozenNodeEntry`, map strings and `OptionsResearchLab`.
- #1258 owns the weekday-volatility mathematics. #1241 / macro #10634 retain source freshness and entitlement release work.

Those files, branches, holds and evidence manifests remain untouched. D08C Plan/Save and D08D replay ownership remain unchanged.

## What users can now do

### 1. Investigate an exact cell without 3D or a pointer

From the existing `/options?tab=prism&symbol=SPY&view=chart` route, choose Surface and **Exact 2D values**. The semantic table exposes every admitted cell in the current expiry lens, strike window and expiry cap. Coordinates use full ISO expiry and the unrounded numeric strike identity. Values use the admitted scaled number without compact rounding, so zero, tiny nonzero and unavailable remain distinct.

Activate a row with Space or Enter. The next Tab reaches its **Cell details** control; Enter focuses the named inspector. **Back to selected cell** restores focus to the same coordinate, including the last row of the tested 81-cell fixture. Source and scope disclosure remains available, with full source session, availability timestamp, snapshot reference and population identifier.

These are exact **strike × expiry aggregates**, not individual contracts. The existing parent reduces the outgoing actions to strike-level work. Labels now say **Pin strike** and **Open strike in Exposure**; this component does not promise exact-contract continuity after those actions or fabricate a contract from an aggregate.

### 2. Narrow the research window without losing the investigation

An explicit selected coordinate retains its source identity and prior window/cap. When crop or expiry cap hides it, the coordinate remains named, the state explains the exclusion, and **Restore selection window** restores the remembered controls. The inspector never silently switches to a different dominant cell.

Lens exclusion, source absence, source identity change and removed cells have separate states. A current largest cell can be selected only through an explicit action. The initial largest-visible suggestion is labeled as a suggestion before any explicit selection.

### 3. Compare 3D shape with exact values

The 3D and exact views share the existing computed cell set, metric, lens, crop, cap and selection. Net columns extend above or below zero according to sign. Gross and absolute Net remain nonnegative. Columns are discrete and unsmoothed. Missing values are not drawn as zero.

The camera now translates and fits the projected geometry into its measured viewport. The sign/tier CSS reaches the actual polygons. A full-lens reference for the selected metric determines height before crop, so gross exposure remains visible when net positions cancel. The legend distinguishes this height reference from the retained net-book magnitude tiers. The latter's labels are presented to 12 significant digits with a rounded-limits disclosure; exact cell numbers and underlying tier decisions remain unchanged.

Rotation, elevation, strike window, expiry cap, spot plane, Net/Gross/|Net|, source disclosure and strike exits remain available. No auto-orbit or forced motion was added. The existing SVG renderer does not require WebGL; no WebGL failure injection is claimed.

## Retention and source/build contract

| Capability / contract | Implementation decision |
| --- | --- |
| Qualified projection and expiry lens | Reuse `buildExposureSurface` and `selectedProjectionCells`; no new fetcher, cache or state store |
| Gamma math and comparison cohorts | `lib/exposureSurface.ts` unchanged at blob `56624b371218f574428d3eb4c3baf6d68ab286a0`; existing matched-change logic and totals retained |
| Signs and units | The value owner still converts to $M per +1% spot. Presentation does not repeat the conversion. Net is signed; Gross/|Net| are nonnegative |
| Time | Both builder and lens use the same `evaluationTime`. The production parent's existing `now` takes precedence; a standalone mount captures one fallback clock. DTE retains source-session semantics |
| Selected identity | Bind root, security ID, projection kind, source snapshot, source session and global population; additionally bind cell population and exact coordinate |
| Scope changes | Crop/cap/lens are not new source identities; exclusion retains the coordinate without substituting data |
| Source changes | Changed root/snapshot/session/population fences the old selection; current inspection requires explicit selection |
| Missing / zero | Null and nonfinite are unavailable; finite zero and tiny nonzero retain their values and can be inspected |
| Coverage | Existing `joint.complete` is labeled **Joint Greek coverage**, not presented as gamma-only or whole-market completeness |
| Precision | Full coordinate and exact displayed metric in table/inspector; compact axis captions remain presentation labels |
| Full-scope normalization | Net/|Net| height uses full-lens maximum absolute Net; Gross uses full-lens maximum Gross. Crop does not renormalize height. Existing net-book tiers remain owned by the calculation module |
| Parent callbacks | Existing `{ strike, expiry }` callback signatures retained; no parent code or pin-key change; visible wording accurately describes the parent's strike-scoped destination |
| Backend/auth | No new endpoint, producer schema, clock, access decision, persistent store or auth flow |
| D08C/D boundary | No contract admission, Plan, Save, watch, replay or knowledge-cutoff owner changes |

### Interaction states

| State | User-visible behavior |
| --- | --- |
| Suggested | Label largest visible cell; no claim of an explicit user selection |
| Selected | Identical coordinate/value in table and inspector; 3D highlights that cell |
| Outside window/cap | Retain exact coordinate, explain exclusion, offer remembered-window restore |
| Outside lens | Retain coordinate and name the need to restore expiry scope |
| No qualified projection | Retain explicit selection; no qualified data claimed for current source/scope |
| Source changed | Explain changed identity; old selection cannot inspect a replacement cell |
| Cell removed | Explain coordinate absence; do not substitute the largest current cell |
| Empty window | Existing explicit widen-window action remains |
| Missing cell metric | Unavailable row is inspectable; exact value is unavailable, never zero |

Loading, authentication, entitlements, provider read failures and stale-cache admission remain with the existing parent/source owners. The component does not infer their cause from a null projection.

## Responsive and accessibility proof

The composition uses measured component width as well as viewport breakpoints. This matters inside a narrow desk pane or under CSS magnification, where desktop media queries can otherwise keep fixed columns. Bounded `minmax(0,1fr)` tracks and wrapping prevent legend content from widening the shared inspector track.

Every enabled component button, select and source summary has a 44px minimum height; exact cell buttons have a 48px minimum height. The table uses normal page/parent vertical scrolling without a nested table scroll trap. Native controls, semantic table headers, named inspector, visible focus and explicit return focus provide the complete 2D route without relying on color, hovering or SVG point selection.

Tested viewport sizes are **1440 × 900**, **820 × 1180**, **390 × 844**, and a separate dense **320 × 844** sequence. Both EN/ZH and dark/light were exercised in the three standard sizes. The dense sequence also uses reduced motion and **CSS `zoom:2` at a 1440 × 900 viewport**. This is CSS magnification evidence, not native browser zoom, a complete 200% text-resize audit, or 400% reflow proof.

The fit assertions intersect Surface, viewport and clipping-ancestor bounds; they measure text ranges as well as element boxes. The selected zoom row, detail heading/value and return control are scrolled into the viewport and hit-tested before capture. A document `scrollWidth` assertion alone is explicitly insufficient.

## Verification executed

| Check | Observed outcome / scope |
| --- | --- |
| Unit | **48 passed**: 34 component and 14 existing calculation tests, final source |
| Scoped ESLint | Passed for component, strings, component tests and new browser spec |
| Production build | `npm run build` passed, including TypeScript and 68 static pages; no deployment |
| Actual-route browser suite | **7 passed, 2 skipped**; the two skips avoid duplicating the explicit 320/CSS-zoom sequence in tablet/mobile projects |
| Browser captures | **34** current PNGs, hashes/dimensions in `browser-captures.json`; illustrative controlled source fixtures |
| Independent contract review | PASS on exact five source/test blobs in `source-blobs.json`; source/test design reviewed, tests not independently rerun |
| Independent geometry review | 4,608 camera combinations / 152,064 points finite and in bounds; numerical transform proof, separate from browser rendering |
| Independent visual review | First pass found 320 clipping and unusable zoom evidence; both corrected. Final five-capture recheck PASS |
| Whitespace | `git diff --check` passed |

Run from `terminal/`:

```sh
npx vitest run lib/__tests__/exposureSurfaceView.test.tsx lib/__tests__/exposureSurface.test.ts
npx eslint components/exposure-map/ExposureSurface.tsx components/exposure-map/exposureSurfaceStrings.ts lib/__tests__/exposureSurfaceView.test.tsx e2e/options-exposure-surface-exact.spec.ts
TERMINAL_E2E_PORT=3468 TERMINAL_VISUAL_EVIDENCE_OPERATION=d08b-surface-exact-values-20261104-c3 npm run test:e2e:responsive -- e2e/options-exposure-surface-exact.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npm run build
```

The browser uses the repository's existing local auth/fixture seams and intercepts the GEX response with a controlled qualified projection. It tests the actual route and parent reader, not a detached demo. It does **not** prove live market availability, production entitlements, production clocks or a deployed candidate. The build's coverage pre-step writes only this managed workspace's local generated coverage file. Build warnings in unmodified Tiingo filesystem-tracing paths are retained in `build.log`; they did not fail compilation or TypeScript.

## Review findings resolved

1. Dated gamma with incomplete joint Greeks was ambiguously labeled: copy now names joint coverage.
2. Fractional strike identities could round in retained selection: retained identity and inspector use the full numeric string.
3. Dense keyboard users had no practical next-step detail action: the selected row now exposes details on the next Tab and a precise return control.
4. Camera origin and sign selectors clipped or blackened the actual 3D rendering: bounded projection/correct selectors and browser geometry/fill assertions cover it.
5. Balanced or near-canceling net books flattened gross height: full-lens metric height reference, signed Net domain and nonnegative Gross/|Net| fixed it; tests examine actual vertical edges, not total polygon footprint.
6. Single-strike spot placement and small continuous tier ranges were misleading: exact/equal/above/below spot cases and fractional limits are covered.
7. Dense 320 legend minimum width clipped the shared inspector: bounded tracks and text wrapping correct it; ancestor/text-bound assertions replace the weak page-only check.
8. The original zoom capture showed nearly empty outlines: component-width queries and explicit visible-target captures now demonstrate the selected row, detail and return path.

Initial failed screenshots remain under `before/` and are not represented as final proof. [Final desktop 3D](browser/d08b-surface-desktop-en-light-3d.png), [phone exact](browser/d08b-surface-mobile-en-light-exact.png), [dense 320 inspector](browser/d08b-surface-320-zh-dense-last-cell.png), [CSS-zoom selected row](browser/d08b-surface-css-200percent-zh-selected-row.png), [CSS-zoom inspector](browser/d08b-surface-css-200percent-zh-inspector.png).

## Relation to the original acceptance criteria

This is **partial program coverage**, not a wholesale change of A01–A26 to PASS. It supplies bounded Surface evidence for parts of A04 (zero/missing), A06 (metric/units), A12 (3D/exact parity and signed/full-scope height), A14 (keyboard/reduced motion), A16 (phone controls), A17 (listed widths and CSS zoom), A18 (focus), A19 (locale/theme), A23 (ownership), and A24 (existing reader reuse).

Whole-program origin/exact-contract continuity, matched comparison and effective knowledge-cutoff paths, volatility, published-chain Lab, positioning/Levels, complete source/access state matrix, every specified width, native zoom/400% reflow, assistive-technology audit, measured product contrast and performance budgets remain unaccepted. A26 still requires D08's admitted independent RIG process and released foundation binding. The existing Paper specification remains the acceptance source for those paths.

## Executable return to D08

The current D08 receiver should bind the published exact commit and these blob/capture identities to the existing review process, reconcile the separately owned foundation and source-release gates, and compose this Surface change with the incumbent branches. Recheck only material changed interfaces or source effects; do not rebuild the accepted design boards or duplicate the source owner.

The original managed workspace and publisher retain custody. No unknown modifying effect is outstanding in this bounded return. No Fabric job, background watcher, auto-merge or deployment is represented as running. Native advisers were accepted/stopped on their original carriers. GitHub CI/review state is reported on the exact published PR; local success does not imply formal RIG, merge or production proof.

## Resumed native Paper verification

The same session re-inspected exact Terminal file `01M3NSZGE8JWN2EZCSF0DT05RM` and found an original B01 contrast-placement mismatch. A distinct, freshly guarded repair changed only the live matrix SVG foregrounds at B01 `1NZL-0` → matrix `1ONW-0` → inner `1ONX-0` → new SVG `1SDU-0`. The independent native check matched all 54 cells and verified minimum 4.655805:1 contrast with zero labels below 4.5:1; values, signs, coordinates, alpha and selection remained identical. The repair/finish effects are observed, and no unknown operation was retried. Corrective evidence belongs to the original [macro #10686 design return](https://github.com/mastermindx-market-intelligence/macro/pull/10686#issuecomment-6620804724), preserving the frozen before screenshot. This Paper proof and the Surface browser proof are distinct.

## Presentation-proof correction in the volatility continuation

Visual QA during the next D08B phase found that the ordinary Options shell does not activate the separate shared-shell light-token owner. The original Surface tests changed only `data-theme`; therefore, captures at `4741b1ceb2e8718d59ab74654bbeefd9eb6c4484` with `light` in their filenames actually rendered dark. They retain their dark-layout and interaction evidence and **must not be cited as light-theme proof**.

The original Surface implementation remains unchanged. Its browser spec now uses the existing shared-shell light CSS declaration as an explicitly scoped **light-token fixture**, verifies the effective token, and labels those captures `light-tokens`. All seven Surface cases passed in the corrected combined run (17 total passes, four intentional duplicate-width skips). The 12 new light-token screenshots and the exact run log are preserved in [the volatility verification package](../d08b-vol-skew-exact-20261104/README.md). This proves panel compatibility with the supplied palette, not production theme activation, account preference delivery or F01/F02 release. The old captures remain for provenance; the current correction supersedes their earlier light-theme description.
