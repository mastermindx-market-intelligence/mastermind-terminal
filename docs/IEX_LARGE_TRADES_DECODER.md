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

L and T are distinct execution populations. The decoder does not discard L
volume or count an order modification/removal as a trade. Trade IDs are scoped
to protocol, transport session, market date and symbol; contradictory reuse
refuses instead of guessing. A matching B subtracts the original execution only
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
certified as an identical duplicate.

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
archive acquisition.

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
      --max-records 10000

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
million messages, 10,000 selected records, 100,000 selected live orders and
65,536 recent sequence digests per stream. There is no full raw unpack or
automatic archive retention/deletion.

## Actual-data verification, October 11, 2026

The finalized decoder source SHA-256 is:

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

All seven finalized envelopes passed the actual Terminal transaction validator
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
