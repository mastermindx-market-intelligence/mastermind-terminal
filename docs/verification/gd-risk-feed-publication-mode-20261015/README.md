# Public risk-feed publication mode — 2026-10-15

Program: Grey Deer / MAS-258 / Macro #8128.
Source operation: `gd-risk-feed-publication-mode-20261015`.
Base: Terminal `6159475696f460ca7921bf82cb27b79553c5763f` (merged #1008).
State: source repair; no production rollout or live403 resolution claimed.

## Reproduced defect and bounded design

`ingest/pull_macro_risk.py::main` writes the intentionally public
`terminal/public/data/market_risk.json` through `NamedTemporaryFile` and atomic
replacement. The temporary's private0600 mode survives the rename. All six
new synthetic cases produced0600, including replacement of an already0644
public output and execution with umask0022 or0077. An independent serving
account therefore cannot rely on that output's ordinary POSIX read bits.

This is source-level reproduction, not a read of the original production file
or proof that file mode is the only cause of the earlier403. That endpoint's
host diagnostic and the attempted #1008 deployment remain separately blocked;
this work does not retry or bypass them.

The fix flushes the complete serialized payload and calls
`os.fchmod(handle.fileno(), 0o644)` on the owned temporary descriptor before
atomic replacement. Only this public artifact's writer changes. There is no
global umask change, host chmod, account/ACL/authentication change, source
qualification change, new data engine, schema change or alternate publisher.
The temporary stays private while being written. Mode failure propagates,
keeps the last-good output, and removes only this writer's temporary.

## Verification

Eight added regressions failed before the fix: six output-mode cases,
mode-setting failure preservation, and verification that mode and complete
JSON are established before atomic visibility. After the fix the complete
existing bridge module passes **52 tests**, with no failures or skipped cases
on M2. All inputs and outputs are synthetic/temp-root; network fetching is
explicitly forbidden by the fixtures. Tests restore their temporary umask in
`finally`.

AST comparison confirms only `main` changes; all source selection, market
math, timestamps, envelope qualification and return schemas are unchanged.
`git diff --check` passes.

Source SHA256:
`aa4effb30f417ca5349be9b3241b051c077f3cca12b0451bd7c9da61d6eadbe9`.
Test SHA256:
`8d81b4db155676cce931cbeb9416f0dc9590f6e284d78cd47ec2b2ef270ae089`.

## Independent review and release

Independent Fabric child `gd-risk-feed-publication-mode-review-20261015-01`
was verified unused and requested once through the installed M2 adapter.
Original root and immediate parent: `gd-native-publish-continuity-20261015`.
Normal router admitted Qwen3.8-max/Bailian on Ubuntu3. Packet SHA256:
`f77f478977cec03840fc71f1e34411faa493684420b06510078c77ea35ec1dac`.
Review was pending at this source save; execution is not acceptance.

The previous disclosure #1008 is merged and all37 paths matched its squash;
its exact production deployment was blocked before dispatch and its original
unit remained absent. No code or file-mode change from this source repair has
been deployed. Required source review/CI/merge and the original deployment
permission gate remain distinct. A later normal admitted publisher must
establish actual served bytes and user access before the feed is called live.
