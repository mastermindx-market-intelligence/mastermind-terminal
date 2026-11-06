# D06 — public snapshot recovery and embedded fullscreen
Date: 2026-11-04. Source parent: f01a4ebf0924d53a448f1acb63a8ee235418d8b6.
Protected source pin: 0f9043313069d90cc3e1629a04ff2455f0f0fe78.
Carrier: d06-terminal-reader-resilience-20261103-c4; existing Draft PR #1270.

## Delivered behavior
Public snapshot routes validate the existing ten-character slug before constructing any CDN URL. An eight-second uncached HEAD classifies only 404/410 as missing. Other HTTP/network failures remain unavailable and recover through an explicit, guarded retry. The actual image must load with positive natural dimensions before ready is announced; a corrupt 200 response is unavailable. Natural aspect ratio and ordinary document scrolling keep wide and portrait images complete. The footer remains reachable at 320 CSS pixels.

The /x layout reuses SharedShellPresentation only under the existing MMX_SHARED_SHELL flag. It uses the existing verified account identity or guest result; identity-service unavailability keeps public content accessible without inventing an identity or blocking the image. The existing presentation owner supplies EN/ZH and light/dark controls. No new preference, session or authentication owner, API contract, database write, storage bucket, expiry inference or default rollout is added. Metadata no longer invents image dimensions.

The existing fs=1 affordance now asks the actual browser Fullscreen API to enter or exit. Fullscreen state follows fullscreenElement/fullscreenchange. Pending requests cannot duplicate; unsupported/enter/exit failures explain the observed action while the chart remains usable. The chart instance, chosen range, moving averages and data read survive entry and exit. Transparent widgets become opaque in fullscreen; compact browser widgets restore their source date and attribution. Focus returns to the same button. Off moving-average labels remain readable with an explicit strike instead of opacity reduction.

A callable existing WebKit mm handler retains precedence and receives exactly openFullChart. Native failure is visible and cannot replay through browser fullscreen. Successful handoff is an accessible request acknowledgement, not a claim that the host accepted/opened the destination. The native compact geometry is retained.

Ordinary web viewports permit zoom. NativeViewportPolicy is the single client owner of the native exception, replacing the former global lock. It applies after metadata hydration for shell=app or a callable mm handler, retains unrelated viewport directives, and conditionally restores its own change on navigation. There is no pre-hydration viewport mutation, duplicate tag, observer or second native bridge. Actual client navigation from a native-marked snapshot back to Terminal restores web zoom.

The trusted Macro bridge leaves Escape alone while this chart is actually fullscreen; after return inline its existing close handoff still works.

## Actual Paper design
[Terminal D06 page](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-17-0).
- 1WYN-0: desktop light EN browser/fullscreen/recovery states.
- 1WYO-0: phone dark ZH browser recovery and native handoff; all seven ranges and both SMA controls retained.
- Snapshot board 1WIA-0 was rendered/exported with the earlier workspace slice and remains its design reference.

Both new boards were rendered, visually inspected, corrected to actual candlestick/range/SMA semantics, exported as JSX and finished. JPEG/JSX exports are in pr-crops/d06-snapshot-embed-20261104/paper. Specimen prices are illustrative, not live quotes.

## Verification
- 95 unit/DOM checks: 18 availability/layout, 17 existing ingress, 60 plain-label call sites.
- Final coupled browser run: 17 passed, 1 scoped portrait duplicate skipped. EN/ZH, light/dark snapshot states, corrupt-image retry, confirmed missing versus unavailable, tall 320px image, and actual fullscreen retaining chart settings.
- Additional embed qualification: 16 passed, 8 viewport-independent fault/host duplicate cases skipped. Includes native success/failure, unsupported/rejected entry, rejected exit, zoom, compact variants, actual two-origin Macro admission and close message fence.
- Compact fullscreen / client-navigation follow-up: 3 passed, 1 desktop-only navigation duplicate skipped.
- next typegen and full TypeScript check exit 0. An earlier concurrent dev/typegen race was diagnosed and replaced by this sequential check.
- Focused lint has no new diagnostics; EmbedChart retains the same five pre-existing diagnostics as source parent.
- Actual runtime screenshots inspected for desktop light/fullscreen, phone dark/fullscreen, Chinese snapshot failure and the complete tall 320px image. Hashes, test identities and scope are in verification.json.

## Proof limits and release state
The browser uses synthetic daily bars and intercepted public image responses. No production database, real quote or WKWebView gesture proof is claimed. Chromium page-scale zoom was observed at 2x; separate 320 CSS-pixel reflow proof is retained. The default headless keyboard carrier did not perform browser-level Escape exit: the actual fullscreen bridge guard, explicit exit and subsequent Escape close are proven; physical browser-UI Escape is not. This does not block the implemented browser exit control.

Draft/no-ready/no-merge/no-deploy and joint-shell rollout holds remain. F01/F02 effects stay fenced at their original targets. Self-QA is complete for this slice; this is not a claim of merge, deployment or Chairman acceptance.

## Continuation — Macro work remains active
D06 also covers Market Structure, Stage Analysis and S&P Vector. Their implementation is continuing in operation d06-macro-implementation-20261104-c4, base 52abe2e183833a216267942a99513e6c9cbe062f, branch sol/web-d06-macro-implementation-20261104-c4.
Actual workspace: /Volumes/Mastermind 2/agent-workspaces/macro/web/d06-macro-implementation-20261104-c4.
The original acquisition response was uncertain; the same operation was reconciled by publisher status and the exact registered/locked worktree. No duplicate acquisition was made.

Macro Paper design home created and read back: MASTERMIND PAGES file 01M2WGNCX9475G79JRKJTCM08P, page p-29-0, “D06 · Market structure, stages and model allocation · R1”. This is a disjoint page; prior D02/D04/D12 boards are references only. Operation d06-r6-macro-page-20261104 was APPLIED_RESPONSE_OBSERVED. Root remains the sole code/canvas writer; native child agents supply read-only reasoning. Next action: author the three route designs, implement the existing template/builder corrections, prove real journeys and publish the Macro Draft code PR. The separate evidence PR #10655 remains on its existing GitHub carrier.

DO_NOT_REDO: accepted Workspace f9960127, Scripts f01a4ebf, earlier reader/feedback/source-clock changes. Do not treat this checkpoint as full D06 completion.
