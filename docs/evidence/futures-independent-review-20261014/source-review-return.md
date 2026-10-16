```
Mastermind Terminal PR #964 — capture-to-API boundary, source review
HEAD: 5ea5d2851477ba502c46d78af53b36cfe9fa211f
Review type: read-only, no execution, no repo writes, no child workers, no network.
```

## Files reviewed (hash-bound)

| File | SHA256 |
| --- | --- |
| `hub/lib/futuresWorkspaceProjection.js` | `7ca38237f92987a0597ea9d71430e49b1b9574811b535fede9b7a6e192d69d69` |
| `hub/lib/futuresPublication.js` | `5f7b39cce63944086f50097e9102af8e8f34b2b0072565b21b7b1f95758ffe5d` |
| `terminal/lib/futuresSourceJoin.ts` | `bade0e254aa3a868ab331e1157660ab8ce94ba967991052b785ff8eecc09c8c8` |
| `terminal/lib/futuresTransport.ts` | `d8c6fc62054663b18394c65bc349faf0b88b85976247814bede8b5088e10c348` |
| `terminal/lib/futuresSourceRead.ts` | `4508886df3171a1abd869cc98aae4701e78a186eefb072abef54c9da80e3982b` |
| `terminal/app/api/futures/route.ts` | `59ea3b71995fb695faf448b9b0afacdb6295b8267228f0448f086d335014e66e` |
| `terminal/lib/futuresRequest.ts` | `2c2d4c9f5f6c2c8c4cea70994e0e4db9fc9cfd49eeabfe0b05fe7b34c75cd4f1` |

## What I did not execute

- No shell, `node`, `npm`, `pnpm`, `git`, or `gh`.
- No `AggregateFootprint` / `buildLiquidityTiles` body inspection (the `futuresMbo.js` referenced at `futuresWorkspaceProjection.js:8` was not in the supplied snapshot); defect derivations that depend on its return-shape are explicitly marked "logical" below.
- No `lib/futuresGexProjection.ts` / `lib/futuresGexFrame.ts` / `lib/futuresGexLevels.ts` body inspection — relied on the named exports (`validClockMs`, `isRecord`, `finiteNumber`, `isFuturesGexContract`, `FUTURES_GEX_UNIT`, `buildFuturesGexFrame`).
- No hub or terminal start, no API call, no rateLimit internals, no fixtures.
- Excluded the independently repaired Options header layout per mission.

## Findings (5 of max 8)

### F1 — P1 defect — freshness window can predate its own publication stamp
**Location:** `hub/lib/futuresWorkspaceProjection.js:28-29`; downstream symmetry at `terminal/lib/futuresTransport.ts:101,104`.

The producer check enforces `publishedAtMs >= sourceAsOfMs && freshUntilMs >= sourceAsOfMs && (freshUntilMs - sourceAsOfMs) <= {15000 | 900000}`. **It never requires `freshUntilMs >= publishedAtMs`.** The parser at `parseFuturesPublishedView:101,104` only forbids `freshUntilMs < sourceAsOfMs`; nothing forbids it from being earlier than `publishedAtMs`.

**Counterexample:** `publication = { basis: 'historical', sourceAsOfMs: 100, publishedAtMs: 200, freshUntilMs: 150 }` — passes both layers. `freshUntilMs` is 50 ms *before* `publishedAtMs`.

**Logical failure:** any consumer that orders or windows by `freshUntilMs` while prioritizing `publishedAtMs` computes a fresh-window whose end precedes its own start. This is a producer defect, not malformed-data — the incoherence originates in this same code.

**Minimal repair:** add `&& p.freshUntilMs >= p.publishedAtMs` to the producer check at line 28; mirror at `parseFuturesPublishedView` line 104: `raw.freshUntilMs < raw.sourceAsOfMs || raw.freshUntilMs < raw.publishedAtMs || …`.

### F2 — P1 defect — workspace projected against an already-expired definition
**Location:** `hub/lib/futuresWorkspaceProjection.js:30-31`.

The check enforces `windowStartMs >= validFromNs && windowStartMs >= definitionAvailableAtNs && validFromNs < validUntilNs`, but **never `windowStartMs < validUntilNs`**.

**Counterexample:** `b = { validFromNs: '1700000000000000000', validUntilNs: '1700000001000000000', … }`, `capture.windowStartMs = 1700000002000` (20 ms past expiry). All line 30–31 conditions hold. The loop continues, dispatches `aggregateFootprint`/`buildLiquidityTiles`, may return a `partial` per F3, and the projection publishes a view whose `startNs` is post-expiry. The transport's per-frame guard at `parseFuturesPublishedView:125` (`BigInt(b.endNs) > BigInt(definition.validUntilNs)`) eventually fails — but only after work, bytes, and an envelope have been emitted. The admission boundary is at the head, not the tail.

**Logical failure:** producer contradicts its own definition-binding contract; expiry is the wallet/session boundary and should fail closed at admission, not after projection.

**Minimal repair:** at line 30 add `&& nanos(capture.windowStartMs) < BigInt(b.validUntilNs)`.

### F3 — P1 defect — asymmetric availability predicate for footprint vs depth
**Location:** `hub/lib/futuresWorkspaceProjection.js:53`.

`check(footprint.status !== 'unavailable' && depth.status === 'ok', 'projection_unavailable')`. Footprint is admitted on **any** non-`'unavailable'` value (which silently accepts `'partial'`, `'gap'`, `'unknown'`, and any future statuses `futuresMbo` may add), while depth must be exactly `'ok'`. The same `capture.tradeCoverage` accepted earlier accepts `'complete' | 'partial' | 'gap'`; the producer does not bind footprint-status to `coverage`.

**Counterexample (logical, since `futuresMbo.js` body not in snapshot):** if `aggregateFootprint` returns `{ status: 'partial', bars: […] }`, the producer publishes partial bars under `coverage = 'partial'`. The transport's gex-status gate at `parseFuturesPublishedView:160` runs against `f.gex`, not the footprint bar list — so the consumer has no machine-visible flag that the footprint was degraded. `parseFuturesPublishedView:143` then promotes `buyImbalance`/`sellImbalance` based on `tradeCoverage === 'complete'` only — which is correct — but a `partial` coverage with `buyImbalance: true` upstream is silently dropped without surfacing that this happened. Depth, by contrast, is fail-closed.

**Logical failure:** the producer's fail-closed contract is asymmetric across the two aggregation units. Either pin footprint to the same closed set as `coverage` and bind them, or document the asymmetry. Today the asymmetry is silent.

**Minimal repair:** replace `'projection_unavailable'` predicate with `['complete','partial','gap'].includes(footprint.status) && footprint.status === coverage && depth.status === 'ok'`.

### F4 — P2 defect — per-frame `Number(f.endMs)` cast without prior validation
**Location:** `terminal/lib/futuresSourceJoin.ts:73`.

The selected view is gated by `validClockMs(selected.cutoffMs)` and `Array.isArray(selected.frames)`, but the per-frame `f.endMs` is **never** validated before being cast (`Number(f.endMs)`) and passed to `joinGamma` as the `endMs` parameter, which becomes `policy.decisionTimeMs` (line 42) and feeds every comparison inside `joinGamma:30-34`. The per-frame `validClockMs(f.endMs)` check exists inside `parseFuturesPublishedView:121` — but **after** `selected.frames.map(...)` has already dispatched through `joinGamma` (a pure function with internal try/catch).

**Counterexample:** `selected.frames = [{ endMs: 'not-a-number', bar: {...}, depth: null }]`. `Number(f.endMs) === NaN`. `joinGamma` accepts, stamps `policy.decisionTimeMs = NaN`. Inner comparisons against `BigInt(definition.validFromNs)` etc. yield `false` for `>`/`<`, ultimately surfacing as `source_unavailable`. The `null`/`missing` semantic is dropped; downstream traceability of *which* field tripped is lost inside the catch.

**Logical failure:** the projection defines `Number(bar.endNs / 1e6)` precisely at `futuresWorkspaceProjection.js:60`; transport re-validates the same field; `joinFuturesSource` could and should validate the same field before `.map(...)` so a per-frame defect short-circuits at the boundary.

**Minimal repair:** filter `selected.frames` for `validClockMs(f.endMs)` before `.map(...)`; drop frames that fail and proceed with the remaining eligible frames (or refuse with `source_invalid` if all frames fail).

### F5 — P2 scope observation — capture capacity is per-channel, not summed
**Location:** `hub/lib/futuresWorkspaceProjection.js:33`.

`capture.trades.length <= 100000 && capture.depthSamples.length <= 100000` admits **both** channels saturated simultaneously (200 000 records combined). The downstream cell/level budgets (`publication_cell_capacity`, `frame_capacity`, `gamma_frame_capacity`, `payload_capacity`) constrain the worst-case output, so this is **not a correctness defect** — but the input admission can be made consistent either way. Marking as scope/capacity, not defect.

**Minimal repair (optional):** choose one of (a) replace with `capture.trades.length + capture.depthSamples.length <= 200000` if the intent is a single combined input budget; (b) document explicitly that input and output budgets are independent.

## Not flagged (audit confidence: high)

- **Definition/conservation quorum.** All four conservation identities (`total === buy+sell+unknown`, `deltaKnown === buy−sell`, `cvdKnown` cumulative, cells re-sum to bar totals) are enforced in `parseFuturesPublishedView:128-145`. Per-bar/cell `<= 2048` and totals `<= 40000` / `<= 80000` are checked post-increment, fail-closed.
- **Definition binding at admission.** `BigInt(b.startNs) >= previousEnd && BigInt(b.startNs) >= BigInt(definition.validFromNs) && BigInt(b.endNs) <= BigInt(definition.validUntilNs)` at transport `123-127` is correct on a per-frame basis; the projection-side defect is F2, not this gate.
- **File/HTTP lifecycle.** `O_NOFOLLOW | O_NONBLOCK` + pre-stat size bound + post-stat (size, mtimeMs) re-check + envelope/payload SHA-256 + `x-futures-source-sha256` header at terminal line 40 cover FIFO/TOCTOU/growth up to `MAX_FILE_BYTES + 1`. `readFuturesJson` declares-then-streams bytes with hard cap; declared-vs-streams are independent so a lying `content-length` cannot bypass.
- **Quota cell/level/gamma/payload budgets** are post-increment (`publication_cell_capacity`, `gamma_capacity`, `payload_capacity`) — no TOCTOU slip.
- **Replay selection** at `joinFuturesSource:63-68` correctly rejects ambiguous ties (`eligible[1].cutoffMs === selected.cutoffMs`) and re-uses `raw.freshUntilMs` only when `request.cutoffMs === null`.
- **Distribution grant.** Two-layer check (`hub:37`, `join:57`) for `audience === 'subscriber_display'` + `reference(distributionEvidenceRef)`. The route feature authority (`hasLiveOptions`) is layered ahead of source read; no `FLOW_FIXTURE`/`NODE_ENV`/cookie exemption is honored. Hash binding is byte-level only — the comment in `futuresPublication.js:39-41` and the comment in `futuresSourceJoin.ts:39-40` correctly defer rights/license to the trusted publisher (this same code under review as the upstream). No defect introduced.
- **Request admission.** `parseFuturesRequest` enforces a closed key set + cardinality=1 per key; `rateLimit` is consulted before any entitlement; an authority exception fails closed to `access_required` (403). `HUB_PORT` is the only env var, regex-validated, range-checked (`1-65535`), host hardcoded to `127.0.0.1`.
- **Per-frame depth validation.** When `coverage === 'gap'`, all `bidMean`/`askMean` must be `null`; otherwise finite `>= 0`. Coverage derivation is `coverageFraction ∈ {0,1, else}` mapped to `gap/full/partial`. NaN `coverageFraction` is rejected at the `!finiteNumber` gate.

## Finalization note

Hash binding is the byte witness; rights/license/title are the trusted publisher's decisions (this PR's projection+publication source under review). The defects above are correctness defects in this same source, not publisher-dishonesty or malformed-data acceptance. Publication remains INACTIVE; this is source review, not deployment or live-data approval.
