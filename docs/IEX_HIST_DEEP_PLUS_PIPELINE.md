# IEX HIST DEEP+ (DPLS) acquisition and PIT storage

Scope: bounded one-day acquisition, sealed-file validation and verified partial
continuation. Existing downstream owners are documented in
[IEX_LARGE_TRADES_DECODER.md](IEX_LARGE_TRADES_DECODER.md) and
[IEX_DEPTH_REPLAY.md](IEX_DEPTH_REPLAY.md). Their decoder/replay work must not be
recreated here; normalized Parquet, retention and scheduler acceptance remain
separate obligations.

## What the free source is

IEX HIST exposes historical packet captures without an API key.  The HIST catalog
feed code `DPLS` corresponds to IEX DEEP+, the order-by-order equities feed.
This is true market-by-order data for displayed resting orders on **IEX venue
only**.  It is not a consolidated US national order book and does not reveal
undisplayed/hidden liquidity.

Do not confuse it with HIST `DEEP`, which is the price-aggregated depth feed.

Catalog:

```
https://iextrading.com/api/1.0/hist
```

Acquisition CLI:

```bash
python3 scripts/iex_hist_deep_plus.py inventory
python3 scripts/iex_hist_deep_plus.py download --date latest
python3 scripts/iex_hist_deep_plus.py download --date 20261005
```

No IEX API token is used or expected.

## Storage decision

The Mastermind external SSD is the correct **hot/staging + normalized PIT** home,
but it cannot hold a complete raw HIST mirror.

Observed on 2026-10-07 from the M2:

- mount: `/Volumes/Mastermind`
- filesystem total: 4,000,577,273,856 bytes (about 3.64 TiB)
- free when measured: about 474 GB
- DPLS catalog: 457 files, 2024-10-01 through 2026-10-05
- total compressed raw DPLS: about 4.478 TB decimal
- recent daily raw captures: roughly 10-15 GB compressed each

Canonical data root:

```
/Volumes/Mastermind/market-data/iex/hist/
  raw/DPLS/YYYY/MM/YYYYMMDD_IEXTP1_DPLS1.0.pcap.gz
  normalized/...
  manifests/...
```

The downloader keeps a 50 GiB free-space reserve by default, writes to a
`.part` file, validates the exact catalog byte size and completed-file SHA-256,
atomically renames the completed capture, and writes a receipt adjacent to the
raw file. For a verified partial, capacity checks count only the remaining
allocation plus that same reserve.

### Reuse and continuation integrity

An existing final file is reusable only with a valid
`mastermind.iex_hist_acquisition.v1` receipt. The selected feed, date, protocol,
version, source URL and expected size must match. Actual file and receipt sizes,
source/product/scope labels, acquisition history types and a recomputed full-file
SHA-256 must also agree. The historical `local_path` may describe a prior
location; successful validation does not rewrite it or the acquisition time.
Valid existing v1 receipts do not need new ETag fields.

Receipt existence or byte count alone is insufficient. Missing, malformed,
wrong-object or wrong-digest receipts are preserved and refused. A final file
without a receipt is not adopted by generating a fresh acquisition history.
An orphan receipt likewise blocks a replacement transfer.

A newly interrupted transfer records its retained prefix in
`<capture>.pcap.gz.part.json`, schema `mastermind.iex_hist_partial.v1`. The
sidecar binds the catalog identity, effective response URL, observed ETag,
identity encoding, retained length and prefix SHA-256. Data is flushed and
fsynced before the sidecar is atomically replaced. A controlled short read or
network error can therefore leave a matching checkpoint. A hard crash can leave
missing or mismatched metadata; that state is refused without truncation or
restamping. Unfinished metadata temporary files also require reconciliation.

Resume requires a matching prefix digest and a **strong quoted ETag recorded
when those bytes were received**. Weak ETags, Last-Modified-only state and a
validator obtained later cannot establish the old prefix's origin. For prefix
length `k` and catalog size `N`, the same owner sends `Range: bytes=k-(N-1)`,
`If-Range: <saved ETag>` and `Accept-Encoding: identity`. Before append it requires
HTTP 206, the same effective resource URL and strong ETag, a single exact
`Content-Range: bytes k-(N-1)/N`, identity encoding, and a matching Content-Length
when present. Multipart, duplicate/conflicting integrity headers, an ignored
range returning HTTP 200, and changed representations are refused before append.
No recursive restart or deletion follows a rejected response.

Streaming is bounded by the selected object's remaining byte count. Short,
overlong or interrupted bodies never receive a successful acquisition receipt.
Only an exactly completed file whose stored digest matches the received bytes
can be sealed. A fresh full HTTP 200 transfer may complete without a strong
ETag; if interrupted, that partial is preserved but cannot be resumed
automatically.

Legacy partials without metadata, zero-length/complete/oversized partials,
orphan metadata and mismatched checkpoints remain in place for the original
owner to reconcile. This command assumes one admitted acquisition writer; it
does not seize another process's files or establish execution absence. The
existing October 5 archive and original receipt documented by the downstream
owners are not repair fixtures. SHA-256 verifies consistency with recorded local
bytes; it is not an exchange-supplied authenticity guarantee.

These rules use the strong-validator and range semantics in
[RFC 9110 sections 13.1.5 and 14.4](https://www.rfc-editor.org/rfc/rfc9110.html).
The downloader deliberately accepts only one exact remaining range and does
not introduce a subrange scheduler or retry service.

## Downstream packet decode and PIT Parquet

Do not accumulate raw captures indefinitely. Continue through the existing
decoder/replay owners above; their existence does not certify complete-session
normalization, Parquet output, retention or a daily scheduler.

For each sealed raw DPLS capture:

1. parse Ethernet/IP/UDP and IEX-TP framing;
2. preserve packet/session sequence and exchange timestamps;
3. decode DEEP+ order-level events according to the exact DEEP+ 1.0 spec;
4. normalize into append-only order events partitioned by trading date and
   symbol;
5. validate sequence continuity and order-lifecycle invariants;
6. write compressed Parquet plus a normalization manifest and raw SHA-256
   lineage;
7. only after successful readback/validation may retention policy delete an old
   raw capture.

Minimum normalized fields should include:

```
trading_date
symbol
iex_channel/session identity
packet_sequence
message_sequence / event sequence when supplied
exchange_timestamp_ns
local_ingested_at_ns
event_type
order_id
side
price
quantity
executed_quantity when applicable
flags / sale or event conditions when applicable
source_file_sha256
schema_version
parser_version
gap_before
```

Exact field names and event semantics must be bound to the official DEEP+ 1.0
spec rather than inferred from ordinary DEEP.

## PIT contract

The source capture is already historical T+1 evidence.  Keep two clocks
separate:

- `exchange_timestamp_ns`: time of the event in the exchange feed.
- `local_ingested_at_ns`: when Mastermind acquired/normalized the historical
  evidence.

For historical strategy evaluation, do not pretend the T+1 HIST file was
available during the trading session.  It can train/validate microstructure
models and reconstruct IEX book state, but it is not contemporaneous input for
an intraday historical decision unless a separately licensed live feed existed
at that time.

## Retention policy

Until measured normalized size is known:

- retain the newest 5-10 raw DPLS days for parser regression/replay;
- normalized Parquet is the durable local research representation;
- older raw PCAP can be re-fetched from HIST while the file remains in IEX's
  retention window, so do not sacrifice the SSD to a raw mirror;
- do not publish raw exchange data to a public R2 bucket or client surface;
- any cloud archival decision must first map current IEX HIST terms to that
  storage/distribution use.

## Product ownership

- Terminal Quote/Data plane remains the market-data owner.
- This HIST lane is research/PIT calibration data, not a second quote authority.
- Live depth later enters through the existing Terminal Quote Hub server-side
  provider architecture.
- Macro/Commission 15 and other intelligence consumers should consume derived,
  versioned microstructure features or research datasets, not acquire a rival
  raw feed independently.

## Acceptance for acquisition lane

- DPLS is selected independently from DEEP.
- explicit and latest dates resolve from the public HIST catalog.
- storage partition is deterministic.
- insufficient free space fails closed.
- complete file size is checked against the catalog.
- completed files are SHA-256 sealed with an acquisition receipt.
- existing final receipts are parsed, bound to the selected object and verified
  against the current full-file digest without rewriting their history.
- resume requires a bound prefix, strong response validator, exact range/length
  and bounded body; rejected artifacts are preserved without automatic restart.
- no API key or browser credential exists in the path.

The actual `download()` branches have an offline standard-library suite with tiny
temporary files and fake HTTP responses:

```bash
python3 -m unittest discover -s tests -p test_iex_hist_download_integrity.py -v
```

This exercises valid sealed reuse, malformed/mismatched/corrupt artifacts,
fresh transfer, interrupted transfer and verified resume, range/version/header
rejection, exact byte budgets, unchanged reserve boundaries and refusal to
replace a newly appeared final artifact. It performs no catalog request, live
acquisition, full-archive rehash, host cleanup or scheduler operation. The
original six catalog/path/receipt/capacity tests remain alongside it.
