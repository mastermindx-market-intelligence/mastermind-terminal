# Futures source conformance: continuation evidence

The official `databento-dbn==0.70.0` decoder now feeds a bounded normalized JSON
adapter and the existing Quote Hub book/trade reducers. Raw order IDs, fixed-point
prices and nanosecond times remain exact decimal strings. Source hashes,
no-replace output publication, truncated DBN/zstd refusal, per-instrument LAST
assembly, vendor gap flags, contract validity and venue status are tested.

**498/498 full Quote Hub tests passed**, including **46 new source-adapter
cases**. **15/15 Python SDK/conformance tests passed**, including a real
Python-decoder-to-Node-reducer path. Test logs and exact source hashes are here.
The Python tests are wired into the existing Quote Hub CI job, not a second CI
or runtime owner. Current-head hosted CI is separate and not claimed here.

Two upstream ESH1 cancellation records are decoded exactly and cannot make a
starting order book. The actual result is `snapshot_required`. Generated native
SDK records separately prove the complete snapshot/trade path and a replay cutoff
that excludes a later trade. Vendor capture timestamps remain retrospective:
none of this proves when Mastermind first knew a historical value.

The CLI intentionally returns `source_not_ready_for_depth` or
`replayed_requires_external_book_comparison`, never unconditional live acceptance.
A lawful full ES/NQ session with a matching displayed-book reference, source
entitlements, authentic definitions and publication receipts remains required.
No data purchase, live subscription, production deployment or market forecast
has been performed. Source integration is now substantially implemented; it is
not a commercial feed or a production-ready stream owner.
