"""Frozen full-manifest corpus is consumed by both Python and TypeScript."""
import json
from pathlib import Path

import pytest

from api.investigation_contracts import validate_investigation_manifest

BUNDLE = json.loads((Path(__file__).resolve().parents[1] / 'terminal/lib/__tests__/fixtures/investigation_manifest_vectors.json').read_text())


@pytest.mark.parametrize('vector', BUNDLE['vectors'], ids=lambda v: v['name'])
def test_shared_manifest_acceptance_and_exact_detached_roundtrip(vector):
    original = json.loads(json.dumps(vector['manifest']))
    result = validate_investigation_manifest(original, vector['admission'])
    assert result['ok'] is vector['valid'], result
    assert original == vector['manifest']
    if result['ok']:
        assert result['value'] == original
        assert result['value'] is not original
        result['value']['intent']['question'] = 'Detached edit'
        assert original['intent']['question'] == vector['manifest']['intent']['question']


def test_non_json_custom_types_cycles_and_malformed_admission_fail_closed():
    class Custom(dict):
        pass
    for raw in (Custom(), {1: 'non-string key'}, float('nan')):
        assert not validate_investigation_manifest(raw)['ok']
    cycle = {}; cycle['loop'] = cycle
    assert not validate_investigation_manifest(cycle)['ok']
    vector = next(v for v in BUNDLE['vectors'] if v['name'] == 'typed admitted security')
    assert not validate_investigation_manifest(vector['manifest'], {'subjects': [{}]})['ok']
