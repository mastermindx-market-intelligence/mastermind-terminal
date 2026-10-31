# Toolbar first reveal after a phone mount

At299f75bb7, a page opened at phone width measured its hidden toolbar as zero-sized controls and reused those invalid metrics after widening to820px. More remained hidden and Compare could not return to a reachable tablet entry. Actual Firefox151 text-only200 phone390->820 failed; desktop1440->820 was a passing control.

The hook now invalidates metrics whenever its root has no layout boxes or positive clientWidth, and measures actual controls on first visible resize. Visible resize still uses valid cached metrics. Full/overflow/compact arithmetic, fonts-ready handling and observer cleanup are unchanged. No timer, viewport heuristic, CSS, owner or API changes.

Validation:
- Four mounted lifecycle tests PASS: initialhidden->visible, hide/textchange/reveal, all three visible width modes, and unmount/late-font cleanup. The first two failed against the original implementation.
- The original nativeEN200 phone->tablet browser case now PASS, including exact saved owners/configuration, zero owner/auth writes/modelcommands, Escape to More, keyboard reentry and Escape back to More. Both actual pixels were viewed. RealFirefox151 textZoom2/fullZoom1/fontdouble; no Chinese text200 or whole-page claim.
- Six composed English/Chinese desktop/tablet/mobile keyboard cases PASS (four original candidate D/T plus two corrected mobile), workers1/retries0, with the phone->tablet transition permanently covered. Initialtwo mobile failures after a second tablet->desktop transition expected the desktop Compare button despite the still-visible original More opener. Actual screenshot showed correct More focus; the oracle now preserves that usable original opener as required.
- Whole TypeScript and focused lint PASS with zero findings; diff whitespace clean.

The same original Fabric proposal was consumed but NOT_ACCEPTED: it used full>0 rather than actual layout visibility (computed margins/gaps can remain nonzero while hidden), and its zero-metric mode description was incorrect. Root implementation and tests above are accepted; no independent-review claim.

Earlier static capture matrices are reused without restamping: their layout-input bytes are unchanged; each fixed-viewport capture creates a new context, with no hidden-to-visible transition. Fresh viewed screenshots here cover the newly repaired transition. Earlier batch1 at source823a4d169 remains its own rendered evidence. External originals are in IW2 fable-commission-20261013/compare-controls-native-20261015/modal-boundary/viewport-return/tablet-successor.
