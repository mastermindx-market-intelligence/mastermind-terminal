# Document language synchronization — issue #1153

The existing `mm.lang` preference, `data-lang` attribute and `mm:lang` event remain the only language owners. The patch synchronizes root HTML `lang` (`zh-CN` / `en`) during prepaint, imperative account-preference updates and provider initialization. It does not add another store or global event.

## Regression and real browser proof

The real provider/source-bootstrap unit falsifier was **4 Chinese failures / 1 English pass** before the repair, then **5/5 pass** afterward. Including shared-shell presentation checks, **22/22 targeted tests pass**. The native page suite changes only the existing saved preference and checks the actual root attribute before/after hydration and after language reload, including browser-locale fallback: **9/9 desktop/tablet/mobile cases pass**. Six screenshots and `browser-report.json` are included; no test forces the expected DOM language.

The original compound shell test-write was falsely rejected because Desktop Commander's parser interpreted a JavaScript test helper named `mount()` inside a heredoc as the blocked OS `mount` command. Reading and nonexecutingly evaluating the installed parser established that cause. The original managed workspace was retained; typed file tools performed the source edit with existing permissions. No security setting, OS mount or alternate machine was used.

## Evidence requalification

The initial complete unit run had **16,830 passes and 12 evidence-lock failures** after the intentional locale source changes. Those guards were retained. Ten existing native capture producers and the complete 30-case Visual Intelligence suite were rerun against source commit `e2846880681d4b9aff4a060e1321f50f240cafc7`. They generated **140 actual current native evidence images**; six additional images belong to the document-language suite. The original 11 manifests were retained verbatim under each folder's `history/before-document-language-20261024.yml` and remain linked to base `919114d1...`. Current source/crop hashes were qualified from actual renders, never blind-rehashed.

Six older OptionsScreener images in the Batch-1 folder were not part of this recapture: they remain explicitly historical in `recapture-index.json`, not presented as new proof. Batch-1's broader existing 48 layout-source and 12 capture-harness locks were preserved, rather than dropped by the older native producer. Other historical evidence folders outside this recapture scope were left untouched.

The full suite after recapture passes **985 test files / 16,842 tests**, with 2 skipped and 4 todo cases explicitly retained, **zero failures**. `recapture-index.json` binds current source, current manifests, all qualified image hashes, prior manifests, and both actual browser reports.

All browser runs use the repository's existing local fixtures. This proves locale behavior and rendering, not authenticated live data, production deployment or signed-in account flows. Hosted CI/CodeQL, protected merge, actual deployed source and live document-language acceptance remain separate gates.
