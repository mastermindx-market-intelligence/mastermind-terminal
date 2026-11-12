# Large Trades: final local chart and CI-repair verification

This bundle records the corrected source at combined commit c8abc66e771442ad9cd2ac9c7c0c73c1ba0aa94d. The containing evidence commit adds these files without changing the bound runtime or browser tests.

## What changed

The MM renderer now clears each pane canvas before applying its configured background. A transparent fill had retained the previous bitmap, leaving the initial 0..1 axis and old geometry visible over priced data. The new regression constructs two separate real Canvas2D charts with different paint histories and compares their complete final PNG bytes. It failed at that equality assertion before the product fix; desktop, tablet, and phone passed after the fix.

Native chart export also retains the earlier pending-frame flush. Its range-change and historical-correction cases now save actual PNGs and proof JSON by file path so the CI artifact uploader can retain them.

Two drawing checks now measure the current connected SVG group and painted line in one DOM task. The indicator-pane test validates a real main-axis rescale after each of six wheel events and keeps its original exact position tolerance. A03 keeps its original mobile scope, size assertions, and readiness budget; its recorded DOM geometry excludes stroke inflation and does not claim viewport intersection. These changes address invalid measurements without adding retries, sleeps, looser tolerances, or new skips.

## Verification

- Typecheck passed.
- The 82 related unit files passed: 1,438 tests.
- The responsive selection collected 93 instances: 66 passed, 27 inapplicable viewport instances skipped, zero retries.
- The later accepted master delta added only three unit-test paths. All 58 bound runtime and browser-test files remained byte-identical. Typecheck and those three files passed again: 94 tests.
- The corrected indicator drawing remained at y=624.5 while six acknowledged main-axis range expansions disabled autoscale.
- The corrected A03 captured a unique connected painted line with a 6.728 by 38.678 CSS-pixel DOM rectangle.
- All three transparent-pane cases produced exactly equal repainted and fresh PNG bytes.
- Both pending-export cases passed at all three viewport sizes, with immediate export different from the prior image and equal to the settled reference.

The source review, actual file hashes, commands, timestamps, and source bindings are in verification.json and the copied execution receipts. The earlier required CI run 39027647854 failed on the drawing measurement and is not represented as green. New-head CI and source acceptance must be assessed separately.

## Visual evidence and limits

The four MM product captures in visuals/ were inspected after the clear. The old 0..1 axis labels are absent; quantity markers, accounting fields, and export provenance remain visible. The tablet inspector explicitly distinguishes 1,301 shares, three trade reports, and unavailable distinct-order count. The phone PNG preserves the gross-report basis, absent corrections, SIP reporting clock, and synthetic-fixture disclosure.

These UI captures and browser comparisons use deterministic fixtures. They are not evidence of a live feed, authentic native TP-1 capture, CME entitlement, production deployment, absorption efficacy, or out-of-sample predictive performance.

The earlier real-IEX regression remains separately retained in ../large-trades-accepted-followup/real-iex-regression.json. Its engine, types, and accounting source hashes remain unchanged. It covers 1,685 executed reports and 141,057 shares from a bounded historical archive prefix, with no qualified absorption result and no estimable out-of-sample effect.

Canonical production access, native feed custody/admission, the protected Macro CI enrollment refusal, and the exact MNQ account quote remain separately tracked gates. No credential, feed, licensing, or CI-policy boundary was changed by this patch.
