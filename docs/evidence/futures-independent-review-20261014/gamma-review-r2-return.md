Reviewed HEAD 54bf1bc931832655b7c0ca4de24e26fbab598d11. MANIFEST_SHA256 63630d8563f5d77621e9ba271ddb4346f709a68c2492f6abb7a99df0fe89f8d6. Analysis is from the supplied excerpts only; no tests executed.

**P1: terminal/lib/futuresGexLens.ts:68** — `values.byStrike.get(strike) ?? 0` conflates "strike absent from helper output" with "sum is zero". The `missing` poison at line 63 only triggers on a SELECTED-expiry null cell; strikes whose cells all sit in non-selected expiries never enter `missing`, so `?? 0` silently assigns 0.

Counterexample: lens=ex-zero, sourceSession="2026-10-13", payload.expiries=["2026-10-13","2026-10-16"], payload.strikes=[5000], payload.cells=[{strike:5000, expiry:"2026-10-13", gex:100}]. selected=["2026-10-16"]; covered={5000}; missing={}. matrixLensByStrike yields no entry for 5000; `values.byStrike.get(5000) ?? 0` → 0; byStrike.set(5000, 0).

Wrong result: strike 5000 (no data in the ex-zero view) is published as gammaNetMn=0, not null. call_wall / put_wall / gamma_flip landmarks can land on it and treat 0 as a known, nonzero-suppressed exposure instead of unavailable.

Fix: `const value = !covered.has(strike) || missing.has(strike) ? null : (values.byStrike.has(strike) ? values.byStrike.get(strike) : null);`.

**P1: terminal/lib/futuresGexFrame.ts:119** — `if (rows.every(row => row.gammaNetMn === null))` only fires when every row is null. Paired with the lens defect, an ex-zero lens over a payload whose strikes carry cells only in sourceSession will publish an "ok" frame with all-zero exposure; `stale_exposure` (line 91) only inspects the source asof age and won't catch per-strike lens absence.

Counterexample: as above. rows=[{strike:5000, gammaNetMn:0}]. every(===null) is false. projectFuturesGex runs with the zero, and the frame is delivered as ok with empty exposure and a POC equal to whichever cell happens to round lowest.

Wrong result: an unavailable condition is silently emitted as ok with zero exposure. Observed POC and named levels derived from this frame are meaningless.

Fix: harden the gate, e.g. `if (rows.every(row => row.gammaNetMn === null || row.gammaNetMn === 0)) return unavailable("empty_source");` — but the root cause is the lens `?? 0`; fixing that makes the existing check sufficient.

**P2: terminal/components/futures/useFuturesWorkspace.ts:21+45** — initial `nextPollMs` is 15000 but line 63 calls `void load()` immediately, so the actual timeline is request@0s → next@15s → 5s. The line 73 staleness gate uses `now > active.data.freshUntilMs`; if the publisher's fresh window is ≈5s, the 1s interval (line 71) flips the chart to `unavailable("stale_source")` at t≈5s and holds it there until t=15s when the next poll lands.

Counterexample: dataTimeMs=0, decisionTime=0, freshUntilMs=5000. At t=5500, `now` (1s tick) crosses freshUntilMs; hook returns unavailable/stale_source. Remains so until t=15000 when the next load() resolves and the data state is reset.

Wrong result: a chart the upstream source still considers live is rendered as unavailable for ~10s of every 15s during the first poll cycle, repeating on every remount.

Fix: align the initial gap with the live cadence — drop the initial 15000 to 5000, or initialize `nextPollMs` from `data.basis === "historical"` only after the first response.
