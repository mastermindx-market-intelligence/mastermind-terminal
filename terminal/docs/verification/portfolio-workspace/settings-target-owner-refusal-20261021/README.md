# Settings owner-refusal status repair — 2026-10-21

## Finding and change

The follow-up review of `c5fd88bf26bcdd9af74c79c00cfb9b42cb08a271` found
one remaining branch, preserved in
[HOLD 6317367403](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1099#issuecomment-6317367403).
Settings made a 409 refusal terminal only after reading an exact JSON error.
Malformed or unreadable bodies left the ordinary failure/readback path reachable:
session B could be read while canonical props still identified A.

The existing target route emits HTTP 409 only for its originating-owner mismatch
precondition. Settings now maps that **status** directly to the existing safe
`owner mismatch` error, before automatic readback, without reading the body.
The prior canonical-owner, generation, lifetime, serial-order and debounce
retirement repair is unchanged.

Only the Settings component, its mounted test file and this packet change from
the held parent. No API, schema, Portfolio readout, debounce/card, CSS, package,
Treasury source, compiler, SQL or production receipt changes are included.

## Verification

Two new mounted regressions retain canonical props A, change the fixture session
to B, and return a 409 with either malformed JSON or a rejecting body reader.
Both reproduce an unwanted B GET before this repair. Both now verify the captured
A owner precondition, preservation of B's target, no follow-up GET, retained old
row, safe localized refusal and no successful-clear acknowledgement.

| Check | Result |
| --- | --- |
| Selected RED against c5fd88bf | 2 failures; 52 cases excluded by name filter |
| Final affected unit suites | 153/153 passed in 5 files |
| Full TypeScript | No emit, nonincremental; exit 0, empty log |

The full affected suites comprise Settings 54, summary 20, shared readout 42,
target API 27 and Portfolio owner panels 10. Existing queued-unmount/A→B→A,
profile/email/guest/StrictMode and already-submitted/no-replay regressions remain.
Actual local runtime is Node v26.5.0 / npm 11.17.0. Expected Vite deprecation and
deliberate driver-fault stderr remain disclosed in the logs.

## Explicit evidence reuse

The twelve fresh EN/ZH × Portfolio/Settings × desktop/tablet/phone browser cases
and inspected synthetic crops remain bound to **c5fd88bf**, under
`../settings-target-owner-scope-20261021/`. They passed with zero retries,
skips or flakes on the fresh owned port 39110 server, which exited cleanly.
They were **not rerun** for this refusal-only change.

Reuse is limited to those unchanged successful removal and visual paths: the
production delta only replaces response-body decoding inside the non-OK 409
branch. Successful POST handling, shared UI, E2E source and CSS are unchanged.
The new branch is covered by fresh mounted RED/GREEN regressions and the existing
route owner-precondition tests. Hosted CI and the actual final-head independent
review remain separate release gates.

`validation.json` binds the two final source hashes, exact commands/results,
compressed raw logs, unchanged protected blobs and the older browser source
binding. No real-account mutation, live multi-account acceptance, deployment or
positive historical-source availability is claimed.
