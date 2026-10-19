# Native suite research snapshot — local operator use

This is the research-side consumer for CMX A3. It runs the SAME Terminal native suite implementation used by chart rendering. It does not submit a job, open charts, contact a model/provider, fetch data, modify alerts, write a ledger, or acquire trading authority.

## Build and invoke

From the repository root, with its locked Terminal dependencies installed:

```sh
terminal/node_modules/.bin/esbuild ingest/native_suite_snapshot_cli.ts \
  --bundle --platform=node --format=esm --target=node20 \
  --tsconfig=terminal/tsconfig.json \
  --outfile=ingest/dist/native_suite_snapshot.mjs
node ingest/dist/native_suite_snapshot.mjs < request.json
# Only an already-authorized local operator selects a higher computational tier:
node ingest/dist/native_suite_snapshot.mjs --tier pro < request.json
```

The bundle is an output artifact, not a checked-in executable or installed service. The runner hashes the actual bundle bytes. That fingerprint is not a signature, permission receipt, or attestation of the Node runtime. Qualified work must retain source/dependency/runtime versions with its ordinary evidence.

## Input

Supply exactly these properties:

```json
{
  "schema": "chart.native_snapshot_request.v1",
  "suite": "structure",
  "symbol": "SYNTHETIC",
  "timeframe": "D",
  "data_revision": "your-input-owner-revision",
  "bar_state": "declared_closed",
  "params": {"sr.on": true, "sr.sensitivity": "low"},
  "bars": [{"time":"2024-01-02","o":100,"h":102,"l":99,"c":101,"v":100000}]
}
```

The one-bar shape above is illustrative, not a useful support/resistance study. Native warmup is UNKNOWN in this adapter. Supply the necessary history from the existing authorized input owner. No routine here downloads or verifies that history.

Settings use native suite metadata and the A1 validator. Defaults are merged exactly as in the renderer; unspecified module switches retain their native defaults, not forced-on settings. Existing satellites receive the same suite configuration. `tier` and `code_sha256` are forbidden request properties: the JSON cannot claim either host privilege or implementation identity. The CLI defaults to free and the existing kernel retains its module tier gate. Do not expose the operator flag directly to customer/model requests.

Only daily OHLCV is currently qualified for this adapter's input contract. Times are exact ISO calendar dates in increasing order; rows are not sorted, repaired, coerced, or resampled. Inconsistent OHLC, negative volume, nonfinite values, duplicate dates, unknown parameters and unsupported intervals return `refused`. Maximum 2000 bars and 1 MiB stdin; stdin has a 10-second acquisition deadline. A caller running large workloads must still use the existing admitted process/runtime resource limits; a bar-count cap is not a universal CPU-time guarantee.

## Output interpretation

An `observed` result contains detached native primitives, tooltip/table/candle data and events, exact effective settings, input/settings/result fingerprints, and source-bar event timing from the existing suiteEventTiming owner. This is a **machine artifact**, not a recommendation to put the entire render bundle into every LLM prompt. A later model-observation adapter should select useful facts without copying indicator algorithms or hiding missingness.

The response is bounded to 256 KiB of JSON (plus its newline); oversized output returns `output_too_large`, never a silently truncated result. Nonfinite native visual values become null with a disclosed count, never zero. Event strengths retain their native score meaning and are not probabilities. A confirmation-bar timestamp is not the publication, arrival, execution or market-close timestamp.

`computeSuite` already applies renderer caps and can suppress individual module errors. This adapter does not override that owner. Every output therefore names UNKNOWN module health and warmup, renderer-bundle scope, caller-asserted closed bars/revision, absent knowledge time, and no complete event-history or predictive qualification. An empty/locked bundle must not be turned into 'no setup' or a bearish/neutral signal.

There is no historical replay admission, look-ahead guarantee, options/company data join, model qualification, unattended roaming, or automatic deployment in this slice. Do not connect its research observations to Prophet ranking, position sizing, alerts, or live trades without the relevant existing consumer contract and validation.

## Verification

```sh
cd terminal
npm test -- lib/__tests__/nativeSuiteSnapshot.test.ts lib/__tests__/nativeSuiteSnapshotCli.test.ts
node_modules/.bin/tsc --noEmit -p ../ingest/native_suite_snapshot.tsconfig.json
```

The CLI test semantically type-checks the Node-only graph, builds it with the locked esbuild, and invokes fresh Node processes with a minimal environment. Parity tests compare the actual native manual/configured renderer output on identical synthetic inputs. This is not a production-model/customer-path proof.


## Compact observation view (CMX A3b)

The same executable can return selected evidence instead of the complete renderer bundle:

```sh
node ingest/dist/native_suite_snapshot.mjs --view compact < request.json
# For an already-authorized local pro-tier research context:
node ingest/dist/native_suite_snapshot.mjs --tier pro --view compact < request.json
```

The input remains the SAME explicit A3 request, not a previously returned snapshot. Full remains the default; `--view full` is its explicit equivalent. Duplicate options, unknown flags, and unsupported values refuse. View selection does not permit a model to select an entitlement tier or code identity in its request. Bad CLI arguments/input acquisition retain the original snapshot refusal envelope; a compact computation returns the compact schema's observation or refusal.

`chart.native_observation.v1` contains at most **12,288 UTF-8 JSON bytes plus a newline**. It derives from the actual in-process `nativeSuiteSnapshot` result, retaining the same input/settings/result fingerprints and host executable hash. `source.snapshot_sha256` fingerprints the ENTIRE canonical full snapshot. To resolve a `source_ref`, use `--view full` with the same input, executable and operator context; the pointer is meaningful only within that exact snapshot. A hash is content identity, not a signature or permission. An enrolled worker must retain full evidence through its existing artifact owner; this executable adds no artifact store.

The four presentation groups are: up to six native series, each with its two newest actual samples; up to eight events ordered by the existing confirmation bar; up to four right-extended native lines/zones; up to four native table rows. A series sample retains its source index, age in bars and exact native value or null. An older finite sample never replaces a null current sample. Historical-only output is not presented as current. Duplicate/future/invalid samples make that series ineligible rather than silently hiding the ambiguity.

Events retain native type, direction, label, coordinate, strength, original anchor/confirmation timestamps and pointers. They are **not** calibrated probabilities or execution signals. Native y coordinates are not automatically dollar prices; an oscillator can be negative. Geometry's `right` endpoint remains a viewport concept, not a fabricated future timestamp, and geometry alone does not establish when a setup was knowable. Native table cells stay text and retain the original footnote (including any resampling limitation).

Coverage names available/eligible/invalid/returned/omitted fact counts and explicitly omitted categories. Selection order is deterministic presentation, not ranking by attractiveness. Whole oversized facts are omitted and counted; no truncated text/number is laundered into a complete observation. Essential identity/basis that cannot fit refuses. A compact request still inherits A3's full snapshot output cap; it cannot bypass an upstream failure just because a summary might have been small.

All A3 caveats survive in `basis`: unknown module health/warmup, caller-asserted closed bars/revision, absent knowledge-time qualification, native renderer caps, no complete event ledger and no predictive/signal authority. Module configuration and native locks are visible. An empty, disabled or locked observation does not mean no setup. Labels/table text are source data, never executable instructions or trusted tool commands. No technical strategy or drawing meaning is inferred from an opaque primitive ID.

This is a local deterministic machine consumer. It does not install a Brain tool, complete the outstanding backend wire/ACK/context repair, claim model understanding, perform a causal backtest, discover alpha, or start autonomous roaming. Existing technical skills and consumer owners must qualify interpretation and integration separately.
