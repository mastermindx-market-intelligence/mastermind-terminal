# TP-1 lossless private evidence consumer — Phase A, October 11, 2026

**Status: BUILT_NOT_PROVEN FOR PRODUCTION. Original Macro /v0 byte reader plus Terminal-private /v1 string-clock projection. No UI, service route, source subscription, publisher, bucket selection, entitled consumer, browser delivery or deployment.**

**Owner/custody:** Terminal remains product and delivery owner; Macro TP-1 owns native source trade/quote receipts and signing (Macro [#7368](https://github.com/mastermindx-market-intelligence/macro/issues/7368), [PR #8660](https://github.com/mastermindx-market-intelligence/macro/pull/8660)); Macro R0 owns separate measured pressure/response research ([PR #8659](https://github.com/mastermindx-market-intelligence/macro/pull/8659)). Existing Terminal [#655](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/655) has Phase A schema/fixtures and a separately gated TP-2 consumer. Terminal [PR #895](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/895) handles an **EOD v2 fixture consumer**, not this TP-1 private source. Do not conflate or replace them. This is a path-disjoint Phase-A readiness leaf, with no additional lifecycle, access, retry or watcher.

## Reproduced original byte/consumer precision defect

At TP-1 `a3879855b943e1007e43750b38aedd185d745cb9`, the current Python `engine/tick_plane/private_minute_artifact.py` emits native `start_ns`, `end_ns`, `decision_ns`, `source_complete_through_ns`, `source_watermark_available_ns`, `source_latest_print_available_ns` and `max_quote_age_ns` as ordinary JSON integer values. R0 `f7c31402ab4ffc10c1ebe76aeb7929e2f8ab3526` emits its four named nanosecond clocks the same way. Values near 1.791×10^18 exceed `Number.MAX_SAFE_INTEGER`: native `1791417600000000123` becomes `1791417600000000000` under normal JavaScript `JSON.parse`. That loss can flip point-in-time as-of decisions, materialize false source freshness, or conflate adjacent original receipts. A correct SHA256 of the original Python bytes does **not** protect a browser/Next.js JSON parser from losing clock digits.

## Implemented pure source-exact reader

`terminal/lib/tp1PrivateEvidence.ts` accepts **private service-supplied original bytes** plus an independently stored expected SHA-256 and byte length; it does not fetch, cache, publish or broker those bytes. It verifies the exact content digest first, then lexically lifts only the known current-v0 nanosecond integer tokens to decimal text **before** JSON parse. It independently verifies canonical Python JSON ordering/shape, forbids duplicate field shadowing, rejects noncanonical input, and emits exact Node `BigInt` source clocks. Unsafe JSON integers in unrelated fields and any unexpected top-level/nested fields fail closed.

It uses the frozen existing source schemas `equity.tick_plane.private_minute_artifact/v0` and `equity.pressure_response.private_context_view/v0`; no new source schema, authorizing receipt, or alternative server credential is created. It verifies counters/denominators, share/notional conservation with fixed-point `BigInt`, original session/cutoff relations, source policy digests, and that recovery is a **best-NBBO-size proxy**, not a named actor, trade signal, order-level event, or forecast. Public delivery, rank/trade/alert authority, source authenticity, source coverage and forward labels are forcibly held private/unproven. The decoded record is server-side-only; `node:crypto` prevents safe browser inclusion, and this module has no client imports or route callers.

**Compatibility only:** the current Terminal-owned `terminal.tp1.private_evidence_projection/v1` envelope provides JSON-safe string clocks while keeping the accepted Macro /v0 source schemas, bytes and digests unchanged. A future Macro-owned source /v1 remains a separate source-owner decision. Neither reader creates a data store or delivery permission. Terminal must never use ordinary `await response.json()` on original /v0 bytes. A later admitted transport can use bounded `arrayBuffer()` retrieval and independent byte receipts after the existing session, entitlement and source-origin gates; public Flow's `R2_BASE` fallback is forbidden for this private family.

## Historical Phase-A proof (preserved)

M2 Studio used an isolated /tmp test directory, with dependencies symlinked *read-only* from the existing Terminal installation; no workspace checkout, producer, daemon or source-host state was modified. At tested Terminal source-and-test head `29a6843a949fd8443ec2d54d73b6cff9e685a278`:

- **37 Vitest cases passed**, including arbitrary nanosecond +1 difference, unsafe `Number` precision counterexample, hash/byte/canonical-source errors, spoofed authorization/public flags, invalid native counter/share/notional math and forged order-replenishment.
- **Strict TypeScript compilation passed** (`tsc --noEmit --strict` with Node types).
- A genuine **synthetic-only Python interop fixture** was generated against actual TP-1 head `a3879855b943e1007e43750b38aedd185d745cb9` and R0 head `f7c31402ab4ffc10c1ebe76aeb7929e2f8ab3526`; both source serializers produced byte-identical golden files under `lib/__tests__/fixtures/` (no licensed vendor tape). TP-1 golden SHA256 `71bed6bb49ffce62735cc50c9f16a181d69b80393e6737f7899b911985f7f2c8` (2362 bytes), R0 golden SHA256 `47fb5af5e6e7fb8b30c594725363d8d84d787e1879a8916362aa0b81016e9ad2` (2219 bytes). Original byte hashes, source watermark and quote-policy digests, native BigInt timestamps and private-only states verified together.

The tests exercise only private synthetic payload shapes. Their pass does **not** establish the provenance, cryptographic authorization, actual completeness or correctness of any future real production source.

## One-minute source/research pairing contract

`pairPrivateEvidence(minute, research)` is a **pure compatibility** check between two already verified private artifacts. It refuses different source timestamps down to the native nanosecond, ticker/session, original watermark, source manifest, sale/venue/quote policy digests, accepted quote-age rules, population or exact fixed-point provisional notional. This prevents mixing individually authentic-looking but incompatible source generations. The output deliberately remains `PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN` with `publicDeliveryAllowed=false`, `productionApproved=false`, `sourceAuthenticated=false`. The derived `pairedArtifactsSha256` binds both original byte digests but is **not** a vendor signature.

The original private TP-1 minute `source_observation_sha256` and R0's `minute_observations_sha256` are intentionally **different constructions**, so this server adapter does not falsely equate them. Only the incumbent TP-1/R0 source owner with original signed source receipts and stable episode/version lineage can prove the two source generations refer to exactly one original capture. The initial pairing supports **one fully matched minute**; longer future research windows need a separately reviewed per-minute cohort manifest rather than an inferred join.

The immutable source R0 Python private serializer at subsequent head `57bcd2a47d30504bb48197998e0b5c47d636a15a` was independently rerun on the same synthetic actual TP-1 input: its source output was byte-identical to the pinned R0 golden (2219 bytes, same SHA-256). This verifies the subsequent Decimal accuracy repair did not silently change this frozen wire case; other market vintages still require their own independent checks.

### Missing-source-policy behavior is explicit

The existing Python private minute projector permits nullable sale, exchange and quote-policy SHA-256 references if the source minute contains **no measured directional print** and all evidence is unknown or source-excluded. The Terminal Phase-A reader now preserves that distinct valid state rather than rejecting the entire cohort or turning unavailable values into zero. It exposes exact typed `unknownReasons` and `litUnknownReasons` maps and a nullable `sourceHashes` entry only for those three source-reference fields. A source minute with **any** measured buy/sell/midpoint but a missing required reference fails closed as `measured_without_source_policy`. An unknown-policy minute cannot be paired into a source-qualified R0 context, and free-text/non-typed reason keys are refused.

A third genuine Python-generator fixture is now frozen for **one unclassified source print**: `tp1PrivateUnknown.synthetic.v0.json` (2,210 bytes; SHA-256 `02e0bab2885af1a46e399aa1b9474486c1a650a61c3927a2726d702baa6406bf`), produced by the existing TP-1 `minute_projection` + `private_minute_artifact` under source head `a3879855...`. Sale, venue and quote-policy hashes were absent, but `TRADE_CONDITION_POLICY_UNQUALIFIED:1` and the original unknown-notional remain visible. The exact JavaScript decoder interoperated with these **actual Python-serializer bytes** without treating the absent reference as a market zero. Both trusted synthetic golden pairs and this source-invalid fixture contain no licensed market tape.

The associated native-JSON lossless decoder, Python-generated golden interop, cross-artifact pairing and negative missing-policy cases pass **37 focused Vitest tests** at exact source/test head `29a6843a949fd8443ec2d54d73b6cff9e685a278`, with targeted strict TypeScript compilation passing. This is still **only** a private, unauthenticated compatibility reader; it grants no live-source, customer delivery or publication status.

### Bounded high-precision R0 Decimal interoperability

The incumbent R0 arithmetic repair expanded derived-value precision. At `macro@57bcd2a47d30504bb48197998e0b5c47d636a15a`, `private_context_view._signed` permits a bounded **544-character fixed-point string** (`2×(2×128+16)`), while source/notional and quote-size amounts use a separate **128-character** limit. The former Terminal Phase-A v0 decoder admitted just 30 fractional digits, which could wrongly classify a legitimate narrow research response as unavailable.

At Terminal `29a6843a949fd8443ec2d54d73b6cff9e685a278`, this is corrected with bounded, exact decimal-string/fixed-`BigInt` arithmetic. It accepts 544-character **derived** research ratios/response but refuses 545; does not relax native source/share/quote-size bounds. Tests include both limits and a **byte-exact actual Python source-serializer fixture** `tp1PrivateHighPrecision.synthetic.v0.json` (2,390 bytes, SHA-256 `c2a0d860787e1967815635a8ceda2ecd47f9c3dad6bd2a7df9f4ba9fa0552372`) generated with a deliberately synthetic 100-fractional-digit R0 response/pressure case. The Python private writer's own readback verified those bytes first. This is a **wire/precision stress fixture**, not an empirical market return or an artificial claim that the live predictor attained 100-digit accuracy.

Focused verification at this exact head: **37 Vitest tests PASS**, strict `tsc --noEmit` PASS, ESLint `--max-warnings=0` PASS. Tested in a temporary isolated directory with dependencies linked to the already-installed Terminal node_modules; no live source, production auth or user-facing service.

## Current consumer continuation: original PR #915

The canonical TP-1 handoff comment omitted the existing Terminal [PR #915](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/915). The original carrier is preserved: `sol/tp1-lossless-private-terminal-consumer-20261011`, adopted from `2bcc96d73519e4636455c53ebdd8ef11eac56f19`. That accepted predecessor already repaired ES2017 BigInt syntax and passed [hosted CI 38126837434](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/38126837434). This continuation does not create another consumer PR. Historical test counts and temporary-directory receipts above describe their named older revisions; the verification below applies to this continuation's source.

### Exact source-policy and Decimal repairs

The original decoder reproducibly accepted a research `source_quote_age_limit_ns` one nanosecond larger than the minute's original `max_quote_age_ns`. R0 [`tp1_context.py` at 57bcd2a](https://github.com/mastermindx-market-intelligence/macro/blob/57bcd2a47d30504bb48197998e0b5c47d636a15a/engine/market_microstructure/tp1_context.py) records the original minutes' exact policy. Pairing now requires equality; both +1 ns and -1 ns mismatches refuse. The prior tighter-policy refusal remains compatible.

The actual TP-1 [private projector at a387985](https://github.com/mastermindx-market-intelligence/macro/blob/a3879855b943e1007e43750b38aedd185d745cb9/engine/tick_plane/private_minute_artifact.py) validates expanded Decimal width, then writes money and share values with `Decimal.to_eng_string()`. It emitted `100E-9` for a synthetic `0.0000001` amount; the old Terminal decoder refused it. The repaired minute reader accepts bounded engineering notation and expands it for exact fixed-point arithmetic. `100E-9` expands to `0.000000100`, the same exact amount with the emitted representation's decimal scale. Existing fixed text, including `1009.0`, remains unchanged.

Expansion is capped at 128 fixed-point characters **before** allocating zero padding; oversized or malformed exponents refuse. This does not relax R0 fixed-source limits, quote-proxy bounds or the separate 544-character derived research limit. Original engineering text remains byte-for-byte unchanged in the projection and original digest.

New immutable `tp1PrivateEngineering.synthetic.v0.json`: **2362 bytes**, SHA-256 `9879018af385139f145067551aff97fbce5b242327826cd42bf01a8d26f80798`. The actual pinned Python minute projector and private verifier produced and accepted it. `scripts/generate-tp1-engineering-fixture.py` checks the exact source checkout and unchanged imported source before reproducing this single fixture. The four prior goldens are preserved. No real tape, source capture, rights or live-source acceptance is implied.

### Separately versioned, invertible private string-clock contract

`projectPrivateEvidence` verifies one stable snapshot of original /v0 bytes through the existing decoder, then uses its existing lexical clock lifting. It produces canonical ASCII JSON plus a newline:

| Envelope field | Contract |
|---|---|
| `schema` | `terminal.tp1.private_evidence_projection/v1`; distinct from Macro's frozen source schemas |
| `kind` | `minute` or `research`, bound to the corresponding original schema |
| `timestamp_encoding` | `UNSIGNED_DECIMAL_STRING_NS`; canonical nonnegative decimal text bounded by native signed-64 maximum |
| `temporal_role` | `ORIGINAL_FROZEN_OBSERVATION`; frozen bytes do not assert correction finality |
| `original_artifact` | Exact original schema, SHA-256 and byte length |
| `observation` | Original fields with only root `schema` removed and the approved top-level nanosecond values represented as strings |
| Authority flags | Source authentication, production approval, public delivery and rank/trade/alert authority remain false |

`decodePrivateEvidenceProjection` requires **both** independently supplied projection and original SHA-256/length receipts. It never adopts the envelope's declared original receipt as its own trust anchor. It checks bounded bytes, exact field sets, canonical JSON, role/kind/schema and private flags; canonical recursion is capped. It structurally reconstructs only the approved original top-level clock integer lexemes, preserves all other original values, and invokes the existing /v0 semantic decoder against the independent original receipt. There is no second Python semantic validator, arbitrary `*_ns` conversion or original-byte reserialization through unsafe numbers.

The resulting server record contains exact BigInt clocks, original and projection digests, original length and original-only temporal role. A rehashed envelope cannot change a clock or an equivalent monetary spelling under the old original receipt. Later label clocks and outcome fields are rejected from this observation contract. A matching hash proves representation integrity; source authenticity and entitlement remain external.

`lib/tp1Nanoseconds.ts` is a browser-safe primitive module with no source/transport/auth imports. `parseUnsignedNanoseconds` accepts canonical strings only. Its explicit display helper divides in BigInt before converting to integer milliseconds and retains both original nanoseconds and discarded remainder. Display milliseconds must never be used for source identity, point-in-time ordering, pairing or replay.

### Current local verification and reproduction

Verified in the canonical isolated Terminal workspace using its own exact-lock dependency install and actual project configuration:

- **126 focused tests in 5 files PASS**: original decoder 35, prior Python interoperability 4, nanosecond primitives 27, source/Decimal boundaries 22 and v1 projection 38.
- **Whole-project TypeScript PASS** with `tsc --noEmit --incremental false`, preserving the real ES2017 target. There is no ES2022 target override.
- **Scoped ESLint PASS** with `--max-warnings 0`.
- Actual Python fixture generation and Python private readback PASS; all original fixture hashes remain pinned.
- Red-before-green evidence: original decoder had 6 failing new cases (the larger age policy and five engineering cases), while 16 negative/baseline cases already passed.
- No CI enrollment file, Macro source file, original four fixtures, dependency lock, route, authentication setting, live source, public fallback or deployment was changed.

From the Terminal repository's `terminal/` directory:

```bash
npm test -- lib/__tests__/tp1Nanoseconds.test.ts lib/__tests__/tp1PrivateEvidence.test.ts lib/__tests__/tp1PrivateEvidence.pythonInterop.test.ts lib/__tests__/tp1PrivateEvidence.boundaries.test.ts lib/__tests__/tp1PrivateEvidence.projection.test.ts
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint lib/tp1Nanoseconds.ts lib/tp1PrivateEvidence.ts lib/__tests__/tp1Nanoseconds.test.ts lib/__tests__/tp1PrivateEvidence.boundaries.test.ts lib/__tests__/tp1PrivateEvidence.projection.test.ts --max-warnings 0
python3 scripts/generate-tp1-engineering-fixture.py --source-checkout "$TP1_SOURCE_CHECKOUT"
```

Set `TP1_SOURCE_CHECKOUT` to the unchanged accepted TP-1 checkout before the final command. The PR checkpoint binds review and hosted CI to the immutable published continuation revision; local verification is not a release receipt.

### Existing-auth adoption and prospective readiness

At audited Terminal `2957bd64eec9ac3246a52789acb0f7de55400144`, the reusable admission boundary is [`billingAuth`](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/2957bd64eec9ac3246a52789acb0f7de55400144/terminal/app/api/billing/gateway.ts) plus the existing [Macro `/api/me` entitlement authority](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/2957bd64eec9ac3246a52789acb0f7de55400144/terminal/lib/entitlement.ts). The [private Issue Desk proxy](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/2957bd64eec9ac3246a52789acb0f7de55400144/terminal/app/api/options/issue-desk/route.ts) demonstrates verified caller-token forwarding, a fixed private upstream, refused redirects and private/no-store responses. Its endpoint and operator permission are specific to Issue Desk; they do not admit TP-1. The generic Flow fallback and fixed NW display feeds supply no admitted private TP-1 path.

The original source/delivery owners must next supply qualified immutable source artifacts and independent receipts, exact rights/private delivery/readback evidence, and the selected TP-1 endpoint and entitlement mapping. Actual consumer identity, candidate/deadline and availability receipts must then prove what Terminal received before each decision. The pure contract cannot manufacture these facts.

Prospective work reuses the existing [Commission 15 validation protocol](https://github.com/mastermindx-market-intelligence/macro/blob/57bcd2a47d30504bb48197998e0b5c47d636a15a/research/market_microstructure/commission15/VALIDATION_PROTOCOL.md). R0's separate 30-second/2-minute/5-minute labels do not implement the proposed same-candidate **30-trading-minute entry-utility** study. [`label_first_knowable_ns`](https://github.com/mastermindx-market-intelligence/macro/blob/57bcd2a47d30504bb48197998e0b5c47d636a15a/engine/market_microstructure/tp1_matured_response.py) is derived from evidence clocks, not proof of actual consumer emission or a preregistered trial. The evaluation owner must freeze the estimand, controls, costs, fallback, trial accounting and chronological confirmation before outcome inspection. No duplicate study, artificial live observation or predictive promotion is created here.

## Release gates and next in-scope phases

1. Original Macro PR heads, source schemas and source-condition/correction policy must be reconciled by TP-1/R0 owners. The cross-repo compatibility fixture is not source approval. A source schema change requires fresh golden fixtures and independent exact-version tests.
2. Original TP-1 `.github/ci/legacy-jobs.yml` enrollment was explicitly refused by platform safety controls; do **not** route around it. The canonical VPS Quote Hub root SSH preflight previously returned `Permission denied (publickey)`, so no second Massive RT subscription, lease assertion or readback workaround. Existing Macro #7368 operator must qualify source ownership and a small real RTH capture, including >=99% connected seconds, >=95% eligible lit prints with prior qualified NBBO age <=5s, unknown/TRF denominators kept separate, and <=2% same-scope RTH native-share volume discrepancy for >=90% of comparable names. Full-day grouped volume is not an RTH comparator.
3. The existing operator and product entitlement owners must approve a genuine **private** Macro service/store route, source-specific vendor/exchange rights, retention, cache/authorization and selected Terminal gate. There is no such admitted published TP-1 artifact yet. The existing public `/api/flow` -> Flow backend -> public R2 ladder is **not** a permitted data path for this private material.
4. After source and private transport exist, build a narrowly entitled server read route with exact byte verify -> decoder -> separate approved **customer-field allowlist**, no raw frames/receipts and original clock/time labels. Then prove authenticated browser journey, dark/light/EN/ZH where a UI is designed, and machine API consumption of the **same canonical derived** evidence. No first-pass UI or live deployment is authorized by Phase A alone.
5. The source-derived pressure and best-quote-size recovery remain observations. Real order-level replenishment needs venue-specific depth/order-event data; all ranking, Prophet/entry, sizing, automation and predictive use require separate preregistered prospective validation and authority.

**Next operational action:** the original TP-1/source-delivery owners resolve the refused CI/source admissions and return qualified immutable RTH artifacts with private delivery/custody receipts and the selected entitlement path. After exact-revision consumer review/CI and those admissions, Terminal wires and proves the existing-auth consumer journey; prospective promotion remains separately gated. This Phase-A implementation is not a completed or deployed product.
