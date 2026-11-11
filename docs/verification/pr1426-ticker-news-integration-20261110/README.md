# PR1426 current Ticker News evidence integration

## Why this packet exists

The accepted Watchlist A3 change in PR1426 updates TerminalShell.tsx. The retained Ticker News packet still identified the previous Shell hash, so the strict evidence reader failed in merge-group jobs 129950555784 and 129952065137. The second failure was inherited by PR1435 through that queue prefix. Both original decoded logs are retained as lossless gzip files, with hashes and exact failure excerpts in original-failure-diagnosis.json.

The repair retains the SS12 and A3 product changes and the unchanged evidence reader. It captures the original Ticker News packet on the qualified source and binds the real results. It does not weaken an assertion or introduce a new CI capture controller.

## Exact source

Capture commit: **139ec0574b57ecbb59d237dc315c8276dd307794**  
Full source tree: **0af51d3051bb9be1052b156f95b33fcaa3cb1957**  
Parents: original PR1426 f5a79cafb2ed3776f2919fc49d29babc7445f7e4 and protected 3ba8e1a663a752c7de42c717c3826e722dda416d.

The composition has six candidate paths and no overlap with the protected delta. Every candidate and unrelated protected postimage was checked. The old Product Sol workspace was not used. The existing producer remains Git blob 09edca20e9d77e26306936f125a73305d67fc71a.

## Actual proof

- The full unchanged specification discovered 21 cases: **14 passed, seven existing project skips, zero unexpected results, flakes or retries**. It ran for 554.38 seconds using Node22.23.4, Next16.4.6 and Playwright1.61.1 on the owned port47287.
- Both source membership and bytes were re-read: **2,051 observed inputs stayed stable**. The producer, fixtures, setup/helpers, configuration, package lock and explicit reader/specimen inputs are included.
- **Ten PNGs were freshly produced and directly reviewed**: six EN/ZH live-feed panels across desktop/tablet/mobile and four EN/ZH unavailable panels across desktop/mobile. Their dimensions are actual panel dimensions; viewport labels describe the browser viewport.
- All **103 neighboring editorial/recovery/CN-HK files** stayed unchanged. The original eleven-file packet is preserved under prior-packet. The manifest remained unchanged until the successful capture and actual visual review were available.
- The unchanged strict evidence reader passed **4/4**, and affected lint exited0 with zero warnings permitted. Source and packet hashes stayed stable through those consumers.
- Full hosted TypeScript is reused with its original execution attribution. GitHub merge-group d41f601c4427c4ff15f3e9f0ccdeb1a51c902e62 has exactly the same full source tree as this capture. Its actual step7, **npx tsc --noEmit**, succeeded after successful Next type generation in run42850341427/job129950555784. It was not rerun or restamped as local proof. The only later changes are the packet and this verification directory.
- The original producer exited, its owned lifecycle settled, the port closed and the Next lock was absent. Lifecycle state: **STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED**. After consumers finished, the generated default-development next-env.d.ts matched the installed emitter byte-for-byte, was archived, and its original absence was restored. The tracked tsconfig stayed unchanged.

## Review and provenance

QUALIFICATION.json is the bounded acceptance summary. browser-current contains the actual report, log, before/after source maps and execution receipt. visual-review.json binds all ten inspected image hashes. The earlier partial image-review record explicitly marks two mobile crops as pending; only their later fresh writes were accepted in the final visual record. No stale image is relabeled as a fresh capture.

manifest-binding.json binds the actual source commit and the three required layout hashes. typecheck-reuse.json identifies the exact hosted proof. generated-reconciliation.json records the owned generated-file restoration. driver-adaptation.json explains the narrow qualification-wrapper changes; the application and browser specification remain unchanged.

This is fixture-backed local UI proof. The retained images cover dark-theme panels. No authenticated-device, installed-production, live-provider, news-freshness or production-activation acceptance is claimed. Natural CI and the repository's native merge queue must qualify the published successor.
