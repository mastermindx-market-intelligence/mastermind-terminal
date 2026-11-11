# PR645 — expiry-aware GEX successor with retained EOD identity

This additive successor preserves the original expiry-Greeks consumer acceptance while qualifying the complete source integration. It keeps EOD's actual prior capture and adds fresh GEX, general browser, and expiry-specific browser proof.

## Composition and capture identity

Original PR head: a985bf7f37b9a5a9fc490f8b3eb72be04869bfe4. The captures ran with dependency 9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c and protected overlay dad33e10089c9d51d931a1fe72e7fa1acb37abe1, as their immutable receipts report.

The later protected delta dad33e→d15741 (21 paths) and published dependency delta 9ef372→8e2451 (16 paths) were applied with exact pre/postimage verification. Their union has zero intersection with the GEX 29, EOD 32, general-browser 71 or expiry 76 source contracts. final-integration-deltas.json records this applicability; no capture receipt was rewritten to claim a later checkout.

## Qualified execution

| Proof | Actual result |
|---|---|
| Native GEX | 114/114 images, source stable, owned native server settled |
| General browser matrix | 144 passed, zero failed/skipped/flaky/retries |
| Original expiry matrix | Nine passed across desktop/tablet/mobile and EN/ZH plus enriched fixture; zero retries |
| Expiry artifacts | Exact 27 success screenshots and nine traces |
| Shared owner and focused source tests | 171 distinct cases across seven files |
| Reader Node gates | Five passed |
| Full TypeScript on final composition | Passed |

The GEX descriptor is 6432faf8713536aaa14319bb310289b26a68cfa5dd923801d2f4a7b7bf1fc453.
The 144-case qualification is fee8ee7eb79e7a1a680c51b2121e94f78708fba5b14551c3ea701a42556f8210.
The nine-case qualification is 436bbf7bdbee1bb9d7e5d8043878a286093a59f8a54690f71b2b7ae1eff39303.

Native capture observed 3517 source entries; the browser runs observed 3533. Each complete before/after map was stable within its own execution. Exact current-source contracts are checked separately by the reader and final applicability receipt.

## Retained identity and historical integrity

EOD remains options-integration-20261109, descriptor 77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18, captured at 90f275f15b4d174f003fb5b1087823dce6ec865a. It was neither relabeled nor recaptured.

All 4138 original native-history paths were checked. The 4136 non-root files are byte-identical. The two root manifests have additive current declarations; their complete original text and hashes remain in the new history descriptor. Prior Options, UI-copy and earlier native/browser packets continue to be validated.

The shared owner selects both families as qualified/current with no recapture required. current-owner-readback.json records each actual selected path, descriptor, capture identity, source map and plan.

## Repairs and retained unsuccessful attempts

The initial expiry run passed six cases but failed three mobile cases because the accepted phone axis chooser was closed. The two existing specs now click the chooser's visible native summary before the existing By Expiration action. No forced click, DOM state assignment, timeout increase, retry, skip or acceptance-value change was introduced. All original value, drawer, localization and viewport assertions remain. failed-expiry-r1/ and its inventory preserve the failed attempt.

The initial new owner tests used a nonexistent public GEX_CROPS export. They were corrected to call the existing native producer's expectedFiles(), exactly as the shared owner does. The original failed log and the complete 44-case passing rerun remain retained; the six other passing test files were reused.

The first full TypeScript attempt exposed malformed generated development route declarations. Their exact three files were moved to generated-dev-types-before-recovery/, outside the Terminal TypeScript project. Correct production typegen output and the original full compiler gate were retained. The unchanged full TypeScript gate then passed; it also passed again after the final source integration. No application source or type exclusion was changed for that recovery.

The reader rejects substituted capture identity, unsettled native servers, incomplete frames, prior-descriptor corruption, source drift, missing/duplicated/substituted browser cases, and partial/aliased/extra screenshot sets. Screenshot path confinement and content hashing remain in the actual reader before the exact 27-name check.

## Visual checks

The six inspected native GEX states and selected expiry success views support the measured assertions. The English mobile Vanna drawer preserves the 4/5 coverage disclosure and unavailable missing values. Chinese Charm bars retain positive, zero and negative values. All three inspected mobile traces show ordinary summary-open, axis-select, and selected-summary-close behavior without action errors.

## Delivery state

The successor is locally qualified. Publication must reconcile the actual protected #768 merge and advance only the original PR645 ref through exact-head GitHub CAS. Required hosted CI, protected queue acceptance, merge, deployment and production acceptance remain separate. Existing auto-merge is retained.
