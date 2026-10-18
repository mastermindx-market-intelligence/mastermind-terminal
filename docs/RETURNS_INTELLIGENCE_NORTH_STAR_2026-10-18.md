# Returns Intelligence — product, scientific contract, and delivery record

Date: 2026-10-18 UTC / 2026-10-17 America/Chicago. Commission: Ryan's end-to-end
revamp of Returns Calendar, including stocks, sectors/themes, direction changes,
technical analysis, options positioning, flow, and defensible forward likelihoods.

## The decision this product should improve

Which securities or groups are strengthening or weakening, how dependable is the
path, and what evidence supports the next move over the user's chosen horizon?

The current calendar is useful for finding a session, an unusual gap, or a run of
positive days. It is a poor primary instrument for comparing continuous paths,
recognizing a countertrend rebound, or distinguishing broad participation from one
winner. Returns Intelligence makes the trajectory the primary surface, retaining
the calendar as a synchronized inspection tool. Seasonality remains a separate
question about the time of year, and analyst price targets remain separate from
statistical forecasts.

Three analytical layers must remain distinct:

1. **Observed performance:** compounded returns, benchmark-relative wealth,
   calendar sessions, daily OHLC where actually observed, and constituent breadth.
2. **Descriptive change:** direction, fitted pace, change in pace, drawdown,
   volatility, movement efficiency and concentration. These describe the past.
3. **Forward distributions:** a precisely defined future event, a model vintage,
   decision-time inputs, out-of-sample evaluation, calibration, and an abstention
   decision. Technical agreement and GEX polarity are not forecast probabilities.

The primary jobs are comparing a holding with its benchmark, detecting a change
in a previously persistent move, finding groups whose participation is broadening,
and drilling from a group into a constituent and then the existing chart/options
workspace. Success means a user can do those jobs quickly and explain the basis of
the reading without treating a decorative score as evidence.

## Experience and integration

The canonical host is **Analysis → Market → Returns**, with the existing selected
symbol and `?symbol=...&page=returns` contract. The chart's existing hosted pane can
mount the same component. This adds a leaf page, not a new top-level navigation
system. The concurrent navigation work in Terminal #1041 owns the family/header
layout; the older calendar in #814 owns its distinct session decomposition. Its
intraday/BOATS work is not silently replaced by a fabricated daily approximation.

The content hierarchy is:

- Subject and benchmark controls; stock or current-member basket scope.
- A large continuous performance chart, with relative and drawdown views.
- Comparable 5-, 21-, and 63-session readings. Direction and pace are separate.
- Synchronized calendar and day inspector, including true zero, missing session,
  reconstructed open, and source refusal states.
- For groups, participation, median constituent return, and ranked constituents.
- Compact options evidence and forward-outlook panels, with detailed methodology
  available on demand rather than paragraphs of permanent footnotes.

Use the actual Terminal design tokens, accessible contrast, measured SVG pixel
view boxes, restrained directional color, keyboard-accessible selection, and
responsive desktop/tablet/mobile layouts. No left-colored container edges. A user
should reach the next useful action from the observation: open a constituent's
Returns view, continue in Chart, or examine the underlying options evidence.

## Calculation contract (`returns.trajectory.v1`)

The unit of analysis is subject × as-of session × price basis × horizon × benchmark
× membership vintage. A horizon h means exactly h session returns and h+1 closes.
US session membership and early closes come from Terminal's existing immutable
projection of Macro's NYSE owners; weekends are not guessed from weekday math.

Endpoint return is `100 * (P_end / P_start - 1)`. A missing interior session can
leave that endpoint comparison meaningful while invalidating daily volatility,
efficiency and fitted pace. Gaps are never compressed into one session, converted
to zero, forward-filled, or connected by a chart line.

Fitted pace is OLS slope of log close against session index, converted to a
geometric per-session percentage. The comparison window is the immediately prior
window of the same length. Their returns do not overlap; the boundary close is
shared. 63-session pace change therefore needs 127 closes. OLS fit statistics are
not claimed as independent-error statistical significance.

Direction uses both the observed log return and h times the fitted log slope. The
descriptive materiality threshold is the larger of log(1.005) and half the trailing
daily log-return standard deviation times sqrt(h). The volatility reference uses
63 complete sessions, or 21 if 63 are unavailable. This is a versioned policy,
not a fitted predictor or a confidence interval. Rising/falling requires endpoint
and fitted movement to agree beyond the threshold. Sideways also requires the
window's high-to-low log-close range to be no greater than twice the threshold.
Everything else is mixed. Unqualified adjustment or insufficient reference history
withholds the state while preserving clearly labeled reported-price observations.

Risk/path measures are sample log-return volatility annualized by sqrt(252),
maximum peak-to-trough close drawdown, signed movement efficiency
`sum(log returns) / sum(abs(log returns))`, and the largest session's share of total
absolute movement. Flat-series efficiency/concentration are undefined, not zero
confidence. Single-session concentration is not called an overnight gap. An
overnight gap requires compatible previous-close/open observations; reconstructed
opens never qualify. Daily OHLC does not establish separate overnight, premarket,
regular, and after-hours session returns.

Relative wealth is `(1 + subject return) / (1 + benchmark return) - 1`, with aligned
dates and compatible bases. Percentage-point excess is a different quantity and
must be labeled separately. Missing benchmark observations do not erase the
subject's valid path or masquerade as zero benchmark returns.

### Adjustment and identity

Reuse `deriveDataOrigin` and the `terminal.ohlc_view.v1` contract. Macro's nightly
owns `_view_contract.json`; Terminal does not infer an adjusted basis from a vendor
name, price continuity, or an invented receipt. An unknown basis is explicitly
reported-price history. A basis-drift refusal or unresolved identity break blocks
affected calculations. The existing `getJSONResult` path retains distinct absent,
unavailable, malformed, and stale outcomes. Symbol changes must fence late replies.

Live read during discovery: `app.mastermind-x.com/data/NVDA.json` contained 6,977
bars through 2026-10-16, source `yahoo`, real OHLC, and no `view` block. Therefore an
adjusted/probabilistic production claim is currently unproven, even though a valid
reported-price path can be displayed. The tracked repository fixture is older and
cannot stand in for live evidence.

### Groups

Without historical membership and weights, the product says **Current members ·
reconstructed history**. This answers how today's group members performed, not how
a historical index was invested. Initial weighting is daily-rebalanced equal
weight: average simple constituent returns each session, then compound. Averaging
log returns is a different portfolio and is not used.

Every selected member belongs in every daily denominator. Common history begins
at the latest constituent start, with complete expected-session coverage. Missing
members, conflicting bases, and interior holes produce a typed incomplete result;
they are not dropped or reweighted onto survivors. The membership date, common
history dates, weighting, breadth, median member, and member-relative results are
visible. Current source sectors/subsectors and user-defined thematic baskets must
retain their distinct provenance. ETF proxies are labeled as ETF proxies, never
presented as the true underlying sector/theme population.

## Options, flow, and forward likelihood

Reuse the existing entitled `/api/flow` transport, root validation, dated GEX
archive and flow owners. A root mismatch, wrong session, unavailable entitlement,
missing artifact, stale snapshot or malformed payload cannot become bullish or
bearish evidence. A past calendar selection must not borrow today's positioning.
Dollar exposure, strike levels, expiries, estimation convention and timestamps
retain their meanings. Do not add individual strike prices across different stocks.

GEX is a conditional estimate of hedging response and potential amplification or
damping. Open interest does not reveal every dealer's signed inventory. Gross call
premium is not buying intent, and unknown initiator/opening status remains unknown.
Short-expiry positioning is not automatically evidence for a 63-session forecast.
Implied option probabilities are not asserted as real-world outcome frequencies.

A forward artifact must name the subject, basis, as-of session, horizon, neutral
band, model version, training cutoff, publication time and latest available feature
time. Up/flat/down probabilities must sum to one. Quantiles must be ordered. Inputs
arriving after the decision cutoff are rejected even when their event date is old.
Historical outcomes already observed are not called predictions.

Admission requires chronological purged walk-forward evaluation with train-only
preprocessing, calibration evaluated on held-out observations, an unconditional
baseline, Brier/log-loss and reliability evidence, dependence-aware temporal coverage,
and archived forecast vintages. Overlapping labels need purging and dependence-aware
uncertainty. Price-only models are evaluated first; options/flow features must earn
their inclusion through ablation against that same baseline. Multiple correlated
technical indicators are not independent votes. If incremental skill, freshness,
data coverage, or calibration is inadequate, the product abstains.

An abstention still leaves a useful monitoring view: observed direction, pace,
drawdown, breadth, and the measurements that would change that descriptive reading.
It must not be relabeled high confidence, upward odds, or predictive strength.

## Backbone and release gates

Existing owners remain authoritative: Macro/Data OS for price basis, security and
membership history; Terminal's OHLC/data cache and NYSE projection for consumption;
Options Hub for positioning/flow; the existing model/evaluation system for admitted
forward artifacts. Returns is a coherent consumer and numerical contract, not an
independent market-data, identity, options or trading authority.

Required remaining backend work includes verifying the nightly view-contract
publication and Terminal ingestion, binding point-in-time membership where available,
joining source-time-qualified options/flow histories, evaluating forecast artifacts,
and retaining prospective forecasts and realized outcomes. Serving a useful
descriptive workspace does not by itself complete these predictive obligations.

Tests must discriminate splits, single jumps, volatile round trips, countertrend
rebounds, declining-but-improving pace, endpoint/slope disagreement, missing sessions,
constant series, corporate/benchmark basis mismatch, constituent IPOs, narrow
leadership, late replies, account changes, and future-available model inputs. Browser
proof covers 1440×900, 820×1180 and 390×844 in EN/ZH, with explicit synthetic fixture
labeling and separate real production evidence.

## Paper and delivery status

Requested design: file `01M2WGNCX9475G79JRKJTCM08P`, page `p-15-0`. The existing
artboards were read before implementation. Four R3 boards are applied, inspected,
exported and marked finished: continuous stock path (`6B6R-1`), group participation
(`6EA0-1`), calendar/evidence (`6EA1-1`) and mobile (`6EA2-1`). Original boards remain.
See [design exports and evidence](design/returns-intelligence/README.md). These are
labeled illustrative designs, not live market evidence. An optional later group
benchmark-overlay mutation returned an unknown transport outcome; it was not
replayed and the observed export does not contain that overlay. The implemented
group chart does include its benchmark.

Current implementation proof: TypeScript passes; 56 focused numerical, forecast,
API and asynchronous-evidence tests pass, plus the 28 existing session-clock and
navigation tests passed at the preceding checkpoint. All 15 responsive browser
scenarios pass across desktop/tablet/mobile and English/Chinese. Captures live in
`terminal/docs/pr-crops/returns-intelligence/`, with source and screenshot hashes.
The browser fixtures are synthetic and do not prove a production deployment.

CI at initial source `0ff2bb5fa87e05e94754ec680a067d397d93a486` identified two
locale-dependent currency assertions and two existing screenshot evidence locks
affected by the GEX symbol deep link. The assertions now accept equivalent compact
currency formatting, and both existing capture scripts completed all 240 scenarios.
The four async-evidence tests and eleven existing evidence-lock checks then passed.
No GEX layout change or weakened evidence lock was used to resolve these failures.

The flagship OHLC writer also had a real fallback defect: a failed fresh fetch
could rebuild prior bars as newly sourced Yahoo data, dropping metadata. The repair
reuses the exact prior file, retains its origin and observation times, rejects a
shorter or older replacement, and adds nonqualifying observation facts to a fresh
fetch. New bars cannot inherit the previous view contract. The universe builder
preserves real opens even when the legacy vendor is unknown. The 16 provenance,
12 atomic-publication and 9 research tests passed together on the owned worktree.
These repairs preserve evidence; they do not themselves qualify a price basis.

An actual frozen chronological research run is now retained with its exact input,
procedure and output hashes. The price-feature candidate lost to the class-prior
baseline on Brier score and log loss at 5, 21 and 63 sessions. See
[research result and reproducibility](RETURNS_RESEARCH_RESULT_2026-10-18.md).
It is exploratory current-vintage evidence for one stock, not a production model
qualification. The negative result is preserved rather than tuned away.

A forecast with producer-authored metrics and hashes cannot self-admit. The consumer
currently emits `CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED` even for a structurally
complete candidate. There is no Boolean/environment bypass. The delegated owner
census returned no outcome and was not accepted. Direct source reads identified
the existing Eval OS measurement and recovery law; a Returns-specific canonical
admission receipt has not been located or published. No second registry is created.
The seasonal display-only LOYO output is never used as a probability fallback.

Current descriptive qualification and predictive qualification are separate
obligations. The proposed integration is an owner-approved materialization binding
for the actual Terminal OHLC artifact under the existing Data OS view, with its
current-vintage basis evidenced and its historical vintage still unattested. See
[the exact owner questions and acceptance criteria](RETURNS_DATA_QUALIFICATION_2026-10-18.md).

Source workspace: Terminal branch `sol/web-returns-intelligence-20261018`, acquired
at `d6515f47232538161af8d3d4c27064165eda40fe`. The initial acquisition's unknown
transport return was reconciled through the same operation and owner. The earlier invalid
Fabric source-audit submission has no proven START. The separate first numerical
review returned BLOCKED: its Linux worker could not access the unpushed Mac files,
and reviewed zero candidate files. The later exact-published-source review ended
with return code 77 and an unconfirmed final response after a worker rate limit;
it produced no accepted review findings. Neither is an independent PASS. Updated
source requires a fresh bounded review. Draft PR:
https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1043.
Publication, merge and production deployment remain separately evidenced steps.

## Primary research

- Pan & Poteshman, *The Information in Option Volume for Future Stock Prices*,
  https://www.mit.edu/~junpan/volume.pdf — evidence was specific to opening,
  buyer-initiated non-market-maker volume; ordinary public call volume is not the
  same variable.
- Cboe, *0DTEs Decoded: Positioning, Trends, and Market Impact*, May 2025,
  https://www.cboe.com/insights/posts/0-dt-es-decoded-positioning-trends-and-market-impact
  — the examined gross-volume growth did not imply comparably large net dealer
  hedging; sample-specific results are not a universal no-impact claim.
- SpotGamma methodology, https://spotgamma.com/gamma-exposure-gex/ — gamma exposure
  describes conditional market structure, not a standalone directional forecast.
- Adams & MacKay, *Bayesian Online Changepoint Detection*,
  https://arxiv.org/abs/0710.3742 — causal regime-change detection is a useful future
  mechanism, but a change-point probability is not a price-up probability.
- Gneiting & Raftery, *Strictly Proper Scoring Rules, Prediction, and Estimation*,
  https://doi.org/10.1198/016214506000001437 — probability forecasts need appropriate
  scoring and separate calibration assessment.

Empirical usefulness of the new descriptive thresholds, incremental options edge,
and production calibration remain hypotheses until measured. No trading authority,
profitability claim, or investment recommendation is created by this workspace.
