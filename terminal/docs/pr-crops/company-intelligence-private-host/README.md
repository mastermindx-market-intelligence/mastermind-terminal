# Private Company Intelligence host recovery — 2026-10-17

## Accepted source and recovered gap

Protected Terminal base: `a0b8c735062cb6ff8ebe13f9e3aef19e845450b8`.
Recovered accepted host patch: `d9acb6709751f5964c2cb2b9a9ca6e0dd01b3d3a`.
This change restores the actual chart, dossier and Analysis mounts of the existing private Company Intelligence wrapper. Terminal passes its settled identity and preferences readiness; Analysis uses the existing shell identity and a valid settled symbol. Public Company Intelligence failure does not gate the private mount.

Actual browser testing found that MegaPane's workspace layout removed the chart's `pane` parameter. The source repair reuses the existing `host: "chart" | "route"` distinction from chart workstream #959/#960. Only a standalone route removes the legacy pane mirror; chart workspace page changes preserve/update `pane`. Explicit close behavior remains with its existing owner.

Product and browser-test source captured: **`783c0db46b2b8fb0b42438ea8166d4d549126799`**.
Later evidence-only commits do not change the captured source files.

## Evidence

- **27/27 browser tests**, desktop 1440×900, tablet 820×1180 and mobile 390×844; one worker, zero retries; 121.53 seconds including process overhead.
- EN and ZH; actual dark hosts plus an explicitly controlled `html[data-theme=light]` variant. The private wrapper's dark presentation remains the existing behavior. These variants do **not** establish a saved light-mode preference.
- All three actual routes are exercised: chart `/terminal?symbol=NVDA&pane=intelligence`, dossier `/terminal?symbol=NVDA&shell=app&dossier=1&pane=intelligence`, Analysis `/analysis?symbol=NVDA&page=intelligence`.
- Ready, metadata-only and empty selections; selected fact changes clear previous fields; navigation discards late completion; fresh UUID with the same fixture email starts a new private chain; chart reload preserves the research page.
- Thirty-six PNG/JSON receipt pairs bind the source SHA, nine source-file SHA-256 values, viewport, locale, private request trace and PNG hash. All pairs were verified against unchanged source after capture.
- Root inspected current mobile ZH dark and tablet Analysis ZH controlled-light crops, as well as the earlier actual desktop Analysis capture. Long source-reference values remain part of the scrollable drilldown.
- Existing six private decoder/route/wrapper/panel/host/hook suites passed **240 tests** on the restored source. The subsequent host URL repair passed **41 affected tests across six suites**, including the expanded ten-test host suite. These counts overlap and are not additive. TypeScript and `git diff --check` passed.
- Native ticker-news capture ran after the final TerminalShell change: **4 desktop tests + 1 mobile unavailable-state test**, zero retries. Ten fresh native crops and their source hashes are in the adjacent `ticker-news/EVIDENCE.yml`. Identical pixels can leave some regenerated images unchanged in Git.

## Proof boundary

These are **actual Terminal host journeys using synthetic browser-fixture data**. Before navigation, every private endpoint is intercepted; an unexpected private request is aborted. Public CI is deliberately unavailable in this fixture. Private BFF authority is separately exercised by the existing unit suites.

The synthetic issuer, CIK, product names, fact hashes and edition hashes do not claim an admitted real-company disclosure. The visible fact remains planned product integration with unknown commercial magnitude. Source date precision and the original microsecond/offset observation string are retained. No supplier, customer, revenue dependence or causal edge is inferred.

`productionApiAcceptance=false`; `liveEntitlementAcceptance=false`. No unresolved F04 application request was replayed. The original two 524 operations remain EFFECT_UNKNOWN until their original attempt identities and termination are recovered.

## Composition and next gates

Open chart PR #960 has additional accepted close-request, overlay and scroll-lock changes. Future composition must retain its `host="chart"`, `closeRequest`, handled-close reference, overlay presentation and scroll locking, together with these identity/readiness mounts and the host-qualified URL condition. The composed #960 tree has not been compiled or browser-tested by this recovery.

This restores the existing three-read private journey. The separately designed native issuer economic-context contract will replace it with a context-plus-bundle journey after Macro #9423 and its serving API are accepted. No duplicate graph, identity, admission, entitlement or publication owner is introduced.

This first journey is not full GMI completion. US/China universe qualification, business-activity admission, typed economic relationships, historical cutoffs and removals, broader sector coverage, production installation and actual source-to-Terminal acceptance remain on the reconciled program map in Macro #9520.
