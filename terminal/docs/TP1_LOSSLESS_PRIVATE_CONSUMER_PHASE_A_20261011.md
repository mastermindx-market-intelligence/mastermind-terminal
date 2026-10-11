# TP-1 lossless private evidence consumer — Phase A, October 11, 2026

**Status: BUILT_NOT_PROVEN FOR PRODUCTION. Data-only Terminal integration candidate. No UI, service route, source subscription, publisher, bucket selection, entitled consumer, browser delivery or deployment.**

**Owner/custody:** Terminal remains product and delivery owner; Macro TP-1 owns native source trade/quote receipts and signing (Macro [#7368](https://github.com/mastermindx-market-intelligence/macro/issues/7368), [PR #8660](https://github.com/mastermindx-market-intelligence/macro/pull/8660)); Macro R0 owns separate measured pressure/response research ([PR #8659](https://github.com/mastermindx-market-intelligence/macro/pull/8659)). Existing Terminal [#655](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/655) has Phase A schema/fixtures and a separately gated TP-2 consumer. Terminal [PR #895](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/895) handles an **EOD v2 fixture consumer**, not this TP-1 private source. Do not conflate or replace them. This is a path-disjoint Phase-A readiness leaf, with no additional lifecycle, access, retry or watcher.

## Reproduced original byte/consumer precision defect

At TP-1 `a3879855b943e1007e43750b38aedd185d745cb9`, the current Python `engine/tick_plane/private_minute_artifact.py` emits native `start_ns`, `end_ns`, `decision_ns`, `source_complete_through_ns`, `source_watermark_available_ns`, `source_latest_print_available_ns` and `max_quote_age_ns` as ordinary JSON integer values. R0 `f7c31402ab4ffc10c1ebe76aeb7929e2f8ab3526` emits its four named nanosecond clocks the same way. Values near 1.791×10^18 exceed `Number.MAX_SAFE_INTEGER`: native `1791417600000000123` becomes `1791417600000000000` under normal JavaScript `JSON.parse`. That loss can flip point-in-time as-of decisions, materialize false source freshness, or conflate adjacent original receipts. A correct SHA256 of the original Python bytes does **not** protect a browser/Next.js JSON parser from losing clock digits.

## Implemented pure source-exact reader

`terminal/lib/tp1PrivateEvidence.ts` accepts **private service-supplied original bytes** plus an independently stored expected SHA-256 and byte length; it does not fetch, cache, publish or broker those bytes. It verifies the exact content digest first, then lexically lifts only the known current-v0 nanosecond integer tokens to decimal text **before** JSON parse. It independently verifies canonical Python JSON ordering/shape, forbids duplicate field shadowing, rejects noncanonical input, and emits exact Node `BigInt` source clocks. Unsafe JSON integers in unrelated fields and any unexpected top-level/nested fields fail closed.

It uses the frozen existing source schemas `equity.tick_plane.private_minute_artifact/v0` and `equity.pressure_response.private_context_view/v0`; no new source schema, authorizing receipt, or alternative server credential is created. It verifies counters/denominators, share/notional conservation with fixed-point `BigInt`, original session/cutoff relations, source policy digests, and that recovery is a **best-NBBO-size proxy**, not a named actor, trade signal, order-level event, or forecast. Public delivery, rank/trade/alert authority, source authenticity, source coverage and forward labels are forcibly held private/unproven. The decoded record is server-side-only; `node:crypto` prevents safe browser inclusion, and this module has no client imports or route callers.

**Compatibility only:** some callers may prefer a separately versioned future Macro projection that writes nanosecond clocks as canonical decimal strings. That is an original Macro contract change requiring the source owner's approval and new Python/Terminal shared tests. This v0 parser avoids a second data store and does not mutate the accepted Python source artifact/digest. Terminal should never use ordinary `await response.json()` on these original v0 bytes. A future transport may use `arrayBuffer()` with capped exact byte verification **after** the existing server-side cookie, entitlement and source-origin gates; public Flow's fallback `R2_BASE` is expressly forbidden for this private family.

## Reproducible proof at the exact implementation candidate

M2 Studio used an isolated /tmp test directory, with dependencies symlinked *read-only* from the existing Terminal installation; no workspace checkout, producer, daemon or source-host state was modified. At Terminal branch head `a6b3c57313245b46237c22a188cda21c6236ac61`:

- **18 Vitest cases passed**, including arbitrary nanosecond +1 difference, unsafe `Number` precision counterexample, hash/byte/canonical-source errors, spoofed authorization/public flags, invalid native counter/share/notional math and forged order-replenishment.
- **Strict TypeScript compilation passed** (`tsc --noEmit --strict` with Node types).
- A genuine **synthetic-only Python interop fixture** was generated against actual TP-1 head `a3879855b943e1007e43750b38aedd185d745cb9` and R0 head `f7c31402ab4ffc10c1ebe76aeb7929e2f8ab3526`; both source serializers produced byte-identical golden files under `lib/__tests__/fixtures/` (no licensed vendor tape). TP-1 golden SHA256 `71bed6bb49ffce62735cc50c9f16a181d69b80393e6737f7899b911985f7f2c8` (2362 bytes), R0 golden SHA256 `47fb5af5e6e7fb8b30c594725363d8d84d787e1879a8916362aa0b81016e9ad2` (2219 bytes). Original byte hashes, source watermark and quote-policy digests, native BigInt timestamps and private-only states verified together.

To reproduce from **the Terminal repo's `terminal/` directory** after checking out the exact branch:

```bash
npm run test -- --run lib/__tests__/tp1PrivateEvidence.test.ts lib/__tests__/tp1PrivateEvidence.pythonInterop.test.ts
npx tsc --noEmit --strict
```

The tests exercise only private synthetic payload shapes. Their pass does **not** establish the provenance, cryptographic authorization, actual completeness or correctness of any future real production source.

## Release gates and next in-scope phases

1. Original Macro PR heads, source schemas and source-condition/correction policy must be reconciled by TP-1/R0 owners. The cross-repo compatibility fixture is not source approval. A source schema change requires fresh golden fixtures and independent exact-version tests.
2. Original TP-1 `.github/ci/legacy-jobs.yml` enrollment was explicitly refused by platform safety controls; do **not** route around it. The canonical VPS Quote Hub root SSH preflight previously returned `Permission denied (publickey)`, so no second Massive RT subscription, lease assertion or readback workaround. Existing Macro #7368 operator must qualify source ownership and a small real RTH capture, including 99% connection, 95% qualified lit quote age <=5s and same-scope RTH native-share reconciliation.
3. The existing operator and product entitlement owners must approve a genuine **private** Macro service/store route, source-specific vendor/exchange rights, retention, cache/authorization and selected Terminal gate. There is no such admitted published TP-1 artifact yet. The existing public `/api/flow` -> Flow backend -> public R2 ladder is **not** a permitted data path for this private material.
4. After source and private transport exist, build a narrowly entitled server read route with exact byte verify -> decoder -> separate approved **customer-field allowlist**, no raw frames/receipts and original clock/time labels. Then prove authenticated browser journey, dark/light/EN/ZH where a UI is designed, and machine API consumption of the **same canonical derived** evidence. No first-pass UI or live deployment is authorized by Phase A alone.
5. The source-derived pressure and best-quote-size recovery remain observations. Real order-level replenishment needs venue-specific depth/order-event data; all ranking, Prophet/entry, sizing, automation and predictive use require separate preregistered prospective validation and authority.

**Next Terminal owner action:** independent review of this **draft data-only PR** and upstream source-v0 clock contract, then wait for a legitimately admitted private TP-1 artifact before wiring a route. Do not merge/deploy as a completed product.
