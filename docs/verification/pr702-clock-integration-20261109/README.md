# PR 702 — Isolated chart clock and current touch proof

## Current behavior

The candidate integrates the original clock PR with the actual qualified dependency d03e7587711f1182531f25459fa1f60c679bac10 and protected master 156c4b3ecfa27b9137c64068b3ed969e07efbe49. Publication uses all three real parents. The original nine affected paths are archived from both parents, and the protected supplement is retained.

The current chart footer already uses a DOM ref to update the clock without React footer rerenders. This integration preserves that owner. It pauses the single timer while the document is hidden, paints immediately when visibility returns, and cleans up both interval and visibility listener. Each paint obtains one Date and uses it for both clock text and UTC offset. The old separate Clock component is preserved in the original parent archive and removed from the active source; no parallel timer owner is added.

## Discriminating unit proof

The original five clock contracts were first run against the integrated dependency. Two passed and three actually failed: hidden pause, listener cleanup and hidden mount. The bounded repair then passed all five plus an additional coherent-time/offset contract, alongside all 29 marker helper tests: 35 passes.

The coherence test advances the fake clock by one millisecond inside getSeconds and makes the offset depend on the Date receiver. It asserts the displayed time/offset pair, not constructor counts. A separate red run for this sixth case is not claimed.

## Current physical-touch observation

The stalled-touch case previously selected geometry before it installed the stall machinery. The harness now installs the existing stall and a passive, one-shot trusted touch-down observer before its final settled-marker read, then immediately sends the real touchscreen tap.

The observer records the marker rectangles and actual contact coordinates. The existing product hit-test function and unchanged ten-pixel tap slack identify the marker under that actual press. The case requires that marker to match the intended selection, the exact tooltip to appear, and the existing tap-away dismissal to remain correct. There is no forced tap, extra retry, broadened hit target, longer timeout or synthetic replacement for this physical contact.

The complete selected browser set passed with 13 successes and five existing desktop touch skips, zero failures, flaky cases or retries, in 98.35 seconds. It includes the current desktop/tablet clock checks, the phone's hidden-clock/compact-control contract, ordinary and stalled physical taps, geometry-change selection and pan cancellation. Some existing geometry/pan cases use synthetic pointer events; they are not all described as physical input. The phone clock case returns before the larger-screen overflow checks, so those checks are not claimed for phone.

The first two browser preparations stopped before execution because of selector/listing mistakes. A malformed driver also stopped at Python syntax parsing. Those preparations are preserved and not counted as browser failures or passes. Only the exact final 18-case selection executed.

## Source and evidence validation

- All 35 clock/marker unit tests passed.
- Full TypeScript passed in 44.98 seconds.
- The footer retains its dependency's six existing lint diagnostics; the marker browser spec and clock unit test are clean. No new diagnostic or disabled rule is introduced.
- All 1,939 observed source entries stayed stable.
- The original four-file clock packet was restored byte-for-byte after fresh capture. Its historical EVIDENCE declaration is not restamped. The actual new desktop/tablet/phone images live separately with the successful current browser record.
- The existing full CI evidence owner completed in 380.8 seconds inside its unchanged 54-minute owner / 55-minute workflow budget. PL6/VI children returned successfully and the 50-case current composition selected. The applicable Options-axis packet remained unchanged.
- A returned VI server left a stale Next lock. Its recorded process, listener, open-file and same-user working-directory absence were verified, with immediate file-identity checks around one unlink. No server was killed, no capture repeated and no process-group absence inferred from the port.
- All 18 final selected evidence consumers passed against the actual current composition.

The local diagnostic owner identifier is not a GitHub Actions run. GitHub required checks, current merge-tree behavior and repository controls still govern merging. Production, SQL, producer and release boundaries remain binding.

## Publication

Publish the exact qualified tree to the original branch using an exact-head compare-and-swap. The old #688 dependency is present in the protected ancestry. Current source and actual clock/touch proof resolve this PR's old integration/proof hold, subject to fresh controls; no unrelated hold is cleared.

Raw diagnostic logs excluded from publication are individually inventoried by hash and size. Historical packets, current reports, images and descriptor-bound artifacts are preserved.
