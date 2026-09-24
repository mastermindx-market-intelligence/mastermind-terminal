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

The tool accepts only a regular JSON storage-state file inside
`terminal/e2e/.live-state`, requires the directory to be git-ignored, and refuses
a file tracked by git. The tool checks these rules before Phase B starts.

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
`NVDA`. Run with the operator account set to English; the controls are located
by role, label, state, or test id, while visible copy is recorded only when a
screenshot captures it.

Phase B enters directly through
`https://app.mastermind-x.com/analysis?view=theses&symbol=NVDA`. It preflights
every control before its first write. If that preflight fails, Phase B performs
no write. After creation, the thesis id comes only from the page URL, every
detail check must return that id, and each waiting assertion must settle before
the next action. On any failure after creation, the tool makes a best-effort
archive of that one URL-derived thesis and still exits non-zero.

## What each receipt proves | 每份收据证明什么

`receipt-anonymous.json` proves that the exact release served five anonymous
checks: two Analysis routes did not expose the thesis workspace, and three
anonymous thesis APIs returned the required rejection. A valid receipt requires
all five cases, the release id, and exactly zero browser errors. Exit code `0`
means that anonymous proof succeeded; `1` means an assertion failed; `2` means
the required release id was missing or malformed.

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
