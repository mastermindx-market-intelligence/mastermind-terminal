# D06 compact chart: daily dates and honest load states

The embed now identifies the daily bar it displays and distinguishes confirmed missing history from a failed or unusable response. It also gives attribution its own row, keeps narrow clean-mode controls from scrolling the entire widget, and honors reduced motion without a server/client markup mismatch.

This is a bounded implementation of the existing [D06 EMBED01–02 requirements](https://github.com/mastermindx-market-intelligence/macro/blob/ae52ee1a5118d5d169422bce98ac2f2c88409551/research/design_candidates/production_design_20261102/d06/BUILD_AND_TEST_PLAN.md). It remains on the original D06 Draft #1270 branch and publisher. It is not complete D06, final foundation composition, native-host acceptance, deployment or production proof.

## Behavior and source truth

| Observation | Rendered outcome |
| --- | --- |
| Request pending | Loading skeleton and one localized status region |
| Explicit HTTP 404, or a successful object with an empty bars array | Existing no-history message; loading indicators stop |
| Other failed HTTP status, network rejection or invalid JSON | Daily chart unavailable; no claim that the symbol lacks history |
| Missing/nonarray bars, a nonempty payload with no usable rows, or duplicate usable dates | Unavailable; no unsafe chart series is created |
| Usable normalized series | Existing quote/chart plus the actual displayed daily bar date |

The existing same-origin fetch, force-cache policy and cleanup fence remain the only request owner. The local data fallback explicitly returns a no-store 404 for missing files; production static serving remains with its existing owner. There is no new retry loop, cache, feed, source clock or global state.

[chartData.ts](../lib/embed/chartData.ts) validates canonical YYYY-MM-DD calendar days before rendering. It retains the incumbent finite-OHLC filtering and invalid-volume-to-zero fallback. Mixed usable/unusable rows may still produce a chart from the usable subset. Duplicate usable dates are rejected without selecting or inventing a winner. A valid calendar date does not establish exchange-session validity, completed-session status, provenance or point-in-time correctness.

The header says **Latest daily bar** for the latest normalized quote. When the existing crosshair presents historical OHLC, it says **Daily bar** and uses that hovered bar's date. The date remains date-only; it is not translated into a local instant. It does not claim a live quote, refresh time, publication time or source freshness. Both date-line extremes in the tests preserve the deliberately old final date, 2024-03-04.

The pre-mounted local status region announces loading and settled outcomes in EN/ZH. Crosshair movement does not change that region. The quote skeleton renders only while loading. Existing content-language declarations, saved application language, invalid-symbol view and query parsing retain their owners.

## Layout and accessibility repairs

The attribution link occupies a flex row outside the chart body. Its bounds and full focus outline stay outside the canvas/time axis. It has a 24px minimum height with a fine pointer and 44px with a coarse pointer. This does not qualify every other incumbent control's target size.

The 320px clean-mode test initially failed after clicking the fullscreen affordance: the header's intrinsic minimum width scrolled the entire fixed root sideways, moving the date to x=-44. Allowing the existing right-hand header group to shrink contains horizontal scrolling within the range strip. The chart and quote stay in place.

Reduced-motion testing also exposed an incumbent hydration mismatch: render-time matchMedia added no-anim only in the browser. The existing CSS media query now exclusively controls shimmer and ribbon animation. The final tests assert a hidden loading shimmer, no ribbon animation, and no captured hydration errors. No replacement motion preference or lifecycle owner is introduced.

Visual review caught pale date text in the light clean variant. The date and new unavailable message now use the existing theme text color. Eighteen actual computed-color observations measured at least **14.053766617886108:1** on the tested opaque backgrounds. Transparent embeds still depend on the external host background; no transparent-host contrast acceptance is inferred.

The native flags are preserved: hdr=0 hides the quote/date group; clean=1 keeps the candle-only layout and hides attribution/legend; fs=1 retains the existing native bridge and ordinary-browser no-op; transparency reaches html/body. The browser tests do not exercise an actual native host.

## Verification

The complete [receipt](pr-crops/d06-embed-data/verification.json), [tested source hashes](pr-crops/d06-embed-data/source-hashes.json), reports, observations and raw PNGs are retained together.

| Check | Actual result |
| --- | --- |
| Unchanged-source failure proof | Two EN/ZH phone failures: HTTP 503 was mislabeled as no history |
| Data-helper unit tests | 47 passed, zero failed |
| First full browser attempt | 38 passed, one failed; exposed 320px root scrolling; its trace also records reduced-motion hydration mismatch |
| Repaired full browser run | 39 passed, zero failed/skipped/flaky: 21 new data/variant executions plus 18 existing language regressions |
| Final color refinement | Nine overlapping ready/compact executions passed after the final two text-color changes; includes three light clean-mode unavailable views |
| Final static checks | TypeScript passes; four changed helper/test files have zero lint findings |
| Existing component lint | Same five pre-existing findings: one effect-state finding and four explicit-any findings; offending-source signatures match the published baseline |
| Visual review | 29 of 33 retained success captures inspected, including every final ready/focus/short-mode capture and two phone empty-state samples; three failure captures also retained |
| Contrast and geometry | 18 contrast observations, minimum 14.05:1; no root/document horizontal overflow; attribution clear of chart; at least 137.85px chart height in tested 300px frames |

The two successful browser runs overlap; they are not 48 distinct cases. The full run precedes the final date/unavailable text-color refinement. The final nine cases verify that refinement and the affected ready/compact paths. Data interpretation, request lifecycle and existing language behavior did not change after the full run.

Actual local routes use deterministic fixtures at 1440×900, 820×1180 and 390×844. Short-frame checks use 900×300, 390×300 and 320×300. EN uses Pacific/Honolulu; ZH uses Pacific/Kiritimati. The source-state matrix explicitly covers 404, empty arrays, 503, aborted requests, invalid JSON, missing/nonarray bars, unusable OHLC, impossible dates and duplicate dates. Unit cases add leap years, noncanonical strings, sorting, partial usable history, invalid-volume fallback and a single-bar quote.

The browser also preserves range selection, SMA toggling, the existing symbol/CTA URL, scoped language and host flags. The final status remains unchanged during crosshair inspection. Keyboard Tab/Shift+Tab reaches the attribution with a visible complete focus outline.

## Source binding and reproduction

Source parent: d73e55b556c532d09ad144e69be0673db31d035c. Protected procedure pin: 75a6540519cf519edfef7633e74f57b68aef9329. The containing commit plus the five source/test hashes identify the tested implementation. The separate Macro continuation binds publication effects and hosted CI after readback.

Run from the existing terminal application directory:

    npm test -- lib/__tests__/embedChartData.test.ts
    TERMINAL_E2E_PORT=50354 TERMINAL_VISUAL_EVIDENCE_OPERATION=d06-embed-data-reproduce npm run test:e2e:responsive -- e2e/embed-data-state.spec.ts e2e/embed-content-language.spec.ts --project=desktop --project=tablet --project=mobile --workers=2 --retries=0
    ./node_modules/.bin/tsc --noEmit --incremental false

Run TypeScript after the dedicated browser server exits so generated route types are complete. The retained raw reports bind the actual commands and fixture configuration. Existing five component lint findings are disclosed; no suppression is added.

## Acceptance limits

This adds bounded partial EMBED01–02 evidence and extends already-partial HIST02/A11Y02–04 subsets. The 75 complete-case requirements remain authoritative. Repeated-parameter precedence, every symbol/range/visual combination, reload/CTA context semantics, actual native fullscreen and frame ancestors remain separately qualified work.

No actual 400% zoom, physical-device or assistive-technology pronunciation proof is claimed. Existing zoom restrictions, full palette/axis/target conformance, financial bar-quality semantics, upstream freshness and production serving remain open. The volume fallback remains a known limitation: zero after normalization does not prove observed zero volume.

Both existing PRs remain Draft. Shared F01/F02 final composition, exact C4 Paper write admission, required current-head CI, formal non-author approvals where binding, and the existing Ready/merge/deployment holds retain their owners. No Paper mutation, external message, automatic observer or deployment is part of this slice.
