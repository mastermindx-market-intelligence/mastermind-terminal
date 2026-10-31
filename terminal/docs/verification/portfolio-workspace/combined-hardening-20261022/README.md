# Portfolio combined hardening verification — 2026-10-22

## Candidate composition

This packet binds the combined release carried by PR #1114. It includes the accepted target-feedback candidate `f5ed1f931b58cfff537efa46c07e70e771ed580b`, the accepted artifact-origin guard `909004efe60522f40216bf7817914b60ffdc79f8`, and protected master `516d0519ca39d4be3ef186d65261598dfc5f6042`. Both merges were ordinary, conflict-free merges in the existing managed target workspace. The integrated parent is `d2ce27ace2a1a3ad1b648ae105973d01d00364be`.

All seven previously reviewed code/test blobs remain byte-identical. The only subsequent code edit is the readiness precondition in `terminal/e2e/portfolio-workspace.spec.ts`, blob `5c5c1e27e2132aa1779ab3c3f8a3ec3b20be5bf9`. The final containing commit is identified in the PR; validation binds file contents without a circular commit hash.

The original [target-feedback evidence](../target-feedback-20261022/README.md) and [origin-guard evidence](../artifact-origin-guard-20261022/README.md) retain their recorded scope and original execution identities. The source manifest here establishes the union.

## Keyboard diagnosis and repair

The earlier whole CI run [39725164420](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39725164420) finished successfully on the older candidate, with 17 successful jobs. Its browser totals were 2,748 passed, 808 skipped, three flaky, and zero final failures. The three retries involved Portfolio tabs, Transcript deadline copy, and Watchlist bulk selection. This was not a retry-free run, and it does not establish acceptance of this combined candidate.

In the retained Portfolio first-attempt trace, Overview remained focused and Holdings remained unselected after a single ArrowRight. The input preceded the first observed Portfolio client reads. This is consistent with an input-before-handler-readiness race; passive-effect request timing alone does not prove the exact moment hydration completed. The downloaded desktop-4 artifact ZIP had SHA-256 `f924d4f6218ed7101125a39ef1616501a47e9706cc3ca790e3b2cb83b06233d7`.

A controlled fixture diagnostic held client JavaScript while permitting server HTML. At desktop, tablet and mobile sizes, one ArrowRight before JavaScript release left Overview focused and Holdings unselected. After release and the existing committed client-read timestamp, one ArrowRight focused and selected Holdings. The original Overview DOM node remained connected and identical in all three cases, with no page errors. Window-bubble observation recorded `defaultPrevented=false` before readiness and `true`, with Holdings active, afterward. Earlier document listeners run before React's delegated document handler and must not be interpreted as final event state.

The retained diagnostic source and event evidence demonstrate this mechanism under controlled timing. They are not claimed to reproduce the exact hosted-CI schedule. The diagnostic source is retained as text rather than installed as a permanent regression asserting unhydrated noninteractivity.

The repair attaches the page-error listener before navigation, waits for the existing nonempty `time[datetime]` marker from a committed canonical holdings read, and confirms Overview focus before the original single ArrowRight. Holdings focus/selection, filters, and malformed optional-analysis assertions remain unchanged. It adds no arbitrary sleep, retry, repeated keypress, click fallback, production readiness flag, or tab-handler change. Optional risk, quote, history and brief success are not required by this marker.

## Combined local checks

| Check | Result |
| --- | --- |
| Ten target, ownership/readback, origin and artifact/risk route suites | 263 passed |
| ESLint: readiness spec, origin route, origin regression test | Exit 0 |
| Full TypeScript, incremental disabled | Exit 0 |
| Portfolio/Settings feedback EN/ZH plus keyboard scenario, desktop/tablet/mobile | 15 passed; one worker; zero retries, skips, failures or flaky cases |
| Controlled delayed-JavaScript diagnostic | 3 passed; one worker; zero retries |

Commands, timestamps, runtime and package-lock identity are retained in `local-checks.json`; raw logs are compressed without modification. `validation.json` records every reviewed source blob and the evidence-file hashes. All browser runs used synthetic fixture data on isolated loopback servers, and all unit artifact fetches were mocked.

Independent review of the combined head, complete hosted CI, protected merge, incumbent deployment, and live acceptance are separate gates. This packet does not establish historical-price access, positive Treasury-adjusted metrics, new signed-in production edits, full screen-reader acceptance, or measured production load capacity.
