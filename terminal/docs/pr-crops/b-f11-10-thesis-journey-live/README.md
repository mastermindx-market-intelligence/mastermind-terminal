# Thesis journey live proof

This tool proves the anonymous boundary at one exact deployed release, then lets
an authorized operator prove one signed-in thesis journey. Phase A always runs.
Phase B runs only when the operator supplies a Playwright storage state. The
executor does not run Phase B.

## Operator export | 操作员导出

Sign in as the operator in a separate browser, then export Playwright storage
state to the exact git-ignored location below:

```bash
cd terminal
npx playwright codegen --save-storage=e2e/.live-state/state.json https://app.mastermind-x.com
```

`terminal/.gitignore` already ignores `e2e/.live-state/`. The tool refuses a
state file outside that directory and refuses a state file tracked by git.

## Run | 运行

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2) \
  node e2e/tools/prove-thesis-journey-live.mjs
```

For the operator-only signed-in journey, use the exported state:

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2) \
  PROOF_STORAGE_STATE=$(pwd)/e2e/.live-state/state.json \
  node e2e/tools/prove-thesis-journey-live.mjs
```

`PROOF_BASE_URL` defaults to the production site. `PROOF_SYMBOL` defaults to
`NVDA`. Run with the operator account in its chosen language; the tool requires
English controls for its live assertions.

## What each receipt proves | 每份收据证明什么

`receipt-anonymous.json` proves that the exact release served five anonymous
checks: three pages stay gated and two anonymous APIs return the required
rejection. A successful anonymous proof requires all five cases to pass, the
release id to match, and no browser error. Exit code `0` means that anonymous
proof succeeded; `1` means an assertion failed; `2` means the required release
id was missing or malformed.

`receipt-signed-in.json` exists only after Phase B passes. It proves that the
operator created one proof thesis, revised that same thesis, confirmed a stale
write returned a version conflict, checked the Theses and Coverage lenses, and
archived that same thesis through version three. The proof thesis id comes only
from the page URL; every detail check must return that id. Phase B performs no
invalidate, reopen, subscription, settings, watchlist, portfolio, or other row
write. Every receipt is redacted and never records a storage-state value.

## Evidence | 证据

The anonymous screenshots in this directory come from the real Phase A run that
produced `receipt-anonymous.json`. They do not contain signed-in proof; the
operator-only signed-in receipt is produced locally and is never committed by
the executor.
