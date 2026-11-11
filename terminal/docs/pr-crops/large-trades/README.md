# Large Trades and Absorption — UI evidence

This packet contains **32 original browser PNGs**: 21 deterministic EN/ZH fixture views, nine views of the reviewed IEX v4 historical envelope, and two supplemental desktop views after changing the minimum executed quantity through the actual settings UI. The [manifest](manifest.json) records every image hash, viewport, capture time/window, source snapshot and verification stage. Original bytes were checked against their capture receipts before copying and again after copying.

## Source and verification

The UI implementation is commit `4d6d81876d245b45adc0df235ab4439944a06b00`; its integration with the reviewed upstream change is `28851b8d823ee38516c8902da3c9b3453a95ee7e`. All 18 final UI file hashes match both commits and the inspected working tree. Shared `i18n.tsx` remains exactly at the original base; feature copy uses the existing language state with scoped labels.

Verification ran in this order:

| Stage | Result | Evidence meaning |
| --- | --- | --- |
| Full baseline | 24/24 journeys | 21 fixture journeys and three then-current historical v2 journeys; v2 images are superseded and excluded. |
| Responsive inspection refinement | 6/6 journeys | EN/ZH at 1440×900, 820×1180 and 390×844 after scoped stacking and sticky Close fixes. Supplies all 21 fixture PNGs. |
| Final settings and reviewed v4 data | 9/9 journeys | Six settings journeys plus three historical journeys on the final UI source. Supplies nine v4 PNGs. |
| Supplemental manual desktop filter | 1 journey passed | Actual settings changed from 100 to 1,000 shares on the same v4 bytes. Supplies two PNGs. |

These stages repeat some journeys; their counts are not an additive unique-test claim. The fixture images predate the final settings normalization. Their capture-stage hashes remain in the manifest; final settings behavior was then verified across all three viewports. The final source also passed **121 tests in five files** (111 feature checks and 10 existing indicator checks) and `tsc --noEmit`. Sanitized logs and reproduction command templates are included.

## What the images establish

The fixture marker **1,301 means 1,301 executed shares from three reports: 500 + 501 + 300**. It does not establish 1,301 orders. The inspector separately exposes quantities, report records, unavailable distinct-order count, side evidence, response states and evidence clocks. Adverse selling-continuation views are included. Terminal supports dark appearance; EN/ZH captures are language variants.

The final real-data views use the exact reviewed NVDA envelope with SHA-256 `015eab741c6bc40ef9931a4683584cdafee9eedfffc299e75824b1560cccd2b9`: **408 reports and 37,667 eligible captured shares** from the partial IEX archive for 2026-10-05. Every historical PNG shows this venue and historical scope. The 100-share default retains 153 clusters and intentionally preserves the crowded-label stress case. The supplemental 1,000-share filter retains three clusters; its inspector shows **1,200 shares across four reports**, unknown direction, unavailable distinct orders and the applied threshold. The 1,000 value is a manual display choice, not a calibrated recommendation.

## Evidence boundaries

The historical lane intercepts the same-origin read request with those exact decoded bytes. Chart coordinates come from the same partial IEX executions without gap filling. Surrounding header, watchlist and unrelated page context still use Terminal E2E fixtures; their prices/status do not prove a coherent historical market page. Archive acquisition happened later, so original decision-time availability is not established. Qualified response data is unavailable and absorption is not established.

This packet proves local rendering and inspection behavior under the stated inputs. Authenticated production serving, ordinary source publication, deployment and production browser behavior require separate evidence. The original Skylit attachment was unavailable, so exact screenshot parity remains unproven. The existing native chart Snapshot PNG/share exporter omits the HTML marker/dock layer; the supplied images are browser captures.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use. [IEX Historical Data Terms](https://www.iex.io/legal/hist-data-terms).
