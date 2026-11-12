# PR1033: compose inbox and E18 capture steps

The original protected-queue entry could not build a candidate because its workflow additions collided with the preceding E18 PR. #627 and #1346 merged at2026-11-11T17:33:50Z. This repair merges their accepted protected composition `ed6529da70f124c2790c5ddf3b6d4482d739cb46` into the original #1033 head `0b4ffeb3ce65b76ec14003dbab5d61688b1dbb2f`.

The common base is `74c007125129090cc762f2bc4b1b152123326444`. Native merge produced exactly one conflicted path, `.github/workflows/ci.yml`, with two additive conflicts. The resolution keeps E18 first and active inbox second, each after Chromium preparation and before the shared evidence owner. Both keep their existing eight-minute timeout, distinct ports47283/47284, TMPDIR, required failure behavior and original producer commands. Both directories remain in the existing always-upload artifact. The inbox synthetic contract, accepted shared lane routing and browser cache fallback remain intact.

The other **15 non-evidence source paths from #1033 are byte-identical to the original head**. This includes the qualified transcript focus repair; no second implementation or evidence restamping is introduced. Source identities and the exact workflow diff against accepted master are in `source-readback.json`.

The two existing workflow consumer suites passed **39 tests**:

- `tests/test_ci_browser_setup.py` (including required E18 capture and browser fallback)
- `tests/test_ci_briefs_inbox_capture.py` (required inbox capture, retention and synthetic contract)

The owned workflow's diff check passed. The broad merge diff check reports whitespace in25 inherited raw evidence files; every reported file exactly equals the accepted parent's blob. Those original diagnostic bytes are retained, not reformatted. The full diagnostic output and classification are included.

This update continues the original PR branch with an exact-head lease and parents `[0b4ffeb3…, ed6529da…]`. No direct merge, independent approval, deployment, producer scheduling, user preference write or admission hold bypass is performed. Fresh natural and protected-queue CI must qualify the new composition, including both real captures. Existing nullable producer publication, old-client refresh, recurring scheduler and live-delivery acceptance holds remain separate from this admitted consumer/API source phase.
