# Complete saved-screen definitions on the table

Captured against parent `bad27318427cd469831471b9c1a8a4a2d81ecc6c` plus the whole-definition consumer change in this commit. Twelve original PNGs were visually reviewed: English and Chinese at 1440×900, 820×1180 and 390×844, both nested-rule and multi-market-subset modes. Full definition and scope remain readable; mobile controls wrap.

`terminal/e2e/smart-screen-whole-definition.spec.ts`: 6 PASS, workers 1/retries 0. A real isolated Smart Screen route stores and reads the complete definition. The routed scan contains positive and negative OR arms, unknown data, unpriced, foreign-market and asset controls. The table matches exact IDs (3 complex / 6 subset) despite device market preferences and prior search. One explicit Save creates a full-definition copy; reload/reopen/Return produce no automatic owner writes. Original records remain exact. Analytics traffic is separate.

Affected unit/consumer checks: 66 PASS (original two mounted failures retained externally), plus the existing isolated-route save-on-A/reopen-on-B browser path 3 PASS. Typecheck and new browser lint pass; eight pre-existing ScreenerView lint errors are unchanged. The full native definition is compared for duplicate/on-table labels. Account change/session expiry fences the detached session copy. Simple representable screens keep their existing filter-bar path.

These are local fixture and rendered checks. They do not establish production, full accessibility, text zoom, other themes, the separate Investigation capture transaction, or hosted CI acceptance. Existing accepted crops are reused; no release hold is lifted.
