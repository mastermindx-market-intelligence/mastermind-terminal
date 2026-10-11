# Real-data verification evidence

This folder holds a sanitized verification receipt for the transaction-backed large-trades engine. [real-data-verification.json](real-data-verification.json) records a successful run against seven explicitly supplied IEX historical envelopes: **1,685 execution reports and 141,057 shares**. It proves the bounded native-to-engine replay checks described below. Production and chart acceptance remain separate gates in [the implementation and research protocol](../../LARGE_TRADES_ABSORPTION.md).

## Reproduce

Use an authorized checkout with the existing Terminal dependencies installed and the exact local decode artifacts already available. From the repository root:

```sh
node terminal/scripts/verify-large-trades.mjs \
  --input-dir .large-trades-evidence/iex-20261005-v4 \
  --output docs/evidence/large-trades/real-data-verification.json
```

Both arguments are required. The input directory must contain `SPY.json`, `QQQ.json`, `NVDA.json`, `AMD.json`, `INTC.json`, `MU.json`, `ARM.json`, `decode-receipt.json`, and `native-record-provenance.json`. These authorized local artifacts are outside Git. No fixture or feed is selected implicitly, and the verifier performs no download or publication. Missing files produce `INPUT_UNAVAILABLE` and exit 1.

The CLI bundles the **actual** `terminal/lib/largeTrades/engine.ts` and its `types.ts` dependency in memory with the already installed `esbuild`. It verifies that the bundle contains exactly those two source files and pins the independently reviewed engine SHA256:

```text
1936357255e27951d051f2c8fe93349292c7b12a63c66fed8c9246cbfb898483
```

A successful run exits 0 and prints a compact JSON result containing the report count, exact share total, prefix comparison count, engine hash, decode receipt hash, and SHA256 of the newly written evidence receipt. It starts no server or watcher and stops the esbuild service. The receipt is written atomically only after all checks pass. A failed run leaves an existing receipt unchanged; check its recorded source identities and verification time before treating it as current evidence.

The receipt includes the hash of `docs/LARGE_TRADES_ABSORPTION.md`. After changing that protocol or any recorded implementation source, rerun against matching explicit artifacts before attaching the receipt to a new source candidate. The run timestamp and receipt hash change on a rerun; deterministic snapshot and replay digests remain reproducible for unchanged source, settings, and inputs. The receipt cannot contain its own hash; use the CLI result or a local SHA256 tool to obtain it.

## What passed

The receipt records these independent data and consumer checks:

1. Every envelope passes the actual engine's strict schema validator and retains venue-only IEX equity/share provenance, historical mode, partial coverage, archive acquisition availability, no verified tick size, and no qualified response observations.
2. Every envelope and the native provenance sidecar matches the byte count and SHA256 in the decode receipt. The decoder source on disk must match the receipt's decoder source hash. Every execution maps one-to-one to native provenance by normalized identity, symbol, and native message sequence.
3. Exact integer sums of eligible normalized execution quantities reconcile with both native decoder conservation totals and the actual engine. The accounting configuration uses a one-share threshold, no aggregation, and a 1,000-marker limit; every report in this cohort remains visible without marker thinning. The display configuration uses the unchanged engine defaults.
4. At one nanosecond before archive acquisition, all seven envelopes yield zero visible executions, zero shares, and zero markers.
5. The verifier checks **every distinct exchange event timestamp**, an empty prefix, and the declared range end for each symbol. At each cutoff, it compares a snapshot built from the full envelope with one built from the explicit eligible prefix at the same market and knowledge cutoffs. Both accounting and default display settings are checked: **2,966 comparisons** pass. Complete canonical snapshots are compared in memory; the Git receipt stores only their hashes, counts, and aggregate replay digests.
6. Every checked marker retains unavailable absorption and response evidence, null order count, and no predictive claim. `pending` and `unobservable` are abstentions, not evidence of absorption or failed continuation. The original PCAPNG capture timestamps also reconcile exactly to their preserved ticks, resolution, and offset.

The [independent review record](independent-review.json) documents the bounded core and decoder acceptance, including both resolved correction-conservation failures, their synthetic reproductions, and the exact accepted source hashes. It makes no production or out-of-sample efficacy claim.

### Observed cohort

These figures are computed from the real envelopes in the [receipt](real-data-verification.json). Display markers use the recorded default settings, including a 100-share threshold and aggregation. Marker counts are clusters; report counts are source execution messages; neither represents distinct orders.

| Symbol | Execution reports | Executed shares | Unknown-side shares | Default display markers |
| --- | ---: | ---: | ---: | ---: |
| SPY | 302 | 26,121 | 24,486 | 61 |
| QQQ | 111 | 5,356 | 2,254 | 11 |
| NVDA | 408 | 37,667 | 26,940 | 153 |
| AMD | 135 | 6,065 | 5,041 | 41 |
| INTC | 552 | 59,478 | 52,471 | 242 |
| MU | 144 | 4,471 | 4,125 | 20 |
| ARM | 33 | 1,899 | 1,854 | 9 |
| **Total** | **1,685** | **141,057** | **117,171** | **537** |

Native `L` messages contribute 275 reports and 23,886 shares. Their qualified resting-order chains support inferred aggressor sides: 13,034 buy shares and 10,852 sell shares. Native `T` messages contribute 1,410 reports and 117,171 shares; their side stays unknown. Resting-order inference is labeled separately from an exchange-provided aggressor flag. The native formats and interpretation are documented in [the decoder guide](../../IEX_LARGE_TRADES_DECODER.md) and the official [IEX DEEP+ specification](https://www.iex.io/documents/iex-deep-plus-specification).

## Source and clock boundaries

The source is the IEX HIST DEEP+ 1.0 archive for October 5, 2026, acquired on **October 7, 2026 at 06:08:37 UTC**. The bounded decoder examined 2,000,000 packets, 2,321,530 unique native messages, and 312,182,060 decompressed prefix bytes before its packet limit. The final v4 cohort includes the reviewed correction chronology guards and preserves the exact execution rows and native provenance of v3. Its native session and channel identities remain explicit. Its decode receipt SHA256 is:

```text
aa952521d29fa6e4aa05f084ac2b6148becd9ed51e5c5d92b2e04fa1c73162d8
```

The matching decoder source SHA256 is:

```text
9655af3dde9ea225635f6d97be60c6d51a57795c7b7a68bfa91e4d3e18d5a068
```

The evidence distinguishes four clocks:

| Clock | Meaning | Acceptance boundary |
| --- | --- | --- |
| Execution `eventNs` | Native exchange event time | Controls historical market cutoffs |
| IEX-TP send time | Native transport clock | Preserved separately; not a local receipt attestation |
| PCAPNG capture time | Original archived packet capture clock | Reconciled from capture ticks, resolution, and offset |
| Archive acquisition `availableNs` | When this historical acquisition became available | Controls knowledge cutoffs; no original intraday Mastermind receipt claim |

The full archive SHA256 and acquisition receipt SHA256 are retained as recorded provenance. This verifier rehashes the supplied normalized artifacts and source files; it does not reopen or independently rehash the full archive, reach its final gzip checksum, authenticate the source, or validate network checksums. Zero observed sequence gaps applies only to the bounded decoded prefix. No trade breaks occur in this real slice; later breaks and the complete session have not been examined. Correction behavior has a separate deterministic test and review boundary documented in the protocol.

The receipt is constructed from an explicit field whitelist. It excludes raw execution rows, raw native bytes, individual print IDs, packet IPs, source references containing private locations, and private absolute paths. Native raw-message hashes remain in the authorized local provenance sidecar; Git stores only that file's aggregate hash. The local source archive remains in its existing data owner.

## Out-of-sample research

**NOT_ESTIMABLE.** This is one partial session without qualified response quotes or verified tick metadata. No independent held-out sessions, response outcomes, parameter search, fitted parameters, predictive success rate, or effect estimate are available. The default settings are implementation settings, not fitted results. The receipt records zero parameter-search trials and null predictive estimates.

Future research must follow the predeclared chronological holdout, coverage, correction, matched-control, adverse-path, uncertainty, and multiplicity requirements in [the frozen research protocol](../../LARGE_TRADES_ABSORPTION.md). Passing quantity and replay checks does not establish absorption efficacy, trapped positions, performance, or trading profitability.

## Negative-path checks

During implementation, a concurrent decoder source revision was detected by the final before/after hash check, producing `FILES_CHANGED_DURING_VERIFICATION` with exit 1 and no receipt write. Reusing v2 artifacts against the revised decoder then produced `DECODER_HASH_MISMATCH`, including both exact source hashes. An explicitly missing input directory produced `INPUT_UNAVAILABLE`. The final v4 receipt is written only after source and input identities remain stable throughout verification. These are bounded CLI checks; they do not replace the engine and decoder test suites or user-facing release verification.

## IEX attribution

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use.

[IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms)


## Offline CME components

The [CME admission guide](../../CME_LARGE_TRADES_ADMISSION.md) documents the private DBN observation normalizer and separate synthetic decoded-native correction ledger. Their [source verification receipt](cme-source-verification.json) records independent review and repository tests. These components preserve private/fixture-only eligibility and do not expand the public IEX source admission or this real-data cohort.

### Bounded DBN container framing

The [uncompressed DBN v3 container reader](../../CME_DBN_CONTAINER.md) now validates full-file framing and metadata content bindings before composing the unchanged record normalizer. Its [profile](cme-dbn-container-policy.json) and [source verification](cme-dbn-container-verification.json) distinguish structural evidence, author tests, independent synthetic controls and the integrated repository check. The original DBN/native verification above remains the prior record-level baseline. This addition uses no actual CME records, grants no rights and does not expand the IEX cohort, quote coverage, absorption evidence or OOS result.
