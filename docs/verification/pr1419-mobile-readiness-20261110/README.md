# PR 1419 — phone accordion readiness

## Result

Two observer paths in `terminal/e2e/sector-retained-depth.spec.ts` now wait for the existing phone accordion state before interacting. The keyboard case observes Buy-soon closed, opens it with focus + Enter, observes it open, and retains Show-more/Show-less and trace assertions. The emergence case observes Stand-aside closed, opens the real header, observes it open, and retains both blocks, number-free copy, one exact evidence destination, callback and absent-flag assertions.

No product component, fixture, timeout, project, retry policy, dependency, CI workflow or original assertion was relaxed. The other test bodies are unchanged. This is an observation repair, not a product behavior change.

## Source and diagnosis

- Base: `ceab6184a492911b1dd224430b1c6a0e66f9b0a2`, containing owner fixes `c33a3c944b06cfc2d2c75c16aee50a7846c34331` and protected master `533778d2928cfc64d79faa52ddd9bb7b760debb7`.
- Original spec blob: `ec7c915f04b942d12d3140233c70246ceb0c5fed`; repaired blob: `66a0c8bbf7492c57c5fa81386a867db1d4591b1e`.
- Unchanged component blob: `63418a4c60495d13fa17033b03127049713d9a82`.
- Ownership claim: [6770422987](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1419#issuecomment-6770422987).
- Original CI: [mobile-5 job129860631738](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42823404235/job/129860631738), synthetic `21443caa98ece9d6182a20eb5cbf78066a6bf315` over prior PR head `6778c61594b9736f73f132fa4a6f4bcb30c2a9d1`. It recorded 2 failed, 1 flaky, 278 passed and 70 skipped.

The old navigation failure path was deliberately replaced by the source owner under its same-site href rule and is not claimed to remain unchanged. The keyboard and emergence cases still used immediate visibility/count observations on the new head. The component initially renders desktop-open state, then its media-query effect collapses nonprimary phone columns. The old CI log and unchanged hooks support this race diagnosis; a local before-repair failure was not claimed or manufactured.

The old desktop-4/5 font-install timeouts remain separate infrastructure results. No old-head rerun, CI cancellation or installer/timeout edit was performed.

## Actual focused qualification

The unchanged committed Playwright configuration and global setup ran three cases across desktop1440, tablet820 and mobile390, with one worker and explicitly zero retries:

1. calls contract board: keyboard show-more and trace disclosure;
2. navigation out flows through the onNavigate callback with the exact href;
3. emergence mark: owner-carried flag renders the R6-09 chip, copy and evidence link.

All **9 passed**, with **0 skipped, 0 failed, 0 flaky and 0 retries**. Browser process duration: **54.946seconds**; Playwright report duration: **52.092593seconds**. Runtime: **Node22.23.4 / npm10.9.9**. Dependency install passed in31.671seconds; package and lock bytes were unchanged. ESLint and scoped `git diff --check` passed.

All **6,142 tracked Terminal text/source/evidence inputs** in the declared snapshot set stayed stable across execution after the recorded generated-type restoration. This is the exact snapshot population, not a claim of6,142 production modules. All five observed process groups disappeared, the owned port47279 was closed, and no signals were sent. The caller completed with exit0. See `QUALIFICATION.json`, `execution.json`, `lifecycle.json`, source snapshots and the original browser report/log.

The producer refreshed only the existing desktop `calls-trace-1440.png` and `calls-emergence-1440.png` outputs in these selected cases; both are byte-identical to the owner's current committed images. Root displayed both: visible text, keyboard focus and emergence copy/link are legible, with no observed overlap or horizontal clipping. They are viewport captures of synthetic harness data, not full-page, mobile visual, live-data, light-theme or production proof. The other nine pre-existing images were only hash-checked, not recaptured here.

## Preservation and limits

The owner's279unit passes, clean typecheck/lint and45browserpasses/9viewportskips remain attributed to its ceab return; they were not rerun or restamped by this repair. Production-source postimages and all existing proof images remain unchanged. Natural new-head CI and the protected queue must qualify the complete candidate. No auto admission, merge, deployment, authenticated browser acceptance or live Lane-3 mount is supplied by this local proof.

All executed commands and immutable results are retained. Do not replay these completed preparation/capture scripts. Continue from the actual branch and CI receipts, preserving other active writers and denied/uncertain effects.
