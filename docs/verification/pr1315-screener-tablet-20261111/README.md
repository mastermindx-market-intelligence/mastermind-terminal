# Screener tablet consumer — #1454 / #1315

The missing tablet behavior proof is now qualified: **21/21 existing cases passed**, with no retries, skips, failures or flakes, on the actual local fixture-backed page at 820×1180 with touch enabled.

## Immutable inputs

- Actual executed source: `297d2f7ed2abc3310b5eda40059743059b5f100e`, tree `29a1161fc738e240267d0ccc8fa316ddd7678ffa`.
- Cross-market spec blob: `63bee8256a49cb0468d81c12074510b906c93cb7`.
- Cross-market CSS blob: `86555e1b58b1af6679b4f1e9229f2d1e6214aac4`.
- Existing Playwright config blob: `a6a0f8d5938b92af3744a4ee9a8945bbb9ecfcd6`.
- Protected #1457 selector blob present in the tested tree: `2c0ccac181e6bf96952bef3327a8543c210a5f07`.

The CSS and cross-market spec are the exact landed #1454 bytes. The normal tablet project was used, with its global setup and local fixture environment. The four explicit spec files are the same set selected by #1457's Screener shared-layout matrix. No application, test assertion or global configuration was changed for this run.

## Actual execution

The real Playwright discovery listed 21 tablet cases before execution. The browser run executed all 21: eight cross-market, seven fundamental, three failure-state and three technical-scan cases. The existing cross-market tests measured the affected stale-label, unclassified, dismissal and Retry controls against the 44 CSS-pixel floor and exercised their interactions.

Command duration was 243.81s; Playwright report duration was 237459.892ms. Report SHA-256 is `12736a279627eca00184f27cf41c6b6f5504f58dfcf82bd531b0a8bf0840eb6c`. The execution receipt records exact timestamps, per-test results, command and runtime.

All 2,123 source inputs and discovered membership were stable before and after. The complete source map is stored once in `source-before.json`; both subsequent maps are byte-identical and their digests are in the execution receipt. The owned loopback61888 server stopped, the exact stale owned Next lock was reconciled after process/descriptor/workspace absence checks, the compiler-generated file's absent preimage was restored, and the checkout remained clean at its original head.

## Acceptance limits and custody

This closes the local tablet behavior gap left by #1454's original desktop/mobile-only focused run. It is not a hosted execution of the selector's Git/source admission, a latency percentile measurement, a physical-tablet claim, screenshot review, or authenticated production Screener acceptance. The normal free-account-session gate for the live route remains. #1315 stays open for its broader acceptance.

#1454 is already merged at `18fabe9d3c1439c4185559ba5ce491518fe999c9`. Its former source branch returned GitHub404 during proof publication preparation. The branch is not recreated and the merged PR is not reopened. This packet is archived on a new evidence-only Git ref through the same GitHub connector, based on the exact tested source. It changes no application bytes, moves no active source branch and requests no merge/deployment. The existing #718 CI and other live writers remain untouched.

Original #1324/#1251 workspace, publisher and refusal boundaries remain separate.
