# Settings target mutation owner-scope repair — 2026-10-21

## Finding and bounded change

Independent review held combined Terminal #1099 head
`58a3400c35d4c3e0b5e64ba9e51b584dae0ccbc6` in
[comment 6316857360](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1099#issuecomment-6316857360).
A Settings clear queued behind another mutation could dispatch after the section
unmounted, or after a committed A → B → A owner transition. The request omitted
the API's existing originating-owner precondition.

This repair changes only `SectionPortfolioTargets.tsx` and its mounted component
test file, plus this evidence packet:

- Ownership comes from the canonical `SectionProps.identity`, using the existing
  owner-key helpers. A cached profile, email change or profile arrival does not
  define a new account; a guest cannot dispatch a mutation.
- Each intent captures its owner, committed owner generation and layout lifetime
  token. Cleanup permanently revokes that token; a fresh StrictMode setup receives
  a new token. These checks run immediately before a queued POST.
- The POST includes the captured raw immutable `expectedOwnerId`. A session change
  that reaches the server before the UI receives new props is rejected by the
  existing API comparison guard.
- An explicit `409 owner mismatch` rejects before any automatic GET. Its safe
  error code reaches the shared English/Chinese message mapper.
- Retired work rejects its caller after an await, so it cannot acknowledge a stale
  save/clear. An already-submitted POST may have committed; this repair does not
  cancel or replay it.
- The serial chain remains intact. Newer valid intents do not cancel older valid
  writes; only the newest valid intent reads back the whole book. The shared
  readout is keyed by canonical owner to retire pending debounced drafts.

The previously accepted Treasury source and the Portfolio page owner/debounce
implementation remain unchanged from the parent. The target API, packages,
migration SQL and original production receipt are unchanged.

## Fresh verification

| Check | Result |
| --- | --- |
| Selected regression before implementation | 11 failed, 1 passed, 40 excluded by the name filter |
| Final affected unit suites | 151 passed across 5 files; no skipped cases |
| Full no-emit, nonincremental TypeScript | Exit 0; empty output |
| Browser fixture matrix | 12 passed; 0 skipped, 0 unexpected, 0 flaky; retries disabled |
| Owned fixture server | Port 39110, reuse disabled; no listener remained after exit |

The five unit suites contain 52 Settings component cases, 20 Settings summary
cases, 42 shared readout cases, 27 target-route cases and 10 Portfolio owner-panel
cases. The new regressions exercise actual component unmount; queued A → B → A
clear and set retirement; a changed session before new props, in both languages;
pending/stale cached profiles; guest refusal; same-owner profile/email changes;
StrictMode setup/cleanup/setup; and draft retirement followed by a valid new-owner
draft. The existing already-submitted/no-replay and serial ordering cases remain.

The RED fixture models the existing optional server precondition, including
legacy omission. It therefore exposes a wrong-account target deletion before the
repair; it does not make every request fail merely because a new field is absent.

The first implementation run matched three test files (121 cases) and exposed
two localized-error assertions: the shared readout consumes an error `code`,
not its message. That was corrected. The next 151-case run passed, and TypeScript
then identified an unused extra `updatedAt` field in the new orphan fixture.
The field was removed; the final 151-case run and full TypeScript both passed.
The failed iteration logs are retained explicitly as earlier results.

The browser run uses the unchanged orphan-clear cases in
`e2e/portfolio-targets.spec.ts`: Portfolio and Settings, English and Chinese,
1440×900 desktop, 820×1180 tablet and 390×844 phone. Each case creates synthetic
fixture state, closes or deletes the last holding, observes its retained target,
clears it through the UI and real fixture route, checks canonical readback, reloads,
and verifies the holdings are unchanged by target removal. It uses one worker,
`CI=1`, a fresh owned server and `--retries=0`.

All twelve new fixture crops were visually inspected. Target values, bands and
Clear controls are readable; Chinese phone text and the action wrap within the
available width. The browser assertions check no document overflow and the
44-pixel phone action floor. No personal browser captures are included.

Local runtime was actual Node `v26.5.0` and npm `11.17.0`. Hosted CI is a separate
gate. Expected output includes Vite's CJS deprecation, deliberate driver-fault
test stderr, and the fixture server's in-memory analytics fallback.

## Evidence and preservation

`validation.json` records source hashes, commands, exit codes, raw and gzip log
hashes, screenshot hashes/dimensions and preserved Git blobs. The source base is
the held parent `58a3400c`; the containing commit and subsequent independent
review bind these postimages to the final candidate.

The images and browser tests establish a single synthetic owner's removal flow.
The mounted unit regressions and existing route tests establish the bounded race
behavior described above. They do not claim a live multi-account browser test,
real-account write acceptance, positive Treasury/price-history availability or
production deployment. Macro #9880's producer custody HOLD and the current
controlled-account mutation grant remain separate open boundaries.
