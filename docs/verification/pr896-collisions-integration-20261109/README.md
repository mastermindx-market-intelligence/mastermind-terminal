# PR 896 — Alerts collisions evidence renewal

## Result and source

The original branch `claude/evidence-b-f08-b5-3-collisions` is composed from original head `cb3b9a937c9eeb8d8cb2b10c9f1a0d1e8510bfa0` and real protected parent `03af393ce05c12282003a3919cc473c032264922`. Takeover: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/896#issuecomment-6745298157. Governing procedure pin: Mastermind `494d095813dad415938800fa0e4d2719497738fa`.

The producer now checks for the development indicator without deleting its portal first. Its fixture states, seven source locks, filenames, EN/ZH matrix and viewport assertions are preserved. It also uses the already-protected capture lifecycle helpers for server startup, exact-200 readiness, IPC identity reporting and awaited settlement. The old local readiness/shutdown implementation is removed. The shared owner itself is unchanged.

This changes the capture tool and evidence gate; the Alerts product source is exactly the protected parent. The workflow, permissions, runner selection, checks and release controls are unchanged.

## Actual capture and verification

The current producer generated all 16 images: four states (watching, degraded suite, never-run suite, unresolved identity), two languages and two viewports (1440×900 and390×844), dark. CAPTURE_ONLY was absent. Every file was newly written during the attempt, has the expected PNG dimensions and has a recorded byte hash. No failed-image artifact was accepted. The generated manifest records the actual pre-publication HEAD above; qualification binds it to both real source parents and the composed bytes.

The final supervised attempt took 57.25 seconds. All 1,935 observed source entries were unchanged during capture. The existing supervisor retained the producer/server identities, received start and stop reports, returned CLOSED with exit0, and reported settled ownership with no signal, timeout, error or refusal. Independent observations found the recorded processes absent, the owned port closed and no Next lock.

The four original evidence-reader assertions passed. Full TypeScript passed in43.15 seconds. Producer Node syntax validation and TypeScript-test ESLint passed. The raw combined ESLint invocation is retained as a failure: the CommonJS producer has five inherited no-require-imports findings plus one intentional require of the existing shared owner. Its configuration was not changed, and that raw run is not claimed as a clean lint result. The separate baseline and scope classification record this precisely.

The assigned root inspected four actual images: Chinese unresolved identity on phone, English degraded state on desktop, English watching state on phone and Chinese never-run state on phone. The source-state distinctions and controls remain readable, with no developer indicator visible.

## Preserved history

Both the original PR packet and protected-master packet are retained byte-for-byte under prior-pr and prior-master, with their original attribution. The first full16 attempt already passed with stable sources and closed server. Its packet is retained under pre-lifecycle-packet. A concrete shutdown defect then justified the shared-helper change and a new full16 capture against the changed producer; the earlier result is historical, not restamped as current.

Raw .log files remain in this owned validation workspace, with hashes in the retained execution records. The candidate retains structured execution, source maps, actual image packets, baseline lint findings and the review record. Publication-plan and immutable-upload receipts are outside the indexed tree to avoid circular tree identities.

## Release boundary

The conflict and current evidence requirements are qualified locally. Publication uses the original branch and an exact expected-head comparison, with both real parents. Natural current-head required CI and the native protected merge queue remain binding. The expired #1162 scheduling deferral is not active. There is no formal changes-requested review on this PR at takeover. Fixture captures establish this source/evidence result; they do not establish a production deployment or authenticated live acceptance.
