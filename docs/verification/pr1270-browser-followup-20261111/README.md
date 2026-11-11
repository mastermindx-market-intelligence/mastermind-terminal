# PR1270 browser follow-up — 2026-11-11

Published basis: `36f579e184ae9a6939c75154cdf5641c8e2e24b1`. Original workspace/operation remains `d06-terminal-reader-resilience-20261103-c4`.

## Problem and repair

The natural hosted run43003912972 had two browser failure classes. Its six fullscreen attempts each made two identical successful startup NVDA reads before the first range control or fullscreen action; no read was observed during the control/fullscreen sequence. The spec now waits for the completed initial read set, requires a positive startup count, and requires exactly that count after the whole unchanged journey. It records the actual count; it does not hardcode two or permit control-triggered reads.

A cached transcript response could resolve before the drawer's portal mounted. The source-focus effect then found no target node and did not run again when the portal appeared. The effect now waits for the actual mounted state and depends on it. It preserves target identity, one jump per target, scroll behavior and return focus.

The new real React regression controls response and animation-frame ordering. Against the original source it has one failing before-portal case and one passing after-portal case; both pass after the repair.

## Verification

- 53 focused transcript/search/compare/focus cases passed.
- Focused ESLint and full TypeScript passed.
- Six complete fullscreen journeys (EN/ZH × desktop/tablet/mobile) and the actual clipboard lifetime/close/reopen journey passed: seven executions, one attempt each, zero failures, authored skips, retries or flakes.
- Browser reports bind the actual local head357c32f1a330dda9362955361ae0ab30a3e54048, existing index treeeb208c788e69f4d3c03416edf2fe96a6bf7dcddd and published basis36f579e. The three current source files were not staged during the run; actual content is bound by before/after hashes across4,483 files. No claim is made that the recorded index tree contained these new source bytes.
- Port57729 closed after each stage; no listener, lock handle or workspace cwd holder remained. The old lock pathname remained with no handles.
- One initial selection-only command matched zero tests and launched no browser. Its log/receipt is retained. The corrected selection used the same seven named cases, one worker and zero retries.

The archive preserves all raw logs, reports, seven trace ZIPs, source snapshots, selection receipts and the original hosted-artifact download receipt. Its inventory hashes and full decompressed byte readback are recorded beside it. Original hosted artifacts13849462869/13850380562 remain linked to run43003912972; their bytes were downloaded and verified without restamping the failed run as successful.

## Remaining acceptance

Keep Draft and auto-merge off. Current EOD/GEX native qualification and Options-axis historical applicability remain unresolved. Physical WKWebView, browser-UI Escape, authenticated production upload/RLS, full D06 matrix, joint-shell rollout and F01/F02 uncertain-effect boundaries remain. These fixture-browser passes do not prove production acceptance.
