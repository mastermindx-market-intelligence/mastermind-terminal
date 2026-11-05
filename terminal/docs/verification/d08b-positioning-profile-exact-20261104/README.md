# D08B — Positioning Profile exact values

Status: **IMPLEMENTED / LOCAL_REAL_ROUTE_VERIFIED / BUILT_NOT_PROVEN_IN_PRODUCTION**.

This bounded phase is based on Terminal `5903c07acf867366659cec689e6547b08c00ee87`, after the Exposure Changes inspector. It extends the existing Positioning Profile card on `/options?tab=positioning`; it does not introduce a separate route, data owner, contract-selection state or calculation. The protected Mastermind law pin for this continuation is `70187bb1660e8a7c3038271bb9f8924b5e525cb0`. D08's frozen `D08-OPTIONS/1.0.0` remains unchanged.

## User outcome and retained analysis

A researcher can switch between the incumbent modeled exposure curve and exact supplied spot/Gamma sample pairs. Desktop uses a native table; a card container at or below 420px uses a native ordered list with definition lists. Both presentations use the same admitted samples in source order, retaining repeated spot coordinates. Positive Gamma includes `+`, negative Gamma keeps its sign, zero remains zero, and finite values use JavaScript's lossless numeric string representation rather than display rounding. The wire does not contain the original decimal text. Units remain **USD bn per +1% spot** with no conversion.

The existing curve still requires at least 11 finite paired samples. A shorter valid set is now inspectable in Exact profile values. Absent, malformed and zero-finite data have explicit empty states, without predicting that a nightly job will necessarily provide data. These are hypothetical spot coordinates, not option contracts; the view does not fabricate selected-contract identities.

Source & method exposes the supplied root, as-of, method and grid span, exact spot/call-wall/put-wall/flip references, and all finite supplied zero crossings in source order. Missing metadata stays unavailable. As-of identifies the supplied GEX snapshot and does not establish availability time. The existing closest-crossing rule, first-in-source-order tie handling and first-crossing fallback when reference spot is unavailable are preserved and explained.

The finite-pair admission loop, chart geometry and original SVG drawing elements were retained. The SVG adds a local class and a native description linked with `aria-describedby`; its drawing body is otherwise byte-identical. The original calculation section is byte-identical: 1,980 bytes, SHA-256 `9ee4f947a4e9e73af89db53f9bf297f0b18c7128f0594524cc370efec7d84047`. The original 0.05 sign-split threshold, neutral curve, spot/wall/flip markers, regime labels and estimate tier are retained. An always-mounted measurement wrapper supports initial absent-data recovery and view changes. At widths too narrow for the curve, the alternative action focuses the existing exact-values control.

## Responsive and accessibility evidence

The final actual-route browser suite covers English and Chinese at desktop, tablet and mobile sizes, plus 320px, a 230px card container, CSS 200% magnification and reduced motion. It checks keyboard switching and focus, readable unbroken precision values, container and document bounds, retained curve points after switching back, native table/list semantics, source details and the narrow-chart alternative. CSS magnification is not browser-zoom or assistive-technology certification.

Dark mode uses the existing application palette. Light coverage deliberately applies a controlled token palette to this card, including its header; it does not claim that the whole application has a released light-theme path. Local CSS improves the card's text and chart contrast without modifying shared theme or card CSS. Across 24 final contrast records, 1,216 sampled text observations have a minimum contrast ratio of **5.554996509050376:1**; 72 sampled chart marks have a minimum of **5.028420134408705:1**. These computed samples are bounded checks, not a complete WCAG audit.

Root visually inspected the final desktop light-token chart and source details, mobile Chinese exact values, 320px Chinese controls and precision, and 230px light-token precision captures. Signs and digits remain together; the source panel is readable; the controls remain available. All 48 final PNGs have paired capture metadata recording viewport, device-pixel ratio, CSS zoom and the target's visible position. Captures are actual browser output, not design mockups.

## Source and lifecycle contract

The fixture goes through the established authenticated flow route and narrowly replaces `gex:SPY`; other feed handlers remain the incumbent fixture handlers. Positioning independently defaults to SPY. Its root input, GEX/moves loading, optional feeds, cache and lifecycle remain unchanged. A different committed root withdraws old values and reads new sources. Committing the same root is a no-op; tab switching keeps Positioning mounted; no polling or in-place Retry is added.

Browser cases cover 13 dense pairs, 10 sparse pairs, filtered invalid/unpaired entries, absent source, a different-root access failure and full-page reload recovery. Reload recovery is not described as a product Retry. The fixture clock is fixed for deterministic assertions, while the supplied GEX as-of remains `2026-07-10T20:15:00Z`; stale source data is not relabeled live. The fixture uses precise signed and tiny-exponent values and equal-distance crossings to expose rounding, sign fragmentation and tie changes.

## Verification and corrections

| Check | Recorded result |
| --- | --- |
| Focused Profile tests | 13 passed, one suite |
| Actual-route final browser run | 9 passed, 9 intentional skips, exit 0; 40.1s |
| Scope of skips | Three opt-in baseline instances, four duplicate extra/source cases outside desktop, two non-mobile instances of the existing mobile-title regression |
| Scoped lint | Initial lint passed; final lint log empty and the sequential runner advanced into the build |
| Production build | Final log confirms compilation, TypeScript completion, all 68 static pages and complete route footer; no build process remains |
| Diff whitespace | `git diff --check` passed |
| Final capture set | 48 PNGs, 48 capture metadata records, 24 contrast records |

The final lint/build process response was truncated together with an image, so its original PID and direct exit receipt were not retained. The original log was read back and confirmed completed output; the process was not blindly restarted. `VERIFICATION_RESULT.json` records this recovery boundary rather than inventing a direct exit code.

The initial browser run exposed a real low-contrast Signed estimate tier (2.353887:1). A local card-header ink rule corrected it. A second diagnostic sampled a wrapper span with no own text and reported 1.40028:1 although its child text had explicit colors. The measurement was corrected to sample elements that actually paint direct text; the 4.5:1 threshold was unchanged. Both failure logs and the real initial contrast captures remain under this proof directory. The final run passed all applicable assertions.

The before captures show a slight card-bound overflow at 320px and rounded labels without exact sample access; they do not show a 640px unmeasured SVG. The sparse baseline hid the curve and promised a next nightly build. The implementation fixes those specific observed limitations. A production/provider account path, screen-reader run, browser-native zoom, performance audit and released foundation integration were not performed.

## Exact source binding

| File | Final Git blob |
| --- | --- |
| `components/msc/ProfileCard.tsx` | `8a7bb3571390a92d1ee115ffb9364893e5505fd2` |
| `components/msc/ProfileCard.module.css` | `1465099d4ac0009a5875064269e8d79af569dbff` |
| `components/msc/profileStrings.ts` | `f8610fae276a760867fc90af10e964c631d1f975` |
| `lib/__tests__/profileExactValues.test.tsx` | `205649983e818d5410516dabd7753a4b0dfdbc84` |
| `e2e/options-positioning-profile-exact.spec.ts` | `2d2a1fc60a69114812fb5fc4e8c7407988124913` |

The source owner/model, Positioning coordinator, GEX desk, shared chart hook, MscCard and shared CSS were not edited in this phase. `MarketStructureBody.tsx` remains `b4aa15e92f8b5797cf8218c516571dd48a0645ef`, `mscStrings.ts` remains `c2cc28991b1134701fc9ed1b0468cce677803e68`, and `lib/marketStructure.ts` remains `b6718d3f162117af38d114ba691cd4b6b1894bd8` at this phase boundary. Later independently scoped Sign presentation work may intentionally modify the first two; it must not invalidate the preserved Profile calculations or claim those files remained globally unchanged.

This proof does not reopen the accepted Surface/Skew/Term/History or Exposure Changes phases, alter D08C/D08D ownership, approve a PR, merge, enqueue or deploy. Parent acceptance, remaining owner integration and production evidence stay separate.
