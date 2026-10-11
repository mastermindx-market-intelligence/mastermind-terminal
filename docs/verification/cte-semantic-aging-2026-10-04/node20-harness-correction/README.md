# Node 20 route-harness correction

This addendum preserves the original 95-file semantic-aging proof package and records one subsequent test-harness correction against source commit `3ee6f7ae31f0ba98b85308a15014799163fdc1ba`.

Hosted [run 37169476890](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/37169476890), unit job 111339307565, used Node 20.20.2. The mounted-card module passed 11 tests and resolver/client module passed 21 tests. Four of eight route tests failed when real Node WebCrypto received a jsdom-realm ArrayBuffer. This failure was introduced by the test environment change; the production hash implementation was unchanged.

## Correction and verification

The route suite explicitly uses Node for the real receipt hash, resolver, GET response and browser-parser leg. The single mounted round-trip creates the installed public Vitest jsdom environment only around the DOM leg and always unmounts and tears it down. All original immutable-context/hash, future-date, Partial, warning and unavailable-negative assertions remain. There are no cryptography mocks or production edits.

The exact Node 20.20.2 runtime on darwin/arm64 reproduced the four route failures. An independent realm witness accepted a host ArrayBuffer and rejected a foreign-realm ArrayBuffer with the same error. After the correction, all 40 owning tests, TypeScript and focused lint passed. Native process receipts are recorded in the retained JSON.

| Artifact | Meaning |
|---|---|
| [node20-realm-witness.log](node20-realm-witness.log) | Real WebCrypto discriminating host/foreign buffer witness |
| [node20-test-red.log](node20-test-red.log) | Unchanged candidate: 4 failed, 36 passed |
| [node20-test-green.log](node20-test-green.log) | Corrected owning suite: 40 passed |
| [node20-type-green.log](node20-type-green.log) | Exact Node 20 TypeScript exit 0 |
| [node20-lint-green.log](node20-lint-green.log) | Exact Node 20 focused lint exit 0 |
| [node20-harness-correction.patch](node20-harness-correction.patch) | Exact one-file source diff |
| [node20-harness-correction-receipt.json](node20-harness-correction-receipt.json) | Source/runtime/process/hash receipt |
| [manifest.json](manifest.json) | Exact copied evidence and addendum hashes |

Changed file: `terminal/lib/__tests__/companyThemeExposureRoute.test.ts`.
Final file SHA256: `937b971778e8aee8aa5fc4bffb4b1ebd43db2ea968171a86f0cbda7c96e83097`.
Patch SHA256: `a2654597dee2e275a2d279482c11ce9814c76e78a92725db4a72ad0ed72322f6`.

The original resolver, mounted card, other test modules, browser spec and original proof artifacts remain byte-identical. Their original source/runtime receipts remain historical facts; this addendum does not relabel the old CI run as passing.

## Acceptance boundary

This is a source test-harness repair. The refreshed candidate still requires actual protected Ubuntu/Node 20 CI and exact-head release acceptance. The prior 72 controlled browser cases remain attributable to unchanged production code; no additional browser matrix was necessary for this one-file harness change. Controlled clocks and fixtures do not establish natural publication, deployment or scientific support. Terminal's current dark-only appearance and the separate private/service/tier delivery obligations remain explicit product gates.
