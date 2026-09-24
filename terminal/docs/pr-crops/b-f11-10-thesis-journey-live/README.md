# B-F11-10 Thesis Journey — Live Proof

## What this proves

The signed-out gate, create, reopen, revise, conflict detection, lens, and archive
journey was executed against the deployed Terminal at a named release SHA. The
receipt-anonymous.json captures the anonymous Phase A evidence; Phase B (signed-in
journey) runs only when the operator provides a Playwright storage-state file and
that file is not git-tracked.

## How to run

### Prerequisites

The operator signs into their own browser at https://app.mastermind-x.com, then
exports a Playwright storage-state file:

```bash
npx playwright codegen --save-storage=e2e/.live-state/state.json https://app.mastermind-x.com
```

The file `e2e/.live-state/` is git-ignored (see `terminal/.gitignore`).

### Phase A only (no sign-in required)

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2)
node e2e/tools/prove-thesis-journey-live.mjs
```

### Phase A + Phase B (operator's own signed-in session)

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2)
PROOF_STORAGE_STATE=$(pwd)/e2e/.live-state/state.json \
  node e2e/tools/prove-thesis-journey-live.mjs
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PROOF_BASE_URL` | `https://app.mastermind-x.com` | Deployed Terminal base |
| `PROOF_RELEASE` | **(required)** | 40-hex SHA served in `data-dpl-id` |
| `PROOF_STORAGE_STATE` | _(none)_ | Path to Playwright storage-state JSON |
| `PROOF_SYMBOL` | `NVDA` | Symbol for the thesis journey |
| `PROOF_LANG` | `en` | `en` or `zh` (runs mobile 390px viewport at zh) |

## What the receipt proves

### Phase A (always runs, anonymous context)

| Case | Expected | What is recorded |
|---|---|---|
| `GET /analysis?symbol=<SYM>` | 200, thesis-workspace absent, heading present | status + heading copy |
| `GET /analysis?view=theses` | 200, thesis-workspace absent, heading present | status + heading copy |
| `GET /api/theses` (anonymous) | 401 `{"error":"unauthenticated"}` | status |
| `POST /api/theses` (anonymous create) | 401 | status |
| `GET /api/thesis-saved-views` (anonymous) | 401 | status |

### Phase B (only when PROOF_STORAGE_STATE is set and not git-tracked)

- Navigation to `/terminal?symbol=NVDA` → rail → Theses control (or URL fallback)
- Create with title `[proof <release-8-hex>] NVDA journey <ISO timestamp>`
- Reopen via reload: title shown, version 1 confirmed
- Revise with revision note: API confirms `currentVersion` = 2, `previousVersion` = 1
- Conflict: `POST /api/theses` with `expectedVersion: 1` → 409 `version_conflict`
- Lens: thesis row listed in Theses lens; Coverage lens opens without error
- Alerts: `/alerts` → 200 + release stamp; thesis notice row recorded (informational)
- Archive: lifecycleState confirmed as `archived`

## Git ignore

`e2e/.live-state/` is git-ignored. Add this line to `terminal/.gitignore` under `# testing`:

```
# testing
e2e/.live-state/
```

## Receipt redaction

`lib/thesisJourneyReceipt.ts` exports `redactReceipt()` which strips any key or string
that looks like a cookie, token, authorization header, email, JWT, or auth user id.
The storage-state file path and contents are **never written anywhere**. A byte-identical
copy of `redactReceipt` is inlined in the `.mjs` tool for standalone execution.
