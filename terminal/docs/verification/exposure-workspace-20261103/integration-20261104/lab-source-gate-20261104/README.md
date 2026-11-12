# Options Exposure — final Lab integration and source-state repair

The accepted Paper hierarchy and implementation are preserved. The bounded Research Lab integration is implemented on the original Exposure branch and qualified together with the Options workspace at protected Terminal `4df7aad16ea775ad8112858a5095210c076efe08`.

**Implementation and local integration: qualified.** This record does not assert a Git merge, native required-check completion, deployment, production-provider proof, or user acceptance of a release.

## What changed

The host now passes its qualified current Exposure book into the Lab's Replay lens. The existing Market Memory owner remains responsible for reading and validating the previous book. Its optional typed ready renderer supplies the already-bound pair to a presentation consumer; there is no additional cache, stream, request owner, retry path, or pricing model.

The integration found a concrete defect in the newer protected host forwarding. `useFlowStream` retains the last payload after a classified `unavailable` or `absent` status. Forwarding that payload based only on ticker and archive state let Replay continue displaying it as a current comparison, while the host had returned before its stale-data warning.

The repaired gate uses the desk's existing rules: current selection, valid root, a classified live data result, and no classified stream absence/unavailability. A valid direct read still works before the stream supplies a frame. Failed-source values disappear. A valid recovery frame restores the comparison for the exact selected root, expiry, strike, and option side. An archived selection supplies neither the live matrix nor a live Gamma book.

Five runtime files implement this bounded closure:

- `components/gexdesk/GexDeskView.tsx`
- `components/researchlab/OptionsResearchLab.tsx`
- `components/options-companion/GexMarketMemory.tsx`
- `components/researchlab/ResearchReportedGammaPanel.tsx`
- `components/researchlab/researchReportedGamma.ts`

All five are byte-identical between the qualified original and composed trees. The desk's sector-return comment and behavior remain intact. The default Market Memory renderer, Chain landscape, exact-values table, pinned inspector, volatility lens, Plan navigation, disclosure controls, source dates, and signed-value semantics remain available.

## Exact binding

| Owner or input | Binding |
|---|---|
| Source law | Mastermind `700eef54bca4a2dc4e30d94a6b30dcfa733ad57c` |
| Original operation | `exposure-strike-workspace-ux-20261103-c3`, PR #1243 |
| Parent published head | `04afd94cb11649820688912cf23df2f3b0a5b2c3` |
| Accepted Paper implementation | `6d6cdc727b9e8d0d70af23d8b0caa239c6304b5b` |
| Options companion | PR #1248, `98ffa891116ccc9e6be58a64148dbe45591e6ce8` |
| Protected Terminal composition | `4df7aad16ea775ad8112858a5095210c076efe08` |
| Final GexDeskView SHA256 | `e2b1cea4319f0860321d86d3fc8d8fc133060ce11cd7e1bdc0768207613d0a98` |
| Composed browser source map | 3,108 files; SHA256 `0a66cf420e9538bda0598e3c6bce3653e9bb55e7ccc12c047ca6b0762a5fa98c` |

The ignored preview is a composed source tree, not a Git merge commit. Its capture harness inherits the containing worktree's Git head as informational metadata. Qualification therefore uses the explicit input commits and file hashes above.

[Machine-readable qualification](qualification.json) · [Original final sources](original/source-final.json) · [Composed source map](composed/source-after-final-browser.json)

## Falsifiable behavior proof

The two original tests first **failed on the unpatched host**, after the native EventSource received each named status event. Both expected the reported-Gamma panel to disappear and observed that it remained mounted. The native traces contain the delivered `unavailable`/`absent` response and the failing assertion. The exact original test source is extracted from those traces in [red-source.spec.ts.txt](original/red-source.spec.ts.txt).

After repair, the original branch passed **24/24** browser tests, with one worker and **zero retries**, across desktop, tablet, and phone:

- Both failed-source transitions withdraw the comparison, introduce no replacement live/archive reader, and recover the original pin with the recovered values.
- A qualified current HTTP read works before any stream data frame.
- A previously working live comparison is followed through a deliberate archived selection, into Replay, and back to Exposure. The Lab remains intentionally empty and the archive selection survives.
- Exact reported values, source disclosure, EN/ZH rendering, dark/light component tokens, overflow, and return to Chain remain correct.

The composed Options preview passed **30/30** browser tests with **zero retries**. It repeats all 24 cases and adds the physical ladder/Market State/history journey and sector stepping/Back preference preservation across the three viewports. All 3,108 source files remained unchanged throughout that run.

[Original failing log](original/browser-before.log) · [Original passing log](original/browser-after.log) · [Composed passing log](composed/browser-final.log) · [Artifact hashes](browser-artifacts.json)

The automatic screenshots from the red tests are taken after test cleanup releases the recovery gate; they may show the recovered value. The failing assertion and native stream trace are the evidence of the pre-fix failure. Do not label those cleanup screenshots as a held failed-source state.

## Static and evidence checks

| Check | Result |
|---|---:|
| Original focused application/state unit suite after the gate repair | **304/304 passed** |
| Original final GEX/EOD evidence guards | **21/21 passed** |
| Composed focused application/state unit suite before the gate repair | **308/308 passed** |
| Composed final GEX/EOD/VI/B-PL6 evidence guards | **38/38 passed** |
| Original and composed source TypeScript | **Passed** |
| Changed runtime and proof-file lint | **Passed** |

Source TypeScript excludes generated `.next` validator output. It is not a claim that the previously failing default generated-login validator has been fixed. The earlier 18,000+ test inventory and the historical 166/171 browser run plus separate 12/12 recovery remain in [the preceding qualification](../README.md); they have not been relabeled as new full-suite passes.

Historical Paper receipts are now checked against their preserved exact manifests and immutable operation images. Current code has its own fresh source/crop receipt. The Chain Heat guard now bounds its lookup to its own receipt, so a later section cannot satisfy an earlier record's source assertion.

## Actual captures and preservation

| Tree and capture | Native results | Final use |
|---|---:|---|
| Original branch, repaired host | **54 GEX + 42 EOD = 96 passed** | New immutable operation crops; original historical root pixels remain unchanged |
| Composed protected 4df baseline before the gate repair | **114 GEX + 126 EOD = 240 passed** | Retained complete baseline |
| Composed repaired host | **54 GEX + 42 EOD = 96 passed** | Replace only the affected GEX/EOD families |
| Composed final active packet | **240 images** | 96 fresh affected images + 144 unchanged baseline images |

Each run has zero failed frames, exact expected filenames, image hashes, and stable source/harness hashes across capture. The native partial-capture contract intentionally writes PNGs without a replacement whole manifest; the qualified receipt records that scope explicitly.

A preview EOD setup attempt used reserved local port 3659 and produced **zero images**. Its log and receipt are preserved. The stopped setup was reconciled before the same bounded EOD subset ran successfully on previously verified port 3655. The successful GEX subset was not repeated.

The original and composed capture contracts differ in Levels/cache/Flow sources and the EOD dependency list. They were captured independently. One tree's source hash is never substituted for the other's.

Packet references remain under the existing owners:

- `docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-1243-lab-source-gate-20261104/`
- `docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-1243-lab-source-gate-20261104/`
- The corresponding `operations/options-combined-4df-lab-source-gate-20261104/` folders contain the frozen composed manifests, prior-root history, full baseline, affected recaptures, and final `qualified-root/` pixels.

VI's 58 and B-PL6's 55 declared layout dependencies still match their accepted manifests. Their existing qualified proof is reused within that declared scope; no fresh VI/B-PL6 browser run is claimed.

## Visual self-QA

Actual desktop, phone, and Chinese tablet screenshots were inspected for hierarchy, clipped content, readability, density, disclosure state, and horizontal overflow. The ladder remains usable, Market State stays beside it on desktop, and History fits the tablet. The Lab's recovered and archived states retain their exact identities.

[Desktop Exposure workspace](browser-artifacts/composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-desktop/exposure-entry.png) · [Phone Exposure workspace](browser-artifacts/composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-mobile/exposure-entry.png) · [Chinese tablet History](browser-artifacts/composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-tablet/history-controls.png)

The six accepted [Paper boards and JSX](../../paper-20261104/README.md) were preserved without redesign. The live app shell remains dark. Light Paper references and light component-token checks are not an appwide light-theme release claim.

All screenshots and selected decisive native traces are committed. `browser-artifacts.json` records every trace's hash and explicitly marks whether it is included; other traces remain reproducible from the fixed source and recorded commands. The `reproduction/` scripts preserve the exact attended qualification procedures and host paths; they are operation-specific records, not unattended jobs.

## Release boundary

The original branch source, the composed preview, a mergeable Git candidate, hosted required CI, deployment, and signed-in production proof are separate stages. This delivery uses synthetic data and an admitted fixture identity; it does not represent a production account or provider.

The existing **no merge, enqueue, Ready/un-draft, labels, deployment, purchase, or alternate publisher** limits remain. Publication uses the original C3 typed publisher. The final pushed head and its native GitHub status are read back in the PR description; local qualification does not replace branch protection or resolve an ancestry gate.

No optional reviewer or new external message is pending. The accepted boards, native captures, and completed checks should not be redone without a relevant source change.
