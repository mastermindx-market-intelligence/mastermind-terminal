# J6 threshold-selector readability

At native 200% text enlargement, the selected threshold was clipped by its fixed 220px control. The selector now uses its intrinsic width with the existing 220px minimum and responsive full-width rule. Other inputs and comparison behavior are unchanged.

The manifest binds original screenshots to the exact source and distinguishes the original failure, the old-width negative control, and accepted candidate captures. Native Firefox text enlargement doubles text without changing the viewport, device scale, or CSS zoom. Standard responsive checks cover English and Chinese; Chinese native Firefox text rendering remains unaccepted because of the independently retained runtime issue.

Verification: original failing geometry assertion then identical candidate pass; old-width negative control; three native text200 English cases; six existing EN/ZH desktop/tablet/mobile comparison cases; 31 comparison unit tests; TypeScript and focused lint pass. Saved A remains exact and comparisons cause no implicit writes. This is local fixture evidence, not live or release acceptance.

Original proof scripts and complete failure/success logs are retained by the IW2 root in `fable-commission-20261013/j6-selector-readability`. Existing crop manifests, recipes, and before images are reused unchanged. Release holds remain in force.
