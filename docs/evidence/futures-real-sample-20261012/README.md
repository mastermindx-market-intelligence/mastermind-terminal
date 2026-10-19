# Real ES order-book and execution comparison

Date: 2026-10-12. This is actual HISTORICAL public-sample evidence, not the generated
browser fixtures. No paid API, login, data purchase or credential was used.

## Observed result

From the public CME samples linked at https://databento.com/tick-data, retained
an internal five-minute prefix for ESZ5 on 2025-09-22. The MBO prefix contains
18,418 records / 2,399,890 bytes; MBP-1 reference has 4,980 records / 786,643 bytes.
The initial snapshot contains 8,831 orders. Both prefixes finish at the same
complete event immediately after the requested five-minute boundary.

The existing book reducer matched **4,471 / 4,471** final comparable reference
groups on BOTH bid and ask **price, displayed size and order count**. There were
zero remaining mismatches, zero unmatched reference groups, and zero source
adapter errors. All **377 trades / 839 contracts** admitted from the MBO Trade
records survive the same footprint reducer. Fill records are not counted twice.

## What the initial mismatch taught us

The first comparison used `(receive timestamp, packet sequence)` as a unique
event key. Real data has multiple LAST-terminated instrument events in one packet;
MBP omits events that do not change the best quotes. That initial join reported
nine transient differences and 98 repeated reference groups. The second join
also exposed a packet that ENDED with the start of the next unfinished event.

The correct, frozen comparison ruler is now the **last COMPLETED instrument state
at each receive-timestamp/packet-sequence boundary**, matched to the final reference
state at that boundary. No price tolerance, row deletion, quantity adjustment or
book-reducer change was used to manufacture agreement. The regression tests
explicitly include shared sequences, repeated BBO states and incomplete packet tails.
The original failed report is retained alongside the final report.

## Limits

This is one roughly five-minute overnight ES sample. It does not compare all
orders or queue positions to an independent full-depth oracle. Both schemas come
from Databento; their independence is format/normalization, not exchange/counterparty.
It is not full-session, NQ, reconnect or volatile-market proof. Trade conservation
is against MBO Trade records, not yet a separately delivered trade tape.

The identity binding used solely for this diagnostic is explicitly the observed
sample window, NOT an authenticated venue definition or an assertion of expiration.
Source time is vendor-capture retrospective, not historical Mastermind knowability.
Actual contract-reference admission, licensed live data and subscriber display
rights remain unproven. No SPX gamma is paired with these historical data yet.

Raw CSV, normalized real records, detailed mismatches and any real-price browser
images stay under ignored `.local-futures/`. Only URLs, hashes, counts, original code,
synthetic regression tests and aggregate comparison receipts are committed here.
The samples' public download does not establish commercial redistribution rights.

## Reproduction (internal research only)

```
python hub/tools/acquire_futures_sample.py mbo --seconds 300
python hub/tools/acquire_futures_sample.py mbp-1 --seconds 300
node hub/tools/compare_futures_sample.js
```

The acquisition caps bytes, rows and duration and reuses an existing prefix only
after digest verification. No automatic retry or paid source fallback exists.
Current source tests: **515 full Hub tests and 24 Python tests passed**; the existing
Quote Hub CI job runs all `test_futures_*.py` modules. Hosted CI is not implied.

Next: use the same actual-source reducers in the development chart, preserving
historical-only and missing-GEX disclosure, then obtain remaining production/review
and actual-feed acceptance through their existing owners.
