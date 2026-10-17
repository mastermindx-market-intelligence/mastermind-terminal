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

## Later product slice: direct Macro overview handoff

The default-off investor preview now exposes the existing Macro dashboard route as one
desktop pinned destination when entered directly. If already returning from Macro,
the incumbent Back control remains the only Macro return action. This does not install
another route catalogue, modify Macro HTML or add a search/session/state plane.

The **new local** proof is [overview-bridge/receipt.json](overview-bridge/receipt.json):
36 focused component tests, seven desktop browser tests, and two narrow-screen EN/ZH
mobile-locale checks passed. A short desktop-height regression failed before scroll
containment and passed afterward. Native-to-Macro navigation was proved using a
read-only route stub at the exact existing public URL; it is not live Macro payload proof.

The previous `isolated/receipt.json` remains historical source-bound evidence for
the earlier shell/candidate. The new slice has changed AppShell/AppNav/preview-only CSS,
so do **not** promote those older image digests to the new source. The mobile drawer,
the four blocked Next route exports, and the independent mobile #697 adoption gate
remain unmodified. New hosted CI was intentionally not the acceptance focus of this
product-development phase; any naturally started workflow is separately classified.


## Mobile contextual Macro handoff — later R2 evidence

The first overview bridge receipt and three original captures remain historical
evidence for source head `699304729a122b4abd5b6b0c263e1e06f500daa3`.
The subsequent **mobile-r2** implementation adds the same public Macro destination
as a 44px minimum-height contextual link at 320/390 widths, scoped to the
server-enabled Analysis/Discover preview and absent on from-Macro entries.
MobileNav stays the sole drawer owner; this is not a competing destination tree.

Current local source/capture digests and exact test scope:
[overview-bridge/mobile-r2/receipt.json](overview-bridge/mobile-r2/receipt.json).
38 focused component cases passed, including EN/ZH; seven desktop browser
cases passed (one intentional mobile-only skip); three selected mobile browser
cases passed at narrow widths without page-level horizontal overflow.
All browser tests used local fixtures and read-only route interception, not
live Macro data/auth; hosted CI and full Next production typecheck remain held.
