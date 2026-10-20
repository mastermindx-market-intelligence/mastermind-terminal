# News sidebar and shared briefs

Date: 2026-10-19  
Operation: `terminal-news-sidebar-20261018-c4`  
Product owner: existing [Market Intelligence Institutional Buildout](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/agentos/workstreams/WS-MARKET-INTELLIGENCE-INSTITUTIONAL-BUILDOUT.md), package N.  
Scope: implement the Chairman's News reading-surface changes and assess a low-cost, grounded summarization path.

## Decision

Give News the available sidebar height. Remove the activity strip and the reviewed/unreviewed workflow. Keep one compact header and focus the space on dated, readable stories and their original sources.

For a future Brief mode, **generate on explicit demand and share the result among readers with the same source permissions**. Opening Headlines, changing a ticker while reading Headlines, or receiving a news event must not by itself cause a model call. Start with an explicit update action when new evidence exists. Add automatic refresh only for actively demanded briefs after measuring cache reuse and correction handling.

The UI changes and the proposed summary service have separate completion criteria. This patch does not implement or enable a Brief endpoint, alter source rights, buy a feed, enable the legacy LLM job, or add model-driven rankings. There is no placeholder Brief tab.

## 1. Reading-surface changes

| Area | Result |
| --- | --- |
| Height | News uses the remaining desktop rail height; its stories scroll inside the panel. |
| Company pane | Hidden while authenticated, enabled News is selected; retained in the DOM so returning to Watchlists or Portfolio preserves its state. |
| Header | News, active ticker, truthful live/catch-up state, and a source selector only when multiple publishers are present. |
| Removed controls | Activity comparison, “No reports in 24h,” review counters/chips, “Mark shown as reviewed,” per-story review actions and review-status tags. |
| Story hierarchy | Absolute date separators, quieter publisher/time metadata, more readable headlines, short supplied teasers, optional grouped-source disclosure. |
| Accessibility | Native controls, focus outlines, named panel and source filter, ready/error status announcements, expanded-state relationship, coarse-pointer target sizes. |
| Failure behavior | Existing unavailable, restricted, degraded, quiet and stale-symbol protections; grouped-source failure reports a retryable error without disabling the main feed. |
| Responsive behavior | Full desktop rail; natural document flow on the existing mobile/tablet rail layout. EN/ZH and shared theme tokens. |

The canonical feed, safe source links, snapshot parser, auth proxy, SSE delivery, source health and story grouping remain the data boundary. Historical standalone review/flow helper modules and their independent contracts are not evidence that those controls still mount in News.

Implementation: [TickerNewsPanel](../terminal/components/news/TickerNewsPanel.tsx), [scoped styles](../terminal/components/news/TickerNewsPanel.module.css), [TerminalShell](../terminal/components/TerminalShell.tsx). Browser fixture evidence and the delivery receipt belong to this operation's PR.

## 2. What is already present

This is a source-level assessment, not a claim that every configured lane is currently running in production. Macro sources were rechecked at `553625459eccdd23a3759fe6322a632ca403d936`. The ticker API, deterministic annotation and clustering files are unchanged from the initial 2026-10-18 inspection.

| Existing component | Observed role | Implication |
| --- | --- | --- |
| [Terminal feed hook](../terminal/components/news/useTickerNewsFeed.ts) | Authenticated 20-story initial snapshot, then SSE-driven refresh, strict symbol/generation handling. | Incoming news can reach a reader without adding an LLM to each arrival. |
| [Terminal proxy](../terminal/lib/server/tickerNews.ts) and [route](../terminal/app/api/news/[symbol]/route.ts) | Existing user/session entitlement and bounded API forwarding. | Brief reads and requests must retain equivalent authorization. |
| [Macro ticker API](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/app/ticker_news.py) | Canonical security lookup, rights-gated qbus reads, snapshots, grouped stories and stream. | Extend the current News consumer boundary; do not create a parallel news feed. |
| [qbus operating contract](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/docs/ops/ticker-news.md) | One news writer; API has read-only store access and no provider key. | A summary cache must not turn the API or an LLM worker into another qbus writer. |
| [Clustering](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/engine/qbus_news_cluster.py) | Deterministic event groups with numeric, period, action, negation, rating and related distinction guards. | Reuse groups and source revisions. Another syndicated copy usually needs no new summary. |
| [Annotations](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/engine/qbus_news_annotate.py) | Optional deterministic event/numeric extraction from served headline/teaser, gated on derivative permission. | Useful structured input and checking aids; not an LLM digest or proof that a source entails a generated claim. |
| [Legacy news LLM](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/engine/news_llm.py) | Separate batch headline compression plus importance/tone. Explicitly disabled in [config](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/config.yml). | Do not activate it as a shortcut to a ticker Brief. It is a different product path and introduces unnecessary fields. |
| [LLM provider/usage integration](https://github.com/mastermindx-market-intelligence/macro/blob/553625459eccdd23a3759fe6322a632ca403d936/engine/llm_auth.py) | Existing provider fallback and usage capture into `lib.ai_costs`. | Reuse the admitted provider/usage owners. Source presence alone does not prove production suitability, a persistent job limit, or shared-cache concurrency. |

A separate read-only production observation on 2026-10-19 found the existing news writer active/running, its health state `live`, and its last successful catch-up at `2026-10-19T23:14:27.767768+00:00`. The operator-owned receipt was approved and unexpired, with headline, link, teaser and derivative processing permitted; body and image display were false. This removes an observed source-receipt blocker for synthesis of the served headline/teaser bundle. It does not by itself establish a particular external model endpoint's processing terms, quota, or a completed Brief implementation. No receipt, credential or service setting was changed.

Two audit details matter:

1. The legacy module's “default off” documentation conflicts with `cfg.get("enabled", True)` fallbacks. The checked-in explicit `enabled: false` currently keeps that configured path off. A future task must preserve explicit default-deny admission and should resolve this latent mismatch separately; copying the permissive fallback into Brief would be a mistake.
2. The optional Finlight AI feed is also explicitly disabled. The narrative news-vector path has `llm_extract: false`. Neither is the active ticker Brief implementation. There is no Brief payload in the current Terminal news contract.

## 3. TradingView target

The useful product target is a readable headline feed plus concise, source-linked key facts with clear coverage time. A static screenshot cannot establish overall update latency.

TradingView's [official corporate-news announcement](https://www.tradingview.com/blog/en/ai-powered-news-57454/) describes AI summaries of regulatory filings, key figures and original filing links, with summaries available within minutes. Treat that as a vendor-described capability, not an independently benchmarked latency result. Its [News Flow filters](https://www.tradingview.com/support/solutions/43000732560-news-flow-s-filters-overview/) also cover instruments, watchlists, providers and event categories.

Matching that level requires four capabilities:

- Timely, permitted source coverage, including substantive filings and releases where admitted.
- Correct event identity, deduplication, chronology and correction handling.
- Concise factual synthesis with inspectable sources.
- A clear reading experience that communicates coverage and missing information.

A better model cannot fill facts absent from a headline-only license. Start by summarizing only the licensed evidence actually available. Where evidence is too thin, show fewer facts or abstain. A future filing lane should reuse the existing filing/source owners and obtain its own admission; do not scrape a publisher article body through the source link as a hidden enrichment path.

## 4. Proposed first Brief release

### User experience

Once a real backend is ready, add a compact Headlines / Brief choice within the current header area.

Selecting Brief is the demand signal. Return an eligible shared cached artifact immediately; otherwise show a short preparing state while the existing admitted task owner handles the request. Headlines remain available. The first brief contains up to three substantive developments, with room for at most five only when the evidence warrants it.

Each development should contain:

- A short event label and one or two factual sentences.
- Exact links to the supporting reports or filing.
- Source attribution for opinions, estimates or conflicting accounts.
- The covered event/report date.

Show one coverage line for the bundle. Distinguish `generated_at` from the latest source observation included. Do not change “through” or “updated” merely because a request was attempted. No sentiment score, importance score, price-movement explanation inferred from coincidence, recommendation, or unsupported “why it matters” prose in the first release.

If newer material evidence arrives, retain a still-valid brief with its actual coverage and expose “Update brief.” Do not move the reader's scroll position when the replacement becomes available.

### Demand rules

| Event | First release behavior |
| --- | --- |
| No users and no internal Brief requests | Zero scheduled summary jobs. Existing feed ingestion continues independently. |
| Open Headlines or switch tickers there | No generation request. |
| Select Brief | Read authorized cache; join an already-running request or admit one bounded job. |
| Repeat same ticker/language/scope | Reuse the shared result if its evidence remains applicable. |
| New duplicate/syndicated report | Update source lineage; normally no regeneration. |
| Substantive new event | Mark that newer evidence exists; regenerate when requested. |
| Correction/retraction | Immediately suppress or mark affected claims superseded through the canonical lineage owner; never wait for an LLM to stop serving a false claim. |
| Rights/entitlement revoked | Withhold now-ineligible artifacts on every read, including cached responses. |
| Model failure or budget deferral | Keep an eligible earlier result with its real coverage, otherwise show an honest unavailable state; Headlines continue working. |

A later phase may coalesce changes for 60–120 seconds and refresh a currently viewed Brief no more often than every five minutes. These are proposed tuning values, not observed service behavior or a launch promise. Use the existing demand/task owner; if it has no qualified presence mechanism, keep the explicit update action instead of building a separate presence registry.

## 5. Source, cache and execution contract

### Evidence preparation

Use the stable security ID, market/venue context and canonical source revisions. Select a bounded set of distinct events from the existing clustering output. Material numerical differences, changed guidance periods, reversals, corrections and conflicting analyst opinions must remain distinct.

Construct two identities:

- **Audit identity:** exact permitted evidence revisions, extraction versions, rights receipt scope, recipe/schema version and actual model/route used.
- **Regeneration identity:** semantic event/fact content relevant to the brief. Exclude receive timestamps, `last_seen`, and other heartbeat-only fields.

Hashing every raw arrival would defeat caching. Conversely, deduplicating away a correction because its headline is similar would preserve a wrong statement. Preserve both exact provenance and a deterministic material-change decision.

Bound the supplied evidence by tokens and event count; include a disclosure when the selected evidence is incomplete. Avoid a rolling “summary of the previous summary” as the only input. Regenerate from the actual source bundle or retain explicitly source-backed claims.

### Cache and request placement

Proposed logical cache scope:

`stable_security_id + language + brief_scope + eligible_source/audience_scope + recipe_version`

The immutable artifact also records its evidence hash and revision manifest. Do not cache solely by ticker or user. A shared artifact may be reused only across consumers whose current rights permit its sources and derivative output.

The API must recheck rights on every cache read and request. Do not put a rights-bearing response into a publicly shared CDN cache. Replacing a rights receipt, correction, removal or security alias must invalidate the corresponding applicability, without relabeling an old artifact as fresh.

Deduplicate concurrent requests for the same logical scope/evidence through the existing admitted job owner. Every request needs a bounded timeout, existing request limits, a daily budget check and an idempotency identity. Repeated HTTP calls must not create repeated inference.

The concrete durable artifact store and production single-flight/job binding must be qualified with the existing product runtime owner before implementation is activated. `engine/llm_auth.make_call` supplies provider fallback/usage integration; it does **not** by itself establish these cache or job guarantees. Do not create a second Executive queue, router, retry registry, or lifecycle database. Keep the qbus news writer boundary intact.

### Output contract

A versioned, strict response should carry:

| Field | Meaning |
| --- | --- |
| Identity | Schema/recipe version, stable security ID, language and brief scope. |
| State | Ready, preparing, deferred, insufficient evidence, unavailable, or withheld; explicit reason where appropriate. |
| Evidence | Exact permitted source/story IDs and revision hashes, coverage start/end, selected event count, selection limits. |
| Content | Ordered developments; each has factual text, supporting source IDs and attributed uncertainty/conflict if present. |
| Freshness | Generation time, evidence coverage time and whether newer material evidence exists. |
| Lineage | Artifact ID, superseded artifact/claim references, correction or withdrawal reason. |
| Internal accounting | Actual model/route, prompt/schema version, input/output usage, cache hit, latency and accepted-cost record. Do not expose operational identifiers in the normal reading flow. |

Returned source IDs must be a subset of the permitted input manifest. Parse strict JSON and reject unknown fields or malformed shapes. Validate numbers, currencies, periods, dates, entity attribution and source references. Those deterministic checks reduce risk but cannot prove semantic support; evaluation and sampled review must also assess whether the cited text supports each claim.

The summarizer receives bounded source text as untrusted data and has no browser, shell, retrieval, portfolio or trading tools. Source text must never change the system instructions. No user portfolio details are needed for a shared factual ticker brief.

## 6. Cheap models and Fabric

Use the existing Fabric to commission bounded dataset preparation, model evaluation, implementation and independent review. It is suitable for the build/evaluation workflow. A production brief should use the product's admitted inference path, with bounded evidence and structured output, rather than launching a coding-agent session per headline or webpage request.

OpenCode has both an agent harness and an inference gateway. A model's availability in the harness is not proof of production admission, quota, retention terms, or summarization quality. Preserve Model Router / Capacity / RuntimeBinding ownership; do not pin a provider account into application code.

The [MiniMax price page](https://platform.minimax.io/docs/pricing/overview), checked 2026-10-19, lists standard M3 at $0.30 per million input and $1.20 per million output tokens, and M3.1 Flash at $0.15 / $0.60. [OpenCode's model catalog](https://opencode.ai/v2/docs/console/models/) lists MiniMax M3/M2.7 at $0.30 / $1.20 and GLM 5.3 Flash at $0.15 / $0.50. These are public catalog observations, not a claim that every route is admitted in Mastermind.

Evaluate the cheapest currently admitted candidates. Include a deterministic extractive baseline. A free promotional endpoint can be useful for an approved experiment, but its availability and model-specific retention/training terms need checking; do not treat “free” as a durable capacity or data-handling guarantee.

### Illustrative token economics

Assume 6,000 input tokens and **600 total billable output tokens** per accepted refresh, using $0.30/M input and $1.20/M output. Cost is:

`(6,000 × 0.30 + 600 × 1.20) / 1,000,000 = $0.00252`

| Workload | Refreshes/day | Model cost/day | 30 days at that workload |
| --- | ---: | ---: | ---: |
| Nobody opens Brief | 0 | $0 | $0 |
| Internal trial | 20 | $0.0504 | $1.51 |
| Small launch | 100 | $0.252 | $7.56 |
| 50 demanded tickers, four refreshes each | 200 | $0.504 | $15.12 |
| Heavier demand | 1,000 | $2.52 | $75.60 |
| 500 tickers, every five minutes for 6.5 hours | 39,000 | $98.28 | $2,948.40 |

The last row is an intentionally wasteful comparison, not a recommendation or a claim about current usage. Monthly figures assume 30 equivalent days, not a market trading-day forecast. These figures exclude retries, additional reasoning tokens beyond the stated total, other model calls, feed licensing, infrastructure, storage and taxes. Shared cache reads require no model tokens; they still have normal infrastructure cost. Actual output usage and cost per accepted brief are what the ledger must measure.

Proposed internal canary limits: 20 unique generation attempts/day, one concurrent job per evidence key, one small retry only for a repairable transport/format failure within the same budget, hard token and monetary ceilings. Count all attempts and fallback calls. A provider outage or malformed response must not trigger an unbounded waterfall. These are starting policy values for the existing budget owner, not settings activated by this UI patch.

## 7. Evaluation and implementation sequence

1. **Freeze a representative corpus.** Prepare 60–100 immutable, rights-eligible bundles covering earnings, guidance, acquisitions, analyst opinions, sparse evidence, duplicate wires, revisions, denials, contradictions, currencies/units/periods and embedded prompt injection. Include EN/ZH outputs and empty/withheld cases. Keep source event times and first-seen versions for replay.
2. **Run a small comparison.** Compare the cheapest admitted candidates to the extractive baseline with the same evidence and strict output schema. Record every attempt's tokens, total cost, latency, format failures, factual errors and source entailment. Use existing Fabric result/acceptance owners.
3. **Accept a bounded quality bar.** No unsupported material claims or materially wrong numbers in the acceptance corpus; every claim cites eligible supporting evidence; corrections/attribution/uncertainty are accurate. Separately measure helpful consolidation and latency. Passing a small corpus is launch evidence, not a universal hallucination guarantee.
4. **Implement the server slice.** Qualify source/derivative rights and exact inference/artifact/job bindings; add explicit default-off configuration, bounded evidence selection, shared artifact reuse, current-read authorization, correction invalidation, deduplication and accounting. Reuse current auth, news, model/usage and runtime owners.
5. **Implement the consumer.** Add Brief only when the endpoint and valid states exist. Verify request coalescing across two readers, cached reuse, a different rights scope, ticker/language switching, source withdrawal, correction and budget/model failure.
6. **Observe an internal canary.** Start with explicit Brief selection and manual refresh. Verify zero summary jobs with zero demand, no duplicate concurrent inference, no revoked output served, and no changes to news ranking or trading authority.
7. **Decide on automatic refresh from evidence.** Expand only to demanded tickers after observing useful refresh frequency, cache-hit rate, cost per accepted result, correction latency and factual quality. Universe-wide refreshing is not the default.

## 8. Delivery boundaries and continuation

The parent owns product judgment and release acceptance. Test/evidence work is delegated through the existing Fabric under the same original operation root. The active return must be consumed in full and verified before integration; a controller-created or DONE status is not acceptance.

Protected source-law reference: [Mastermind skillpack](https://github.com/mastermindx-market-intelligence/Mastermind/blob/89cf2399c47da20c0c23826266e52984f88c27e7/docs/sol_skills/INDEX.md). Agent OS remains in Macro; this document is implementation design and evidence, not a replacement organizational ledger.

Required closeout for the UI: focused News/unit and type checks; affected responsive News journeys; inspected dark and light-specimen screenshots in EN/ZH; exact reviewed PR/CI/merge receipt; git-gated deploy of a protected target; real-path production evidence where the authorized browser is available. Distinguish any unverified production cell from local fixture proof.
