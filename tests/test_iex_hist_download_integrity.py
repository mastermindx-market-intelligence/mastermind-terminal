"""Exercise the real downloader offline; every artifact is a tiny temporary file."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "iex_hist_deep_plus.py"
SPEC = importlib.util.spec_from_file_location("iex_hist_integrity_under_test", MODULE_PATH)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)

BODY = b"abcdef"
URL = "https://example.test/dpls"
EFFECTIVE_URL = "https://mirror.example.test/dpls"
ETAG = '"fixture-version-1"'


def write_json(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")


class Response:
    def __init__(self, body=BODY, *, status=200, headers=None, url=EFFECTIVE_URL,
                 fail_after=None, on_read=None):
        self.body = body
        self.status = status
        self.headers = Message()
        for key, value in (headers or {}).items():
            if value is not None:
                self.headers[key] = value
        self.url = url
        self.fail_after = fail_after
        self.on_read = on_read
        self.position = 0
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def geturl(self):
        return self.url

    def read(self, size):
        if self.on_read is not None:
            callback, self.on_read = self.on_read, None
            callback()
        if self.fail_after is not None and self.position >= self.fail_after:
            raise OSError("synthetic interrupted response")
        result = self.body[self.position:self.position + size]
        self.position += len(result)
        return result


class DownloadIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.case_number = 0
        network_patch = patch.object(
            mod.urllib.request, "urlopen", side_effect=AssertionError("unexpected network")
        )
        self.network = network_patch.start()
        self.addCleanup(network_patch.stop)
        chunk_patch = patch.object(mod, "CHUNK_BYTES", 3)
        chunk_patch.start()
        self.addCleanup(chunk_patch.stop)

    def case(self):
        self.case_number += 1
        root = Path(self.temp.name) / str(self.case_number)
        obj = mod.HistObject("20261005", "DPLS", "1.0", "IEXTP1", len(BODY), URL)
        final = mod.destination_for(root, obj)
        final.parent.mkdir(parents=True)
        partial = final.with_suffix(final.suffix + ".part")
        return SimpleNamespace(
            root=root, obj=obj, final=final, partial=partial,
            receipt=mod.receipt_path_for(final),
            metadata=partial.with_suffix(partial.suffix + ".json"),
        )

    def snapshot(self, case):
        return {str(p.relative_to(case.root)): p.read_bytes()
                for p in case.root.rglob("*") if p.is_file()}

    def sealed(self, case):
        case.final.write_bytes(BODY)
        mod.write_receipt(
            case.obj, case.final, case.receipt, hashlib.sha256(BODY).hexdigest(), reused=False
        )
        return json.loads(case.receipt.read_text())

    def prefix(self, case, data=b"abc"):
        case.partial.write_bytes(data)
        record = {
            "schema": "mastermind.iex_hist_partial.v1",
            "feed": "DPLS", "date": "20261005", "protocol": "IEXTP1", "version": "1.0",
            "source_url": URL, "expected_size_bytes": case.obj.size,
            "response_url": EFFECTIVE_URL, "etag": ETAG, "content_encoding": "identity",
            "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        }
        write_json(case.metadata, record)
        return record

    def download(self, case, reserve=0):
        with contextlib.redirect_stdout(io.StringIO()):
            return mod.download(case.obj, case.root, reserve)

    def reject_before_network(self, case):
        before = self.snapshot(case)
        self.network.reset_mock()
        with self.assertRaises(SystemExit):
            self.download(case)
        self.network.assert_not_called()
        self.assertEqual(self.snapshot(case), before)

    def assert_complete(self, case):
        self.assertEqual(case.final.read_bytes(), BODY)
        receipt = json.loads(case.receipt.read_text())
        self.assertEqual(receipt["sha256"], hashlib.sha256(BODY).hexdigest())
        self.assertEqual(receipt["actual_size_bytes"], len(BODY))
        self.assertEqual(receipt["expected_size_bytes"], len(BODY))
        self.assertEqual(receipt["source_url"], URL)
        self.assertFalse(case.partial.exists())
        self.assertFalse(case.metadata.exists())

    def test_valid_v1_receipt_reuses_bytes_without_rewriting_history(self):
        case = self.case()
        record = self.sealed(case)
        record["acquired_at_utc"] = "2026-10-07T06:08:37+00:00"
        record["local_path"] = "/previous/location/capture.pcap.gz"
        record["reused_existing_file"] = True
        write_json(case.receipt, record)
        before = self.snapshot(case)
        self.assertEqual(self.download(case), case.final)
        self.network.assert_not_called()
        self.assertEqual(self.snapshot(case), before)

    def test_missing_or_unreadable_final_receipt_is_not_adopted(self):
        for raw in (None, "", "{broken", "[]", "null", '{"schema":"unknown"}'):
            with self.subTest(raw=raw):
                case = self.case()
                case.final.write_bytes(BODY)
                if raw is not None:
                    case.receipt.write_text(raw)
                self.reject_before_network(case)

    def test_final_receipt_identity_sizes_labels_and_history_are_validated(self):
        bad_fields = [
            ("feed", "DEEP"), ("date", "20261006"), ("protocol", "OTHER"),
            ("version", "2.0"), ("source_url", URL + "/other"),
            ("expected_size_bytes", 7), ("expected_size_bytes", "6"),
            ("expected_size_bytes", True), ("actual_size_bytes", 7),
            ("actual_size_bytes", "6"), ("actual_size_bytes", True),
            ("source", "other"), ("product", "DEEP"), ("scope", "all venues"),
            ("api_key_required", 0), ("local_path", None),
            ("reused_existing_file", "false"), ("acquired_at_utc", None),
            ("acquired_at_utc", "2026-10-07"), ("acquired_at_utc", "not-a-time"),
            ("sha256", None), ("sha256", "abc123"), ("sha256", "0" * 64),
        ]
        for key, value in bad_fields:
            with self.subTest(key=key, value=value):
                case = self.case()
                record = self.sealed(case)
                record[key] = value
                write_json(case.receipt, record)
                self.reject_before_network(case)

    def test_same_size_final_corruption_is_rejected(self):
        case = self.case()
        self.sealed(case)
        case.final.write_bytes(b"ABCDEF")
        self.reject_before_network(case)

    def test_wrong_size_final_is_rejected(self):
        case = self.case()
        self.sealed(case)
        case.final.write_bytes(b"abc")
        self.reject_before_network(case)

    def test_orphan_final_receipt_is_preserved(self):
        case = self.case()
        self.sealed(case)
        case.final.unlink()
        self.reject_before_network(case)

    def test_fresh_download_can_complete_with_strong_weak_or_no_validator(self):
        for etag in (ETAG, 'W/"weak-version"', None, "unquoted"):
            with self.subTest(etag=etag):
                case = self.case()
                response = Response(headers={"ETag": etag, "Content-Length": "6"})
                with patch.object(mod.urllib.request, "urlopen", return_value=response) as request:
                    self.assertEqual(self.download(case), case.final)
                request.assert_called_once()
                headers = {k.lower(): v for k, v in request.call_args.args[0].header_items()}
                self.assertEqual(headers["accept-encoding"], "identity")
                self.assertNotIn("range", headers)
                self.assertTrue(response.closed)
                self.assert_complete(case)

    def test_fresh_download_without_content_length_still_checks_actual_length(self):
        case = self.case()
        with patch.object(mod.urllib.request, "urlopen", return_value=Response()):
            self.download(case)
        self.assert_complete(case)

    def test_interruption_records_prefix_then_validated_resume_completes(self):
        for network_error in (False, True):
            with self.subTest(network_error=network_error):
                case = self.case()
                response = Response(b"abc", headers={"ETag": ETAG},
                                    fail_after=3 if network_error else None)
                with patch.object(mod.urllib.request, "urlopen", return_value=response):
                    with self.assertRaises(OSError if network_error else SystemExit):
                        self.download(case)
                self.assertFalse(case.final.exists())
                self.assertFalse(case.receipt.exists())
                checkpoint = json.loads(case.metadata.read_text())
                self.assertEqual(checkpoint["size_bytes"], 3)
                self.assertEqual(checkpoint["sha256"], hashlib.sha256(b"abc").hexdigest())
                self.assertEqual(checkpoint["response_url"], EFFECTIVE_URL)
                response = Response(b"def", status=206, headers={
                    "ETag": ETAG, "Content-Range": "bytes 3-5/6", "Content-Length": "3",
                })
                with patch.object(mod.urllib.request, "urlopen", return_value=response) as request:
                    self.download(case)
                request.assert_called_once()
                headers = {k.lower(): v for k, v in request.call_args.args[0].header_items()}
                self.assertEqual(headers["range"], "bytes=3-5")
                self.assertEqual(headers["if-range"], ETAG)
                self.assertEqual(headers["accept-encoding"], "identity")
                self.assert_complete(case)

    def test_legacy_or_malformed_partial_metadata_cannot_authorize_resume(self):
        for raw in (None, "", "{broken", "[]", "null", '{"schema":"unknown"}'):
            with self.subTest(raw=raw):
                case = self.case()
                case.partial.write_bytes(b"abc")
                if raw is not None:
                    case.metadata.write_text(raw)
                self.reject_before_network(case)

    def test_partial_identity_validator_and_checkpoint_must_match(self):
        bad_fields = [
            ("feed", "DEEP"), ("date", "20261006"), ("protocol", "other"),
            ("version", "2.0"), ("source_url", URL + "/other"),
            ("expected_size_bytes", 7), ("expected_size_bytes", True),
            ("size_bytes", 2), ("size_bytes", "3"), ("size_bytes", True),
            ("etag", None), ("etag", 'W/"weak"'), ("etag", "unquoted"),
            ("content_encoding", "gzip"), ("response_url", None),
            ("sha256", None), ("sha256", "0" * 64),
        ]
        for key, value in bad_fields:
            with self.subTest(key=key, value=value):
                case = self.case()
                record = self.prefix(case)
                record[key] = value
                write_json(case.metadata, record)
                self.reject_before_network(case)

    def test_partial_same_size_corruption_is_rejected(self):
        case = self.case()
        self.prefix(case)
        case.partial.write_bytes(b"ABC")
        self.reject_before_network(case)

    def test_partial_metadata_without_bytes_is_not_overwritten(self):
        case = self.case()
        self.prefix(case)
        case.partial.unlink()
        self.reject_before_network(case)

    def test_zero_complete_or_oversized_partial_is_preserved_not_promoted(self):
        for data in (b"", BODY, BODY + b"x"):
            with self.subTest(size=len(data)):
                case = self.case()
                self.prefix(case, data)
                self.reject_before_network(case)

    def test_unfinished_metadata_publication_is_not_overwritten(self):
        for which in ("receipt", "metadata"):
            with self.subTest(which=which):
                case = self.case()
                path = getattr(case, which)
                path.with_suffix(path.suffix + ".tmp").write_text("unreconciled")
                self.reject_before_network(case)

    def test_bad_resume_headers_reject_before_append_or_restart(self):
        changes = [
            ("status", 200), ("status", 416),
            ("Content-Range", None), ("Content-Range", "bytes 2-5/6"),
            ("Content-Range", "bytes 3-4/6"), ("Content-Range", "bytes 3-5/7"),
            ("Content-Range", "bytes 3-5/*"), ("Content-Range", "garbage"),
            ("Content-Range", "bytes 3-5/6, bytes 3-5/6"),
            ("ETag", None), ("ETag", 'W/"fixture-version-1"'), ("ETag", '"other"'),
            ("url", EFFECTIVE_URL + "/changed"), ("Content-Encoding", "gzip"),
            ("Content-Type", "multipart/byteranges; boundary=fixture"),
            ("Content-Length", "2"), ("Content-Length", "four"),
            ("Content-Length", "9" * 80),
        ]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                case = self.case()
                self.prefix(case)
                before = self.snapshot(case)
                headers = {"ETag": ETAG, "Content-Range": "bytes 3-5/6", "Content-Length": "3"}
                options = {"status": 206, "url": EFFECTIVE_URL}
                if key in options:
                    options[key] = value
                else:
                    headers[key] = value
                response = Response(b"def", headers=headers, **options)
                with patch.object(mod.urllib.request, "urlopen", return_value=response) as request:
                    with self.assertRaises(SystemExit):
                        self.download(case)
                request.assert_called_once()
                self.assertEqual(self.snapshot(case), before)
                self.assertEqual(response.position, 0)
                self.assertTrue(response.closed)

    def test_duplicate_resume_validator_or_range_is_rejected(self):
        for header, value in (("ETag", '"other"'), ("Content-Range", "bytes 0-2/6")):
            with self.subTest(header=header):
                case = self.case()
                self.prefix(case)
                before = self.snapshot(case)
                response = Response(b"def", status=206, headers={
                    "ETag": ETAG, "Content-Range": "bytes 3-5/6",
                })
                response.headers[header] = value
                with patch.object(mod.urllib.request, "urlopen", return_value=response):
                    with self.assertRaises(SystemExit):
                        self.download(case)
                self.assertEqual(self.snapshot(case), before)

    def test_fresh_invalid_headers_do_not_create_partial_or_receipt(self):
        for options in (
            {"status": 206}, {"headers": {"Content-Encoding": "gzip"}},
            {"headers": {"Content-Range": "bytes 0-5/6"}},
            {"headers": {"Content-Length": "3"}},
            {"headers": {"Content-Type": "multipart/byteranges"}},
        ):
            with self.subTest(options=options):
                case = self.case()
                with patch.object(mod.urllib.request, "urlopen", return_value=Response(**options)):
                    with self.assertRaises(SystemExit):
                        self.download(case)
                self.assertEqual(self.snapshot(case), {})

    def test_interrupted_unvalidated_response_is_preserved_but_not_resumable(self):
        for etag in (None, 'W/"weak"'):
            with self.subTest(etag=etag):
                case = self.case()
                with patch.object(mod.urllib.request, "urlopen",
                                  return_value=Response(b"abc", headers={"ETag": etag})):
                    with self.assertRaises(SystemExit):
                        self.download(case)
                self.assertEqual(case.partial.read_bytes(), b"abc")
                self.reject_before_network(case)

    def test_short_resume_keeps_only_an_unsealed_matching_checkpoint(self):
        case = self.case()
        self.prefix(case)
        response = Response(b"de", status=206, headers={"ETag": ETAG, "Content-Range": "bytes 3-5/6"})
        with patch.object(mod.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(SystemExit):
                self.download(case)
        self.assertFalse(case.final.exists())
        self.assertFalse(case.receipt.exists())
        self.assertEqual(case.partial.read_bytes(), b"abcde")
        checkpoint = json.loads(case.metadata.read_text())
        self.assertEqual(checkpoint["size_bytes"], 5)
        self.assertEqual(checkpoint["sha256"], hashlib.sha256(b"abcde").hexdigest())

    def test_overlong_body_never_exceeds_budget_or_seals(self):
        for resume in (False, True):
            with self.subTest(resume=resume):
                case = self.case()
                headers = {"ETag": ETAG}
                if resume:
                    self.prefix(case)
                    headers["Content-Range"] = "bytes 3-5/6"
                response = Response(b"defx" if resume else BODY + b"x",
                                    status=206 if resume else 200, headers=headers)
                with patch.object(mod.urllib.request, "urlopen", return_value=response):
                    with self.assertRaises(SystemExit):
                        self.download(case)
                self.assertFalse(case.final.exists())
                self.assertFalse(case.receipt.exists())
                self.assertLessEqual(case.partial.stat().st_size, len(BODY))
                checkpoint = json.loads(case.metadata.read_text())
                self.assertEqual(checkpoint["size_bytes"], case.partial.stat().st_size)
                self.assertEqual(checkpoint["sha256"], hashlib.sha256(case.partial.read_bytes()).hexdigest())

    def test_capacity_reserve_still_blocks_before_network(self):
        case = self.case()
        usage = SimpleNamespace(total=100, used=91, free=9)
        with patch.object(mod.shutil, "disk_usage", return_value=usage):
            with self.assertRaisesRegex(SystemExit, "Insufficient free space"):
                self.download(case, reserve=4)
        self.network.assert_not_called()
        self.assertEqual(self.snapshot(case), {})

    def test_resume_capacity_counts_only_remaining_bytes_and_same_reserve(self):
        for free in (25, 19):
            with self.subTest(free=free):
                case = self.case()
                case.obj = mod.HistObject("20261005", "DPLS", "1.0", "IEXTP1", 100, URL)
                self.prefix(case, b"x" * 90)
                before = self.snapshot(case)
                response = Response(b"y" * 10, status=206, headers={
                    "ETag": ETAG, "Content-Range": "bytes 90-99/100", "Content-Length": "10",
                })
                usage = SimpleNamespace(total=200, used=200 - free, free=free)
                with patch.object(mod.shutil, "disk_usage", return_value=usage):
                    with patch.object(mod.urllib.request, "urlopen", return_value=response) as request:
                        if free == 19:
                            with self.assertRaisesRegex(SystemExit, "Insufficient free space"):
                                self.download(case, reserve=10)
                            request.assert_not_called()
                            self.assertEqual(self.snapshot(case), before)
                        else:
                            self.download(case, reserve=10)
                            request.assert_called_once()
                            expected = b"x" * 90 + b"y" * 10
                            self.assertEqual(case.final.read_bytes(), expected)
                            receipt = json.loads(case.receipt.read_text())
                            self.assertEqual(receipt["sha256"], hashlib.sha256(expected).hexdigest())

    def test_new_final_artifact_is_not_replaced_at_sealing(self):
        case = self.case()
        response = Response(headers={"ETag": ETAG},
                            on_read=lambda: case.final.write_bytes(b"other!"))
        with patch.object(mod.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(SystemExit):
                self.download(case)
        self.assertEqual(case.final.read_bytes(), b"other!")
        self.assertEqual(case.partial.read_bytes(), BODY)
        self.assertFalse(case.receipt.exists())

    def test_receipt_publication_failure_is_not_relabelled_as_acquisition(self):
        case = self.case()
        response = Response(headers={"ETag": ETAG})
        with patch.object(mod.urllib.request, "urlopen", return_value=response):
            with patch.object(mod, "write_receipt", side_effect=OSError("synthetic receipt failure")):
                with self.assertRaisesRegex(OSError, "synthetic receipt failure"):
                    self.download(case)
        self.assertEqual(case.final.read_bytes(), BODY)
        self.assertFalse(case.partial.exists())
        self.assertFalse(case.receipt.exists())
        self.assertTrue(case.metadata.exists())
        self.reject_before_network(case)


if __name__ == "__main__":
    unittest.main()
