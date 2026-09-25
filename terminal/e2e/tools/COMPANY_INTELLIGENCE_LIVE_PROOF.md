# Company Intelligence live proof

`prove-company-intelligence-live.mjs` is the release-bound browser prover for the
Company Intelligence redesign. It never creates or changes product data.

It proves two distinct boundaries:

1. **Anonymous** — the exact requested deployment serves the Analysis route, the
   authentication gate is visible, and Company Intelligence does not leak before
   sign-in.
2. **Signed in** — desktop and mobile render Brief, Results, Call + Q&A, Sources,
   the fixed Evidence overlay and CompanyVisual; the chart-to-Intelligence entry
   works; Institutional Ownership remains a separate deep link; and no document
   overflow or browser exception occurs.

Run against one exact served release:

```bash
PROOF_RELEASE=<full-40-hex-data-dpl-id> \
PROOF_SYMBOL=NVDA \
PROOF_STORAGE_STATE=terminal/e2e/.live-state/operator.json \
node terminal/e2e/tools/prove-company-intelligence-live.mjs
```

The storage state must be a regular untracked file inside the git-ignored
`terminal/e2e/.live-state/` directory. The prover writes a redacted mode-0600
receipt and screenshots beneath that directory. Missing or invalid operator state
returns exit 78 after the anonymous boundary passes; it is an exact authentication
gate, not a product failure.

Exit codes:

- `0` — anonymous and signed-in journeys passed at the exact release;
- `64` — invalid input or served-release mismatch;
- `70` — browser/product assertion failure;
- `78` — operator authentication state is unavailable or invalid.
