# Terminal Intelligence Workspace

Owner carrier: [Terminal #612](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/612).

Design source: [Terminal · Intelligence Workspace · 2026-10](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-I-1).

## Product behavior

One Intelligence launcher replaces the Research Desk and Golden Oracle popup pair.
The workspace stays attached to the chart-facing edge of the watchlist. It overlays
the chart without changing chart width or covering the watchlist, including during
entry and exit motion. Desktop remains nonmodal: chart, watchlists and symbol
selection stay usable. The panel follows watchlist resizing and viewport changes.

The default width is 440 px. A pointer/keyboard resize handle and an expanded view
support deeper reading; a session preference retains the chosen compact width.
Below 861 px, the same content becomes a native modal bottom sheet. A dedicated
handle supports drag-to-dismiss while content scrolling remains independent.
Close, Escape, focus return, keyboard tab navigation and reduced motion are supported.

| View | Purpose |
| --- | --- |
| Summary | Oracle stance and known date, supplied performance metrics, market risk, research drivers and cautions, recent activity |
| Oracle | Existing entry/position interpretation, complete supplied performance curve, source dates and methodology |
| Research | Research conviction, supporting and opposing evidence, technical and sector context, source-owned company state |
| Activity | Complete signal history with filters and pagination, chart navigation, candidate receipts |

The desktop chart-jump action keeps the workspace open. On mobile it closes the
sheet so the selected chart point can be seen. Changing watchlist symbols updates
the workspace subject; synchronous identity fences prevent previous-symbol data
from appearing under a new symbol.

## Engine composition

The workspace consumes the existing data pipeline and shared cache. It adds no
second signal engine, score, decision spine, persistent store, or retry queue.

| Owner | Contract consumed | Boundary |
| --- | --- | --- |
| Existing Oracle producer | `SYMBOL.slice.json` | Existing signal/position semantics, known time, blocked entries, retro disclosures and structure stops |
| Existing research ingest | `SYMBOL.intel.json` | Existing research verdict, conviction, drivers/cautions and source observation date |
| Existing backtest producer | `SYMBOL.backtest.json` | Supplied equity and gaps; no reconstruction from trade history |
| Existing market-risk owner | Normalized market-risk display | Existing precedence and degradation interpretation remain in `marketRisk.ts` |
| Macro Security State Decision Spine | `security_state.v1` in stockdata | Public display-only context, validated and forwarded unchanged |

`useWorkspaceSource` reads through `dataCache.ts`, with a 60-second freshness
window and the existing stale-while-revalidate contract. It distinguishes loading,
ready, absent and unavailable outcomes, plus checking/failed refresh states.
Retry invalidates the same shared cache entry. Focus and visibility refresh only
while the workspace is open. Response sequence and lifecycle fences reject late
responses after a symbol or component change.

The source boundary validates the actual nested fields consumed by the workspace.
Malformed collections, non-finite prices, wrong primitive types and identity
mismatches cannot become an empty history or a contradictory stance. A failed
refresh is labeled while the last accepted source remains visible; a completed
refresh containing malformed data is rejected. Each module exposes its own
source status and recovery action.

## Security-state bridge

`ingest/security_state_bridge.py` accepts the existing Macro owner's
`security_state.v1` / version `1.0.0` envelope. The vendored schema is unchanged
from Macro commit `ab5156a4b2c336181f3c5256e7c0766f04f99598`:

`contracts/market_os/security_state.v1.schema.json`

Schema SHA-256:
`4f3d6c678a0700f1cc06a53cd62893d76308f1024d964dc9c8a047f15cc89305`.

Before publishing, the bridge checks the closed schema, timestamp formats,
ticker/listing/security identity, compilation clock equality and the owner's
content digest. Digest exclusions match the owner implementation. Accepted
envelopes are deep-copied without rewriting clocks, coverage, receipts or text.
Invalid, unsupported and unavailable envelopes receive a typed
`security_state_read.disposition` without publishing the rejected payload.

The closed public schema excludes private holdings and personal overlays.
Frontend projection also requires display-only authority, all action capabilities
false, a proven identity, and `NO_USER_CONTEXT` with a null private overlay
reference. These checks preserve the existing public/private boundary.

`entry.available` describes source evidence availability. It never grants entry
permission. Candidate and Prophet coverage remain owner-supplied context; the
workspace does not manufacture a current trade plan from a research event.
Estimated catalyst windows remain explicitly estimated and non-authoritative.
Missing, stale, corrected, partial and conflicted evidence retain their source
meaning. Structured unresolved-risk facts preserve the source leg and code when
the owner supplies no narrative text.

Current source coverage is source-owned. The integration does not expand the
Macro compiler's publication universe or promote unpublished symbols to covered.

## Verification and release

Focused tests cover geometry and collapsed viewports, nested source validation,
wrong-symbol and late responses, shared refresh/retry, owner receipts/digests,
private-field rejection, unchanged market-risk behavior and Oracle semantics.
Browser journeys cover desktop/tablet/mobile, watchlist access during motion,
panel resizing, keyboard tabs, source dates, curves, filtered history, chart
navigation, reduced motion, focus return and mobile dismissal.

Release follows the existing protected Terminal chain: scoped commit and PR,
required CI, merge to master, the git-gated `terminal-build.sh`, then live identity
and user-journey proof. The regular deployment includes `ingest/` and its vendored
contract. Generated `public/data/` remains host-owned and refreshes through the
existing ingest owner; a frontend deploy does not make old source artifacts new.

The earlier stacked drafts (#614, #619 and #620) are historical design and
implementation references. This successor was built from current protected
master rather than merging those stale branches.
