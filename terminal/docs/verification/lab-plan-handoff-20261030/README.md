# Lab Scenario → exact-contract Plan handoff

Source-only Draft integration from protected Terminal `729a781acdb639f9e8ef9aaaba043c7624b6ceda`, commissioned through [Terminal #1151](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1151). Original Lab root: `01a118f3-fc4e-7941-b432-03703dccd19b`.

The Scenario lens now offers navigation to the existing exact-contract shortlist when its host admits the Screener. The callback takes zero arguments. Matrix coordinates are never converted to doi/hot snapshots, Plan assumptions, valuation requests or persistence records. The existing shortlist retains pins; leaving it unmounts its previous draft. A fresh draft requires the existing explicit Plan button and starts with blank assumptions. No compatible draft is available inside the Lab to transfer.

## Verification

- Existing affected suites: 33 tests passed across Lab view, shortlist Plan, workspace navigation, Plan scope and payoff panel. After the review repair, the extended Lab suite passed 11 tests (10 reused cases plus one new callback/withdrawal regression); 34 distinct affected unit cases resolved.
- Playwright: 12 cases passed in 24.1s, EN/ZH × dark/light × desktop 1440×900, tablet 820×1180 and mobile 390×844. Each proves zero Matrix-to-Plan promotion, explicit exact-contract pinning, blank assumptions, zero automatic valuation calls, preserved pins and cleared draft on a Lab round trip, preserved unrelated URL state and no horizontal overflow.
- TypeScript `--noEmit --incremental false`: passed. The three source files have exactly the baseline ESLint diagnostic set (29 Hub, 2 GexDesk, 0 Lab; 18 errors and 13 warnings total), with no new rule/message/severity differences. Diff whitespace check passed.
- Browser cases use synthetic development identity and routed Matrix/OI fixtures. The theme is explicitly applied as a presentation fixture and asserted on the root; this does not prove real account preference synchronization or authenticated production behavior. The local runner disables unrelated global route warming, uses one worker and zero retries; CI retains the repository configuration.

Initial test-harness assumptions about the URL alias and the absent empty-shortlist Plan control failed and were corrected against the actual native UI. Initial light captures were dark due to an incorrect preference fixture and are not accepted as light evidence. A subsequent round-trip test falsified the original draft-retention claim, matching the independent review; the disclosure and regression now match the existing unmount lifecycle.

## Independent review and adjudication

Admitted Fabric `options3d-plan-handoff-review-20261030-r1` returned a non-author Cursor/Grok static review, rc0. It found (1) Medium: the initial copy incorrectly promised draft retention, and (2) Low: the Chinese button implied immediate creation. Parent reproduced (1) in the browser and adopted the review's scoped copy repair; both languages now promise only pinned-contract retention and explicit draft creation, with a navigation-shaped Chinese CTA. The callback/routing implementation was otherwise found sound. The useful review report was accepted through the incumbent result owner; this is **not** an independent PASS claim on the later copy repair. Parent tests qualify that repair.

Separate GLM test worker `options3d-plan-handoff-tests-20261030-r1` completed, but export refused the local destination (`destination_outside_approved_evidence_root`). No export retry or alternate retrieval occurred. Its unseen artifact was not integrated or accepted. The committed regression extends the existing local suite and was authored and run by the parent.

This review is solely for the new navigation seam. It neither retries nor replaces frozen Matrix HTTP/auth review `61394`, and grants no auth, rights, Matrix HTTP, Save or release acceptance. No provider, grant, runtime or persistence mutation occurred.

## Visual scope

The new panel reuses existing governed Lab capability/back controls. Dark uses the incumbent low-luminance surfaces; light uses the incumbent white material and neutral shadow/borders. No new palette or stylesheet is introduced. Existing page styling outside the handoff is inherited, including the light overview accent. No-callback hosts retain the prior unavailable state.

Each filename encodes viewport, state, language and theme. `scenario-*` shows the disclosure/action; `plan-*` shows the existing editor after the round trip and explicit new draft. Representative comparisons:

| Viewport | Dark | Light |
|---|---|---|
| Desktop EN | [Scenario](desktop-scenario-en-dark.png) / [Plan](desktop-plan-en-dark.png) | [Scenario](desktop-scenario-en-light.png) / [Plan](desktop-plan-en-light.png) |
| Tablet ZH | [Scenario](tablet-scenario-zh-dark.png) / [Plan](tablet-plan-zh-dark.png) | [Scenario](tablet-scenario-zh-light.png) / [Plan](tablet-plan-zh-light.png) |
| Mobile ZH | [Scenario](mobile-scenario-zh-dark.png) / [Plan](mobile-plan-zh-dark.png) | [Scenario](mobile-scenario-zh-light.png) / [Plan](mobile-plan-zh-light.png) |

## Integration boundary

Draft only: no arm, merge, deploy or production claim. IW2/full-suite integration remains the sole Save/reopen owner. Commercial Theta rights are approved by Chairman attestation; actual technical enrollment and authenticated source/consumer qualification remain separate. Original review publication/lease UNKNOWN and T03k UNKNOWN remain held. The original Matrix transport carriers #10126/#1151 are unchanged by this navigation slice.
