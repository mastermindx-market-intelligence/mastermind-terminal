# Current Terminal toolchain security repair

## Outcome and scope

The current application lockfile's npm audit moves from **23 vulnerable package entries (2 critical, 7 high, 14 moderate) to zero**. Package entries and GitHub alerts are different measures. The actual prepublication Dependabot snapshot contains 51 open alerts: 31 against the current lockfile and 20 against the frozen historical Next fixture used by #1235. No alert was dismissed, and that historical fixture was not modified.

The application stays on **Next 16.4.6 and React/ReactDOM 19.2.4**. This repair selects Vitest 4.1.12, Vite 6.4.6, esbuild 0.25.12 and the coherent Tailwind 4.3.2 family, together with compatible transitive updates. Only typescript-estree 8.62.0 receives minimatch 11.0.8; legacy minimatch 3.1.5 stays separate. Tinypool and vite-node disappear with the old Vitest dependency graph. Vitest 5 was excluded because its engines do not support the repository's Node 20 CI route.

Compatible shared runtime dependencies also change. The graph review accounts for all 94 non-root lock changes, finds no unresolved required edge, and confirms that no optional Vitest browser, UI, coverage or developer-tools package was installed inadvertently.

## Installation and audit

The original npm 10.9.9 resolver failed before changing the lock on its Arborist detached-parent path. Published npm 11.19.1's guarded resolver justified a temporary invocation of that exact version, retaining ordinary peer checks and the existing lock. No force option, legacy peer mode, global npm upgrade or lock regeneration was used. A compatible transitive update exposed an advisory affecting Vite 6.4.4, so the verified 6.4.6 patch was selected.

The original **npm 10.9.9 then performed a successful clean installation**: 471 installed packages, 472 audited packages and zero vulnerabilities. Manifest and lock bytes stayed stable.

| Input | SHA-256 |
| --- | --- |
| Current package.json | 57f4e8f34a066bb4fe1f8a3c4776d2015ac3fcf7c3f729ec07c3b0890c3a03bf |
| Current package-lock.json | be6d44bc152fdb84590bb647c939e333c268123f07ac3c7c09ecd14555c9567e |
| Original package-lock.json | ba5effb6ceb68fd277281ccb7cd8e15dd94fccdc317285f68eb49f4e59388cd4 |

## Existing test contracts

The major toolchain migration exposed harness compatibility differences. The changes preserve the financial and evidence assertions:

- Twenty mock declarations now carry their actual callback or DOM method signatures. Pre- and post-edit TypeScript transpilation produces **byte-identical runtime JavaScript** for each file.
- Vite 6's default JSON stringification loses negative zero. The test configuration sets `json.stringify: false` to preserve producer values and canonical financial digests. Financial fixture bytes and expected digests remain unchanged.
- Three HTML/snapshot baselines receive only the generated CSS identifier migration from MD5(relative module path) to SHA1(relative module path). Every other byte and every CSS source is preserved.
- The phone inspector advances to the actual next fake animation frame. The chart model-clock test explicitly fakes Date, setTimeout and clearTimeout, preserving its intentional requestAnimationFrame stub and all three timer assertions.
- The client import-graph assertion resolves immutable adjacency once during its measured assertion, retaining every client entry, breadth-first path and scorer-boundary check.
- The password-boundary scan searches raw bytes for its ASCII token. The complete traversal, archives, test files, caught read errors and exact hit set are preserved.
- The timezone checks still use two fresh processes and the actual parser under New York and Shanghai. They use the declared Vite SSR API with watching and WebSocket serving disabled, and close it in finally. They no longer resolve an undeclared vite-node runner through npx.
- Seventeen tests that traverse full historical evidence receive a finite 15-second integration budget. Pure shape tests keep the default. Strict readers, image bytes, history and corruption assertions are unchanged; no validation is cached or skipped.
- Four new consumer tests exercise the actual TypeScript project-service/minimatch path and React Hooks compiler/Zod path, including positive and specific negative behavior.

## Actual verification

The three existing cold partitions ran with their **unchanged 38 evidence exclusions**, four workers and a stable source state. The qualified complete inventory is:

| Result | Count |
| --- | ---: |
| Test files | 1,287 |
| Passed tests | 23,498 |
| Failed tests | 0 |
| Existing pending/skipped tests | 50 |
| Existing todo tests | 3 |
| Total tests | 23,551 |

The first final shard 3 process exited 1 while its JSON reporter said success and omitted one nine-case file. That original execution remains failed and incomplete. Vitest 4's JSON reporter does not serialize the run-level error argument; its success field cannot override the process result. A bounded run of the same shard, source, worker count and exclusions added the normal reporter beside JSON and passed with all 429 files and the nine missing cases restored. The original cause remains unproven. Both raw runs are retained.

Additional targeted verification covers 178 migration cases, 14 chart lifecycle cases, 106 remaining consumer cases, six strict inbox cases, 66 partition contracts and the real parser/compiler checks. These overlap the final partitions and are not added to the distinct 23,498 count.

Next type generation and full TypeScript pass. Scoped lint has **zero new diagnostics**. Its five errors and two warnings match the protected-source baseline exactly; the raw lint failure and the baseline comparison are retained.

The actual **`npx next build` passes in 54.75 seconds** using the existing CI production-build fixture environment. Matching CI, the prebuild data-generation hook was not called. Public coverage.json was absent before and after. An initial preflight assumed that file existed and stopped before starting a build; the corrected absence-aware preflight and original error are retained. The actual build leaves source unchanged. Tracing warnings in unchanged source are retained. This is compilation proof; production delivery is still owed.

The bounded static inventory also confirms that existing workflow/script invocations use arguments supported by installed Vitest 4.1.12. No removed pool/thread option or remaining executable vite-node invocation was found.

## Fresh inbox and historical preservation

The unchanged inbox producer captured all **eight list/empty × desktop/mobile × English/Chinese views**, and the principal visually inspected each image. The packet binds all 15 current source inputs. Eight contexts, the browser and the server settled, and the owned port closed.

On macOS, the producer stopped before promotion because /tmp resolves to /private/tmp. Captures and cleanup had completed, and the original nine-file target was positively unchanged. The exact staged packet passed the unchanged reader at its canonical real path. Its eight images were copied exactly and its original manifest selected last. The target reader and six strict unit cases pass. The prior packet is archived verbatim.

The raw checkout identity remains actual HEAD 2c00073fa0c0449fa626f06d33af0ace478f6f2c and tree c95dc0b9849cf49809890ab47d4fb3a94f2fd677, with the original working-tree source hashes. It is not relabeled as a future publication commit. Producer activation and production acceptance remain false. The frozen twelve-view recurring-briefs packet and #1235's historical Next fixture stay byte-identical.

## Source and delivery boundary

Local checks use protected base 2c00073fa0c0449fa626f06d33af0ace478f6f2c plus the recorded working-tree delta. Later protected e2a76ec4fa684f0289dd3afc3a9abbe8c01d8661 adds only two Prophet design documents (#1476 and #1479). No affected application, dependency, test, evidence-source or CI input changes in those two commits.

Natural successor CI remains required, including its current F11, PL6 and VI owners and serial ticker capture. Historical evidence cannot substitute for changed package inputs. Any current ticker import must use qualified bytes returned by that run. The protected queue, natural deployment and installed readback remain the delivery route.

Parent duty: https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028#issuecomment-6808051700

## Evidence layout

- `qualification.json` records the accepted local outcome and outstanding delivery obligations.
- `source-readback.json` binds the final local source and preserved historical inputs.
- `raw-evidence.tar.gz` retains the original execution records, failures, successes and source preimages in a deterministic archive. `raw-evidence-index.json` records the size and SHA-256 of every uncompressed member.
- `prior-active-inbox/` preserves all nine original packet files.
- `manifest.json` inventories every outer proof file. The packaging readback checks both the outer files and every archive member against their recorded hashes.
