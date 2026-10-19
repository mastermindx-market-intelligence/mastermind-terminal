# Returns review disposition — 2026-10-19

## Scope and result

This records completed review returns, root decisions, and the verification of
the integrated source before its next publication. It is not a production,
Data OS whole-system, or forecast-model acceptance receipt.

- Terminal integration PR: [#1043](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1043).
- Paired existing Data OS owner PR: [Macro #9619](https://github.com/mastermindx-market-intelligence/macro/pull/9619).
- Prior reviewed source: `47ac40e3cffdce2ce02e88bd0f531f6c0f1f98c9`.
- Integration base: `4a418f530ff0482b6e518ec98a6d12dc3dee42b8`, including master navigation and producer cutoff changes.
- First independently reviewed owner source: `d974d0f843737e49bc072c4481c2fd6539a02d4b`; accepted hardening: `a380c1783b70fad9878298d282501b9c84b87df6`.

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

## Verification at consumer checkpoint 0b3c47

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

## Completed owner and binding reviews

The owner review returned bounded PASS advice on d974d0, response SHA-256
`8e5475c26af622894e425fdc099e943034e915c0f440e879700b14d8e4454544`.
The follow-up hardening proposal had response SHA-256
`74419bde1ac08cc07e60a6b6cd302f47d2c2750a29fc4b4cf4ece68ebcf89a56`.
Root read the exact complete patch, corrected its missing
`ZoneInfoNotFoundError` import, changed the test to exercise that actual exception
handler, removed an object-identity assertion, and corrected claims about atomic
reference publication, freshness, factory scope and golden ownership.

The hardened owner now resolves New York timezone data only when binding.
Portable encoding remains available without tzdata; binding instead returns a
typed clock refusal. Malformed listing-parser results refuse. Reference read time
passes through without an invented age or freshness policy. API and golden bytes
are unchanged. Root validation at the amended source: **72 C04/materializer tests
passed** and `git diff --check` passed. Published owner commit: a380c178.

The independent consumer/producer binding review returned bounded PASS advice
at 0b3c47, response SHA-256
`4af05af3498e0b75ccc80d8dcfda9c9b8f6b470537ae2fce3d0a59e32ef328f6`.
It executed **37 Python and 92 TypeScript tests**, targeted strict TypeScript
checking, real owner/adapter/canonical-reader probes, and Python/JavaScript
portable-byte checks. It did not run the whole application or browser suite.
Root read the full return and separately inspected the decisive owner/consumer
code before accepting the advice.

| Review observation or suggestion | Root disposition |
|---|---|
| Strip revision columns from selected aliases to avoid catalog refusal | Declined. Both canonical `from_records` and the owner's explicit `legacy_only_records` reject non-null revision metadata without the required context. Erasing it would conceal an owner refusal. Nullable columns are already normalized correctly. |
| Narrow the direct-materialization guard for a hypothetical future legacy null-registry contract | Declined. Removing both the materialization block and observation clock must not route remaining null-registry evidence into legacy qualification. Two added adversarial cases preserve that boundary. A new legitimate owner variant would need its own positive contract and fixture. |
| One reference snapshot serves the whole nightly | Documented. Its hashes describe the actual read bytes, not a later republish, reference-age guarantee or atomic generation. |
| Browser verification requires a secure WebCrypto context | Documented for HTTPS production readback. Unavailable verification does not qualify a history. |

The bounded ETF census, response SHA-256
`d53dbccdd116acef30bee1a69f3cb67d50cfa257b01397bed90f2170e7030c39`,
was accepted for its source/data findings after root inspection. Its inference
that a direct ETF must first obtain Macro common-stock storage was not adopted.
The existing owner can explicitly extend its direct materialization contract,
subject to actual canonical/source evidence and normal publication. No alias was
admitted by that design decision.

## Latest master integration and root repairs

The candidate incorporates master
`fb0dacd4e4b88041a095971f6de50a38d33a55a7` through local merge
`099784b23ff2d6b4fae0126445e6000b062eac4c`. Earlier source-content integration
of 3e0be25 was given its missing merge ancestry by 079efef; e45bde2 was then merged
by 94095fb. Existing shared-shell, context-dock, daily ChartPanel and touch-back
behavior is preserved. No active merge state remains after these ordinary
commits in the same managed workspace.

A real tablet browser failure showed a calendar date pinned to April 1 while
the chart retained a hover index that now referred to April 20. Root reproduced
the problem with two deterministic cases: expanding the path for an older date,
and selecting dates within one path, including returning to the prior pin.
Both failed before the repair. Hover now belongs to the exact path, symbol, view
and selection; a changed context cannot re-index or revive it. Blur clears it.

Visual inspection also distinguished session inspection from the analytical
cutoff. Selecting a past calendar day pins the chart, day inspector and dated
evidence. The 5/21/63-session descriptive reading still ends at the latest
completed history date, now explicitly shown in that card's Through caption.
The regression confirms this distinction. The Chinese reported-price label no
longer implies that an unverified vendor-adjusted history is raw prices.

The expanded page-state suite passed 8 tests and the expanded materialization
suite passed 26, including the two combined owner-block/clock stripping cases.
They also passed together (34 tests). Complete application typechecking after
these final source edits exited 0.

One preceding desktop Chinese browser attempt timed out before hydration.
The trace showed two unfinished JavaScript downloads and no fixture data requests;
its screenshot was the server-rendered English loading state. The unchanged case
passed in isolation with one worker. No timeout, assertion, production behavior
or quarantine policy was weakened. After the dated-caption edit, the entire
responsive suite passed **21 tests in one run with one worker** across all three
screen sizes. All 15 PNGs and all 165 source-hash bindings were independently
verified against the final files. Root inspected refreshed desktop, tablet and
mobile captures, including the historical chart selection beside the explicit
latest reading date. These remain synthetic UI evidence, not production prices.

## What remains open

1. Complete current required CI, publish only merged source, and use the existing
   production release owner. The accepted bounded reviews do not waive CI.
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

## Full CI integration repair — 2026-10-19

The normal CI run [39209320561](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39209320561) at published source `15210ebae58bf4d577a9d15434bf7e43ced3379e` ran the full unit job: **13,249 passed, three failed, four existing todo**. The three failures were the existing PL6, options-axis and Visual Intelligence evidence readers. Their manifests still bound the preceding ChartPanel bytes (`f100d02a…`); the integrated host was `1f24d314…`. This is a real evidence failure, not permission to waive the checks.

Root merged protected `5622e0ee0275a1a111ae4541c1294e7f1549c585` (the resting mobile roller-label repair) through an ordinary Git merge in the same owned workspace. The resulting capture source is **`34ec2695b7ee3abc712b93efdddc7dc01cc56558`**, with parents `15210ebae58bf4d577a9d15434bf7e43ced3379e` and `5622e0ee0275a1a111ae4541c1294e7f1549c585`. The owner readback was clean before capture. No application source changed during the following evidence repair.

- The existing Visual Intelligence suite passed **30/30** in a single run, one worker, zero skips/retries/flaky cases, across desktop/tablet/mobile and EN/ZH. Six screenshots and the actual complete JSON report were regenerated. Report SHA-256: `a6141ed988e45f3bd0e6759fe8778087a4427594c2e2e6ff97ab6346721e3543`.
- The existing PL6 capture tool regenerated **all 24** dark EN/ZH desktop/mobile crops and its source manifest; exit 0.
- The existing options-axis capture tool regenerated **five** views from its intercepted fixture contracts. Each retained six exact levels and six visible separated labels, with no console, page or HTTP errors. Its final reader independently checked these fields.
- All **three affected evidence readers / 10 tests passed** against the regenerated packets. No test, capture assertion, timeout, skip rule or source implementation was weakened.
- Root visually inspected the new desktop chart/context, Chinese mobile context, mobile options labels and Chinese mobile Options screen.

The Visual Intelligence manifest retains the prior source's build/unit claims under `priorChartContext9fe57LocalGates`; they are not relabeled as verification of the new source. The earlier Returns-specific 21-case browser run and 34 focused regressions retain their stated source scope. Required CI on the next published artifact head, merge, git-gated release and live readback remain separate gates.

### Bounded execution and continuation facts

Two new read-only Fabric requests (`returns-intelligence-20261018-ci-evidence-15210-v1` and `returns-intelligence-20261018-spy-admission-evidence-v1`) were refused by the selected admission path with `canonical_source_unreadable`. Their exact result SHA is `971eb7390dfc2e761cff7a49518de344335a26f014291097e5218e3fca592a58`; both remain UNVERIFIED, execution absence unproven, retry disallowed. No alternate provider, credential, host or native labor child was substituted. The native C3 adjudication retained root's distinct same-M2 repair under **CRITICAL_PATH_SHORTCUT**, after fresh clean custody readback; it did not convert those refusals into accepted worker results.

The prospective SPY source operation `returns-spy-qualification-20261019` has an unresolved constructor prefix. The typed acquire returned PARTIAL / EFFECT_UNKNOWN. Same-owner status identifies the registered Macro workspace at `/Volumes/Mastermind 2/agent-workspaces/macro/web/returns-spy-qualification-20261019`, exact base `a380c1783b70fad9878298d282501b9c84b87df6`, with an empty/absent index and no physical content except its Git linkage. Its 127,422 staged-deletion paths equal the HEAD path set. The sparse state includes data/site, whereas the pinned profile excludes them. No source edits, hydration, reset, cleanup, acquisition replay or publication of that workspace occurred. Preserve this state for exact owner reconciliation; never commit its constructor artifacts as source changes.
