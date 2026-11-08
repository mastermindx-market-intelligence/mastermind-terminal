# IEX historical large-trade decoder

This is a bounded, offline adapter for already-acquired IEX HIST DEEP+ 1.0
executions. It supplies the existing Terminal transaction-study contract. It
opens no socket, downloads no data, uses no credential and starts no service.

## Source contract

The wire format is bound to the primary specifications:

- [IEX DEEP+ specification](https://www.iex.io/documents/iex-deep-plus-specification),
  v1.06, trading-message tables pages 21–27 and flags pages 28–29.
  Reviewed PDF SHA-256:
  1a14b62eacc5aea0f66f7311fa8929d5fdafc1116f144ccbe39be8d727a4153d.
  The October 7 revision changes disaster-recovery/replay addresses; the
  October 5 DPLS 1.0 trade layouts used here are unchanged.
- [IEX-TP v1](https://www.iex.io/documents/iex-tp-v1), v1.26, pages 5–7.
  Reviewed PDF SHA-256:
  30d790afa4bf966fcd113381562c59c90424ebc317919436f74ddb3f6d7394ae.
- [PCAPNG specification, September 2026 draft](https://www.ietf.org/ietf-ftp/internet-drafts/draft-ietf-opsawg-pcapng-06.html),
  sections 3.1, 3.5 and 4.1–4.4.

DPLS protocol ID is **0x8005**, distinct from ordinary DEEP 0x8004.
IEX fields are little endian, independently of the capture file's byte order.
The 40-byte transport header supplies the protocol/channel/session identity,
sequence, stream-byte offset and send timestamp. Each message has a two-byte
length prefix, excluding that prefix. Heartbeats consume no message sequence.

| Native message | Bytes | Volume and lifecycle meaning |
| --- | ---: | --- |
| a | 38 | Add a displayed resting order; native side 8 = buy, 5 = sell. |
| M | 38 | Modify an existing order. Quantity is the new total, not a delta. |
| R | 26 | Delete an order. A later Add may reuse its identifier. |
| C | 18 | Clear a symbol's displayed book. |
| L | 46 | Execution against a displayed order; executed quantity contributes to volume. |
| T | 38 | Non-displayed versus non-displayed execution; quantity also contributes to volume. |
| B | 38 | Later trade break targeting an earlier L or T by native trade ID. |
| S | 10 | System event; timestamp, no symbol. |
| D | 31 | Security directory; administrative reference metadata. |
| H | 22 | Trading status; administrative status metadata. |
| I | 18 | Retail-liquidity indicator; no executed quantity. |
| O | 18 | Operational halt status; no executed quantity. |
| P | 19 | Short-sale price-test status; no executed quantity. |
| E | 18 | Opening/closing process status; no executed quantity. |

L and T are distinct execution populations. The decoder does not discard L
volume or count an order modification/removal as a trade. Trade IDs are scoped
to market date, protocol, channel, transport session, symbol and native trade
ID. DEEP+ v1.06 pp9-10 partitions symbols across channels; pp24-26 makes no
cross-channel or cross-session global uniqueness promise for Trade ID. Redundant
A/B sources retain the same channel/session identity and deduplicate by native
sequence/offset, even if packet grouping or network endpoints differ. Distinct
channels and sessions stay separate. Contradictory reuse refuses instead of
guessing. The full native signature includes message kind, size, price, flags,
event timestamp and (for L) resting-order ID. A matching B subtracts the original execution only
from its later correction state. Orphan breaks remain explicit and subtract
nothing. A break does not restore a previously executed order in the book.

Prices remain exact signed integer source prices with scale 10,000. Quantities
remain actual unsigned native shares. Values that cannot be represented exactly
by the consumer's integer-number contract are refused. No tick size is guessed.

## Side inference and source integrity

A native L does not itself report an aggressor side. The optional
resting_order inference is the opposite of the referenced resting side only
after the decoder has observed an intact Add/Modify/Delete/Execute lifecycle.
Unknown prefix, source gap, unverifiable replay, unknown message type, missing
order or quantity overrun removes that inference. A single-price-cross execution
stays unsigned. T stays unsigned. Retail-liquidity indicators do not identify
the aggressor of a trade.

All source messages advance transport continuity before any symbol filter.
Protocol/channel/session/sequence identities deduplicate retransmissions even
when redundant packet grouping differs. Contradictory retransmissions refuse.
A finite sequence cache is explicit; a replay outside it cannot be silently
certified as an identical duplicate. Semantic trade/break signatures are retained
before any time filter and before applying L to displayed quantity. Identical
repeats cannot consume an order twice, including outside the selected output
window. Contradictory repeated breaks are checked against both their original
execution and the first break signature before any idempotent return.

The shared 100,000-signature default ceiling includes filtered L/T and B records.
Reaching it stops with partial evidence before the next lifecycle mutation;
identities are never evicted and later mistaken for new trades. A selected B
whose target was observed only outside the selection remains an explicit
unmatched output correction and subtracts no selected volume.

Known administrative messages must match their exact documented body length,
nonnegative acquisition-bounded timestamp and (except S) valid source symbol.
Their status/detail payloads remain unused administrative metadata, not inputs
to executed volume, aggressor inference or response evidence. Unknown message
types retain the existing lifecycle-invalidation policy.

The actual source identified two details that the first fixtures had missed:

- R's reserved byte is commonly ASCII space, 0x20. The specification gives no
  mandatory-zero rule; its 0x00 example does not create one. R/C reserved bytes
  are retained in diagnostics and ignored semantically.
- I is the documented retail-liquidity indicator. The initial 0x20 publications
  across all symbols are administrative, not missing execution types.

The initial run refused the reserved byte before writing an output directory.
Primary-source review corrected the assumption and added real-form regressions.
No malformed-record or unknown-enum guard was disabled.

## Four separate clocks

1. Exchange message timestamp: the event's native nanoseconds.
2. Transport send timestamp: the IEX-TP packet timestamp.
3. Capture timestamp: the PCAP/PCAPNG timestamp and its exact resolution/offset.
4. Archive acquisition timestamp: when Mastermind obtained the historical file.

Only clock 4 supplies availableNs for this historical adapter. Clock 3 never
becomes an invented original Mastermind receive timestamp. Non-integral
nanosecond capture clocks retain their rational tick representation.

Native message order updates the book; exchange timestamps may decrease
across message types. Time selection filters emitted records without
discarding the prior lifecycle. No source event may postdate the claimed
archive acquisition. Each normalized row's session has the 31-character form
`YYYYMMDD.pppp.cccccccc.ssssssss`, preserving full protocol/channel/session fields
as hexadecimal. Native source sequences and cancel targets are scoped to this
identity; date alone is not an ordering domain. The receipt records every
observed native stream and its normalized session.

Every envelope declares historical / HISTORICAL_REPLAY /
archive_acquisition, venue scope, partial coverage, shares and a null tick
size. It supplies no qualified midpoint responses, absorption signal, validated
forecast or original intraday availability claim. Distinct order count is not
part of this output.

## Bounded execution

Run from the Terminal repository root on M2 Studio:

    python3 -m pytest tests/test_iex_deep_trades.py -q

    python3 ingest/iex_deep_trades.py \
      --archive /Volumes/Mastermind/market-data/iex/hist/raw/DPLS/2026/10/20261005_IEXTP1_DPLS1.0.pcap.gz \
      --output-dir .large-trades-evidence/iex-20261005-new-run \
      --symbols SPY,QQQ,NVDA,AMD,INTC,MU,ARM \
      --max-bytes 536870912 \
      --max-packets 2000000 \
      --max-messages 8000000 \
      --max-records 10000 \
      --max-native-identities 100000

Use a new output directory. Existing output refuses so an interrupted effect
must be inspected before another write. Source files and existing acquisition
receipts are read-only. Generated envelopes, native provenance and the decode
receipt use exclusive private files; they are not source-code fixtures and
must not be committed to Git.

The decoder streams gzip and supports classic PCAP plus PCAPNG section,
interface and enhanced-packet blocks. It handles capture endianness, interface
resolution/offset, Ethernet VLAN headers and IPv4/IPv6 UDP boundaries.
Unsupported packet blocks/linktypes, IP fragments, truncated frames and
contradictory lengths refuse. Metadata blocks do not become market messages.

Default bounds are 512 MiB decompressed input, two million packets, eight
million messages, 10,000 selected records, 100,000 selected live orders,
100,000 native trade/break signatures and 65,536 recent sequence digests per
stream, with at most 32 streams. There is no full raw unpack or
automatic archive retention/deletion.

## Initial actual-data verification (v2), October 11, 2026

The initial v2 decoder source SHA-256 was:

    b801e468e8e5143d83723a9ae11cc1c3041042b85fd9554ac0485d4573fadf71

Its existing-discovery Python suite passed **53 cases**. Tests include native
L/T/B conservation, orphan/mismatched/repeated breaks, order-ID reuse, changed
total sizes, decreasing event clocks, crossed-event abstention, unknown enums,
protocol confusion, altered retransmissions, sequence gaps, heartbeat behavior,
PCAPNG sections/endianness/clock precision, malformed framing and hard bounds.

The finalized run used the already-sealed October 5 archive and stopped at the
two-million-packet ceiling:

| Measurement | Result |
| --- | ---: |
| Decoded packets | 2,000,000 |
| Unique IEX-TP messages | 2,321,530 |
| Decompressed bytes read | 312,182,060 |
| Selected native L executions | 275 |
| Selected native T executions | 1,410 |
| Selected execution records | 1,685 |
| Total executed shares | 141,057 |
| Observed sequence gaps / unknown message types | 0 / 0 |
| Observed breaks in this prefix | 0 |

The selected observations span approximately 12:01:29 through 13:30:38 UTC on
October 5, depending on symbol. This is a bounded premarket/opening prefix,
not a complete session, live cohort, independent tape census or out-of-sample
predictive validation.

| Symbol | Execution records | Executed shares | Unknown-side shares |
| --- | ---: | ---: | ---: |
| SPY | 302 | 26,121 | 24,486 |
| QQQ | 111 | 5,356 | 2,254 |
| NVDA | 408 | 37,667 | 26,940 |
| AMD | 135 | 6,065 | 5,041 |
| INTC | 552 | 59,478 | 52,471 |
| MU | 144 | 4,471 | 4,125 |
| ARM | 33 | 1,899 | 1,854 |

All seven v2 envelopes passed the actual Terminal transaction validator
and snapshot builder. Their eligible quantities equal the decoded source
quantities. A knowledge cutoff before archive acquisition exposes zero prints.
No cluster receives absorption availability or predictive authority.

Consumer verification used engine SHA-256
6749909101747881985239da9fefb2a6492b79f0d87d3b1f68b5b946ccf4a339.
Later engine revisions require their own consumer check; this is not a claim
about an unspecified future head.

Evidence remains under the operation workspace:

    .large-trades-evidence/iex-20261005-v2/

| Evidence | SHA-256 |
| --- | --- |
| decode-receipt.json | c372d5b41afba4aa8282a2fe13e4e24cd5e936f105963ec4d7047d292f43ac28 |
| consumer-contract-verification.json | 0f5d30a983c41492376aec2058b12083375501773dce0489f4abe371567eb758 |
| Native-record provenance | 09dd11155da653c579a95bd9098ae7ea2210a7eaf4bb249186b831f0ad374558 |
| Independently hashed decompressed prefix | 3b173fd73113318e5db6ac0d232c19f7a7aaa25b55bd92228b66b17406a9fe5d |

The acquisition receipt records the full 9,875,890,058-byte archive hash
2e41ba84c2a24ccd541d079c2bb05a6da38e988790d8e97a19c1527b1195b0dd
and acquisition at 2026-10-07T06:08:37Z. This implementation checked present
archive size and hashed the exact decompressed prefix; it did not rehash the
entire archive or reach its final gzip checksum.

An earlier successful bounded pass used prefixed source-record labels that
the product validator did not admit. The finalized pass uses native L/T/B
labels. All seven native record arrays are identical after that label
normalization; only the contract serialization and exact stopping boundary
changed. Both receipts remain preserved.

## Integrity review and regenerated v3 sample

The v3 decoder source SHA-256 after the first bounded integrity review was:

    d06d521146389c51d89cc254305adac007f3e458274ef7b2ced50feaf2c85ae1

The review added 44 deterministic cases. Before the fixes, 37 new cases failed,
while the original 53 and seven valid administrative-frame cases passed. After
the fixes, **97/97 cases passed** using the same existing CI discovery command:

    python3 -m pytest tests/test_iex_deep_trades.py -q --tb=short

The new cases cover contradictory event times and resting-order references,
channel/session-separated cancellation targets, maximum unsigned stream fields,
all seven administrative body lengths and invalid clocks, filtered duplicate
executions, contradictory repeated breaks, filtered correction targets, and the
shared identity-memory ceiling. No test enrollment or workflow changed.

The v3 regeneration repeated the exact v2 bounds: the same seven symbols, no
event-time filter, two million packets and at most 512 MiB decompressed input.
It finished in 40.757 seconds and stopped at the packet ceiling. All 312,182,060
consumed bytes have the identical independently computed prefix digest. Every
price, quantity, side, condition, event clock and source sequence is unchanged
from v2. Only normalized row IDs, cancel-target IDs where applicable, and session
identities changed. There were again 1,685 executions and 141,057 shares, with
zero observed source gaps, unknown message types or breaks.

Exactly one source stream was observed: protocol 32773 (`0x8005`), channel 1,
session 1358626816, normalized as `20261005.8005.00000001.50fb0000`. Its first
observed native sequence is 1 and its next sequence at the ceiling is 2,321,531.
The decoder retained 1,685 native identity signatures, below its 100,000 cap.

The v3 sample and its bounded comparison/test receipt remain private artifacts:

    .large-trades-evidence/iex-20261005-v3/

| Evidence | SHA-256 |
| --- | --- |
| decode-receipt.json | c42147b170e382a0a7c26ec9f3a434bbdb3496ada0712eb3bf2094fdcb3683c9 |
| Native-record provenance | f157c389a3b2b383764ddbc64528962206c07be02d8876faf380c025223e4536 |
| Independently hashed decompressed prefix | 3b173fd73113318e5db6ac0d232c19f7a7aaa25b55bd92228b66b17406a9fe5d |

V2 receipts and data remain preserved. The earlier v2 consumer proof is not
silently reassigned to v3 or to a later engine. Independent consumer verification
must bind the v3 source receipt, current decoder and current engine hashes; its
own receipt carries that result. The source acquisition and publication limits
below are unchanged.

## Independent correction review and final v4 sample

Independent review found two additional native correction-order contradictions.
A B timestamp earlier than a known L/T execution was accepted by the decoder
while the consumer refused that correction. A first-seen L/T after an unmatched
B in the same native identity scope was also accepted, allowing decoder and
consumer correction totals to disagree. The decoder now rejects both before
identity insertion, order-book mutation, time filtering or volume accounting.
This follows the native contract that B refers to a previously sent L/T and
carries the break event's timestamp. It does not introduce another pending-
correction authority.

Equal execution/break timestamps remain permitted. An exact duplicate of an
already-known L/T after its valid B remains an idempotent no-op. Unknown-target
breaks remain explicit when no contradictory original subsequently appears.

The first nine review tests reproduced seven failures against v3 (99 cases
passed). After the two checks and three additional mutation-boundary tests,
**109/109 tests pass**. A separate read-only reviewer ran 13 independent probe
groups, including 21 administrative length/clock rejection checks, and reported
no remaining high or medium defect in this scoped diff.

Final decoder source SHA-256:

    9655af3dde9ea225635f6d97be60c6d51a57795c7b7a68bfa91e4d3e18d5a068

The final sample is retained separately:

    .large-trades-evidence/iex-20261005-v4/

It repeats the same seven symbols and two-million-packet ceiling, finishing in
21.908 seconds. The decoded prefix, all 1,685 normalized record objects, every
native-provenance byte and the 141,057-share total are identical to v3. No B
occurs in this real-data prefix; correction ordering remains deterministic-
fixture proof, not an observed historical-bust example. V2 and v3 are preserved.

| Evidence | SHA-256 |
| --- | --- |
| decode-receipt.json | aa952521d29fa6e4aa05f084ac2b6148becd9ed51e5c5d92b2e04fa1c73162d8 |
| Native-record provenance | f157c389a3b2b383764ddbc64528962206c07be02d8876faf380c025223e4536 |
| Independently hashed decompressed prefix | 3b173fd73113318e5db6ac0d232c19f7a7aaa25b55bd92228b66b17406a9fe5d |

Independent consumer verification must use v4 and its matching decoder hash;
the successful prior v3 receipt cannot stand in for this final binding.

## Interpretation and publication limits

No actual B occurred in this prefix. Break behavior is therefore
fixture-verified, and later full-session corrections remain unexamined.
Absence of a break in the sample is not a final-vintage guarantee. Zero observed
sequence gaps establishes continuity of this observed logical prefix, not
complete market/session coverage or source authenticity.

This is IEX venue-only equity data. It proves no CME/MNQ entitlement, futures
contract volume, consolidated NBBO, live delay SLA, hidden-order identity,
institutional participant identity or trading advantage.

[The IEX HIST Terms of Use](https://www.iex.io/legal/hist-data-terms) govern
redisplay, sale, receipt and use. A redisplaying consumer must preserve the
required attribution and terms link already supplied in each envelope:

> Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use.

The parent release owner still owns source integration, CI, deployment and
responsive browser acceptance. Decoder and consumer tests do not establish
production availability.
