"""Shared candidate-shape vectors; no runtime admission or source-rights grant."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/options_matrix_selection.v1.schema.json").read_text())
CORPUS = json.loads((ROOT / "terminal/lib/__tests__/fixtures/options_matrix_selection_vectors_v1.json").read_text())
Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def test_vector_names_are_unique():
    names = [vector["name"] for vector in CORPUS["vectors"]]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("vector", CORPUS["vectors"], ids=lambda vector: vector["name"])
def test_shared_candidate_selection_contract(vector):
    value = copy.deepcopy(vector["input"])
    before = copy.deepcopy(value)
    errors = list(VALIDATOR.iter_errors(value))
    assert (not errors) == vector["valid"], [error.message for error in errors]
    assert value == before  # No defaults, coercion, dropped fields or comparison reordering.
    if vector["valid"]:
        assert len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) <= 2048
