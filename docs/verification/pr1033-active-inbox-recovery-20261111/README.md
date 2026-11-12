# PR #1033: recover recurring-inbox evidence without activating subscriptions

The original mixed B-F11-7 packet contains eight inbox views and four subscription-control views. The current protected product deliberately does not mount those subscription controls. A partial `CAPTURE_ONLY` run cannot qualify that old global lock. This repair names a complete, current eight-view inbox packet and retains every historical mixed-packet byte.

## Source and behavior

The original 34 contribution postimages, including all 25 explicit-language proof files, are unchanged. The composition uses protected `74c007125129090cc762f2bc4b1b152123326444`. Its advance from the accepted test snapshot `ffcc39bcdf89cb19b08444b8bb64cadbc1a3a5ec` has zero intersection with the original contribution and repair paths. The existing language contract, owner routing, explicit nullable Chinese coverage, English original text, and old-client compatibility remain intact.

The existing capture entrypoint now requires `--active-inbox` and captures list/empty states in English/Chinese at 1440px and 390px. It uses the incumbent supervised legacy server owner, rejects subset selection and unexpected fixture writes, checks settled UI and partial language coverage, records actual checkout/source/runtime identity, closes all contexts/browser/server, and validates the complete packet before promotion. A pure validator fully decodes each PNG, binds 15 source inputs, and rejects incomplete, stale, corrupt or symlinked packets. It never launches a process when imported by unit tests.

The unit workflow runs this explicit eight-minute capture after browser preparation and before the longer shared exporter, retaining both the canonical packet and temporary diagnostics in the existing artifact. The shared exporter, its planner and PR-owned drift gate remain unchanged. The historical 12-image packet is byte-locked; the unit consumer requires a separate genuine current eight-image packet.

## Executed qualification

- 97 original inbox/language/owner behavior tests passed.
- 34 pure validator tests passed, including deliberately corrupt PNGs and wrong hashes, matrix, runtime, lifecycle, writes and filesystem paths. Their small generated images are synthetic test inputs, never browser evidence.
- 198 focused workflow/routing tests passed.
- Exact-lock dependency install, route type generation, full TypeScript check and affected ESLint passed. The complete candidate added-lines plain-language guard scanned 496 source files with zero blocking or waived findings; five pre-existing findings remain disclosed.
- The current packet consumer has five passing tests and one expected failure because the new real capture does not exist locally yet. This requirement remains enforced.

No local browser run is claimed. The session's local Chromium launch was denied before any browser test; that action is not retried. Natural hosted CI on this source must produce the actual eight views, after which its artifact will be qualified and committed on this original branch.

## Remaining boundary

Hosted capture, artifact readback/import and exact-head required CI remain outstanding at this source commit. `producerActivation=false`, `productionAcceptance=false`, the #662 hold and existing nullable rollout constraints remain in force. This change does not approve, enroll, merge, deploy or activate subscriptions.
