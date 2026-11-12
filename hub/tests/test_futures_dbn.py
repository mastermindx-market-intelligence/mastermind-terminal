"""Executable conformance for the official DBN decoder -> JSON boundary.

The upstream MBO assets contain TWO cancellations, not a full-session book.
Native synthetic DBN cases are labeled separately and are never called real CME data.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

import databento_dbn as dbn
import zstandard

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/databento-dbn"
spec = importlib.util.spec_from_file_location("normalize_futures_dbn", ROOT / "tools/normalize_futures_dbn.py")
normalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalizer)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def native_file(records):
    metadata = dbn.Metadata(dataset="GLBX.MDP3", start=1791547200000000000,
        end=1791547201000000000, schema=dbn.Schema.MBO,
        stype_in=dbn.SType.RAW_SYMBOL, stype_out=dbn.SType.INSTRUMENT_ID,
        symbols=["ESZ6"], version=3)
    return bytes(metadata) + b"".join(bytes(r) for r in records)


def mbo(action="T", flags=128, order_id=9007199254740993):
    return dbn.MBOMsg(publisher_id=1, instrument_id=42, ts_event=1791547200000000011,
        ts_recv=1791547200000000111, order_id=order_id, price=7500000000000,
        size=7, action=dbn.Action.TRADE if action == "T" else dbn.Action.ADD,
        side=dbn.Side.BID, flags=flags, channel_id=0, sequence=10)


class DbnBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def convert(self, data, name="sample.dbn", max_records=100):
        source, output = self.folder / name, self.folder / (name + ".jsonl")
        source.write_bytes(data)
        receipt = normalizer.normalize(source, output, digest(data), max_records)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        self.assertEqual(receipt["outputSha256"], digest(output.read_bytes()))
        return receipt, rows

    def test_upstream_v1_and_v3_keep_the_same_exact_mbo_records(self):
        old = (FIXTURES / "test_data.mbo.dbn").read_bytes()
        new = (FIXTURES / "test_data.mbo.v3.dbn").read_bytes()
        self.assertEqual(digest(old), "31403d17bf9801842acf59bca668e6b8f19ff4b5d70dce05f0fe70d995fc70d6")
        self.assertEqual(digest(new), "d2a526d952f845ab8f03ceac42ec828a2541e0b5e2e8a64df2e8bbaa1e898184")
        receipt, a = self.convert(old, "v1.dbn")
        _, b = self.convert(new, "v3.dbn")
        self.assertEqual(receipt["recordCount"], 2)
        self.assertEqual([r["record"] for r in a[1:]], [r["record"] for r in b[1:]])
        self.assertEqual(a[1]["record"]["order_id"], "647784973705")
        self.assertEqual(a[1]["record"]["ts_event"], "1609160400000429831")
        self.assertEqual(a[1]["record"]["price"], "3722750000000")
        self.assertEqual(a[1]["record"]["action"], "C")
        self.assertEqual(a[0]["mappings"]["ESH1"][0]["instrumentId"], "5482")
        self.assertFalse(receipt["live"])
        self.assertEqual(receipt["availabilityBasis"], "vendor_capture_retrospective")

    def test_official_compressed_status_keeps_venue_state_not_clock_inference(self):
        receipt, rows = self.convert((FIXTURES / "test_data.status.v3.dbn.zst").read_bytes())
        self.assertEqual(receipt["sourceSchema"], "status")
        self.assertEqual(rows[1]["record"]["is_trading"], "Y")
        self.assertEqual(rows[2]["record"]["is_trading"], "N")
        self.assertEqual(rows[1]["record"]["ts_recv"], "1609113600000000000")

    def test_non_cme_definition_is_refused_not_mislabeled_futures(self):
        data = (FIXTURES / "test_data.definition.v3.dbn.zst").read_bytes()
        with self.assertRaisesRegex(ValueError, "unsupported_dataset"):
            self.convert(data)
        self.assertFalse((self.folder / "sample.dbn.jsonl").exists())

    def test_synthetic_native_sdk_uint64_and_ns_survive_json(self):
        receipt, rows = self.convert(native_file([mbo()]))
        self.assertEqual(receipt["recordCount"], 1)
        self.assertEqual(rows[1]["record"]["order_id"], "9007199254740993")
        self.assertEqual(rows[1]["record"]["ts_recv"], "1791547200000000111")
        self.assertIsInstance(rows[1]["record"]["price"], str)
        self.assertEqual(rows[1]["ordinal"], 0)

    def test_compressed_and_concatenated_frames_decode_equivalently(self):
        data = native_file([mbo(), mbo(order_id=999)])
        compression = zstandard.ZstdCompressor()
        _, plain = self.convert(data, "plain")
        _, compressed = self.convert(compression.compress(data), "compressed")
        split = len(data) // 2
        _, concatenated = self.convert(compression.compress(data[:split]) + compression.compress(data[split:]), "concat")
        for output in (compressed, concatenated):
            self.assertEqual([r["record"] for r in output[1:]], [r["record"] for r in plain[1:]])

    def test_partial_raw_record_is_not_published(self):
        with self.assertRaisesRegex(ValueError, "truncated_or_unconsumed"):
            self.convert(native_file([mbo()])[:-1])
        self.assertFalse((self.folder / "sample.dbn.jsonl").exists())

    def test_partial_compressed_frame_is_not_published(self):
        data = zstandard.ZstdCompressor().compress(native_file([mbo()]))
        with self.assertRaisesRegex(ValueError, "truncated_compression"):
            self.convert(data[:-1])
        self.assertFalse((self.folder / "sample.dbn.jsonl").exists())

    def test_digest_mismatch_does_not_create_output(self):
        src, out = self.folder / "input", self.folder / "output"
        src.write_bytes(native_file([mbo()]))
        with self.assertRaisesRegex(ValueError, "digest_mismatch"):
            normalizer.normalize(src, out, "0" * 64)
        self.assertFalse(out.exists())

    def test_existing_output_is_never_overwritten(self):
        src, out = self.folder / "input", self.folder / "output"
        data = native_file([mbo()]); src.write_bytes(data); out.write_text("keep me")
        with self.assertRaisesRegex(ValueError, "output_exists"):
            normalizer.normalize(src, out, digest(data))
        self.assertEqual(out.read_text(), "keep me")

    def test_record_limit_fails_instead_of_silently_truncating(self):
        with self.assertRaisesRegex(ValueError, "record_limit"):
            self.convert(native_file([mbo(), mbo()]), max_records=1)
        self.assertFalse((self.folder / "sample.dbn.jsonl").exists())

    def test_empty_or_non_dbn_source_fails_without_output(self):
        for data in (b"", b"not dbn", b"DBN\x03"):
            with self.subTest(data=data):
                with self.assertRaises(Exception):
                    self.convert(data)
                self.assertFalse((self.folder / "sample.dbn.jsonl").exists())

    def test_atomic_no_replace_if_a_writer_creates_the_output_during_decode(self):
        source, output = self.folder / "input", self.folder / "output"
        data = native_file([mbo()]); source.write_bytes(data)
        original = normalizer.encode_record
        def race(record):
            output.write_text("other writer")
            return original(record)
        with patch.object(normalizer, "encode_record", side_effect=race):
            with self.assertRaises(FileExistsError):
                normalizer.normalize(source, output, digest(data))
        self.assertEqual(output.read_text(), "other writer")
        self.assertFalse(list(self.folder.glob(".futures-normalize-*")))

    def test_source_changed_mid_decode_cannot_earn_a_receipt(self):
        source, output = self.folder / "input", self.folder / "output"
        data = native_file([mbo()]); source.write_bytes(data)
        original = normalizer.encode_record
        def mutate(record):
            source.write_bytes(data + b"changed")
            return original(record)
        with patch.object(normalizer, "encode_record", side_effect=mutate):
            with self.assertRaises(Exception):
                normalizer.normalize(source, output, digest(data))
        self.assertFalse(output.exists())


    def replay_with_node(self, output, receipt, binding, decision):
        code = """
const { replayNormalizedSource } = require(process.argv[1]);
replayNormalizedSource(process.argv[2], JSON.parse(process.argv[3]))
 .then(value => console.log(JSON.stringify(value)))
 .catch(error => { console.error(error.message); process.exitCode = 2; });
"""
        args = {"sha256": receipt["outputSha256"], "bindings": [binding],
                "decisionTimeNs": str(decision), "maxAgeNs": "1000000000"}
        run = subprocess.run(["node", "-e", code, str(ROOT / "tools/replay_futures_source.js"),
            str(output), json.dumps(args)], text=True, capture_output=True, timeout=15)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)

    def test_upstream_cancellations_do_not_fabricate_a_starting_depth_book(self):
        data = (FIXTURES / "test_data.mbo.v3.dbn").read_bytes()
        receipt, _ = self.convert(data)
        binding = {"contract": "ESH1", "publisherId": 1, "instrumentId": 5482,
            "sessionId": "2020-12-28", "validFromNs": "1600000000000000000",
            "validUntilNs": "1610000000000000000", "definitionId": "codec-test-only:not-venue-proof",
            "definitionAvailableAtNs": "1600000000000000000"}
        result = self.replay_with_node(self.folder / "sample.dbn.jsonl", receipt, binding, 1609160400000711344)
        self.assertEqual(result["acceptance"], "source_not_ready_for_depth")
        self.assertEqual(result["views"][0]["reason"], "snapshot_required")
        self.assertIsNone(result["views"][0]["bestBid"])
        self.assertEqual(result["observedTrades"], 0)
        self.assertEqual(result["rows"], 2)

    def test_synthetic_native_dbn_reaches_the_actual_node_book_and_trade_reducers(self):
        start = 1791547200000000000
        records = []
        for i, (action, side, price, size, flags, order) in enumerate([
            (dbn.Action.CLEAR, dbn.Side.NONE, 9223372036854775807, 0, 40, 0),
            (dbn.Action.ADD, dbn.Side.BID, 7500000000000, 5, 40, 9007199254740993),
            (dbn.Action.ADD, dbn.Side.ASK, 7500250000000, 9, 168, 9007199254740994),
            (dbn.Action.TRADE, dbn.Side.BID, 7500250000000, 2, 128, 0),
        ]):
            records.append(dbn.MBOMsg(publisher_id=1, instrument_id=42, ts_event=start + i,
                ts_recv=start + 100 + i, order_id=order, price=price, size=size,
                action=action, side=side, flags=flags, sequence=i, channel_id=0))
        receipt, _ = self.convert(native_file(records))
        binding = {"contract": "ESZ6", "publisherId": 1, "instrumentId": 42,
            "sessionId": "2026-10-09", "validFromNs": str(start - 1000),
            "validUntilNs": str(start + 100000), "definitionId": "synthetic-native-test",
            "definitionAvailableAtNs": str(start - 1)}
        result = self.replay_with_node(self.folder / "sample.dbn.jsonl", receipt, binding, start + 1000)
        self.assertEqual(result["views"][0]["bestBid"]["size"], 5)
        self.assertEqual(result["views"][0]["bestAsk"]["size"], 9)
        self.assertEqual(result["observedTrades"], 1)
        self.assertEqual(result["observedContracts"], 2)
        self.assertEqual(result["acceptance"], "replayed_requires_external_book_comparison")
        # At the snapshot's last record, the future trade is not yet admitted.
        earlier = self.replay_with_node(self.folder / "sample.dbn.jsonl", receipt, binding, start + 102)
        self.assertEqual(earlier["deferredRows"], 1)
        self.assertEqual(earlier["observedContracts"], 0)
        self.assertEqual(earlier["views"][0]["bestBid"]["size"], 5)


if __name__ == "__main__":
    unittest.main()
