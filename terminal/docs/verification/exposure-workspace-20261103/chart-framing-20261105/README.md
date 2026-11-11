# Exposure phone chart framing

The phone price header wraps onto additional lines. The old chart framing reserved only a fixed header clearance, allowing ranked strike labels to paint over that header. The failing browser baseline measured overlaps of 11.25 pixels for the leading 756 label and 28.20 pixels for 757.

The Exposure-owned framing function now measures the actual header and extends only the initial/Fit upper price bound when needed. It applies only on phone with a normal, non-inverted scale. The lower bound, existing margins, data, controls, manual panning and shared primitive collision policy remain unchanged.

## Result

The revised connected journey passed **12/12** cases: original and integrated source, each with English and Chinese at desktop, tablet and phone widths. There were no retries, skipped cases or flaky outcomes. All source maps stayed unchanged during capture and every owned server stopped.

The observer records real canvas glyph paints while forwarding the original paint calls unchanged. It requires primary strike 756, checks at least four CSS pixels of separation for every actually painted ranked glyph, verifies all four OHLC values and the change remain visible, then clicks Reset view and requires a new primary paint with the same clearance. The connected comparison, scanner, momentum and return assertions remain intact.

| Viewport | Minimum measured clearance, rounded to two decimals |
| --- | --- |
| Desktop | 5.49 CSS pixels |
| Tablet | 5.49 CSS pixels |
| Phone | 25.54 CSS pixels |

The existing 16-pixel spacing rule intentionally suppresses some secondary labels after framing on phones. The final observer checks every label that actually paints and requires the leading label; it does not require collision-suppressed secondary labels to render. The first observer's failed assumption and both failing baseline attempts are retained in the packet.

## Binding

[qualification.json](qualification.json) binds the exact driver, original and integrated source maps, all six case identities in each report, geometry attachments and baseline-to-original change restricted to `ExposureMap.tsx`. Its SHA-256 is `4175c376a016a00cd03dbf2c90c9604739c62b9004362db4a9cb277b752fc891`.

Native Strike/failure-state captures and their 319/138 source contracts retain their original identities. The evidence reader admits only the two exact later chart identities through this separate pinned proof; unknown identities or missing proof fail.

This is actual local browser proof with controlled market fixtures. It does not assert production deployment, live market-feed correctness or user acceptance. See the [final integrated verification record](../../options-workspace-20261103/final-delivery-20261105/README.md).
