# Thesis journey live proof

This tool proves the anonymous boundary at an exact deployed release, then gives
an authorized operator an assertion-only proof of the signed-in thesis journey.
Phase A runs every time. Phase B runs only when the operator exports a Playwright
storage state to the required location. The executor does not run Phase B.

## Operator export | 操作员导出

Sign in as the operator in a separate browser, then export Playwright storage
state to the exact git-ignored path below:

```bash
npx playwright codegen --save-storage=e2e/.live-state/state.json https://app.mastermind-x.com
```

`terminal/.gitignore` already ignores `e2e/.live-state/`, so the credentials file
is never committed.

## Run | 运行

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2) \
  node e2e/tools/prove-thesis-journey-live.mjs
```

For the operator-only signed-in journey, use the exported path:

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2) \
  PROOF_STORAGE_STATE=$(pwd)/e2e/.live-state/state.json \
  node e2e/tools/prove-thesis-journey-live.mjs
```

`PROOF_BASE_URL` defaults to the production site. `PROOF_SYMBOL` defaults to
`NVDA`. There is no language switch.

## Receipts | 收据

`receipt-anonymous.json` always records the exact served release and five
anonymous cases. A successful anonymous proof requires all five cases to pass,
the release id to remain readable, and no browser error. Exit code `0` means that
anonymous proof succeeded; `1` means an assertion failed; `2` means the required
release id was missing or malformed.

`receipt-signed-in.json` exists only after Phase B runs. It records the route,
the URL-derived proof thesis id, the three versions, and the archived state.
Every Phase B write carries the thesis id that Phase B obtained from the URL and
asserts the detail belongs to that same id. Phase B creates one proof thesis,
revises that thesis, tests a stale revision, and archives that thesis. It does
not invalidate, list-select, or write settings, watchlists, portfolios, or
subscriptions.

Receipt redaction keeps 40-character release ids, ISO timestamps, and thesis UUID
ids readable. It redacts JWT-shaped values, email addresses, long credential-like
strings, and values whose key names cookies, tokens, authorization, sessions,
users, secrets, passwords, credentials, or keys. Receipt messages do not include
local paths or storage-state contents.
