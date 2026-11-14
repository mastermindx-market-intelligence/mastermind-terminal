# P6A — Discover questions and canonical handoffs

## Outcome and scope

Discover now explains the investigation each existing tool supports. The chooser
uses a compact screening entrance, two groups of tool rows, a separate timing
study and three deeper research choices. It corrects two misleading destination
promises: the primary Catalyst action now opens the native developing-theme
workspace, while BioCatalyst is explicitly named as a specialty destination;
Prophet candidates opens the native complete pool while the full US stock
workspace stays available below it. Signal Board keeps its real catalog name
and does not imply that it receives the current native Screener filters.

This is the first P6 slice. It does not certify the Screener, Heatmap, Leaders,
Radar, RS study, Signal Board or specialty workspaces as fully migrated. The
parent P0–P17 acceptance and the 320-route worklist remain open.

## Source and custody

- Protected Terminal source: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- Authoring stack input: repaired P5 at `6a83fb906b4ee2d449c333657f59775d34129b25`,
  tree `5bd6697cc25e9503637b0151b1644cb8519f5a4c`. This owned merge retains
  original P5 `c6f115fd3e8651857ed0dd55a787022f517d53d6` and incorporates
  P4 phone repair `dc8039571b40a0d0ce3765b92560f4cbf7d195d5`. All five
  published repair files and the original P5 branch were read back exactly.
- Existing chooser source: `components/workspaces/DiscoverLanding.tsx`, blob
  `76d90559938cb5af8055021772e47d47102f95aa`; CSS blob
  `ad94ad0a2208551bd3ae8d8c28527424d83507eb` at protected master.
- `DiscoverWorkspace`, `WorkspaceTabs`, the market helper, engine components,
  filters, data readers and personal mutation owners are unchanged.
- The inspected 25 relevant open carriers had no direct overlap with either
  DiscoverLanding file. Adjacent PR1501 at
  `f58e7c47b403a41ff04161840e5ece10b6f1279f` owns directory/rail/mobile chrome,
  `AppShell`, market helper and routes; this slice does not recreate that work.
  PR1494's Analysis work, PR1503's full Macro lane and PR1505's additional
  Prophet work remain separate live carriers.

The chooser is presentation over admitted destinations, not another route
catalog, engine registry, saved-filter reader or navigation controller.

## Destination map

| Choice | Owner and destination | Preserved distinction |
|---|---|---|
| Stock Screener | Existing `onSelect('screener')`, `/discover?tab=screener` | Engine owns universe, technical/fundamental/classification conditions, field coverage, saved presets and exact listing links |
| Heatmap | Existing `onSelect('heatmap')` | Company price/flow map; local layer, sizing, search and tile detail stay with the existing engine |
| Sector Intelligence | Existing `onSelect('sectors')` → canonical `/sectors` with current market | Existing Discover-sector bookmarks keep their depth URL and owner without a second Discover tab layer |
| Leaders | Existing `onSelect('leaders')` | Published flow/price boards and per-name source coverage |
| Leader Radar | Existing `onSelect('radar')` | Published states, handoff watches and re-rating context |
| RS · 30m Pivot | Existing `onSelect('rs-pivot')` | A study with its own conditions, timing and limitations |
| Prophet candidates | `/prophet?tab=candidates` through `marketNavigationHref` | Complete published pool; existing P4 decoder, account lifetime, detail and search owner |
| Full US stock workspace | `/us_stocks.html` | Explicit US depth entrance, retained while broader native parity is incomplete |
| Catalyst Intelligence | Existing `onSelect('catalysts')` | Native developing-theme observations and their evidence; not a claim of a confirmed news catalyst |
| BioCatalyst Intelligence | `/biocatalyst.html` | Separate specialty product, never a fallback substitution for native theme evidence |
| Signal Board | `/confluence_screener.html` | Existing published-signal comparison; no unsupported transfer of the current native screen |

All four destination anchors disable speculative prefetch. Same-context links
use the ordinary navigation arrow. Search companies retains the existing shell
search event. No new company search, data engine, ranking, recommendation,
market observation or sample count appears on the chooser.

## Paper and implementation

Existing reference: [F01 integration page, board 2NP-0](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0).
Derived editable designs: [P6 Discover page p-8-0](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-8-0).

| Board | Presentation |
|---|---|
| `48N-0` | 1216px content area, dark English |
| `48V-0` | 320px, light English |
| `493-0` | 390px, dark Chinese |

All three boards were visually read back. The 183 owned nodes' working indicators
were released with an applied receipt; prior boards and other writers' nodes
were untouched. Adapter observation guard
`29f07d2c5e8a43082878fa35d103da0d9ffd9e941cd6b4d796c7fd727b389d15`
and token hash `6234666b` bind the observed active-file state, not a content hash
of every new board. The active reference page remained p-2-0.

The implemented hierarchy uses existing typography/color tokens, 20px questions,
16px tool names, 14px explanations, a single filled screening action and 44px
minimum targets. Tool descriptions sit beside their own actions. The specialized
study has a separate low-emphasis row. No tall empty feature cards or invented
visualizations are added. At narrow widths the same DOM becomes one column;
primary and study controls fill the available width, and other labels wrap.

The old Paper phrase “Saved in this browser” is intentionally absent: the chooser
has not loaded or saved a screen. This does not remove the engine's saved-preset
capability or claim to have migrated its persistence.

## State and focus contracts

The existing hydration boundary keeps tool buttons unavailable until their owner
can handle them. Actual anchors retain ordinary link behavior. The existing
selected-tab focus and Discover-heading return are preserved, including newer
interaction cancellation and URL changes that should not steal focus.

Chooser navigation changes only the existing `tab` field. Unrelated query
fields, fragments and Catalyst `case` selections remain. Leaders/Radar retain
their incumbent re-selection nonce: it returns from their local Tickers drill.
No second tab strip or picker is added. Native candidate navigation reads the
current URL market using the existing helper; the global coverage boundary still
prevents mounting a US engine for an unsupported market.

Native Screener and Heatmap working filters are currently local to their engine
mounts; tool changes unmount inactive engines. This slice makes no new cross-tool
filter-restoration promise and does not invent URL parameters the engines cannot
consume. Later workbench improvements must inspect and preserve the actual
filter/listing identity contract before changing that lifetime.

## Verification and remaining proof

The focused existing chooser and focus suites passed **21 tests**. They cover
explicit destination mapping and catalog admission, the candidate URL codec,
all seven tool actions and shell search, EN/ZH labels, hydration readiness,
query/fragment/case retention, canonical Sector return, focus ownership and
absence of mounted engines, tool fetches or browser-storage reads/writes while
choosing. Targeted ESLint, a nonempty added-lines language guard, qualifier
syntax and diff whitespace checks passed. A separate read-only advisory pass
found the eight-button/four-link counts, accessible names, ordinary target flow,
existing focus owner and no-prefetch handoffs consistent. That source review
does not establish rendered geometry or substitute for hosted browser proof.

The incumbent authenticated fixture qualifier now includes Discover at 1440,
820 and 320px. It verifies every target's size and readable bounds in EN/ZH,
source hash binding, no initial candidate/Catalyst read, keyboard launch into
native Catalysts, chooser focus/URL return, the real candidate route and browser
Back. Catalyst's unavailable response is deliberately synthetic: this proves
the handoff into its existing owner, not populated domain intelligence. Canonical
Sector handoff already has an actual journey in the same qualifier. No second
runner, workflow, account service or watcher is introduced.

Hosted execution and screenshot readback are owed on the published P6 head.
The local Chromium refusal remains respected. Fixture proof is not production
CSP, actual account/source acceptance or legacy feature parity.

Remaining P6 work includes source-led dense Screener/Heatmap/leadership/study
review, genuine listing and market-universe proof, and deliberate filter/return
handoff contracts where useful. Source work can continue in the independently
owned P7 evidence journey while existing CI/release lanes progress. No engine or
legacy presentation is archived by this chooser change.
