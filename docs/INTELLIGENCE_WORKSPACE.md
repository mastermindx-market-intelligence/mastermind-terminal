# Terminal Intelligence Workspace

Owner carrier: [Terminal #612](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/612).

The R4 four-view AMZN predecessor is artboard `1MX1-0`. [Terminal · Stock Intelligence R4](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-I-1?node=1MX1-0). Preserve it as the source-accurate baseline.

The R5 design study uses the same Terminal Paper file and page `p-I-1`:
desktop contextual command deck `1NT3-0` (1600 × 980) and mobile
decision overview `1NXH-0` (390 × 844). These are editable Paper
boards, not deployed routes. The desktop price curve is **schematic**,
explicitly labeled in the specimen; it must never be substituted for
real market series in the application.

### R5 first-glance and progressive disclosure

The R5 responsive code remains in the **existing** single Intelligence
workspace and source owners. It is not a second chart, route, data
pipeline or signal spine. The hierarchy is:

1. **Current Oracle entry** — one source-qualified status. Unverified
   data remains unverified regardless of historical buys or a bullish
   regime. The subline distinguishes historical evidence from a new call.
2. **Evidence** — compact, clickable Oracle and research observations,
   each with its own dates and statuses. Prophet is a separate
   early-evidence source, not an entry instruction.
3. **Historical validation** — trades and source-supplied risk, clearly
   labeled as a past sample. Drawdown and scores never become a
   probability of future returns.
4. **Deep detail** — Oracle history/equity comparison, Research
   methods/cautions and the complete Activity timeline remain available.
   Summary is a triage view, not a replacement for those functions.

Desktop still docks against the existing chart and rail without resizing
the chart. Mobile continues to use the same bottom-sheet state
and accessible four-view navigation. The R5 Paper command deck visually
explores a wider contextual option; it is an *exploration*, not a claim
that the current product has adopted new chart placement or new data.

Production-quality acceptance requires actual localized English/Chinese
and narrow/wide browser screenshots, preserved source identity/freshness,
correct error/permission states, full repository checks and protected
non-author review. Paper screenshots and local fixture-browser captures
are separate from deployed production acceptance.

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
| Summary | Current Oracle entry availability, dated evidence rows, market risk and access to activity |
| Oracle | Historical signals, regime, source-qualified risk measures and gap-aware strategy equity |
| Research | Current setup, saved research notes, cautions, technical and sector context, and company evidence |
| Activity | Chronological signals and candidate receipts, category counts, chart jumps and pagination |

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

The research producer withholds directional readings for missing, future or expired
source sessions. Newly published leans carry the configured age limit so cached
observations expire locally too. A named timing posture remains usable when the
producer supplies it independently of a direction. The backtest displays drawdown
and Sharpe only when supplied, and splits the equity line at missing observations.
Legacy activity bars retain their chart date with an explicit label when the
first-observable date is absent.

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
