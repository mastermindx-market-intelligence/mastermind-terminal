# Native investor-shell preview evidence

Start with `isolated/receipt.json`. It binds the final product/test bytes to native source `d1d09f374f9cb5dbbcf562a366db43ee3cce8819` and distinguishes the unchanged-source mobile failures from the exact existing #697 dependency qualification.

Earlier top-level, bridge and mobile-dependency receipts remain historical but are superseded for exact-source browser acceptance because their harness allowed reuse of a port later observed under another worktree. Unit/source results retain their separate scopes. No production acceptance is implied.

## Current results

- Primary native source: 480 unit files / 7,863 passed / 4 todo; fresh browser 10 passed / 4 inherited mobile Escape failures / 4 skipped.
- Exact #697 test-only combination: same unit totals; fresh browser 31 passed / 23 intentional project skips / zero failures. No #697 source was adopted into this branch.
- Optimized frontend compilation passed after moving the existing global cohort selector unchanged to an explicitly imported global stylesheet. Full build and generated-route typechecks remain blocked by four existing API exports; see generated-route-type-errors.txt and production-build-blocked.txt. No API source was changed.
- The Macro round trip uses baked source9b54c2d7... plus its 30-file manifest, existing controllers and loopback endpoint mapping. It preserves the mounted parent/hash/focus; it is not a new iframe architecture or production-SSO/data proof.

## Reproduction boundaries

Use the locked dependencies and existing Playwright harness. Opt-in commands must include `CI=1`, `MMX_INVESTOR_SHELL_PREVIEW=1`, a dedicated `TERMINAL_E2E_PORT`, `--workers=1`, `--retries=0` and a unique output directory. The inherited CI setting disables server reuse. The preview tests intentionally refuse a reuse-enabled opt-in run.

For the bridge test, materialize each path in bridge/macro-source-manifest.json from the exact Macro Git commit and validate its SHA-256, serve that read-only snapshot on a separate loopback port, and set MMX_MACRO_FIXTURE_ORIGIN accordingly. The test blocks every external/non-GET-or-HEAD request and maps only the existing Terminal endpoint for local transport.

The detached mobile test tree is reproducible with git merge-tree of the two exact parent commits in isolated/receipt.json; its four added/changed dependency blobs must match original #697 byte-for-byte. The local test-only merge commit was not published or accepted. Keep the API, mobile, independent review, CI and deployment gates intact.
