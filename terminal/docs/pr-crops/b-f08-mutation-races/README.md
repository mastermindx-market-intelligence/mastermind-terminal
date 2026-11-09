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

## Recapture on E20 landing train 2

Train 2 merged E17 into `AlertsView.tsx`, a locked source, so all twelve captures were regenerated on the merged tree (capture head `1bfb1c7f4`, Terminal master `2957bd64e` merged in). No PNG or hash was copied from either parent. The spec passed 12 of 12 across desktop, tablet and mobile with retries off. All twelve captures, EN and ZH, were viewed. E17's dry-run panel only renders for the suite category, so these signal-category states look the same as before. `evidence.json` now carries the new source and capture hashes plus a `recapture` block.

## Recapture on E20 landing train 3

Train 3 merged E18, which adds a "Manage several alerts" card (批量管理提醒) to the alerts page. The page that mounts the card is not one of this packet's locked sources, and those three sources are unchanged. These are full-page captures, though, so they now show the card. All twelve captures were regenerated on the train 3 tree (capture head `8753bbf7f`, Terminal master `85ad93866` merged in) during the train's cold e2e run, with one project per run and retries off. The spec passed 12 of 12 across desktop, tablet and mobile. No PNG or hash was copied from either parent. Desktop EN/ZH, tablet ZH and mobile EN/ZH captures were viewed. The race states are the same as before: the accepted 100 row with the 200 draft still editable, and the deleted row absent with the truthful failed-refresh copy. `evidence.json` carries the new capture hashes and a `recapture` block that keeps the train 2 block as `priorRecapture`.
