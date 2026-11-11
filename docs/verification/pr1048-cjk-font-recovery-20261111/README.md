# PR1048: pinned CJK environment and actual glyph proof

## Why this change is required

The natural run **43058589661**, source `4eee35f4945cb82365e63e72b8d8fa0cb73c8022`, completed its ticker command with **14 passes, 7 authored project skips and zero retries**. Its serial job `130657667008` succeeded and returned artifact `13873869731`. The old observer correctly established source identity, fresh images, report completeness, preservation and closed-port cleanup. It did not establish that Chinese glyphs were actually drawn.

Principal inspection of all five changed ZH PNGs found missing-glyph boxes. This packet is **REJECTED** and has not replaced the selected ticker packet. Five EN PNGs match the previous accepted original-8a packet byte for byte; that does not rescue the bilingual capture. The complete ten-image rejected crop set, raw receipts/report, original job log, artifact digest and canonical bindings are retained in `rejected-43058589661/`. Raw `qualified: true` means the former observer's mechanical qualification; its original `visualAcceptance: false` is preserved. The separate visual disposition records rejection without rewriting history.

The capture's actual checkout was `5530a2cb6e79db7e1b8426ea38dfee64f9b6e134`, complete tree `40b540b7eb71e10311e5dde86c80eac9dbd6a8b5`, ordered canonical parents `b418e924c734ad5f457aab1b783cacb75dd5a109` and `4eee35f4945cb82365e63e72b8d8fa0cb73c8022`. The shallow runner reported an empty parent list; the original bytes remain intact and canonical reconciliation is separate. All 16 source inputs, 11 prior packet files and 118 neighboring packet files matched actual Git bindings. The 170-member ZIP was size/digest/CRC/path verified before extraction. The complete raw report is stored losslessly as `report.json.gz` (decompress to `report.json` in a temporary reproduction directory). The historical qualifier requires the original 4eee source checkout; it intentionally does not qualify the new 19-input observer.

Final job readback of that run was **27 successful jobs and 2 failures**: the unit job's sole failing case was the selected ticker manifest's stale TerminalShell lock, and the Terminal aggregate failed as a consequence. Unit results were 23,383 passed, 50 skipped, 3 todo and 1 failed. The original browser matrix and production build succeeded. Those results are historical, not current-source acceptance.

## Composition and bounded repair

Protected master advanced by three commits after `b418e924`: #1461 multi-host runner routing, #627 Pulse/hydration repairs, and #1346 alert inventory validation/current E18 capture. The clean three-way union of original head `4eee35f` and protected `ed6529da70f124c2790c5ddf3b6d4482d739cb46` is tree `b5955ae0c3ff8d7e9ccbffa1f4cc92272cc4b7f4`. There are no conflicted paths. No source-law file changed in that protected advance. This change applies only nine font/capture/test/workflow files over that union; all product source and selected evidence remain exact to it.

The accepted #1469 bounded Playwright/APT fallback is retained. The earlier mirror trial was disproved by hosted DNS failures and is not restored. A mandatory, separate three-minute step obtains and validates one immutable Noto Sans CJK SC Regular face before browser consumers. It runs in unit capture (before newly protected E18), ordinary responsive/serial capture, production browser tests and the existing canary job. It changes no routing, ports, workers, dependency gates, producer opt-ins or canary activation. Newly protected selfhosted routing and E18 capture/artifact behavior remain intact.

`terminal_cjk_font.py` uses a fresh directory beneath `RUNNER_TEMP`, exact file size/SHA-256/upstream Git blob checks, the exact upstream OFL license, and an isolated Fontconfig configuration selecting that exact private face. It checks family, PostScript identity and the required CJK characters, including the actual status punctuation. The existing Latin configuration is included. A private writable cache is preferred, not claimed as an absolute Fontconfig write sandbox. The receipt binds the top-level included base configuration file, not every transitive include.

There is one bounded HTTPS download; failures do not export a successful environment or fall through to browser consumers. The workflow uses a 120-second process bound plus 15-second kill grace. Both installer and observer invoke isolated Python; optimized Python is explicitly rejected so validation cannot disappear. `--verify` does not download or change the environment file. Fontconfig queries may maintain their cache. The font binary is not vendored and no application CSS is injected.

The existing ticker observer adds the helper, pin and license to its source closure, for **19 inputs**. It verifies the prepared font environment before and after the existing capture. Each of the five ZH crops also retains a CDP `CSS.getPlatformFontsForNode` observation from a real visible heading or unavailable-status node immediately before its original screenshot. The recorded face must be native, match the pinned family/PostScript name and paint all code points of the exact text (`新闻` or `新闻暂时不可用。`). Filename, font receipt digest, capture interval, bounds and character coverage are checked again by the artifact observer. Temporary identification attributes are removed before screenshots; test-only glyph nodes/styles are not used.

These observations prove the font used on one real Chinese node in each crop. They do not certify every pixel or word elsewhere. Fresh inspection of all five returned ZH images remains required.

## Upstream provenance

- Repository: https://github.com/notofonts/noto-cjk
- Release `Sans2.004`, commit `523d033d6cb47f4a80c58a35753646f5c3608a78`.
- File `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`, 16,437,364 bytes, Git blob `dc15562470b4f842321894787a0d066879ccff8b`, SHA-256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.
- Checksum is independently published in the upstream SPDX manifest at `f8d157532fbfaeda587e826d4cd5b21a49186f7c`, `_manifest/spdx_2.2/manifest.spdx.json`, blob `68b3684f0d0a5a66b962db989962cb183f45a39e`. Both revisions were canonically read and contain the same font blob and size.
- Root `LICENSE` at the release commit is OFL 1.1, 4,301 bytes, blob `d952d62c065f3f35fb83a173496e90b21525aef3`. Its exact bytes are retained in `.github/fonts/noto-cjk/OFL.txt`; the installer keeps license and copyright alongside the unmodified font.
- No actual Noto binary was downloaded locally. The first real hosted download and font-face verification remain owed after publication. Local native integration used the existing libre DejaVu Sans fixture solely to exercise private duplicate-family selection.

## Verification and acceptance boundary

See `checks.json` and retained logs for final integrated-source commands/results. The original 14/7/0 ticker matrix, assertions, ten-image membership, prior packet and other packet checks remain required. Strict scoped TypeScript and lint validate the changed spec/observer; local browser execution is not claimed or attempted after the recorded launch refusal.

The selected ticker manifest and its ten images remain untouched. Do not import the rejected packet or update source locks from it. The next natural CI must prove actual pinned Noto installation, five correct real-node glyph witnesses, a full report and ten complete fresh images. Then qualify actual checkout/source/packet/artifact bindings, inspect ZH images, import a whole accepted packet and consume successor CI. Current PL6/VI/source-composition proof must also be consumed; an unchanged old receipt is not a fresh proof for this environment.

The existing Ready / merge-blocked / no-auto state, SQL0050, coordinated Macro/provider, ordinary-model target/ACK/persistence and production/release holds remain. No migration, host provisioning, canary dispatch, review approval, merge or deployment is performed by this repair.
