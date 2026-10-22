# Portfolio artifact cookie destination guard

## Change and boundary

The main Portfolio route previously compared a configured artifact URL against a host derived from the same configuration. An external HTTPS origin or HTTP on the expected hostname could therefore receive the caller's selected session cookies on the first request. Manual redirects protected later hops but did not constrain that initial destination.

The route now independently approves only the parsed origin `https://www.mastermind-x.com`, with no URL username or password. Other configured artifact destinations receive no session-cookie header. The module-time base configuration, manual redirects, timeout, typed artifact outcomes and caller-separated cache are retained.

This source defect is configuration-induced. These tests do not establish a production disclosure. No live data-source or credential probe was made; historical-price source/access qualification remains separate.

## Regression proof

The new route-level suite imports the configuration afresh for every case and imports its fixture database in the same module graph. Every upstream request is mocked.

| Cases | Proof |
| --- | --- |
| Default origin, configured approved origin, explicit HTTPS port 443 | Exactly the selected two synthetic session chunks are sent; unrelated cookies and Authorization are absent. |
| External host, HTTP, nondefault port, two lookalike hosts, username, password, username/password, approved hostname in userinfo | No session-cookie or Authorization header is attached. |
| Anonymous caller at approved and external origins | Request remains anonymous. |
| Redirect at approved and external origins | One manual request and typed `page_unreadable`; no follow-up request. |
| Malformed base | No credential-bearing request; the normal URL parser failure yields typed `page_unreadable`. |

On the unchanged base route, the suite failed in **10 cases**, with **7 passing**. With the repair, the new suite and four existing route/cache suites passed: **74 tests in five files**. Changed-file ESLint and full `tsc --noEmit` also exited zero.

The focused set covers the original Portfolio risk route, historical risk route, artifact cache and general Portfolio owner/mutation route. No UI markup or style changed; hosted CI supplies the full application and responsive integration gate.

## Receipts

- `validation.json`: exact base and source blobs, runtime, commands, exit codes, durations and hashes.
- `red.log.gz`: the original route's ten reproduced failures, retained unedited.
- `green.log.gz`: all 74 passing focused tests.
- `lint.log.gz` and `typecheck.log.gz`: successful, empty diagnostics.

Local Node was v26.5.0. The repository's hosted Node 20 CI remains a separate release gate. These local receipts do not assert that hosted CI, protected merge, deployment or live acceptance has completed.
