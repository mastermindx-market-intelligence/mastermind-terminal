# Portfolio Treasury consumer — integrated source qualification

This packet qualifies the exact five-file consumer patch carried in [PR1044 comment6308643716](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044#issuecomment-6308643716), applied to actual Portfolio squash `8f00622096d0dc574458c134516e802ce78907ae`. The portable patch SHA256 is `c794d3f276ecb6d57a0e6ae91a630ff9d4eeeaf81d7a2a6a1e095b81a13094e6`. All five resulting source hashes match the independently reviewed handoff; `validation.json` binds them to the fresh commands and raw logs.

## Behavior

The risk-history route verifies its captured bearer against the captured owner before reading positions. The Treasury helper makes one bounded request to literal loopback port8000, sends only that bearer and the three requested dates, refuses redirects, validates the full dated DGS3MO annual-percent contract and preserves failure/staleness distinctions. Cookies are not sent to Treasury. The existing OHLC cookie forwarding is restricted to the fixed approved origin. No alternate price origin or credential retry is introduced.

The existing compiler and its seven-calendar-day backward alignment rule remain unchanged. Missing or stale risk-free observations continue to withhold Sharpe/Sortino; beta can remain available when price inputs qualify. No qualified price window means no Treasury request. The Portfolio owner-remount repair, mutation flows, SQL0036, original receipt, UI, visual harness and image guard remain unchanged.

## Fresh local results

- Four affected suites: **105 passed** —33 compiler, 12 route, 36 Treasury helper, 24 route-composition cases.
- Full project TypeScript check: **exit0**, using `tsc --noEmit --incremental false`.
- Whitespace check: passed.
- Runtime: Node **v26.5.0**, npm **11.17.0**. The host's node@22 path resolves to this same Node26 binary; it is not represented as a Node22 run. `npm ci` succeeded and the package lock remained unchanged. Hosted CI uses its own pinned runtime and remains a separate required gate.

The byte-exact raw affected-suite log is stored as `affected-tests.log.gz` to preserve its terminal whitespace. It retains the expected fixture store-error message and Vite deprecation warning. The empty typecheck log is the actual successful output (SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). Historical handoff tests are not counted as this fresh run.

## Review and release boundaries

The separate native reviewer prospectively reconstructed and reviewed the same five postimages against the frozen application candidate and compared them with MacroPR9880 producer head `239aaa8f5ab5a4105c1ddae9c70284a9dbb8cbaa`, finding no blocking source defect. That assessment is not an integrated-commit approval; the actual frozen follow-up receives its own source-binding review and ordinary hosted CI.

The producer's merge, installation, current Treasury freshness, permitted holdings/SPY price access and positive authenticated consumer proof remain separate. Existing unpublished producer work is preserved on its incumbent carrier. Historical price-access refusals and one-shot production-write permissions are not replayed. No positive financial metric, production mutation, producer availability or full-project completion is claimed by these fixture results. The existing compiler-hash discrepancy in older evidence predates this patch and is not restamped here.
