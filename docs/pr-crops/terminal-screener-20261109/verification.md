# Options Screener ticker actions — verification

Product/test head: 362199e327a37c1146e464726f23dc795a177fed.
Base: 8390cc4ad41b1c0773e979198c80e742852c01dc.
PR: [#1371](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1371).
Mission/law/design source pins and overlap analysis: [mission note](../../terminal-screener-tickers-20261109.md).

## Corrected interaction

Volume > OI, delta-OI Builds, 0DTE Heavy and Hot Contracts now render native named ticker buttons in their existing cells. Keyboard activation opens the same selected ticker and moves focus to the existing search control. Pointer row navigation is retained. Contract pin and ticker controls remain independent siblings, and a ticker activation does not alter the shortlist.

The scoped style retains Terminal typography and tokens, shows keyboard focus, and supplies a 44 by 44 pixel minimum target on touch devices. Existing columns, order, filters, CSV output, selection and navigation owners remain in place.

The broader #1248 Options lane is preserved: this patch does not duplicate its header sorting, Tape or Top Premium/Unusual Activity changes. A ref is added to the existing ticker search field only for keyboard focus handoff.

## Results

| Check | Observed result |
| --- | --- |
| Options Screener selectors | 8 passed |
| Contract shortlist | 24 passed |
| CSV contract | 5 passed |
| Full TypeScript check | Exit 0, no diagnostics, 4 GB heap; owned integration snapshot includes UI1/UI2 plus this candidate |
| ESLint baseline comparison | Zero added messages after normalizing shifted line numbers; existing OptionsHubView has 17 errors / 12 warnings, changed browser spec has zero |
| Four new ticker journeys × desktop/tablet/phone | 12 passed |
| Chinese accessible-name witness | 1 passed; redundant tablet/phone repetitions intentionally skipped |
| Existing exact-contract shortlist journey × three sizes | 3 passed |
| Native browser total | 16 passed, 2 intentional skips, 51.1 seconds, process exit 0 |

The first unit attempt exposed an omitted scratch screener_fixture.json. It was restored from the pinned GitHub blob b81c18136776c43f0146b654fcf1a3af3a8001d1; no repository fixture or product logic was changed to make that validation pass.

## Real-route proof

The browser suite loads /options using the existing fixture-enabled application, then exercises:

- Actual Tab navigation from a preset control followed by Enter or Space.
- A decoded ticker request carrying the exact selected root, selected Tickers tab, and focused ticker search field.
- Preservation of unrelated URL parameters.
- Returning through the existing Screener view tab with the original preset, filter and ordered rows intact.
- Keyboard pinning without navigation; ticker navigation without changing pinned identity or count.
- Existing pointer navigation by a non-button row cell.
- Visible focus outline, button containment within its cell, 44px touch target floor, pin/ticker alignment and no page-level horizontal overflow.
- English and Chinese action names.

Feed data comes from the existing application fixture. The new navigation tests explicitly fulfill a root-specific ticker request with honest-empty data and verify the corresponding selected-root no-data message. This is interaction proof, not a claim about current market data or source acceptance. The existing shortlist test separately retains its exact contract/source semantics.

## Captures

Visually inspected at each native project viewport:

- [Desktop, 1440 × 900](./desktop-screener-ticker-action.png)
- [Touch tablet, 820 × 1180](./tablet-screener-ticker-action.png)
- [Phone, 390 × 844](./mobile-screener-ticker-action.png)

The captures show keyboard focus on AAPL next to its independent pinned-contract control. Phone tables retain their existing internal horizontal scrolling; the page itself stays within the viewport. Captures are scrolled to the active row where needed.

## Reproduction and release

Remote evidence root: /Volumes/STORAGE/mmx-evidence/terminal-ui-20261109-c1.
Exact-source receipt: source-receipt-ui3.json; each overlaid source file was verified against its Git blob SHA. Browser output: screener-proof.log. The isolated fixture runner uses the source Playwright configuration with serial execution, its own port and external evidence output; repository production/CI configuration was not edited.

SELF_REVIEWED. Normal protected native auto-merge is the next publication step after this evidence-only commit. Required hosted CI, actual review controls and release holds remain in force. Ready/auto-merge is not merge, deployment or production-browser acceptance.
