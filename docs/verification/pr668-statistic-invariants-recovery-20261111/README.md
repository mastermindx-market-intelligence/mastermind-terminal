# PR #668: reject impossible supplied raw-statistic relationships

The parent accepted an out-of-range median, reversed extrema, and nonzero reported performance when every available entered-plan return was zero. These are necessary-contract failures that can be corrected without approximating the native arithmetic.

## Two bounded guards

The normalizer now requires supplied rounded minimum <= median <= maximum. For an odd finite population the median is a member. For an even finite result, floating-point addition followed by division by two keeps the midpoint between the central inputs; monotone four-decimal rounding preserves its order against the rounded extrema. Underflow and signed zero do not break this inequality. A nonfinite native midpoint is already outside the existing finite-statistic admission domain.

For a nonempty available population containing only numerical zero, all four supplied statistics must be numerically zero. Both signs of zero are accepted and preserved. The guard does not apply vacuously to empty/all-unavailable populations, which retain null statistics, or to tiny nonzero values that legitimately round to zero. Partial coverage is preserved.

The mean is deliberately excluded from the extrema inequality. Three identical finite inputs15000000000000004 have a valid native mean15000000000000006 after fsum/division rounding; the negative counterpart also overshoots its extremum. Both remain admitted. No tolerance, approximate recomputation or new magnitude/precision bound is added.

## Verification

All56 prior tests remain byte-identical as the original prefix. Seven new negative cases demonstrate three impossible orderings and four invented all-zero summaries; eight positive controls preserve signed zero, partial availability, subnormals, underflow, rounded ties, opposite-sign extreme values and both valid mean-overshoot cases. Parent baseline is64passing/7expectedfailures; the repair passes71/71. Strict scoped TypeScript, scoped ESLint and whitespace checks pass.

The eight positive vectors are extracted from the actual Terminal test AST with a literal-only reader and checked against the four native arithmetic expressions using Python standard libraries. Exact values and signs of zero agree. No Macro module, producer route, ledger, request or browser is executed. These controls establish their particular native results, not unrestricted arithmetic equivalence. The two actual unchanged empty/partial browser-literal payloads also remain admitted with inputs/source/summary/rows preserved.

The native contract remains bound to Macro#7399 head41ca935449b6668c60e0b5ba2a0863703e072d8c, app/hub.py blobea33b1221f04b24a8b7571d899fca79985371d52. The original Macro-only R5/R6 worker refusal6684580395 and grant6684228755 remain fenced; these Terminal necessary guards do not replay or close that work.

## Remaining scope

General mean arithmetic, exact rounded extrema binding to row values, dated-NO_ENTRY presentation, full PacketA, private producer and release acceptance remain open. A finite forged mean can still survive on a nonzero population; this patch does not claim otherwise. UI, transport, source-date rules and benchmark authority are unchanged. Protected #1460 has now merged; broader current-master integration remains a distinct source phase. Draft/BUILT_NOT_PROVEN and private endpoint, producer/deploy-safe, screen-refinement and release holds remain. No feature enablement, migration, deployment, approval or merge occurs.
