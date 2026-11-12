# Bottom Pivot daily evidence — Terminal consumer (2026-11-06)

Source operation: `bottom-pivot-terminal-consumer-20261106`; Macro producer remains `mastermindx-market-intelligence/macro#10785`. The Terminal change is a **display-only, on-demand single-symbol** consumer in the existing Prophet analysis scroll. It does not alter signal ranking, entry timing, scores, broker orders or portfolio decisions.

## Screenshots and browser proof

Captured in Chromium through the existing Next.js test origin with `NW_FIXTURE=1`, using the authenticated-route **fixture** mode, not live production entitlement. The source model uses the producer-owned `bottom_pivot_context.v1` contract; artifacts are demonstration samples and not prospective market evidence.

| Viewport | English full | English detail | Chinese full | Chinese detail |
| --- | --- | --- | --- | --- |
| 1440×900 desktop | [EN](desktop-bottom-pivot-en.png) | [Detail](desktop-bottom-pivot-detail-en.png) | [ZH](desktop-bottom-pivot-zh.png) | [Detail](desktop-bottom-pivot-detail-zh.png) |
| 820×1180 tablet | [EN](tablet-bottom-pivot-en.png) | [Detail](tablet-bottom-pivot-detail-en.png) | [ZH](tablet-bottom-pivot-zh.png) | [Detail](tablet-bottom-pivot-detail-zh.png) |
| 390×844 mobile | [EN](mobile-bottom-pivot-en.png) | [Detail](mobile-bottom-pivot-detail-en.png) | [ZH](mobile-bottom-pivot-zh.png) | [Detail](mobile-bottom-pivot-detail-zh.png) |

**Observed tests:** `vitest run lib/__tests__/bottomPivotSelection.test.ts lib/__tests__/nwRoute.test.ts` → 21/21 pass; `npx tsc --noEmit --pretty false` → exit 0; focused `eslint` → exit 0; `NW_FIXTURE=1 TERMINAL_E2E_PORT=3157 ... playwright test e2e/bottom-pivot-evidence.spec.ts --project=desktop --project=tablet --project=mobile --workers=1` → 3/3 pass and twelve captures. Test asserts no first-paint pivot fetch, one on user open, exact symbol selection, localized display, no unrelated paid rows and no horizontal overflow.

**Still owed:** protected Terminal review/CI/merge, git-gated deployment and authenticated production proof. Macro's own producer must first publish the source file; an anonymous or missing producer response cannot count as this proof. Existing Terminal rotation-pivot PR #1281 is separate and remains Draft/unarmed.
