# PR #496 — adaptive toolbar integration proof

## Source and behavior

This packet qualifies the original PR branch `sol/terminal-r1t-toolbar-settled-20260831` from `f664ba3d604934572ea50a98a8560abfac0631f8`, integrated with protected master `74c007125129090cc762f2bc4b1b152123326444`. The exact tested source tree is **`0354429170eb12b539424d03d9f2992015385a5e`**. The six source blob identities are in [receipt.json](receipt.json).

The accepted production hook and its hook tests are retained. Current layout and W2A assertions, phone entry routes, EN/ZH cases, owner/member/foreign authentication cases, and existing test timeout overrides are preserved. Helper callers now supply their test-owned deadline. Phone Workspaces/Replay entry is handled before waiting for a hidden desktop toolbar. A phone intent opens the hub and selects its destination once, observes the semantic result, and preserves the same absolute deadline and PAGE/BUDGET/ACTION classification throughout. Five focused regressions cover this route, already-open destinations, post-action failures, and budget behavior.

## Validation

- **43 unit tests passed:** 36 deadline/helper tests and 7 hook tests.
- Scoped lint, Next type generation and the full Terminal typecheck passed.
- The owned diff against integrated protected master passes whitespace checking. The initial diff check used the stale original PR HEAD and reported inherited historical whitespace; that result is retained and is not represented as an owned-source failure.
- **56 unique selected browser cases are proven across two runs.** The original run passed 37, then lost access to the shared Chromium executable and recorded 19 interrupted/prelaunch failures. An operation-owned Playwright 1.61.1 Chromium cache was installed. Only those exact 19 case instances were resumed, and all passed with one worker and retries disabled. Original raw results remain in this packet; this is not a claim that the first attempt was all green.
- Both runs preserved all **6,469 source hashes**. The server listener closed. The remaining Next lock pathname had no open handles; no other owner's processes or browser cache were removed.

The original and resumed reports are stored as lossless gzip files. [case-outcomes.json](case-outcomes.json) provides readable identities and attempt statuses; [receipt.json](receipt.json) records the matching identity sets, raw byte hashes, commands, timing and source custody. Decompress `*.gz` to inspect the original report/log/snapshot bytes.

## Visual evidence

Five actual browser captures were transferred without byte changes and visually inspected:

- [1440px English workspace menu](captures/1440-en-ready.png)
- [820px English workspace row actions](captures/820-en-row-open.png)
- [390px English Analysis hub](captures/390-en-hub-entry.png)
- [390px English saved workspace](captures/390-en-ready.png)
- [390px Chinese workspace row actions](captures/390-zh-row-open.png)

Menus, saved-state text and row actions fit the observed viewports. These fixture-backed local captures qualify the repaired route; production deployment and live acceptance remain separate.

## Release boundary

The PR remains Ready with `merge-blocked` and auto-merge off. Native changes-requested reviews **5108504922** and **5108886118** remain intact. No review was dismissed, approval manufactured, or branch protection bypassed. New publication-head CI and any required actual review remain owed. Protected master subsequently advanced to `18fabe9d3c1439c4185559ba5ce491518fe999c9` in two disjoint screener paths; hosted checks qualify its actual merge projection.

The operation is `terminal-pr-estate-support-20261111-c3-496`, under [Mastermind #2028](https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028), law pin `bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178`.
