# Readable comparison units

An actual comparison displayed `1.125 usd_millions`. The label now reads `1.125 million USD` / `1.125 百万美元`. The numeric values are not scaled, rounded or reformatted; unfamiliar units and comparison eligibility remain unchanged.

Validation on the source in this commit: original desktop regression **1 FAIL**, candidate **6 EN/ZH desktop/tablet/mobile PASS**, plus **1 English 390px native text-only 200% PASS**. Pinned external Firefox151 reported textZoom2/fullZoom1, fixed viewport/DPR and doubled font size. Seven crops reviewed. Each case uses synthetic read transport, one explicit comparison GET, an exact unchanged fixture baseline/manifest and zero owner/auth writes. No production, provider-history, Chinese text-only or whole-page accessibility claim.

The affected mounted component and comparison suites passed **55 tests**, including fractional, zero, negative, unknown-unit and unavailable comparison controls. Typecheck and whitespace pass; lint has zero errors and two inherited unused-parameter warnings. Existing theme, keyboard/pagination and legacy capture proof are reused.

`results.json` binds the component blob and observations. Raw harness, original failure and logs remain in the original IW2 evidence directory, `fable-commission-20261013/investigation-secondary-text-20261015/value-units`. Release holds remain in force.
