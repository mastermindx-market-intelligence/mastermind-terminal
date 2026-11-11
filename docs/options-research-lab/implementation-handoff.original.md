# Implementation handoff — 3D Options Research Lab
**October 7, 2026 · R1 · Design complete for first build sequence; Terminal code NOT implemented**

## 1. Resume from this frontier

The user authorized research, Paper design and subsequent Terminal implementation. Pro is the user-selected mode. Paper mutations succeeded and seven artboards were read back as screenshots. A host-terminal preflight was blocked by the platform before a process ID was returned. No implementation worktree, branch, code change, PR, test run, deployment or active worker was created.

**Blocked carrier:** `Studio_Direct_—_C3_Personal.start_process`.

**Observed response:** “This tool call was blocked by OpenAI because we couldn't determine the safety status of the request.”

The refused call was an advisory repo-habit read plus isolation preflight. Do not rephrase it, use another host carrier, or treat a new chat as clearance. After an actual user/runtime change, recheck the original affected preflight under current policy. Extra High was requested, but no switch has yet been observed and no mode guarantees tool access.

Paper remains the durable design owner. This delivery’s research and handoff are conversation artifacts, **NOT_CANONICALLY_PERSISTED to GitHub**. There is no fabricated publication receipt. Publish them on the approved implementation/evidence carrier after the applicable gate is cleared.

### Source pins

- Protected Mastermind: `ee120e80f5d5e0344c453dd7cbf4108b9c429b38`; INDEX blob `38a18571229e487f525b1c9780f7993220a5da93`.
- Terminal implementation census: `ad36a332cd4b53af1d917a94f6fb3a10e27dad84`.
- Macro options research census: PR #8321, merged head `351601bd063c95884b6213477d444dba7efb70f0`.
- Paper: file `01M3NSZGE8JWN2EZCSF0DT05RM`, page `p-H-0`.
- Paper snapshot guard: `62799a96f71884a0fa3eae34e7f2e1ad00c4fbde47b5092b4b94f29e9dd3193d`. This is a drift guard, **not a revision or write permission**.

Refresh relevant policy and affected owner states at resumption. Unrelated source movement is not a reason to redo the research. Open/draft PR contents are evidence, not protected law.

## 2. Existing implementation surfaces and custody

Repository: `mastermindx-market-intelligence/mastermind-terminal`.
Host repository observed: `/Users/chriswong/Documents/Cluade/charting-app`.

Proposed but **not created** worktree: `.claude/worktrees/options-3d-research-lab-20261007`.
Proposed but **not created** branch: `claude/options-3d-research-lab-20261007`.
Use current canonical isolation rules instead of assuming these names establish custody.

### Retain these owners

| Existing source at Terminal pin | Observed responsibility | Required behavior |
|---|---|---|
| `terminal/components/OptionsHubView.tsx` | Options navigation and integration with existing views/cache/stream | Add a narrow investigation entry; do not restructure the hub wholesale |
| `terminal/components/gexdesk/matrixDoc.ts` | Matrix schema/parser, activity and producer exposure | Reuse semantics and null handling; add a presentation adapter |
| `terminal/components/surface/SurfacePane.tsx` and `SurfaceView.tsx` | Surface/Replay consumer and shared flow integration | Reuse root selection/replay; do not create a second clock |
| `terminal/lib/surfaceContract.ts` | Surface identity, time and archive constraints | Consume its admitted contract rather than bypassing it |
| `terminal/components/vol/volTypes.ts` | Volatility types, including percentage-valued IV conventions | Normalize once with explicit units |
| Existing payoff/Plan owner | Scenario/position planning | Reuse valuation/leg state; do not build a parallel pricer |

The inspected package was Next 16.2.9 / React 19.2.4 / Lightweight Charts 5.2. No Three.js/React Three Fiber dependency was present at the inspected pin. Verify the actual current package and vendored Next guidance before adding a compatible, locked dependency. Existing files were not all read in full: Surface/Hub files received bounded entry-point reads, while the matrix and volatility type files were fully inspected. Complete the affected-function reads before editing.

Relevant PR observations at the census boundary: #608 merged (shared replay); #686 open (intraday work); #768 draft (clock/gap work); #780 draft (Volatility Lab); #781 open (Payoff); #723 draft (large options/heatmap work). Reconcile current heads and source ownership. Do not cherry-pick an entire large PR or duplicate its feature. Production-custody references #599/#603 also require the current owner’s procedure before release.

Pinned Macro context:
`research/options_intelligence/2026-10-03/PRINCIPAL_DECISIONS_20261003.md`.
It separates engineering evidence from empirical/live evidence. Do not introduce a second options-intelligence lifecycle, candidate publisher or historical event store.

## 3. Read-model contract

The matrix cell supplies `strike`, `expiry`, `gex`, optional `call_oi`, `put_oi`, `call_vol`, `put_vol`, nested `delta_oi`, and unusual-activity metadata. The document has root, spot, as-of and build/provenance fields. Preserve the actual producer’s GEX unit.

**Absent from that contract:** individual bid/ask/last, per-contract gamma/IV, complete instrument deliverable, exercise/settlement details and full model provenance. These are enrichment requirements, not data that the browser may invent.

The following is a **proposed consumer schema**, not a new network endpoint or a claim that the producer already emits these field names:

| Group | Required semantics |
|---|---|
| Identity | Stable contract ID, root, exact expiry/settlement timestamp, put/call, strike, currency, multiplier/deliverable and reference-data revision |
| Time | Observation start/end, availability time, session date, OI reference session and OI availability, correction/revision lineage |
| Quantity | Value, unit, source reference, quality state and explicit null reason for each metric |
| Quote | Bid/ask/size, market timestamp, age at relevant event, condition flags and compatible underlying reference |
| Model | Model name/version, inputs, exercise style, rate/dividend convention, time basis, admissibility and fit-domain bounds |
| View | Lens, metric, filters, transform, camera preset, selected contracts, comparison references and capability map |

Where the current producer lacks a timestamp, use unknown availability and disable knowledge-time assertions. Never manufacture `available_at = observed_at`. Preserve zero as a legitimate known value; do not use it to fill missing metrics.

Adapters must reject nonfinite numbers, contradictory units, duplicate identities without a resolution rule, mismatched roots, incompatible model comparisons and unsupported schema versions. Do not drop rejected rows invisibly: return a bounded exclusion summary.

Enrichment must come through existing server/provider owners with current entitlements and rate limits. No direct vendor key in the browser, new socket per lens, hidden retry loop or independently cached stale contract universe.

## 4. Interaction contract

Entering the lab inherits the hub’s instrument. Changing lenses retains compatible selection, clock and filters. Expiry-depth and observation-depth modes have visibly distinct labels. One click pins; an explicit compare action manages at most three selections. The selected item remains accessible in 2D/table mode and the inspector.

A selection outside the current filter is identified as such. A root or identity change invalidates incompatible detail rather than reusing a stale tooltip. Opening the original prints carries exact contract/time references, not just a ticker. Opening Plan creates a manually chosen hypothesis, not an inferred fill. Saving follows the existing investigation owner.

Camera controls: orthographic default, named front/top presets, orbit, zoom and reset. Axis transforms and marker caps are named and reversible. Comparison locks scales. Exact values remain in the inspector/table; no screen-coordinate inversion is the source of financial values.

Keyboard users must traverse available contracts, pin, compare, dismiss detail and return focus predictably. A failed renderer preserves selection and offers the same exact slices. Touch controls must not require hovering. Respect reduced motion, theme tokens, EN/ZH strings and 200% text zoom.

## 5. Build sequence and verification

### A. Admission, isolation and baseline

Clear the actual host gate, recover current owner/custody and create one isolated workspace. Read root and `terminal/` guidance plus affected functions. Record a clean or explicitly understood baseline. Run the existing relevant tests before changing behavior, preserving pre-existing failures separately.

**Result:** admitted workspace, exact source head, carrier and baseline evidence. No false production claim.

### B. Typed adapter, selection and 2D baseline

Write failing tests for null versus zero, root identity, stable contract keys, IV percent conversion, unit labels, metric availability and selection invalidation. Implement a pure adapter and shared view state. Build the table/2D slice and inspector first so every 3D value has an independently readable reference.

Suggested new component boundaries, subject to current conventions:
`OptionsResearchLab`, `researchLabAdapter`, `researchLabTypes`, `ResearchSelectionInspector`, `ResearchSlice`, `ResearchCapabilities`.
These are proposed names, not existing paths.

**Result:** source-parity activity investigation, with unsupported gamma/quotes visibly unavailable.

### C. Lazy 3D chain renderer

Qualify the Three.js dependency against the current Next/React setup. Keep the GPU scene client-only and lazy. Instance or batch marks; retain stable instance-to-contract mapping. Use screen-space area semantics, bounded geometry and demand-driven frames. Dispose buffers/materials/listeners when leaving the view.

Test picking after sorting/filtering/replay changes, camera reset, equal area at different depth, zero-volume rows, negative signed metrics, all-null metrics, filtered selection, extreme values and GPU-context failure.

**Result:** Chain board implemented with exact 2D parity and no extra fetch/stream owner.

### D. Admitted metric enrichment and volatility

Integrate existing quote/Greek/model producers. Add the gamma lens only after the input unit and model provenance contract is proven. Preserve the distinction between long-option gamma, aggregate producer exposure and inventory-sign hypotheses.

Connect Volatility Lab’s raw/fitted data. Add exclusions, reference comparisons and fit-domain gating. Do not build a new SVI calibration service in this PR.

**Result:** additional metrics operate on admitted real records; fixture-only views remain labeled.

### E. Replay and package investigation

Reuse the established replay clock. Add observation-time versus knowledge-time modes only to the extent supported by actual archives. Match A/B universes. Handle corrections, gaps, availability delay and OI lag.

Connect original print detail and the existing package layer. Preserve unverified association, quote-location uncertainty and verified package-net-price distinctions.

**Result:** selecting a concentration can open the underlying dated evidence without future leakage or duplicated flow.

### F. Scenarios, assistant and saved investigations

Reuse the current payoff owner. Implement the exact entry-debit robustness example as a consumer; enable pre-expiry surfaces only for admitted valuation output. Retain user assumptions and costs. Bind assistant questions to immutable evidence references through the existing grounding interface.

**Result:** one connected investigation can be saved and recovered through the existing persistence owner.

### G. Qualification and release

Run unit/integration suites, relevant existing responsive tests, current-base CI, manual browser checks and production-data parity. Obtain the applicable deployment custody/approval and release through the existing path. Keep rollback as removal/disablement of this consumer entry, not changes to source-engine truth.

**DONE_WHEN:** all five lenses function with admitted data or honest capability states; selection/clock/evidence persist; no duplicate owners; responsive and source-parity checks pass; the actual deployed route is observed on production with dated evidence. Empirical research hypotheses remain separately labeled until validated.

## 6. Required counterexample tests

1. `null` gamma is unavailable; numeric zero gamma stays zero.
2. 58.2% IV normalizes to 0.582 exactly once, not 58.2 or 0.00582.
3. Puts displayed on the left do not become negative long-option gamma.
4. Volume greater than OI never emits “opening buys confirmed.”
5. Available-at 14:30:08 is excluded at a 14:30:00 knowledge cutoff.
6. Friday OI and Monday volume retain different sessions.
7. Negative cumulative difference after a correction is not silently clamped into valid interval volume.
8. A/B comparison identifies missing/new contracts instead of calling universe changes market changes.
9. A post-trade quote cannot classify an earlier print.
10. Nearby equal-size legs without a package ID remain an association candidate.
11. Missing deliverable/multiplier blocks premium conversion rather than assuming 100.
12. Expiry at a different settlement time cannot share the same zero-DTE denominator.
13. An excluded volatility region remains a hole.
14. Model/version or units mismatch blocks a misleading surface comparison.
15. WebGL failure retains exact slices, selection and source context.
16. Root change cannot expose a prior instrument’s inspector or AI context.
17. Two open lenses do not create two polling/stream subscriptions.
18. Declining access entitlement removes data without leaking cached restricted values.

These tests are required future work. No such application tests ran in this design session.

## 7. Browser and performance evidence

Qualify 1440×900 desktop, 820×1180 tablet, 390×844 mobile and 320-pixel narrow layout. The taller Paper desktop boards are scrollable design compositions, not permission to clip a shorter application viewport. Test dark/light, EN/ZH, keyboard, 200% zoom, reduced motion and a renderer failure.

Record route, build head, source timestamp, entitlement mode, console errors, network calls and screenshots. Check selection/2D parity on real admitted data, not only synthetic fixtures. Test 1K/5K/20K marks on agreed hardware; proposed budgets are <100 ms picking and 30 fps active interaction. Record actual results before accepting them. Idle CPU and memory must also remain bounded.

## 8. Exact Paper inventory and numerical fixture meanings

| Board | Node | Dimensions |
|---|---|---|
| 3D01 Chain Observatory | `18G0-0` | 1440×1100 |
| 3D02 Volatility Terrain | `18OH-0` | 1440×1000 |
| 3D03 Replay and Change | `18TJ-0` | 1440×1100 |
| 3D04 Flow and Packages | `18XX-0` | 1440×1060 |
| 3D05 Scenario Lab | `192N-0` | 1440×1060 |
| 3D06 Mobile Exact Slice | `196F-0` | 390×844 |
| 3D07 Sources / Models / Unavailable States | `199N-0` | 820×1180 |

The 243K/110K contract is a synthetic example. Volatility terrain uses `17.88 + .02d − 8k + 300k²` in percent for illustration only. Replay arithmetic is 243,000 − 200,250 = 42,750. The package gross premium is (.48 + .18) × 500 × 100 = 33,000. The scenario expiration payoff is `100 × (min(max(S−785,0),5) − debit)`.

The accompanying fixture checks validate these stated numbers, not every decorative SVG mark, an arbitrage-free fit, application integration or profitability. Original editable Paper vectors are not an exported production renderer.

**Do not redo:** source census solely because a new chat starts; Paper creation; the five-lens architecture decision; the known gamma/OI distinctions. Recheck only relevant changed source, effect or authority. Next action remains clearing and reconciling the original host lane, then Stage A.
