# Portfolio readback-order assertion correction — 2026-10-21

## Why this follow-up is required

Hosted workflow [39609441504](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39609441504), unit job [119254447073](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39609441504/job/119254447073), failed on candidate `d0da2f34750877a66845287ad47cbb39e7ca4eb4`. GitHub checked out merge `4110a2d1e36ae121c1a59566dff3b8a480981954`, combining that candidate with protected base `8189edb8abd41e1c95d6460ad735549af5538d48`, and ran Node v20.20.2 / npm 10.8.2.

Type generation and typecheck succeeded. The full unit run recorded 877 passing files, one failing file; 14,888 passing tests, one failed test and four todo cases. Later guard steps in that job were skipped after the failure. This is not an accepted full CI run.

The failing `portfolioPageReadbackOrder.test.tsx` case used a whole-targets-section Clear-button count as a proxy for whether the stale mount read resurrected an editable target card. Retained targets intentionally gained a Clear control in the orphan-row change, so the correct closed/orphan state now contains that control. The existing Close-absent, Reopen-present and retained-orphan assertions passed.

## Narrow correction

Only that test file changes outside this evidence folder. The deferred reads, request bodies, ordering, Close/Reopen assertions and two other cases remain intact. The replacement directly checks the retained AAPL orphan and its scoped Clear control, and requires the editable AAPL target article to be absent. The shared Clear-button helper is unchanged.

No production source, Settings owner checks, Treasury transport, browser harness, package, SQL or original application receipt changes. The parent source review [PASS 6317496362](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1099#issuecomment-6317496362) remains evidence for those unchanged bytes; the new publication still requires its own independent binding review and hosted CI.

## Fresh validation

- Focused RED at unchanged `d0da2f34`: one failure at the same obsolete count, two passing controls.
- Corrected focused suite: 3/3 passed, no filtered or skipped cases.
- Full `tsc --noEmit --incremental false`: exit 0.
- Whitespace check: exit 0.
- Actual local runtime: Node v26.5.0. The expected Vite CJS deprecation warning is retained in the logs.

`validation.json` binds the tested file, parent blob, commands, timestamps and actual log bytes. Gzip files contain the actual unedited local outputs. The hosted failure excerpt is retained with the exact job link; it is an excerpt, not the full hosted log.

The earlier 153-test evidence remains bound to unchanged production source at `d0da2f34`. The earlier 12 browser cases/crops remain bound to `c5fd88bf`; neither suite was rerun for this test-only correction. No new runtime or browser pass is inferred from the three-case result. No real-account mutation, producer installation or positive historical-source availability is established.
