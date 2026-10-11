# F08 alert mutation races — local evidence

The real Alerts form and existing-alerts panel are mounted by the checks. Inventory snapshots are frozen when each request starts. All alert writes and receipts are local test fixtures; these are not production account or delivery proofs.

- Baseline `fc76cf495781e5f53254aa3c457411de0cb64654`: six race cases fail and four ordinary-success controls pass, in English and Chinese.
- Fixed: 26 mutation-race checks and all 25 existing re-arm checks pass.
- Browser: 12 cases pass across English/Chinese and 1440×900,820×1180,390×844.
- Create: submit100, edit200, release the earlier success; the accepted100 row appears while the200 draft remains editable.
- Delete: an earlier frozen inventory arrives after successful deletion, followed by a failed fresh read; the deleted row stays absent and a sibling update is retained.
- Every browser case asserts no horizontal document overflow. The captured existing dark Terminal layout is unchanged; no styles or new theme treatment are introduced.

Run component checks from `terminal/`:

```sh
npx vitest run lib/__tests__/alertsMutationRaces.test.tsx lib/__tests__/alertsRearmReconcile.test.tsx --minWorkers=1 --maxWorkers=1
```

Run the browser spec with the existing local fixture server and the desktop,tablet,mobile projects:

```sh
TERMINAL_E2E_PORT=3187 npx playwright test e2e/alerts-mutation-races.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

This run used a task-local config derived from the checked-in configuration, omitting unrelated route warmup, using `/alerts` for server readiness, and preserving the existing fixture environment and viewport definitions. It was removed after use. `evidence.json` binds the tested source and twelve captures. Captures ending `newer-draft` show the saved100 and retained200; `deleted-row` shows the remaining TSLA row with truthful failed-refresh copy. Representative desktopEN and mobileZH captures were visually inspected.
