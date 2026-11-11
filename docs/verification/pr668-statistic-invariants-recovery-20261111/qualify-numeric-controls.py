import hashlib
import json
import math
import platform
import statistics
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
extractor = Path(sys.argv[2]).resolve()
extracted = json.loads(subprocess.check_output(['node', str(extractor), str(root)]))


def decode(record):
    if record['value'] is None:
        return None
    return -0.0 if record['negativeZero'] else float(record['value'])


def encode(value):
    return {'value': value, 'negativeZero': value == 0 and math.copysign(1.0, value) < 0}


results = []
for case in extracted['controls']:
    values = [decode(record) for record in case['returns'] if record['value'] is not None]
    actual = {
        'mean_pct': round(math.fsum(values) / len(values), 4),
        'median_pct': round(float(statistics.median(values)), 4),
        'min_pct': round(min(values), 4),
        'max_pct': round(max(values), 4),
    }
    for key, value in actual.items():
        assert math.isfinite(value)
        expected = decode(case['statistics'][key])
        assert expected == value and math.copysign(1.0, expected) == math.copysign(1.0, value), (case['label'], key, expected, value)
    results.append({**case, 'standardLibraryResult': {key: encode(value) for key, value in actual.items()}, 'exactIncludingSignedZero': True})

print(json.dumps({
    'schema': 'terminal.perf-standard-library-control-qualification.v1',
    'testPath': extracted['testPath'], 'testSha256': extracted['testSha256'],
    'extractorSha256': hashlib.sha256(extractor.read_bytes()).hexdigest(),
    'pythonVersion': platform.python_version(), 'controlsPassed': len(results), 'results': results,
    'basis': 'Evaluate only the four published native arithmetic expressions with Python standard-library numbers extracted from the actual Terminal tests.',
    'macroModuleImportedOrExecuted': False, 'producerRouteExecuted': False,
    'fullStatisticsEquivalenceEstablished': False,
}, indent=2) + '\n')
