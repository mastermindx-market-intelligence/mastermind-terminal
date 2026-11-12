# PR #1407 workspace CSS evidence successor

## Qualified scope

This packet repairs the concrete dependency collision created when #900's qualified workspace evidence guard merged before #1407. The Layout menu's rendering had moved into `LayoutMenu.module.css`, but the incumbent workspace packet did not bind that file.

The product-source implementation is unchanged by this repair. The only two source changes add `terminal/components/LayoutMenu.module.css` to the existing producer and guard `LAYOUT_FILES` arrays. The guard still verifies every manifest hash and retains the i18n dependency. The accepted lifecycle implementation and its twenty-case test file are byte-preserved.

## Actual composition and execution

The original PR branch was updated once, with expected head `b4d10a409a9e585908cb2e23452668e24cdf9697`, to compose protected master `74c007125129090cc762f2bc4b1b152123326444`. GitHub produced `c6f876e325a7c06160caf61f0d0f335e0c69a951` with those exact parents; the original managed operation then fast-forwarded to that commit. `integration.json` records the result. No protected branch was directly merged or overwritten.

The incumbent producer ran once on that checkout, with the two lock additions present, using actual Node v26.5.0 and Playwright 1.61.1. The installed executable path includes the alias node@22; its observed version is v26.5.0. `NODE_OPTIONS=--no-experimental-webstorage` was used for this runtime. An allowlisted child environment excluded unrelated inherited evidence selectors. The original server owner selected port59954.

All twelve existing EN/ZH × desktop1440×900/mobile-width390×844 × grouped/confirmation/member-read-only images were freshly captured through `/dev/workspaces`. The producer emitted actual `owned-server-closed` for PID98612, code0, signalnull, before writing the manifest. The capture exited0 in60.805seconds; a subsequent connection observation confirmed the owned port closed. All five rendering-source hashes were unchanged across execution.

`capturedAtHead` remains the actual checkout `c6f876e…`; it is not rewritten to a future publication commit. The explicit source hashes bind the captured bytes. The mobile-width loop uses the incumbent ordinary browser context and viewport sizing, not a new touch-device qualification.

## Verification

- Twenty existing OS-free producer lifecycle tests passed, with zero failures/skips.
- All three existing team-sharing evidence guard files passed: grants, workspaces and account completeness.
- Focused ESLint on the changed workspace guard passed.
- All twelve original PNGs were visually inspected. Group headings, private-row actions, share confirmation, and member read-only explanations are legible and contained at both sizes and in both languages; no Next development indicator is present.
- PNG dimensions, filenames, checksums, manifest source hashes, unchanged rendering inputs, preserved packets and the append-only history are checked in `qualification.json`.

Raw commands, stdout/stderr and execution receipts are retained. The current-head natural CI and native merge controls remain required after publication. This packet is SELF_REVIEWED; it is not a formal non-author GitHub approval.

## Historical preservation and limits

`previous-packet/` is the entire14-file canonical workspace packet as it existed before renewal, including its prior manifest and capture history. Its inventory is byte-checked against the original snapshot. The new capture history entry appends to the existing bytes. Other B-F12 packets and all prior PR #1407/#900 proof remain unchanged; no old image is relabeled as a new capture.

These controlled development-harness images prove the rendered workspace states and source provenance. They do not prove authenticated production sharing, ACL enforcement or the full live workspace journey, and no production share/grant/revocation was created.
