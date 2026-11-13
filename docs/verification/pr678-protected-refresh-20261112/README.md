# PR #678: protected-source refresh, 12 November 2026

## Result

The original PR source 492a73948a947c3cccc2981e90a5cc227d96385f is composed with protected master 6c5d71ebbd797897b50f8727588bd95e834517a8 in local integration commit d06340a252167f1e0432ab0b6773011593567647, tree b312f61468271c32ddac31cfd8cbe2f6b0054dc0. Its ordered parents are the original published PR head and protected master.

The complete protected tree is retained with exactly two accepted source blobs: terminal/lib/marketStructure.ts and terminal/lib/__tests__/marketStructure.test.ts. Their protected preimages still equal the previously qualified #646 parent. This continuation follows the explicit deferred integration step in https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/678#issuecomment-6745099340 after #645 and #646 landed. Assigned continuation and custody are recorded at https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/678#issuecomment-6810315200.

## Current integration qualification

Fresh installation used this composition's package lock and the installed Node 22.23.4 runtime. Next type generation, 104 tests (88 Market Structure and 16 exposure node tests), full TypeScript checking, and ESLint on both changed source files all returned zero. Complete commands, raw logs, log hashes, Git identity, and stable source hashes are in execution.json. Product source, affected test source, and package files remained unchanged throughout.

The already accepted threshold red control is reused because both qualified source blobs are byte-identical; this proof does not claim a new execution of that control. It does not claim hosted CI, browser qualification, release, study admission, or live producer acceptance.

## Retained gates

The PR remains Draft with native auto-merge off. Macro #7483 and its exact current producer qualification, canonical ADV ownership (engine.validation.dollar_adv(window=21), a 21-session median), actual owner inputs, and R12 preregistration before opening outcomes remain required. Research-only status, unopened outcome labels, no tail renormalization, null full expectations for any positive unsupported tail, and the separate 95% study admission rule remain intact.

## Provenance

Duty: terminal-pr-estate-support-20261111-c3.
Governing source pin: bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178.
Original managed operation: terminal-pr678-probability-integration-20261109-c4.
The proof-only publication commit will descend from the integration commit above. Captured source identity and the later proof publication identity are deliberately recorded separately.

Manifest.json records every evidence file's length and SHA256 except itself. The original branch is published only after a fresh remote-head check and an ancestry check, with an exact old-head lease. No history rewrite or release admission is authorized by this repair.
