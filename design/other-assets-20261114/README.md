# Other Assets — shared-shell design study

Eight workspaces, in the user's menu order. **NOT_APPLIED_TO_PAPER.** Native Paper is blocked by the original guarded connection; no production application or engine changes are included.

## Open the work

- **Interactive study:** `Other_Assets_Design_Studio.html` is self-contained. Open it in a normal browser to review the proposed navigation, selections, comparisons, evidence drawers, replay, hypothetical scenarios, draft retention and source states. All data is illustrative; it makes no live network/data/account calls.
- **Visual overview:** `compositions/Other_Assets_Design_Overview.png` presents the eight main directions.
- **Complete download:** `Other_Assets_Design_Packet.zip` contains the study, all SVG/PNG compositions, source and build notes. Its embedded contents exclude the ZIP itself and the later upload manifest.
- **Build decisions:** [BUILD_GUIDE.md](BUILD_GUIDE.md) explains each page's main job, advanced investigations, preserved engine owners, conditional capabilities and acceptance cases.
- **Migration architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) maps shell, route, producer, account, state and release responsibilities.
- **Proof status:** [STATE_AND_ACCEPTANCE_MATRIX.md](STATE_AND_ACCEPTANCE_MATRIX.md) distinguishes source checks, static visual review, browser review, Paper and production acceptance.
- **Exact Paper continuation:** [PAPER_TRANSFER_PLAN.md](PAPER_TRANSFER_PLAN.md), with [SOURCE_MAP.md](SOURCE_MAP.md) for pinned references.

## Visual directions

| Order | Destination | Primary desktop composition | Main interaction |
|---|---|---|---|
| 1 | Crypto Intelligence | [Crypto](compositions/01_Crypto_dark.svg) | Asset → comparison → flow/leverage evidence |
| 2 | Bitcoin Vector | [Bitcoin](compositions/02_Bitcoin_dark.svg) | Whole-snapshot historical replay |
| 3 | Strategy Track Record | [Track Record](compositions/03_Record_dark.svg) | Selected period → matching decision ledger |
| 4 | Commodity Dashboard | [Commodities](compositions/04_Commodities_dark.svg) | Seventeen-market map → four-market comparison |
| 5 | Commodity Strategies | [Strategies](compositions/05_Strategies_dark.svg) | Thesis conditions → isolated cost/roll sensitivity |
| 6 | Strategic Reserves | [Reserves](compositions/06_Reserves_dark.svg) | Country stock → coverage denominator → event/vintage |
| 7 | Forex | [Forex](compositions/07_Forex_dark.svg) | Pair → inverse → cross → source-qualified note |
| 8 | Bonds | [Bonds](compositions/08_Bonds_dark.svg) | Curve dates → tenor → separate exposure scenario |

Each primary has dark desktop, light desktop and narrow compositions. Four extra compositions cover Bitcoin replay, commodity comparison, FX source gap and the bond scenario. These are separate authored vectors, **not screenshots of the HTML and not native Paper exports**.

## Qualification

The packet includes 16 passing source-level checks covering 29 page/view combinations and 48 page/data-state combinations. Their receipt is `evidence/source_checks.json`. They use a minimal DOM stub, not a browser. The reviewed SVG compositions establish visual direction; they do not prove responsive HTML layout, real focus behavior, assistive technology, EN/ZH, live data, account isolation or production acceptance.

Local Chromium could not start in this environment. The connected browser's security policy rejected an inline `data:` URL; that path was stopped. No alternate browser, raw browser command or publishing workaround was used to evade that denial.

Paper remained `UPSTREAM_UNAVAILABLE`, with `retry_allowed=false`; there were zero native Paper edits. The old MASTERMIND PAGES file also has a source-recorded capacity/read-only disposition. Current native target qualification is required before placement. The parent migration remains incomplete.

## Reproduce the authored artifacts

```sh
node --check studio.js
node check_source.mjs
python build.py
python compose_boards.py
```

The Python composition renderer uses PyMuPDF and Pillow. It runs locally without network access. It creates separate SVG/PNG compositions, not HTML screenshots. Production must reuse Terminal's actual chart, theme, shell, account and Brain owners; this review tool's global CSS and local draft store must not be transplanted into the application.

## Source and continuity

The owning plan is `docs/plans/OTHER_ASSETS_SHARED_SHELL_2026-11-14.md` on `sol/other-assets-design-20261114-astra`. [PROGRESS.md](PROGRESS.md) records exact effects, blockers, preserved accepted work and the next native action. All source-backed work stays on that isolated authoring branch until the appropriate delivery gate is satisfied.
