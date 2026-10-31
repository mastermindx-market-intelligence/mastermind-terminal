# Screener real HTTP recovery evidence

Six scoped browser cases passed at source `def8a467f05c1805b21e7aa578ab439d6b0e6c2d` (tree `7e7912c1f2b3ccc2e46ddf94eecfe6fde0efc042`), using Chromium 149.0.7827.55 in English at 1440×900 desktop and 390×844 mobile. This publication adds evidence only. It does not reattribute captures to a later GitHub merge checkout.

| Consumer path | Desktop | Mobile | Proven behavior |
|---|---|---|---|
| Cached scan during outage | Pass | Pass | Naturally aged app-written IndexedDB retains all 9,500 rows and exact hash/timestamp/date through failed refresh. Explicit online Retry alone consumes the new date/price; the Up ≥3% filter remains and changes 4,750 results to 4,751. |
| Uncached first read | Pass | Pass | Initial failure and three explicit offline retries leave cache null and show an explanatory unavailable panel with Retry, rather than a false empty scan. One online Retry loads 9,500 rows. |
| Three outage/recovery cycles | Pass | Pass | Each recovery adds exactly one manifest request. Each device has four real HTTP 200 responses and six native offline failures across ten attempts. Recovered DOM/listener counts and one owned Screener ResizeObserver stay constant across all three samples. |

The manifest request uses `route.continue` to a dedicated temporary public fixture on the actual local app server. Native browser offline mode yields `net::ERR_INTERNET_DISCONNECTED`, with zero manifest HTTP responses while offline. Online responses have loopback remote IP and neither disk-cache nor service-worker provenance. Natural cache expiry waits at least 65 seconds; no fake clock, IDB seeding or timestamp rewrite is used. Auxiliary flow/quote legs remain explicit fulfilled fixtures and are **not** network-recovery evidence.

`measurements.json` binds the six cases, original measurement and acceptance digests, and all 20 reviewed PNGs. The first four cases and their 12 images reuse already accepted evidence; only the interrupted mobile repeated-cycle case was completed on October 15. The original desktop repeated-cycle pass was retained without rerunning it. The interrupted controller exit remains unknown; the mobile completion returned zero and its exact fixture directory and server were removed.

The tests observe zero owner writes. Cached/repeated cases do attempt expected analytics POSTs while offline; these are separate from owner writes. The independent Smart Screens account-read warning remains visible after manifest recovery. The test does not claim that all page requests recover.

## Limits and review state

This is root-parent accepted, local synthetic-fixture browser proof. The original Fabric protocol review has **not** been accepted: same-run observation returned `original_run_observation_unconfirmed`; it has not been retried, replaced or retrieved through another path. This publication is not independent review clearance.

Native DOM counters were compared only at matched recovered states after collection; they do not prove zero total-heap growth or all-app resource safety. Existing positive leak controls are retained separately. The known missing development preload remains, so a clean latency baseline is **not accepted**. These cases do not establish tablet, Chinese, theme, full-accessibility, real-provider, authenticated-principal, full-journey, installed or production acceptance. All release, schema, rights and live-effect holds remain in place.

Original harness failures involving event delivery, request identity and archived test discovery were preserved and corrected before accepted runs. No product repair is claimed by this evidence package. Existing evidence matrices, recipes and before images remain unchanged.
