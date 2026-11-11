# Transcript focus recovery on #1033

The inbox import head passed its unit/typecheck gate (23,128 passing tests) but natural CI 43000889110 failed one desktop journey in job 130457128921: the transcript source segment did not regain focus after reopening. All three attempts failed at the same assertion; that shard otherwise passed 184 tests with 32 authored skips.

## Cause and change

The real drawer mounts its portal on its first animation frame. A no-store transcript response and real canonical revision check can finish before that frame. The old focus effect then finds no owned element, and portal readiness does not retrigger it. A matching global segment can also be incorrectly selected before this drawer exists. The saved hosted symptom is consistent with this ordering; the hosted log does not record the relative frame/response times.

The fix adds the existing mounted state to the focus guard and effect dependencies, and scopes the target lookup to the drawer ref. The existing modal focus effect runs first; the verified segment then receives focus. No additional frame, timer, retry, timeout, copy owner or publisher is added.

## Discriminating checks

The mounted test uses the real component, portal, canonical body hash, focus behavior and clipboard feedback. Only the response boundary, animation-frame queue and unsupported JSDOM scrolling/clipboard surfaces are controlled.

On the exact original component, two controls fail: a response-before-frame reopen leaves Close focused; with an unrelated matching segment, focus escapes to that foreign element before the portal exists. Cold load and revision mismatch pass. After repair all four mounted cases pass, including prior-copy rejection after reopen, scoped target scrolling and opener restoration. The transcript normalization/search/comparison suites bring the focused total to 55 passing tests. Changed-file ESLint exits zero. The unchanged browser spec collects 42 project instances; collection is not browser execution.

## Scope

This is an additive repair on the original #1033 branch. Prior inbox source and qualified images are preserved. Nullable publication/old-client obligations, #662 scheduling hold, producerActivation=false and productionAcceptance=false remain. The original local Chromium refusal remains; no local browser was retried. Natural CI on the published follow-up must verify the actual browser journey. No merge, deployment, scheduling or publication activation is claimed.
