# EX-03 — Search, Compare and Add Symbol

**Review date:** 22 October 2026  
**Program:** [Terminal Experience Excellence](../../../../docs/TERMINAL_EXPERIENCE_MASTERPLAN_2026-10-22.md)  
**Source baseline:** `443b3fc0491418bfbcb46653a139c8bdee7db3e7`  
**Candidate:** the source and tests committed with this evidence packet. The owning PR records the exact published head, protected CI, merge and production receipts separately.  
**Status:** first candidate published on Draft PR #1134 at `82dcdc7be9bbf3e2d39a182607aad89ded777ab1`; the hosted unit CI shard failed and the wave is **not merged or deployed**. Focused repair is in the same original managed workspace, **local-only** commit `0bea17f9fc4f9d6da92ccd2c146b3afd3b121938`. Its three affected company-search unit cases pass; current B-PL-6 and Visual Intelligence historical evidence locks still require real new scoped browser recaptures before pushing a new CI candidate. Independent review has not passed (Fabric provider 429). See masterplan §10 for exact blockers and next steps.

## Why this wave exists

The authenticated Chart → Compare task allowed Shift+Tab to move from its input to “Ask Mastermind AI” behind the visible overlay. The generic search panel lacked a dialog role and used a span as its close affordance. Simply putting a focus boundary around the clipped panel would have stranded the add-destination picker, which was portalled to the document body.

This wave gives the modal panel and its overflow-escaping picker one named focus scope. It preserves the existing search ranking, market/category rules, company filtering, watchlist storage and phone primary-navigation sheet.

## Design and behavior

- One clear heading, a real localized close button, a visible focus ring, and the existing glass/type/motion tokens. The close target is at least 44px for coarse pointers.
- Search results consume remaining panel height and scroll without displacing the input, close control or footer. Reduced motion removes the new entry/close transitions.
- Initial view and focus follow one policy: desktop/seeded/Compare/Add entries focus the field; unseeded touch navigation retains the watchlist/recent view without automatically summoning the keyboard.
- Tab and Shift+Tab remain inside the modal, including its nested destination picker. Escape backs out of inline list naming, then the picker, then Search. IME/composing keys and chart shortcuts do not escape the modal task.
- Picker closure and controls that disappear after an action return focus to a valid task control. Direct Add, watchlist remove, Compare price/percentage apply, row remove and chip remove all retain keyboard continuity.
- Only the visible Compare action is enabled and exposed to assistive technology. The price/percentage chooser receives focus when opened.
- Desktop and touch symbol openers are actual buttons with the symbol in their accessible name. The touch quote is an accessible description; the event planner remains its own sibling action.
- Portfolio handoff opens the position form and transfers focus without changing the active chart or saving a holding.

The native phone primary-search drawer remains the incumbent `MobileSheet`. Its broader nested-picker keyboard lifecycle audit belongs to EX-06/EX-16; this packet does not claim that audit complete. Phone Compare uses the upgraded modal and is exercised through its actual Analysis Hub entry.

## Verification

The final local browser command was:

```sh
TERMINAL_CROPS=1 TERMINAL_E2E_PORT=3192 \
NODE_OPTIONS=--no-experimental-webstorage \
npx playwright test \
  e2e/search-dialog-ownership.spec.ts \
  e2e/search-accessibility.spec.ts \
  e2e/search-add-to-list.spec.ts \
  e2e/search-dialog-crops.spec.ts \
  --workers=1 --max-failures=2
```

**Result: 38 passed, 22 explicitly scoped skips, no failures or retries, 4.5 minutes.** The skips identify entries or behaviors that exist in a different layout; they are not failed checks converted to skips.

| Evidence | Result / boundary |
|---|---|
| New ownership regressions | 17 passed across desktop/tablet/phone; 10 layout-specific skips |
| Existing search accessibility | 10 passed; 2 existing desktop-only keyboard cases |
| Existing add-destination tests | 5 passed; 10 layout-specific skips |
| Opt-in EN/ZH capture tests | All 6 viewport/language cases passed |
| Layout checks | Panel/picker containment, document overflow, picker hit testing, coarse close targets, reduced-motion rule |
| Static checks | Final sequential `tsc --noEmit`, SearchModal/new-spec ESLint and `git diff --check` passed. TerminalShell retains the same 54 errors / 17 warnings as baseline, with zero added diagnostics ([comparison](terminal-shell-lint-baseline.json)). |
| Source/design review | Accepted after correcting initial-view race, picker invalidation, direct Add/remove, hidden Compare controls and chip-removal focus |
| Production | Not claimed by this pre-merge packet; exact release and live receipts belong on the owning PR |

An earlier typecheck ran concurrently with dev-server startup and read incomplete generated Next route declarations. The final static receipt is run after the browser matrix and complete route generation. No application type exclusions or validation gates were relaxed.

### Environment

macOS 26.5 on the authorized M2 host; Node 26.5.0; Next 16.2.9; React 19.2.4; TypeScript 5.9.3; Playwright 1.61.1 with its Chromium test browser. Tests use the repository's local fixture server, isolated owner-scoped watchlist fixtures, fresh page contexts, and the existing dark chart presentation. EN/ZH are set through the fixture context before app startup. The Node option disables the host runtime's experimental webstorage behavior; production configuration is unchanged.

These are functional and visual receipts, not field INP/CLS or performance benchmarks. Real operating-system IME composition, screen-reader sessions, Safari/WebKit, Firefox, virtual-keyboard occlusion and long-session measurements remain explicitly unqualified.

## Image index

All committed images contain synthetic/public fixtures. No private account holdings, watchlists or protected scripts were captured for publication.

- `before/desktop-compare.png`: actual baseline at 1440×900, English, default chart theme.
- `after/`: 28 final captures, four task states × two languages × three required viewports, plus EN/ZH Compare at 1180×820 and 1440×600.
- Required viewports: desktop 1440×900; tablet 820×1180 with touch; phone 390×844 with touch.
- States: long search results, one-result destination picker, Compare, Add Symbol.
- Screenshots settle animations; the capture spec separately asserts the reduced-motion rule.
- Tablet Compare and tablet/phone Add Symbol are responsive continuation evidence from their existing desktop entry. They are not claims that new tablet/phone entry controls were added.

| Viewport | Search | Destination picker | Compare | Add Symbol |
|---|---|---|---|---|
| Desktop EN | [View](after/desktop-en-search.png) | [View](after/desktop-en-destination-picker.png) | [View](after/desktop-en-compare.png) | [View](after/desktop-en-add-symbol.png) |
| Desktop ZH | [View](after/desktop-zh-search.png) | [View](after/desktop-zh-destination-picker.png) | [View](after/desktop-zh-compare.png) | [View](after/desktop-zh-add-symbol.png) |
| Tablet EN | [View](after/tablet-en-search.png) | [View](after/tablet-en-destination-picker.png) | [View](after/tablet-en-compare.png) | [View](after/tablet-en-add-symbol.png) |
| Tablet ZH | [View](after/tablet-zh-search.png) | [View](after/tablet-zh-destination-picker.png) | [View](after/tablet-zh-compare.png) | [View](after/tablet-zh-add-symbol.png) |
| Phone EN | [View](after/mobile-en-search.png) | [View](after/mobile-en-destination-picker.png) | [View](after/mobile-en-compare.png) | [View](after/mobile-en-add-symbol.png) |
| Phone ZH | [View](after/mobile-zh-search.png) | [View](after/mobile-zh-destination-picker.png) | [View](after/mobile-zh-compare.png) | [View](after/mobile-zh-add-symbol.png) |

Intermediate: [EN 1180×820](after/desktop-en-compare-1180x820.png), [ZH 1180×820](after/desktop-zh-compare-1180x820.png).  
Short window: [EN 1440×600](after/desktop-en-compare-1440x600.png), [ZH 1440×600](after/desktop-zh-compare-1440x600.png).

The principal inspected representative full-resolution captures of every task family at all three required widths, including both languages and the short-window case. The shared connected browser could not reach the M2 loopback fixture address; local visual/interaction evidence therefore comes from the real-app Playwright fixture run, with authenticated production review reserved for after deployment.

## Release boundary

Current protected master at prepublication was `942eeb526b4fd64b17aa66042c0d0ec2c3a5b94e`; the intervening #1128 merge changes news evidence/tests and has no EX-03 implementation overlap. The live revision was `32b6ba43704a5a87db2582b2b9617271382358b5`, a verified ancestor of that protected head.

No migration, data recalculation, consent change, SharedShell default activation or chart-engine activation is part of this wave. The completed #1125/#1126 rollout and the one-time 0040 application remain accepted and must not be repeated.
