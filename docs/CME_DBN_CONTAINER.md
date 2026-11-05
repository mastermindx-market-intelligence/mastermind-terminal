# Offline DBN v3 trade containers

## What this component does

`ingest/cme_dbn_container.py` validates one bounded, immutable, uncompressed DBN v3 trade container and passes its exact 48-byte records to the existing [record normalizer](CME_LARGE_TRADES_ADMISSION.md). It provides structural validation and content binding. It does not open files, authenticate an export, supply instrument definitions, decompress data, or activate a provider or public feed.

The layout is pinned to Databento DBN library **v0.71.0**, commit `d368005a636bae84bff443cd6ddae6430a0ffd00`, **wire version 3**. A parsed wire version does not identify the library release or normalization epoch that produced an actual file. The [machine-readable profile](evidence/large-trades/cme-dbn-container-policy.json) and [source verification](evidence/large-trades/cme-dbn-container-verification.json) record the contract and its evidence.

## API

`parse_container(data: bytes, limits=Limits())` returns a frozen `ParsedContainer` after checking the entire supplied file. A valid container with zero records can parse. `normalize_container` requires at least one record because the unchanged record normalizer has a nonempty artifact contract.

```python
from ingest.cme_dbn_container import parse_container, normalize_container

parsed = parse_container(container_bytes)
result = normalize_container(
    container_bytes,
    artifact_binding,
    dated_mappings,
    qualification_at_ns,
    publication_at_ns,
    metadata_range_semantics="half_open_query_ts_recv",
)
view = result.at_knowledge(knowledge_cutoff_ns)
```

The variables above must contain the caller's separately supplied `ArtifactBinding`, dated `DatedMapping` and `DefinitionBinding` evidence, and explicit knowledge clocks. Metadata cannot construct those bindings or make them trustworthy. The normalization entry point always reparses original immutable bytes; it does not accept a previously constructed `ParsedContainer` or a serialized diagnostic report as authority.

`ContainerResult.at_knowledge(ns)` returns no metadata, observations or numeric gross quantity before declared publication. `to_dict()` is a diagnostic accessor and returns a fresh copy. Mutating that copy does not change the sealed result. These Python data objects and JSON reports are diagnostics, not authentication tokens or a public market-data interface.

## Supported format and strict import profile

The supported dataset is `GLBX.MDP3`, schema `trades` (4), raw-symbol input (1), instrument-ID output (0), and `ts_out=false`. Records must be 48-byte `TradeMsg` records with length 12 four-byte words, rtype 0, publisher 1, action T, and side A/B/N. MBO fills, MBP-n, mixed schemas, definitions, appended timestamps, concatenated containers and compressed input are unsupported.

The eight-byte prelude contains DBN magic, the wire version, and a little-endian metadata payload length. That length excludes the first eight bytes. The fixed fields, count-prefixed arrays and all dated mapping intervals must fit within that declared metadata slice. A malformed metadata array cannot consume the first trade records to complete itself. The first record begins at `8 + metadata_payload_length`.

The symbol-string width comes from its u16 header field. This profile supports widths 1 through 256; the ordinary v3 width is 71 and the pinned encoder also tests 50. Width 1 is useful only when the relevant string arrays are empty. Strings must be nonempty printable ASCII without spaces, NUL-terminated, and followed by zero padding. The 53 reserved bytes must be zero. After the last mapping, exactly zero to seven zero bytes provide minimal eight-byte alignment. Duplicate entries in an array, duplicate raw-symbol mappings, unsorted or overlapping intervals, invalid dates and noncanonical numeric instrument IDs refuse the supported profile.

These restrictions define this importer. The reference decoder permits some reserved/string/tail representations that this canonical profile refuses. Such a refusal is not a universal finding that the input is corrupt DBN.

Every record boundary and supported record field is checked before a parsed object is returned. A malformed later record refuses the whole parse. A later projection failure in the record normalizer, such as an unsupported tick grid or unavailable external dated mapping, may return its existing **incomplete prefix diagnostics**. That result is explicitly refused and cannot be presented as a complete normalized container.

## Full-file identity and metadata declarations

The reader computes SHA256 over all supplied original container bytes, including metadata. The supplied artifact's SHA256, byte length and first record offset must agree. Its metadata evidence SHA256 must bind the exact header-and-metadata prefix `[0, first_record_offset)`, including the prelude. Matching hashes establish content consistency; they do not authenticate the producer.

Each `RecordBlock` passed to the unchanged normalizer uses the full-container SHA256, the original absolute offset, and the exact 48 bytes. Identical records at different positions remain separate observations. If metadata changes, the full-container identity changes even when every trade payload is unchanged. Overlapping exports cannot therefore be merged or deduplicated automatically.

Requested, partial and not-found symbols remain unverified declarations. For each observed record, the bridge requires one metadata mapping covering its capture-time UTC date, and the resulting raw symbol must agree with the separately supplied dated mapping. A record cannot belong to a not-found symbol. Definitions, tick size, multiplier, effective interval and their knowledge times retain all existing normalizer requirements.

In the synthetic quantity control, one report with size **1301** means **1,301 as-reported contracts in one observation**. It provides no distinct order count. Two identical reports at different physical positions produce 2,602 contracts in two observations. No candle volume, dollar multiplier or estimated order count replaces the executed quantity.

## Query bounds, split files and knowledge

Metadata start/end can describe a historical query or the first/last record of a split file. The bridge therefore requires the explicit caller declaration `metadata_range_semantics="half_open_query_ts_recv"`. It does not infer that meaning from timestamps or a filename. Unknown or split-file semantics are unsupported by this bridge; a structurally valid split file can still parse.

For that declared query profile, start is inclusive and end is exclusive, using **ts_recv**. Native event time may fall outside that range or decrease between records. Records retain their original physical order; the reader never sorts the tape by event time. An unset end and a zero query limit do not prove completeness.

Acquisition, metadata/framing knowledge, normalization knowledge, mapping/definition/tick knowledge, qualification and publication remain separate. Framing knowledge must be at or after acquisition. The existing normalizer checks source clocks and requires all dependency knowledge to precede qualification and publication. Historical declarations remain `caller_supplied_unverified`; fixtures remain `synthetic`. Parsing never converts vendor capture time into Mastermind live receipt.

## Resource limits

| Resource | Default | Hard maximum |
| --- | ---: | ---: |
| Full container bytes | 2 MiB | 4 MiB |
| Metadata payload bytes | 1 MiB | 1 MiB |
| Records and identities | 4,096 | 4,096 |
| Symbol-string width | 256 | 256 |
| Total metadata strings | 1,024 | 1,024 |
| Raw-symbol mappings | 64 | 64 |
| Total mapping intervals | 512 | 512 |
| Serialized normalized JSON | 16 MiB | 32 MiB |

Input accounting includes the prelude, metadata and records. Counts are checked against the declared metadata slice before iteration, and string/interval totals are cumulative across arrays. The parsed object is bounded by these input and count limits. Normalized JSON is encoded incrementally with an exact byte cap, including metadata and observation expansion. Exceeding a cap refuses the operation without truncation, eviction or an apparently complete partial result. `max_output_bytes` applies to the sealed normalized output, not the optional structural dictionary view.

## Evidence and admission limits

Normalized results retain `gross_as_reported`, `correctionCoverage=unsupported`, `publicConsumerEligible=false`, and `orderCount=null`. They do not produce quote responses, absorption, trapped-trader conclusions or OOS performance.

The outer structural result reports framing and canonical-profile validation. The nested record-only component retains `metadataFramingReaderImplemented=false`; that field describes the unchanged component. Its rights, provenance, completeness, correction and public-eligibility fields are not rewritten.

The deterministic tests use synthetic bytes and the actual repository record normalizer. Independent controls use a manually constructed corpus frozen before implementation inspection. The source verification record distinguishes author tests, independent cases and integrated repository checks, and preserves the first malformed golden-vector failure. No test result establishes a licensed CME capture, authenticated acquisition, native SBE correction coverage, an active feed or production deployment.

From the repository root:

```sh
python3 -B -m pytest -q -p no:cacheprovider \
  tests/test_cme_dbn_container.py \
  tests/test_cme_databento_trades.py \
  tests/test_cme_native_fixture_ledger.py \
  tests/test_iex_deep_trades.py
```

Actual export provenance, trusted definitions, corrections, completeness, rights and production behavior still require the separate [admission and release gates](evidence/large-trades/release-handoff.md).

## Primary references

- Pinned [encoder](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/encode/dbn/sync.rs), [decoder](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/decode/dbn/fsm.rs), [metadata](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/metadata.rs), [enums](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/enums.rs), and [symbol mapping](https://github.com/databento/dbn/blob/d368005a636bae84bff443cd6ddae6430a0ffd00/rust/dbn/src/symbol_map.rs).
- Official [DBN format](https://databento.com/docs/standards-and-conventions/databento-binary-encoding) and [historical query range](https://databento.com/docs/api-reference-historical/timeseries/timeseries-get-range).
- Official [DBNStore.to_file](https://databento.com/docs/api-reference-historical/helpers/dbn-store-to-file): an existing authorized producer must select `compression="none"` explicitly to choose uncompressed output. `compression=None` may preserve existing compression. A `.dbn` suffix is not evidence of compression state. This component does not export data or contact a provider.
