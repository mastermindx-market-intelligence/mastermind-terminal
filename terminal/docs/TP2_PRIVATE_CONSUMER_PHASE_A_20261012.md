# Terminal TP-2 private off-exchange decoder — Phase A

**Date:** October 12, 2026 (UTC)
**Role:** Terminal issue [#655](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/655), implementing an independent *read-only/private* consumer contract under Massive TP parent [Macro #7367](https://github.com/mastermindx-market-intelligence/macro/issues/7367).
**Status:** **BUILT_NOT_PROVEN / not released**. No source subscription, R2 fetch/publisher, entitlement, API route, client-side import, browser product, chart marker, trade signal, or deployment.

## Pins and source ownership

- Terminal current master at source acquisition: `e0c405a09b6897df3b5e4a2f22344f3560b800a4`. Terminal [TP1/R0 lossless private decoder PR #915](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/915) **already merged** as `c923cc46d179dd92cb6e3bd6d10c03c9bac17c76`. Its `terminal/lib/tp1PrivateEvidence.ts` and `terminal/lib/tp1Nanoseconds.ts` retain custody of original TP1/R0 private source v0 bytes and nano clocks. Do not replace either reader.
- Macro [TP-2 source-free draft PR #8859](https://github.com/mastermindx-market-intelligence/macro/pull/8859), exact observed head `4feec92aa350f4300e0cb60b63aabbafb5c87801`, owns `engine/tp2_private_ruler_view.py` and its **derived-view** canonical serializer/readback. This is **not** a live source or production R2 store.
- Macro [TP-B research draft #8784](https://github.com/mastermindx-market-intelligence/macro/pull/8784) owns original historical ruler source; TP1 [#8660](https://github.com/mastermindx-market-intelligence/macro/pull/8660) owns the single candidate trade/quote feed; Macro R0 [#8659](https://github.com/mastermindx-market-intelligence/macro/pull/8659) merged as `7cb33d3aaac3512bee53d7254a785af38f3bd172`. All source/auth/receipt/correction decisions stay with those owners.
- Protected Mastermind procedure pin: `25c4b7923734392b1013afae179966985819d847`, compatible `mastermind.sol_skillpack.v1/1.0.1/bootstrap_major=1`; protected INDEX blob `339c3d810f8c74ec157a793b143fde9aeb1e4fec`. Same-commit required universal companion procedures read.

## What the new pure private decoder does

`terminal/lib/tp2PrivateEvidence.ts` exports two separate **server-only** readback projections:

- `decodeTp2PrivateArtifact({bytes,expectedSha256,expectedLength,requestedAsOfNs})`: reads the exact, original **derived-view** source schema `darkpool.tp2_private_offexchange_view/v0`. Enforces a 64 KiB maximum, the original expected digest and byte length, Python-compatible sorted-key canonical ASCII JSON (one LF), exact known top/nested allowlists, and no source/authority promotion. Returns `terminal.tp2.private_projection/v0`.
- `decodeTp2R0Sidecar(...)`: reads the separately versioned **observational** `darkpool.tp2_r0_observed_research/v0` with a 24 KiB maximum and identical byte/cutoff validation, without mixing its quote-location proxy ratios into TP1/TP-B measurements. Returns `terminal.tp2.r0_research_projection/v0`. This is not a second R0 original byte decoder or source signer.

Both use the **existing** `parseUnsignedNanoseconds` from `tp1Nanoseconds.ts` to preserve 19-digit Unix nanoseconds as `bigint`, not JS `Number`. A viewer cutoff earlier than the artifact's original `view_asof_ns_decimal` refuses. The original RTH date and available 9:30 a.m. America/New_York clock are checked with DST-aware `Intl`, but the external market-calendar/source owner must still prove actual trading days, early closes and original custody. Source-manifest and generation hashes identify only supplied internal content, **not vendor signatures**.

Any permitted source view remains `sourceAuthenticated=false`, `publicDeliveryAllowed=false`, `productionApproved=false`, `tradingAuthority=false`, with no signal, live block tape, price shelves, signed aggressor flow, or named ATS attribution. The current EOD/weekly FINRA consumer is **unchanged** and separately labeled. Null source and history states remain null, never market-zero or a fabricated record.

Three observational grains stay separate: largest **single print**, largest **same-level 60s cluster**, and qualified **RTH sampled total**. Sample ranks retain `priorN` and **rank in observed comparable history**, never an all-time or trading signal claim. The historical intraday baseline matches **exact RTH minute index** and keeps null z-score/zero-MAD states. TP1's `provisional_trf_any_condition_notional_usd` and TP-B's `measured_rth_trf_notional_usd` are **not added or source-joined**: provisional raw sale eligibility, final-vintage corrections, consolidated denominators and receipt clocks are different. R0 pressure/response remains an **independent descriptive quote-location proxy**, not a validated predictor, native aggressor or order-book absorption label.

No fetch, writer, background process, R2 bucket selection, tenant-authorizer, React page, chart renderer, authenticated service or deployment was created. The `node:crypto` dependency makes the consumer a server-side pure function, not a browser data loader.

## Immutable Macro-generated evidence

Exact fixture bytes are copied unmodified from Macro at the stated source pin, not recreated by hand in the Terminal repo:

| Fixture | Native Macro schema | Length | SHA-256 |
| --- | --- | ---: | --- |
| `terminal/lib/__tests__/fixtures/tp2PrivateView.synthetic.v0.json` | `darkpool.tp2_private_offexchange_view/v0` | **3,394** | `8c1ee4f865566f013d7a5805fccdd11c031223d39c6d8ec6b66968cbdc35f60b` |
| `terminal/lib/__tests__/fixtures/tp2R0Sidecar.synthetic.v0.json` | `darkpool.tp2_r0_observed_research/v0` | **1,541** | `fe03401a908d26230aa6f8426f9dd9318249a0cdd2eac256ed93786a0a48b715` |

The first shows synthetic TP1 provisional TRF notional **$250,000** separate from TP-B observational daily TRF notional **$500,000**, 3 distinct historical-grain rank states, and an exact-minute cumulative share `0.4` with prior N=5. The second contains an R0 observed pressure-balance proxy `0.3333333333333333333333333333` and explicitly false calibration/actor-truth claims. All inputs and their original purported receipts are **constructed synthetic data**, with no licensed real Massive tape, private source credentials or market completeness.

## Verification and next implementation owner

Run from `terminal/` on an isolated source checkout:

```sh
./node_modules/.bin/vitest run lib/__tests__/tp2PrivateEvidence.test.ts lib/__tests__/tp1Nanoseconds.test.ts lib/__tests__/tp1PrivateEvidence.test.ts
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --types node --skipLibCheck lib/tp1Nanoseconds.ts lib/tp2PrivateEvidence.ts lib/__tests__/tp2PrivateEvidence.test.ts
./node_modules/.bin/eslint lib/tp2PrivateEvidence.ts lib/__tests__/tp2PrivateEvidence.test.ts --max-warnings=0
```

At this implementation head, **44 TP-2 tests** and **106 combined TP1/R0/TP-2 tests** passed, strict TypeScript and zero-error ESLint passed. Tests include original Python-byte fixture parity, missing/stale/future states, nanosecond exactness, duplicate JSON keys, original SHA and length mismatch, recomputed-hash tampering, forged live/ATS/trading/publisher claims, timestamp/session mismatches, separate TRF numerators, exact historical ranks and R0 observational-only projection. Sparse test dependency symlink uses an already-installed Node dependency tree; **no packages installed or source paths altered outside the isolated worktree**.

For the successor Terminal #655 owner, the next product work is a **view model/UI and chart-engine overlay** that remains fixture-only until original private TP2 source is admitted. Keep three major surfaces distinct: *Live Off-Exchange (provisional until TP1 audited source)*, *History/Analogs (TP-B observed coverage only)* and *Delayed FINRA ATS context (separate EOD origin and report clock)*. Source absent, stale, corrected, withheld or partial states must be glanceable, with bilingual/dark/light/mobile and replay checks. No actual per-print block marker or shelf can be drawn from a source-free aggregate; each requires original source-owned individual print/shelf provenance.

The major gates remain: CI-policy owner approval for Macro TP1/TP-B/TP2 suites (prior protected YAML attempt explicitly denied), original Quote Hub singleton access/live 99%/95%/2% RTH evidence, original licensed historical LIST-and-budget-before-GET, correction/venue/condition/split/calendar data rights and receipts, and an approved private market-data R2 namespace plus tenant entitlement. **Generic public R2 and the separately credentialed Research Vault are not automatically authorized for TP2.** No Vercel, no merge/deploy/published endpoint from this Phase A. Current Terminal decoder implementation itself may be eligible for review/CI merge independently of live source, but is not a deployed product acceptance receipt.

**Status: BUILT_NOT_PROVEN.**
