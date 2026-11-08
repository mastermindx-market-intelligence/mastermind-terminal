# F01 continuation: isolate the thesis test's external widget

The previous PR head `b14436dd7b9c1296d17455c89f63960c774ab9be` failed hosted CI in desktop-5 and mobile-3. Workflow `41792754660`, attempt 1, checked out synthetic merge `5011a82b62de7f77c09f65b0ede287190505a071` against base `494f75ad48aba86e0916cef21ffdacadef8fea28`.

Both jobs fail the final zero-browser-error assertion in the existing thesis lineage journey. Root inspected the six archived traces: the original and two retries for each project each contain three failed requests to `https://www.mastermind-x.com/mm_brain.js`, with status -1 and `net::ERR_CONNECTION_CLOSED`. The main-page recorder receives two resource errors; the stale tab supplies the third trace request. The preceding thesis lifecycle/history assertions finish. This diagnoses an external dependency in this fixture; it does not establish a directory regression or the upstream service's root cause.

- [Desktop job 126449710430](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41792754660/job/126449710430)
- [Mobile job 126449710445](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41792754660/job/126449710445)
- [Exact tested thesis source](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/5011a82b62de7f77c09f65b0ede287190505a071/terminal/e2e/thesis-workspace.spec.ts)

## Repair and ownership

The four-line insertion in the existing `prepare()` helper fulfills only that exact external script URL with an empty JavaScript response, at browser-context scope so primary, stale and reopened tabs use the same deterministic fixture. This follows the existing `analysis-ai-context.spec.ts` and `watchlist-review.spec.ts` pattern. The helper already isolates the unrelated Brain usage API.

The production Brain loader, configuration installation, thesis APIs, persistence, conflict handling, assertions, timeouts and retry policy are unchanged. No Brain-specific test is disabled. The zero-console-error assertion remains intact.

The thesis blob is identical at the bare PR head and the hosted synthetic merge: `458c35361d3cbef104a27dedc0984b0aaad5c6aa`. Published-source overlap checks found neither this spec nor BrainWidget among #1271's 31 files at `c84feeba22c2a8dc5eeafa9e1e8381ecc6e51693`, or #761's 153 files at `5ee018ea38f99760f3b88559586476bf82dfcb9a`. That observation concerns published changes, not unpublished worker state. No other branch, owner or carrier was modified.

## Final local qualification

| Check | Actual result |
| --- | --- |
| Previously failing lineage journey, desktop + mobile | **2 passed**, no retries |
| Complete thesis spec, all three projects | **84 passed**, no skips, failures or flaky results |
| Scoped ESLint | Pass, zero warnings |
| TypeScript | Pass |
| Test-generated pre-existing proof images | Six exact tracked preimages restored; tracked proof unchanged |

The full spec retains 28 cases per project, including EN/ZH, history, stale tabs, dirty navigation, effect-unknown envelopes, account isolation, storage refusal, late responses and timezone/DST behavior. `RESULTS.json` binds exact commands, elapsed times and unchanged final source hashes before/after each run. The existing dev/test identity and isolated store are used; these are local mounted journeys, not production authorization or market-data proof.

`TRACE_READBACK.json` preserves exact artifact and inner-trace digests and the selected failed resource records independently read by root. `raw-reports.zip` preserves the actual local reports/logs/process records. Source SHA-256: `45c5249f143a26eb4d05a6b0cf4a0a80e197249d3c9a345aa5fc14f3d2aa1331`.

## Remaining distinction

Desktop also has an initial `ECONNRESET` in `watchlist-annotation-sync.spec.ts` that passed on a later attempt. Its underlying transport cause remains unresolved; this repair does not claim to fix it. Hosted Node 20 CI and the local Node 26 run are distinct. New-head hosted CI still must report its own outcome. The broader F01 86-case programme, original held Paper effects and formal release holds remain open.

Draft only: no Ready, merge, enqueue, held relabel or deployment.
