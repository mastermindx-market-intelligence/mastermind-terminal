# PR #496: comparison caller deadline repair

## Failure and repair

Natural CI run **42993152340** failed the later-loading comparison falsifier on all three attempts. All failed toolbar traces contained zero clicks: initial semantic and settled-state reads consumed about 5.0–5.2 seconds of an unarmed 8-second window, leaving less than the existing 3,001 ms admission floor for opening overflow and Saved Layouts.

Each comparison callback now creates one absolute test bound at entry and passes it through the seed/load helpers, the direct menu call, and fresh browser contexts. The 120-second test timeout, 12-second invocation cap, 3-second test-end reserve, stage admission rules, and comparison assertions remain unchanged. The locale setup utility is imported as `setLang` to avoid its existing false classification as a React hook inside the context loop.

## Verification

- **37 deadline unit cases passed**, including a controlled-clock case exercising the real desktop Saved Layouts helper after 5,200 ms of initial reads. A late invocation on a fresh page retains the original test bound and rejects before any click.
- Focused lint passed, with four retained unit-file warnings. Next type generation and full TypeScript checking passed.
- **9/9 comparison browser executions passed** across desktop, tablet, and mobile: one attempt each, zero skips, flakes, or retries. The optional crop cases were not requested.
- All 4,453 observed source files remained stable. Port 57727 closed. The Next lock pathname remained, with no open handles.

The controlled-clock case verifies the helper contract; the comparison browser cases verify the actual consumer wiring. This repair changes test code only.

## Evidence and retained gates

The archive retains the original failed lint result, corrected checks, complete browser report, source snapshots, execution and lifecycle record, and the source-linked hosted failure diagnosis. Every archive member was reopened and checked against its byte inventory.

Formal Changes Requested reviews **5108504922** and **5108886118** remain binding. Ready status is preserved; auto-merge stays off. This local proof does not establish hosted CI success, review approval, merge, or deployment.
