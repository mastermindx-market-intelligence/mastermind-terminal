# E17 alert dry run: browser evidence

These screenshots show the read-only **Dry run** panel under the Alerts "New alert" form (PR #918)
in English and Chinese, at each viewport the repo requires.

Nothing here is a verification lock. There is no `EVIDENCE.yml` and no manifest, because the
proof lives in tests, not in pixels:

- `lib/__tests__/alertDryRunParity.test.ts` checks parity against the sidecar lane.
- `e2e/alerts-dry-run.spec.ts` covers behaviour and records zero writes.

The Terminal ships dark-only, so there is no light-theme capture.

## Captures

The viewports are `desktop` (1440×900), `tablet` (820×1180) and `mobile` (390×844). Each viewport
has six shots:

| Shot | Source | What it shows |
| --- | --- | --- |
| `<viewport>-e17-would-trigger-{en,zh}.png` | fixtured response | **Would trigger now** for a suite event. The panel shows the condition, instrument, timeframe and both clocks: the data-through/source clock and the evaluation clock. It also shows the fresh window and the UTC creation-floor day. The trace includes "Only events confirmed in the last 3 bars can fire"; the 3 comes from `SUITE_EVENT_FRESH_BARS`. |
| `<viewport>-e17-sequence-simulated-{en,zh}.png` | fixtured response | A sequence condition that would not trigger now. It starts from a new alert's exact initial state. A step-A arming on the creation day is labelled **SIMULATED** and is never recorded. Prior history before the UTC creation day is marked "not simulated". |
| `<viewport>-e17-real-handler-{en,zh}.png` | real handler | The unmocked `/api/alerts/dry-run` reads this worktree's daily bars, which are stale. The answer is **Cannot evaluate** together with the availability clock, never "would not trigger". |

## Capture command

Run from `terminal/` in a cold run (`CI=1`) with one worker:

```sh
CI=1 E17_SHOT_DIR="$PWD/docs/pr-crops/e17-alert-dry-run" TERMINAL_E2E_PORT=47270 \
  npx playwright test e2e/alerts-dry-run.spec.ts --workers=1 \
  --project=desktop --project=tablet --project=mobile
```

The spec's `shot()` helper scrolls the panel into view and parks the mouse. It disables animations
before saving `<project>-<name>.png` into `E17_SHOT_DIR`.
