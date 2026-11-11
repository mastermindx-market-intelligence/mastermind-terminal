`intervalNs` is bounded only by `> 0n`, so long intervals × large resting sizes are reachable.

Falsifying input: A sample at price P with `level.size=0xffffffff` alive for `duration=4e9` ns covering the column. Per-sample product ≈ 1.7e19 contract-ns; `Number(...)` rounds and dividing by `Number(col.covered)` produces an off-by-large-factor mean.

Wrong result: Imprecise `bidMean`/`askMean` for high-volume cells in long-interval windows.

Minimal fix: Compute the mean in BigInt and convert the quotient, or cap the per-cell accumulator at a validated safe range and refuse inputs that would overflow `Number.MAX_SAFE_INTEGER`.

No other blocking defects in the listed scope (volume conservation including unknown, source availability/replay cutoff, grouped-row diagonal imbalances, selected-window CVD, missing depth vs zero, depth-price coverage and averaging). Volume conservation: `observedVolume` and per-bar `total` correctly sum `buy + sell + unknown` per cell via `plusSafe`. Availability cutoff: `available > decision || event > decision` correctly excludes late knowledge; `event < end && end <= decision` makes the `event > decision` clause redundant but harmless. Diagonal imbalance direction (buy at P vs lower sell, sell at P vs upper buy) is correct; ascending-price POC tie-break matches the comment. CVD: per-bar `delta` uses this bar's `unknown`, cumulative `cvd` uses cumulative `unknown` — consistent with contract. Missing depth vs zero: `col.covered === 0n` returns `null` means; zero size during covered time correctly returns `0` mean. Depth-price coverage: `coveredLowTick <= lo && coveredHighTick >= hi` is the correct direction; levels outside `[lo, hi]` are filtered before accumulation.
