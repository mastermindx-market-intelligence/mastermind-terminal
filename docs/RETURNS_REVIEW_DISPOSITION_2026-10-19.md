# Returns review disposition — 2026-10-19

## Scope and result

This records completed review returns, root decisions, and the verification of
the integrated source before its next publication. It is not a production,
Data OS whole-system, or forecast-model acceptance receipt.

- Terminal integration PR: [#1043](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1043).
- Paired existing Data OS owner PR: [Macro #9619](https://github.com/mastermindx-market-intelligence/macro/pull/9619).
- Prior reviewed source: `47ac40e3cffdce2ce02e88bd0f531f6c0f1f98c9`.
- Integration base: `4a418f530ff0482b6e518ec98a6d12dc3dee42b8`, including master navigation and producer cutoff changes.
- Owner source under independent review: `d974d0f843737e49bc072c4481c2fd6539a02d4b`.

## Independent returns and disposition

### Numerical/source review

Completed bounded PASS advice on 47ac40, response SHA-256
`2bab3d881775b99ae9ed97445ba01d268c89c21d575bf76347a4d1e8ca97f306`.
The reviewer independently ran 37 Python tests and recomputed the frozen research
fold counts and reported scores. Its TypeScript analysis was source inspection,
not a runtime execution.

| Finding | Root disposition |
|---|---|
| Span/count checks can lose an interior prior session | Fixed: every prior date must remain in a replacement candidate; behaviorally tested with an extra old row hiding a removed interior row. |
| Prior volume was not validated | Fixed: Boolean, negative, nonfinite and nonnumeric volume prevent reuse; tested. |
| A reused deep series could be labeled real OHLC in its indicator slice | Fixed: the indicator receives the actual chosen chart input's bar-quality label; Polygon backtest routing and three-day closure calculation remain intact. |
| A stale deep document can remain older than the latest shallow quote | Retained source-conservation policy. Reuse preserves its exact original clocks; Returns displays the actual through date and historical state. Reuse does not manufacture a fresh observation. |
| Softmax step requires the Frobenius norm instead of spectral norm | Rejected with the bound below; the frozen procedure remains unchanged. |
| No fsync in the existing atomic writer | Recorded existing durability limitation. The established atomic replace protocol and its failure tests remain; no unrelated storage redesign. |

For one multiclass observation, the softmax covariance is
`C = diag(p) - p p^T`. Its largest eigenvalue is at most 1/2:
each Gershgorin upper bound is `2 p_j (1-p_j) <= 1/2`.
For the matrix of feature rows X (including intercept), the loss Hessian obeys
`H <= 0.5 (I ⊗ X^T X/n) + lambda I`.
Thus `0.5 ||X||_2^2/n + lambda` is a valid gradient Lipschitz bound;
leaving the intercept unpenalized only reduces the penalty curvature.
A Frobenius-norm bound would be looser, not required. This adjudication does not
alter the negative forecast result.

### Consumer review and repair

Completed REQUEST_CHANGES advice on 47ac40, response SHA-256
`b6ac77ce2a2c52322f30f3affb68249f1c47adac50d0bc300033721911f2c5a1`.
That verdict remains the verdict on its reviewed source; the review return was
accepted with these root dispositions.

The bounded repair against 4a418f returned response SHA-256
`e8c603678f258c0053139a8f6c3edcd2c3fa9f2c3b07e3027e577dfa689ebdf7`.
Root read all hunks and applied the exact proposal cleanly before the additions
described below.

| Finding | Integrated behavior |
|---|---|
| Zero-bar/mismatched-subject 200 response rendered a dead workspace | An explicit invalid-history state offers Retry; no calendar or null-session evidence request renders. |
| Chart-host Returns used an inert AppShell identity | Both TerminalShell MegaPane mounts pass their existing memoized AccountIdentity. Returns resolves that prop or its actual AppShell context; the evidence panel requires the resolved identity. |
| Reducing chart range left calendar/evidence pinned outside the chart | The same interaction resets only an out-of-window pin to the latest available session. In-window selection is retained. |
| Unsupported option root remained loading | It terminates in an explicit absent state. Composite baskets issue no options or forecast requests. |
| Basket error lacked local recovery | Its failed read offers the existing Retry action without changing the membership denominator. |
| Returns deep-link family lacked a test | The market-family migration case is covered. |
| UTC date slicing could select the wrong options session | Root consumed the existing `intradaySources.etDateOf` convention for strict timestamps, including DST and microseconds; date-only session records remain supported. |

The repair initially proposed restricting the shared matcher to date-only
snapshots. Root amended that proposal because live flow uses timestamps and the
repository already owns an instant-to-New-York conversion. Tests now prove both
sides of UTC midnight and winter/summer offsets. No current flow is borrowed for
a selected historical session; no gross premium is interpreted as buying intent.

## Additional materialization and comparison work

The new explicit-file adapter loads the existing Data OS owner leaf and canonical
identity reader, using the configured Macro repository only. It records hashes
of the actual installed source bytes. A git commit is attached only when those
bytes match the checked-out source; the production vendored-code layout is covered.

Python and JavaScript JSON serializers need not spell the same numeric value the
same way. The normative owner codec therefore uses ISO dates, a row count and
binary64 big-endian OHLCV. The exact synthetic golden fixture crosses the two
runtimes. The earlier Python JSON observation hash keeps its separate codec label.

The browser, ChartPanel origin reader, basket route and forecast route verify the
whole artifact before transformations. A private process-local verification record
is invalidated by changed content or metadata; a serialized verified flag cannot
qualify data. Any append changes the binding's content and leaves a sticky refusal.
A genuine no-op returns the original document.

Comparison now requires both compatible broad basis and transformation family.
An unavailable benchmark remains visible as unavailable while absolute analysis
continues. A current-member basket preserves its constituents' common family.

## Verification of this integrated source

| Verification | Observed result |
|---|---|
| Application numerical, evidence, API, account-state, origin, route-family and materialization suites | 117 passed |
| Producer adapter, real main/fallback, atomic publication, session-anchor and Polygon suites | 74 passed |
| Complete application TypeScript check | Exit 0; RETURNS_TYPECHECK_OK |
| Playwright stock, group, calendar, failure, wrong-root, browser binding and benchmark-absence cases | 21 passed across 1440×900, 820×1180 and 390×844 |
| Responsive PNG/JSON evidence | Refreshed 15 captures and source hashes; illustrative fixtures, not live prices |
| Owner C04/materializer suite | 63 passed |
| Owner registry/consumers/support/C04 selection | 171 passed, 8 skipped, 1 expected failure |
| Working-tree whitespace check | Passed |

The Python suite emitted an unrelated existing pytest cleanup permission warning
for an old browser-runtime temporary directory; all selected assertions passed.
Browser fixture mode reported absent service credentials as expected; no credentials
were copied or production services changed by those tests.

## What remains open

1. Conclude independent review and CI of the new owner and consumer source,
   integrate current main/master as necessary, and publish only merged source.
2. Complete real production materialization and consumer readback through the
   existing writers. Current inspection shows the required stock aliases but
   missing Yahoo benchmark aliases; code tests do not establish live coverage.
3. Expand a declared useful universe through the existing reference/membership
   owners and verify ordinary refresh behavior.
4. Retain source-time-qualified observations and descriptive state changes through
   existing owners. Current-vintage reconstruction is not an archived signal.
5. Advance historical membership/weights, options-basis and source-time joins,
   state-change monitoring, and predeclared experiments through existing owners.

The first frozen NVDA forecast candidate lost to the prior baseline at all three
horizons. Its input, procedure and result hashes remain unchanged.
`CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED` continues to prevent probabilities.
