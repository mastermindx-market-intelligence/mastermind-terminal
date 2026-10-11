# Offline CME large trades: contracts and admission

## Status and source placement

Prepared 2026-10-11. These components support reproducible offline development. They do not enable a CME feed or change Terminal’s public IEX-only source admission. The modules and tests are integrated in the isolated Terminal candidate. Required hosted CI, protected merge and deployment remain separate release gates.

| Module | Purpose | Tests |
| --- | --- | --- |
| `ingest/cme_databento_trades.py` | Private DBN trade observations | `tests/test_cme_databento_trades.py` |
| `ingest/cme_native_fixture_ledger.py` | Explicitly synthetic decoded-native correction accounting | `tests/test_cme_native_fixture_ledger.py` |

The reviewed private DBN origin has 63 author tests and 21 independent control groups passing. Native revision 3 has 57 author tests and 27 independent controls passing. The combined repository verification passes all 120 new tests and 109 existing IEX decoder tests: **229 passed, plus 176 subtests passed**, with no failures or skips. Root also replayed both original ledger counterexamples successfully. The [source verification receipt](evidence/large-trades/cme-source-verification.json) binds these results to exact source bytes. These results establish bounded synthetic contracts; actual market qualification and hosted CI require their own evidence.

Private origin SHA256s, before repository adoption:

- DBN: `7712df4d9aeb791d1332f77de97fffa9d21d59df8d15c6ebd5afc55143db01e1`.
- Native v3: `c2d465d2404b5eedca093ead2b328f1890c177b22d4da704d503fdfe3b8dc401`.

## Reproduce the focused repository check

From the repository root, with the existing test dependencies installed:

```sh
python3 -B -m pytest -q -p no:cacheprovider \
  tests/test_cme_databento_trades.py \
  tests/test_cme_native_fixture_ledger.py \
  tests/test_iex_deep_trades.py
```

This command uses deterministic fixtures only. Machine-readable policies are [DBN observations](evidence/large-trades/cme-databento-observation-policy.json) and the [native fixture contract](evidence/large-trades/cme-native-fixture-contract.json). The frozen [research protocol](LARGE_TRADES_ABSORPTION.md) continues to govern any future efficacy evaluation.

## Exact DBN representation

The normalizer accepts immutable **48-byte, little-endian TradeMsg blocks**, pinned to Databento DBN library **v0.71.0**, commit `d368005a636bae84bff443cd6ddae6430a0ffd00`, **wire version 3**. A library release number is not a wire version.

The 16-byte header must identify twelve four-byte words, trade rtype 0, and publisher 1. Remaining offsets are price i64 at 16, quantity u32 at 24, action at 28, side at 29, flags at 30, depth at 31, capture timestamp u64 at 32, signed input delta i32 at 40, and sequence u32 at 44. Only trade action T is admitted. A/B/N mean sell/buy/unknown aggressor.

Input binding declares GLBX.MDP3, trades schema, uncompressed blocks, no appended ts_out, and raw-symbol input. No complete DBN-file metadata/framing reader, decompressor, or export authenticator exists here.

Size 1301 means **1,301 reported contracts in one observation**. `orderCount`, native order ID, and native trade ID remain null. Contract quantity is never multiplied by the dollar multiplier or substituted with candle volume. Undefined prices, sizes, and timestamps refuse; zero size refuses. Integers remain exact, with raw prices and nanoseconds serialized as decimal strings. The narrow projection requires positive safe-integer prices on the declared tick; it never rounds unsupported values.

## Identity, instrument, and clocks

DBN identity is the declared artifact SHA256 plus uncompressed physical byte offset. Identical bytes at the same position are idempotent; conflicting bytes permanently refuse the batch. Distinct positions remain separate even with identical sequence, clocks, price, and size. New positions increase; cross-artifact merging is refused. Packet sequence is neither execution identity nor continuity proof.

The projection requires an explicit dated, unadjusted **MNQ outright futures** binding: price scale 1e9, tick 250,000,000 (0.25 points), and multiplier 2,000,000,000 at scale 1e9 ($2). Mapping uses capture-time UTC dates, inclusive start and exclusive end. Definition identity, effective interval, tick, multiplier, evidence digest, and knowledge time must agree. Rolls retain separate resolved instruments; continuous aliases and spreads are unsupported.

Source event time, Databento capture time, declared acquisition, metadata/mapping/definition knowledge, qualification, and publication remain distinct. Negative input deltas are preserved; saturated or out-of-range sender-time derivations remain unavailable. Capture is never relabeled Mastermind live receipt. The knowledge accessor returns no observations or numeric gross quantity before publication; all dependency knowledge must already precede qualification and publication.

Historical declarations remain `caller_supplied_unverified`; fixtures remain `synthetic`. Flags remain raw: SNAPSHOT, BAD_TS_RECV, MAYBE_BAD_BOOK, publisher-specific, and reserved bits carry explicit exclusions. LAST and absence of exclusions do not prove completeness. Outputs preserve `gross_as_reported`, `correctionCoverage: unsupported`, and `publicConsumerEligible: false`. Refused DBN prefixes remain explicitly incomplete diagnostics. Defaults cap 4,096 attempts/identities, 196,608 input bytes, and 64 mappings; hard maxima are 65,536 attempts/identities and 3,145,728 bytes. Duplicates consume attempt and byte budgets; caps refuse without eviction.

## Separate synthetic correction ledger

`FixtureLedger.from_bytes` accepts only the declared synthetic JSON schema, fixed channel/session/instrument/symbol namespace, and explicit physical source identity `(artifactId, ordinal, byteOffset)`. It does not decode CME SBE, PCAP, or DBN. Native MDTradeEntryID is a trade-group reference: repeated IDs across distinct NEW reports remain distinct observations.

| Action | Supported transition |
| --- | --- |
| NEW | Add the original contract quantity and aggressor once. |
| CHANGE | For exactly one active target, preserve quantity and original aggressor/event clocks; amend integer price only. |
| DELETE | For exactly one active target, verify current price and quantity, then cancel its entire quantity once. |

Corrections require raw aggressor code 0; their own clocks and source records remain in history. Zero or multiple active targets refuse; price, recency, sequence, and RptSeq cannot resolve ambiguity. Exact canonical physical replays are idempotent. Gross NEW quantity equals active plus cancelled quantity, including each original aggressor partition. Distinct order count stays null. A reached error makes totals null and active/cancelled arrays empty, preserving diagnostic history.

## Prefix causality and bounded parsing

`snapshot` and `snapshot_bytes` require inclusive message and knowledge cutoffs. Traversal stops before the first source-ordered record whose trustworthy message **or** availability clock exceeds its cutoff. A reached unclocked record refuses; it cannot be declared future. Unique message and availability clocks must not regress, and event ≤ message ≤ availability; event times are never sorted into a reconstructed tape.

Excluded future bodies cannot change an earlier admitted prefix. Whole-document syntax, envelope validity, and resource admission remain separate: an unparseable or oversized document produces no ledger. This is observed source-prefix arithmetic, without an exchange-event watermark or atomic-completeness claim.

Nested duplicate-key evidence retains each original value once. Parser-created duplicate provenance survives storage in an immutable row flag; caller-written marker-shaped JSON cannot authenticate clocks or hide a malformed row. Non-integer number lexemes remain inert evidence. Canonical serialization checks remaining budget before appends and encodes strings in bounded chunks. Hard ceilings are 4 MiB input, 8 MiB stored canonical data, 4,096 records/identities, and total quantity 9,223,372,036,854,775,807; no eviction or silent truncation occurs.

## Future admission checklist

1. Complete required hosted CI and protected merge against the actual repository candidate, then use the canonical deployment and production-verification gates. Preserve prior failures and review identities.
2. Obtain the exact written commercial quote and rights grant specified in the [release handoff](evidence/large-trades/release-handoff.md), including trades, qualified quotes, audience/devices, display/redistribution, server analytics, storage, and derived outputs. Published examples are not an approved all-in price.
3. Independently admit actual export framing/authenticity, dated definitions, acquisition and consumer-knowledge provenance, plus a current native SBE/template and correction-targeting contract. Synthetic ledger transitions cannot restore fields absent from TradeMsg.
4. Validate licensed samples, corrections and completeness; then separately review any consumer/publisher admission and prove authenticated production behavior. No feed activation, public IEX admission change, live claim, absorption/trapped-trader claim, or OOS performance follows from these components.

## Primary references

- Pinned [TradeMsg and RecordHeader](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/record.rs), [layout assertions](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/record/layout_tests.rs), and [UTC mapping metadata](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/metadata.rs).
- Databento [GLBX supplement](https://databento.com/docs/venues-and-datasets/glbx-mdp3) and CME [MNQ Chapter 361](https://www.cmegroup.com/rulebook/CME/IV/350/361.pdf).
- CME [Trade Summary](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457418925/MDP%2B3.0%2B-%2BTrade%2BSummary) and [correction example](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457574586). These indexed examples motivate fixture semantics; they do not pin a current production SBE template.
