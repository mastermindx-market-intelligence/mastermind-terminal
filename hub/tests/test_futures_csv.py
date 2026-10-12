"""Hermetic CSV/public-prefix tests. All inputs generated here are SYNTHETIC."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import futures_csv as fields
import acquire_futures_sample as acquisition

STAMP = '2025-09-22T00:00:00.123456789Z'
HEADER = 'ts_recv,ts_event,rtype,publisher_id,instrument_id,action,side,price,size,channel_id,order_id,flags,ts_in_delta,sequence,symbol'.split(',')

def sample_bytes():
    data = io.StringIO(newline='')
    writer = csv.writer(data); writer.writerow(HEADER)
    rows = [
        ['2025-09-22T00:00:00.000000000Z', STAMP, 160, 1, 42, 'R', 'N', '', 0, 0, 0, 40, 0, 0, 'ESZ5'],
        ['2025-09-22T00:00:00.000000000Z', STAMP, 160, 1, 42, 'A', 'B', '6700.250000000', 1, 0, 9007199254740993, 168, 0, 1, 'ESZ5'],
        ['2025-09-22T00:00:01.000000000Z', STAMP, 160, 1, 42, 'T', 'B', '6700.500000000', 2, 0, 0, 0, 0, 2, 'ESZ5'],
        ['2025-09-22T00:00:01.000000001Z', STAMP, 160, 1, 42, 'F', 'A', '6700.500000000', 2, 0, 2, 128, 0, 2, 'ESZ5'],
        ['2025-09-22T00:00:02.000000000Z', STAMP, 160, 1, 42, 'T', 'A', '6700.250000000', 9, 0, 0, 128, 0, 3, 'ESZ5'],
    ]
    writer.writerows(rows)
    return data.getvalue().encode()

class Response(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'text/csv'}

class CsvBoundaryTest(unittest.TestCase):
    def test_nanosecond_and_price_are_lossless(self):
        self.assertEqual(fields.timestamp_ns(STAMP), '1758499200123456789')
        self.assertEqual(fields.fixed_price('6714.750000000'), '6714750000000')
        self.assertEqual(fields.fixed_price('-0.000000001'), '-1')
        self.assertEqual(fields.fixed_price(''), str(2**63-1))
        self.assertEqual(fields.integer('9007199254740993', 64), 9007199254740993)

    def test_timestamp_no_float_or_silent_timezone_coercion(self):
        for value in ['2025-09-22T00:00:00Z', '2025-09-22T00:00:00.123Z',
                      '2025-09-22T00:00:00.123456789-04:00', '2025-02-30T00:00:00.000000000Z']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                fields.timestamp_ns(value)
        self.assertEqual(int(fields.timestamp_ns('2025-09-22T00:00:00.123456790Z')) - int(fields.timestamp_ns(STAMP)), 1)

    def test_fixed_decimal_schema_is_required(self):
        for value in ['6714.75', 'NaN', '1e3', '1.0000000001', '9223372036.854775808']:
            with self.subTest(value=value), self.assertRaises(ValueError): fields.fixed_price(value)
        for value in ['-1', '1.0', '01', '4294967296']:
            with self.subTest(value=value), self.assertRaises(ValueError): fields.integer(value)

    def test_normalizes_order_ids_without_collision(self):
        rows = list(csv.DictReader(io.StringIO(sample_bytes().decode())))
        first = fields.normalize_mbo(rows[1])
        self.assertEqual(first['order_id'], '9007199254740993')
        self.assertEqual(first['price'], '6700250000000')
        self.assertEqual(fields.normalize_mbo(rows[0])['price'], str(2**63-1))
        with self.assertRaises(ValueError): fields.normalize_mbo({**rows[1], 'rtype': '1'})

    def test_reference_book_fields_keep_fixed_point_size_and_count(self):
        row = {'rtype':'1','publisher_id':'1','instrument_id':'42','ts_recv':STAMP,'sequence':'1','flags':'128',
            'symbol':'ESZ5','bid_px_00':'6714.750000000','ask_px_00':'6715.000000000',
            'bid_sz_00':'9','ask_sz_00':'11','bid_ct_00':'7','ask_ct_00':'10'}
        r = fields.normalize_reference(row)
        self.assertEqual(r['bidPrice'], '6714750000000'); self.assertEqual(r['bidSize'], 9)
        self.assertEqual(r['askCount'], 10)

    def test_acquisition_ends_at_complete_event_and_reuses_verified_prefix(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(acquisition, 'ROOT', Path(tmp)):
            with patch.object(acquisition, 'urlopen', return_value=Response(sample_bytes())) as network:
                receipt = acquisition.acquire('mbo', 1)
                self.assertEqual(network.call_count, 1)
            folder = Path(receipt['localDirectory'])
            self.assertEqual(receipt['recordCount'], 4)
            self.assertEqual(receipt['lastReceiveNs'], '1758499201000000001')
            self.assertFalse(receipt['fullFile']); self.assertFalse(receipt['live'])
            self.assertEqual(hashlib.sha256((folder/'prefix.csv').read_bytes()).hexdigest(), receipt['rawPrefixSha256'])
            rows = [json.loads(r) for r in (folder/'normalized.jsonl').read_text().splitlines()]
            self.assertEqual(rows[-1]['record']['action'], 'F')
            self.assertEqual(rows[-1]['ordinal'], 3)
            with patch.object(acquisition, 'urlopen', side_effect=AssertionError('must not redownload')):
                self.assertTrue(acquisition.acquire('mbo', 1)['reused'])

    def test_corrupt_saved_prefix_is_not_refetched_or_called_verified(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(acquisition, 'ROOT', Path(tmp)):
            with patch.object(acquisition, 'urlopen', return_value=Response(sample_bytes())):
                receipt = acquisition.acquire('mbo', 1)
            (Path(receipt['localDirectory'])/'prefix.csv').write_text('corrupt')
            with patch.object(acquisition, 'urlopen', side_effect=AssertionError('no automatic retry')):
                with self.assertRaisesRegex(ValueError, 'digest_mismatch'): acquisition.acquire('mbo', 1)

    def test_no_arbitrary_url_or_unbounded_request(self):
        for schema, seconds in [('https://example.com',1),('mbo',0),('mbo',901),('mbo',True)]:
            with self.subTest(schema=schema, seconds=seconds), self.assertRaises(ValueError):
                acquisition.acquire(schema, seconds)

    def test_partial_source_cannot_publish_a_complete_receipt(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(acquisition, 'ROOT', Path(tmp)):
            with patch.object(acquisition, 'urlopen', return_value=Response(sample_bytes())), patch('builtins.print'):
                with self.assertRaisesRegex(ValueError, 'ended_before'): acquisition.acquire('mbo', 10)
            self.assertFalse((Path(tmp)/'public-mbo-10s').exists())

if __name__ == '__main__':
    unittest.main()
