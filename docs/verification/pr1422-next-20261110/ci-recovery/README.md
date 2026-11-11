# PR #1422 — natural-CI recovery

## Exact scope and source

This packet follows natural CI [42814215829](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42814215829) on published head `1aec81f3c6d378cb9edc2b9ecb8bda5ff12a90df`. The [scoped recovery receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1422#issuecomment-6768298762) records the original source, control removal and owned-workspace reconciliation.

Production code, dependencies, runner routing and the earlier accepted integration remain unchanged. This recovery changes two browser tests and refreshes the B-F08-8 evidence manifest through its actual producer. Original packets, prior proof and failed-attempt records are retained with their original source attribution.

## B-F08-8: actual recapture after the admission repair

The old packet at `0f077993fc1a1244531f825d3d829491f47d338c` locked the former EventImpactPanel hash `aeb0dd9fa708ab9fa9cec3e4eca3e5f1b5443123eaef6a591653867567c5eba9`. The accepted StrictMode request-admission repair changed that one input to `698d0de0e6b95f2644bee0912215065c566786b4a7bb51f088753e31b1c99e64`; the other eight locked inputs are unchanged. Unit job 129826075287 correctly rejected the stale lock.

The original `capture_b_f08_8_invalidation.cjs` producer ran on exact head 1aec81f, using Node v22.23.4 and port 34231. It completed **eight real captures**: desktop/mobile × EN/ZH × condition/typed-null, in 31.511 seconds. Its existing promotion required successful capture, incumbent runtime cleanup and stable source identity. All 2,016 mapped inputs remained unchanged; the port closed and the Next lock was absent.

All eight new image hashes are identical to the former pixels. They were nevertheless freshly rendered by the actual producer and viewed individually. The panel, holding, condition or explicit typed-null text, and source/no-advice footer are present without clipping, overlap or blur. This is bounded panel proof; it is not a live-data, full-page or accessibility certification. The prior nine-file packet is preserved under `prior-b-f08-8/`, alongside its exact inventory. Earlier in-tree history is unchanged.

The unchanged **four B-F08-8 evidence-reader tests passed**. No hash was restamped without a successful recapture.

## Missing study chunk: wait through the actual recovery sequence

Mobile job 129826076443 failed at an exact-one rejected-transport assertion before reaching its safety checks. The emitted runtime retries a failed chunk; the existing error boundary then permits one document reload, guarded by the existing 30-second `mm.chunkreload` cooldown. The retained CI trace has two factory aborts, the recovery reload and two more aborts, with no intraday request.

The repair uses a positive rejected-transport observation as fault-injection evidence, waits for the actual navigation timing type `reload`, then waits for the native **Something went wrong** error heading. It keeps the original requirements of zero enabled study actions and zero intraday research requests. No exact rejected-transport count, retry budget or sleep is hard-coded. The held-factory case, including its exact-one held transport and exactly-two research-input assertions, remains byte-identical.

The repaired missing-chunk case passed on **desktop, tablet and mobile: three passed, zero skipped, zero retries, zero failures and zero flaky cases**. The actual report and log retain the chunk failures and error-boundary handling. The run took 49.661 seconds including its setup; all 2,016 mapped inputs were stable. The existing passive observer reconciled the owned stale lock only after verifying process/listener/file-descriptor absence, and port 34233 was closed.

The first local selector used a start anchor that did not match Playwright's full project/file/test title. It executed zero cases and exited 1 with `No tests found`. Its output remains in this packet. The subsequent selector removed only that anchor; no source or assertion changed between attempts, and the already-passing reader/lint checks were reused. The original port 34232 was reconciled before the next attempt.

## Failed watchlist save: inject a closed-page edit before startup

The final two substantive failures in the original CI run were the same case on tablet-4 (job 129826075971) and mobile-5 (job 129826076523): `AC-E05-04 — a failed save never shows Synced and never overwrites the local edit`. The tested synthetic checkout was `cfa3bcf1bc32f960cdc40a6e2f4af4ac15f51dce`; its additional protected changes do not alter the watchlist, shell, fixture or annotation source used here.

An independent local run of the unchanged case reproduced the failure on mobile. Its actual trace records the fault cookie on the reloaded annotation GETs, but no browser POST of the new V2 note; the only POST was the setup client's acknowledged V1 seed. The test had edited localStorage beneath the still-live shell despite describing a closed-page edit.

The touch fixture now uses the existing once-per-context `seedSlots` helper to install V2 before the next application document starts. The existing account ledger and all original assertions remain. A new response assertion additionally requires an actual annotation POST carrying NVDA's V2 note to receive HTTP 500. This prevents the scenario from passing without exercising the failed save.

The full existing case then passed once on **desktop, tablet and mobile: three passed, no skips, retries, failures or flaky cases**, in 123.092 seconds including setup. It proved V2 survives the failed save and reload, the chip never claims Synced during failure, the server still holds V1/revision 1, and explicit retry after fault removal saves V2 as revision 2. All 2,016 mapped inputs were stable. ESLint passed; the existing passive observer verified closure and reconciled the owned stale lock. Ports 34234 and 34235 are closed.

The original local failure remains in `watchlist-repro/`; the successful report, logs, source maps and lifecycle receipt are in `watchlist-fixed/`. `trace-observations.json` contains the bounded annotation-only projection from the original local trace. Raw diagnostic traces remain in the named owned qualification directories and are indexed separately; they are not substitutes for the successful case report.

The attempted inspection of pre-existing GitHub artifact 13767787287 received an explicit command-admission refusal (no PID or trace data). That action was not retried or rerouted. No conclusion above relies on that unread artifact; the separate local reproduction and its own trace provide the diagnostic evidence.

## Checks and release

| Check | Result |
| --- | --- |
| Incumbent B-F08-8 capture | 8 successful captures, all viewed |
| Existing evidence-reader suite | 4 passed |
| Missing-chunk browser case | 3 projects passed, no retries/skips/failures |
| Failed watchlist save/reload case | 3 projects passed, with actual V2 POST/500 proof |
| ESLint on both affected browser tests | Passed |
| Source and prior-packet preservation | Exact hashes checked |
| Owned runtimes | Settled; ports 34231 through 34235 closed |

`bf08-execution.json`, `bf08-visual-review.json`, `focused-checks.json`, `rs-r2-execution.json` and the original report/logs carry the actual evidence. This local qualification does not claim a full hosted-CI pass or production acceptance. The original branch will be updated through one exact-head CAS; native auto-merge may be re-enabled only after publication and control readback. GitHub's required checks and merge queue remain authoritative.
