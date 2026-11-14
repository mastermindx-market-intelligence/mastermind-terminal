# Heatmap sizing disclosure control labels

The cached USD-cap explanation and empty-state instructions previously directed users to CAP/EQUAL even though the actual fallback buttons are **Price × volume / EQUAL** in English and **价格 × 成交量 / 等面积** in Chinese. Four copy literals now identify the visible controls. The price × reported-volume proxy remains distinguished from cached USD market capitalization; the unknown capitalization date and separate quote-time explanation are unchanged.

Only HeatmapView and its existing disclosure test change. The two language cases now compare their instructions with the authoritative translation owner's current labels. Existing capitalization integration #839 and truthful labels #610 are preserved. No cache, data, sizing, translation-owner or layout implementation is changed.

## Evidence

- Base: `18fabe9d3c1439c4185559ba5ce491518fe999c9`.
- **7/7** affected disclosure tests passed.
- Test-file ESLint and `git diff --check` passed.
- Both postimages remained unchanged during checks; exact blob and SHA-256 identities are in [receipt.json](receipt.json).
- Original #707 unpublished refresh-order repair remains in its original workspace. Its separate source/capture holds are not cleared or adopted by this copy fix.

[Issue #609 source claim](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/609#issuecomment-6792064823) records the exact custody separation. This packet does not claim production acceptance or issue closure. Natural publication-head CI and normal protected release controls still apply.
