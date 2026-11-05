# D08B — Positioning Sign robustness: honest uncertainty and threshold explanation

**IMPLEMENTED / LOCAL_REAL_ROUTE_VERIFIED / BUILT_NOT_PROVEN_IN_PRODUCTION.**

This phase continues Terminal Draft #1266 from `fd014cb9acbecd319ad7816a6514197f0f446e83`, through the original managed operation `d08b-surface-exact-values-20261104-c3`. Protected Mastermind pin: `70187bb1660e8a7c3038271bb9f8924b5e525cb0`. D08-OPTIONS/1.0.0, D08C contract/Plan ownership and D08D replay/availability ownership remain unchanged.

## Before and after

The incumbent Sign card treated the model's `unknown` verdict as **No gamma**, described a null critical weight as unflippable, displayed its synthetic flat zero curve and used the robust footer. A nonempty ladder can contain reported net Gamma while lacking the side-magnitude basis needed for sign sensitivity. The actual-route baseline demonstrates this with **60 mn of reported Gamma**.

The card now displays **Unknown / 未知** and **Not determined / 未确定**, explains that the supplied inputs do not establish the estimate, and withholds the unsupported curve and weight-axis labels. The source convention remains visible. The model does not distinguish missing side magnitudes from supplied zero side magnitudes; the presentation does not invent that distinction or infer that net Gamma is absent.

The same review found that the old robust footer promised survival across the full convention range. The unchanged model actually classifies robustness from absolute tilt against `TILT_FRAGILE_ABS`, currently **0.12**. A robust 400/100 call/put magnitude example still crosses zero at call weight **0.25**. The corrected explanation imports the existing constant, displays **12.0%**, and directs the reader to the curve and flip weight to see whether another convention changes the estimated sign. The label, threshold, formula and critical weight are unchanged.

## Useful investigation states

The browser goes through the existing `/options?tab=positioning` route. It narrowly substitutes `gex:SPY` through the established fixture/auth arrangement, leaving the parent reader and other feeds intact. The three-strike toy books retain original root, schema, reference spot, as-of and convention; unrelated profile/history/coverage/expiry/delta/level evidence is withheld. The source Greek and curve unit is **USD mn per +1% spot**; the existing headline remains bn with the corresponding fixture conversion. This is distinct from Profile's existing bn unit.

| Supplied example | Model result, retained | Correct user-visible result |
| --- | --- | --- |
| Net-only rows sum to 60 mn; no side-magnitude basis | Unknown; tilt and critical weight null | Unknown, Not determined, explanation and convention; no fabricated flat curve |
| Supplied side magnitudes both zero | Same unknown estimate | Same explanation; no invented missing-versus-zero diagnosis |
| Call/put magnitudes 400/100 | Robust; tilt 60%; critical weight 0.25 | Original rising five-point curve and two markers; explicit threshold explanation without an all-conventions guarantee |
| Call/put magnitudes 400/360 | Fragile; tilt about 5.3%; critical weight 0.90 | Original sensitivity curve, warning meaning, critical/current markers and fragile explanation |
| Put-only 0/300 | Robust; tilt −100%; null critical weight | Valid no-crossing readout and constant negative curve; null alone does not mean unknown |

The unit suite additionally checks an out-of-range crossing and the exact 12% boundary. Known point values, sign relative to zero, critical and current markers, source convention and verdicts are checked through the actual model and browser route.

The measurement element stays attached while the estimate is unknown. Unit tests establish same-element prop recovery; the real browser establishes its survival through a viewport resize. The existing Positioning parent requires a different committed root or a full page reload for a new source read. Browser source loss uses a controlled QQQ 403 and verifies removal of the old card; SPY reload recovery returns to honest unknown state. This does not claim an in-place Retry or same-element source replacement that the parent does not provide.

The supplied as-of remains `2026-07-10T20:15:00Z`; the existing stale header and convention are retained. No observation is relabeled live, no availability timestamp is fabricated, and no complete contract/side coverage is inferred from a nonempty ladder.

## Responsive and visual acceptance

Actual browser journeys cover EN/ZH at 1440px desktop, 820px tablet and 390px mobile, with additional 320px phone cases and a reduced-motion resize/source-loss journey. All stat labels and the whole explanation/convention footer remain in the 320px viewport. The existing tier/tooltips, root input and source clock remain available. No analytical controls were removed.

Local `SignCard.module.css` corrects the observed label, tier, footer and zero-reference contrast. Fragile ink uses a local mix of the existing warning and text tokens, retaining amber meaning while making the light palette readable. The styles affect this card only. Point geometry and numerical values do not change.

Final evidence contains **52 viewport PNGs**, **52 capture metadata records**, **40 contrast records** and **six state/geometry inventories**. Across sampled direct styles, **478 text observations** have a minimum ratio of **4.8720061448799585:1** and **102 chart-mark observations** have a minimum of **3.6558670736197985:1**. Every sampled text observation meets 4.5:1 and every sampled mark, including the zero line, meets 3:1.

Root visually inspected 320px English unknown, 320px Chinese put-only, desktop English light-token Fragile, and the 320px English source-header capture. The latter visibly includes SPY, the full source date and the stale label. Its automated capture hit-tests the input, not the entire wider header wrapper; horizontal date checks and visual inspection support the specific captured result, without claiming a generic full-header occlusion proof.

Light coverage applies existing shared-shell light tokens to this card. It does not activate or certify a released application-wide theme. Contrast checks use direct rendered styles against an opaque background; gradients, alpha compositing, ancestor opacity, screen-reader use and complete WCAG conformance are not certified. Root did not use synthetic mockups as browser evidence.

## Final verification

| Check | Result |
| --- | --- |
| Focused unit run | **91 passed**, exit 0: 14 new Sign cases, 64 existing model cases, 13 Profile cases |
| Scoped lint | **PASS**, exit 0 |
| Actual-route browser run | **7 passed / 5 intentional skips**, exit 0; six locale/viewport journeys and one actual-parent lifecycle journey |
| Skip meaning | Three opt-in original-baseline instances and two non-desktop duplicates of the lifecycle case |
| Production build | **PASS**, exit 0, including TypeScript and static generation; original stage receipt retained |
| Source diff whitespace | **PASS** |
| Before baseline | One corrected baseline case passed against original source, demonstrating both defects; not counted as final-product acceptance |

The final production build includes the retained final Inspector and Profile changes as well as this Sign phase. It supplies a current full-tree build result without rewriting the earlier Inspector timing caveat or inventing the lost original Profile exit receipt.

`run-result.json` binds the source blobs, commands, stage exit codes, UTC timestamps and isolated test-server port. Existing test fixture/auth seams were used; there is no live provider/account, deployed browser, persistence or product-acceptance claim. Repeated unit and browser executions are not added as unique tests.

### Retained diagnostics and their disposition

1. The first baseline harness incorrectly asked whether a horizontal SVG polyline had a nonzero visible bounding box. It now checks the visible containing SVG plus retained points; the valid put-only negative horizontal curve receives the same correct treatment. The original failure log and screenshot remain.
2. The first full browser diagnostic found low-contrast labels (2.353887:1), a near-invisible zero line (1.062240:1) and a source-header capture target wider than its visible control. Local card ink/zero-line styles and a source-input capture target corrected those specific issues.
3. Enforcing light Fragile coverage exposed the existing warning token at 2.156628:1. The Sign-local warning mix corrected it, with the threshold unchanged. Its failure log/screenshots remain.
4. The final suite passes all applicable assertions. No failed modifying operation was replayed and no assertion threshold was lowered.

## Exact source and invariants

| Final file | Git blob |
| --- | --- |
| `components/msc/MarketStructureBody.tsx` | `f8f018ae1e80d2ce5c87131a652044fa23c87762` |
| `components/msc/mscStrings.ts` | `d9874f831d33831d0fced203512c1cfa2e7e4b0f` |
| `components/msc/SignCard.module.css` | `988784e44da60532c653ba6af3732edf3d9410df` |
| `lib/__tests__/positioningSignState.test.tsx` | `e8f9d804f644c7b233a89877698ca90bd8b84cef` |
| `e2e/options-positioning-sign-state.spec.ts` | `c99fe4b69f410979a6bd60d3fffd90fe75e4d8c3` |
| Unchanged calculation owner, `lib/marketStructure.ts` | `b6718d3f162117af38d114ba691cd4b6b1894bd8` |

Every other card remains byte-identical, apart from the two imports needed for the existing threshold and local CSS. The critical-weight/geometry block is byte-identical: **958 bytes**, SHA-256 `4e877271f35dd63ac63ad367889612069d95967e6df129a1a6ed993edcf7d0d7`. The SVG drawing structure matches after normalizing the intentional fragile-color token change. Raw SVG source is **not** claimed byte-identical: fragile stroke/fill references and computed zero-line contrast intentionally improve.

Root independently reviewed the prepared source, pure-model fixtures and actual runtime results. A bounded native static audit independently confirmed the final source preservation and identified the precise SVG/source-header qualifications recorded here. It performed no remote effects or formal GitHub approval. Native helpers were used for separable source/fixture/draft preparation; root retained every managed source mutation and publication. No external Fable/Fabric admission or second writer was created.

The complete prior PR-path census covered the existing Body/strings and new unit/browser paths without a hit; the overlapping model owner remains untouched. The new local CSS target was confirmed absent before creation. Open PR overlap is not represented as a live lease. The exact original Paper B14/RP02 targets were inspected read-only; no Paper edit or retry occurs in this phase.

This is bounded evidence for retained uncertainty/source qualification and responsive investigation, including R12/R22 and A15/A20 context. It does not globally mark the 60-item ledger or A01–A26 complete. Levels, matrix/node/Lab integration, released foundation, full source/access, exact-contract/cutoff integration and production proof retain their established owners. No merge, Ready/un-draft, enqueue, held relabel or deployment is authorized or performed.
