# IEX HIST DEEP+ (DPLS) acquisition and PIT storage

Status: acquisition lane implemented; decode/normalization lane remains next.

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
`.part` file, resumes byte-range downloads, validates catalog byte size,
atomically renames the completed capture, computes SHA-256, and writes a
receipt adjacent to the raw file.

## Required next lane: packet decode -> PIT Parquet

Do not accumulate raw captures indefinitely.  Build the decoder before any
daily scheduler is armed.

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
- no API key or browser credential exists in the path.
