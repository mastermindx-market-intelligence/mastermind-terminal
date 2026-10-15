# Compare focus return across responsive breakpoints

Opening Compare, changing between desktop and phone widths, and pressing Escape previously left keyboard focus on BODY when the original entry became hidden. The original desktop-to-phone and phone-to-desktop cases both failed.

The dialog now preserves a usable original opener or finds its visible existing successor within the same Terminal app. Disabled, inert, ARIA-hidden and hidden controls are excluded; it never searches another app. No timer, owner mutation or comparison configuration change is involved.

Validation on the parent correction:
- Six English/Chinese desktop/tablet/mobile browser cases passed, including unchanged-viewport exact-opener return, responsive successor return, a foreign-app decoy, exact saved owners/configuration and zero owner/auth writes or model commands.
- Three real pinned Firefox151 English native text200 cases passed: textZoom2/fullZoom1 with doubled computed input font and real viewport transitions. These prove focus target and data invariants; they do not certify the whole page or Chinese text enlargement.
- Six permanent composed keyboard cases passed with the new resize regression (workers1/retries0); whole TypeScript passed, the browser test has no lint findings, and the component's six errors/two warnings are inherited with zero added.
- Four representative PNGs were viewed and copied unchanged here. Screenshots are local fixture evidence, not production acceptance.

The initial candidate's two mobile failures were a strict locator matching the deliberate foreign-app decoy; both passed after scoping only that harness locator. Original failures remain retained externally. The original Fabric proposal was consumed but NOT_ACCEPTED because its document-wide fallback violated app isolation; the parent correction and actual browser results above are accepted. No independent-review claim.

External originals: fable-commission-20261013/compare-controls-native-20261015/modal-boundary/viewport-return under the IW2 evidence directory. The source-dependent batch1 capture is refreshed separately before publication; other valid evidence is reused.
