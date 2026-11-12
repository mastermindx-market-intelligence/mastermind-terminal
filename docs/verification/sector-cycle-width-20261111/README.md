# Sector cycle chart measurement repair

## Problem and change

The current protected CycleChartPanel attached its width observer to the conditional chart-only wrapper. Switching to the table or an empty family removed that element; restoring the chart after a resize could leave SVG coordinates at the stale width. The old-source browser negative control reproduces a 340 px mismatch.

The component now keeps one measured content host mounted across chart, table, and empty states. The existing graph wrapper still owns clipping. Calculation, domain, tick generation, scientific validity, and displayed value formatting remain with their existing owners.

During visual review, the dev harness's Light radio was found to set a label without activating the incumbent light appearance selector. The harness now imports the existing Shared Shell stylesheet and sets/restores the existing appearance/theme attributes while mounted. It does not mount shell chrome or account-preference state. Regression tests verify actual computed surface/text colors and token values, including switching away and back.

## Verification and raw chronology

- Old-source negative control: the single selected desktop case fails with the expected 340 px width mismatch; raw output and trace are retained in old-source/.
- The first selection preflight stopped before browser execution because its wrapper expected plural output for one selected test. The original receipt and exact wrapper repair are retained.
- Fixed geometry: twelve cases passed, covering table and empty-state round trips in EN/dark and ZH/light-labelled modes at desktop, tablet, and mobile sizes. This initial run is retained in fixed-source/ but is not accepted as light-theme proof.
- First actual-theme matrix: all twelve cases stopped on the same test assertion spelling difference, #fff versus #ffffff, while actual computed white surfaces already matched. theme-qualified/ retains the raw failure. The redundant token spelling comparison was replaced with the incumbent secondary-panel token; strict actual RGB assertions remain.
- Final theme-paint-qualified/: twelve passed, zero failed, skipped, flaky, or retried; one worker, retries zero, actual Playwright project selection. Numeric SVG width, viewBox width, rendered width, live container width, stable panel/host identity, table/date/value equivalence, resizing while the chart is absent, and no horizontal overflow are asserted. Each case switches themes both ways.
- Final run: 2026-11-11T14:04:55.917700+00:00 through 2026-11-11T14:06:03.439847+00:00, 67.519 s wrapper duration. See the immutable execution receipt for its exact timestamps.
- Source snapshots before and after the browser run contain 24,630 unchanged regular input files. The real checkout is b6db0ca0ebfba1463746dc1eb6bdd6b50f4e19e7, with the repaired working tree; no later publication commit is claimed as the capture checkout.
- Focused ESLint and full Terminal TypeScript checks passed. Final assertion-only edit also passed focused lint. git diff --check passed.
- Root visual review checked EN dark and ZH light at all three viewport sizes. The six inspected panel PNG paths and exact byte hashes are in visual-review.json; all twelve final PNGs and traces are retained.
- The owned port 57735, lock handles, and workspace process holders were empty when the final browser run settled. Any subsequent removal of the owned stale lock pathname is separately recorded in cleanup.json.

## Scope and ownership

This is a new current-protected-source repair for the residual observer problem recorded on PR #1249 at https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1249#issuecomment-6775303344. The independent managed branch is sol/web-terminal-cycle-width-support-20261111-c3, operation terminal-cycle-width-support-20261111-c3.

Original #1249 remains Draft, with its historical publication refusal and broader scientific, precision, basket, and release acceptance unchanged. This evidence proves the fixture-backed component regression and harness paint contract. It does not claim authenticated production acceptance or full sector-science acceptance.

Canonical estate duty: https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028
Mastermind law pin: bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178.
