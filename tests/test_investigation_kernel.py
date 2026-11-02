"""One semantic/canonical corpus shared with the TS and PostgreSQL owners."""
import hashlib
import json
from pathlib import Path

import pytest

from api.investigation_contracts import canonical_investigation_json, validate_investigation_manifest

CORPUS = json.loads((Path(__file__).resolve().parents[1] / "terminal/lib/__tests__/fixtures/investigation_kernel_vectors.json").read_text())


@pytest.mark.parametrize("vector", CORPUS["vectors"], ids=lambda v: v["name"])
def test_shared_kernel_semantics_and_canonical_bytes(vector):
    result = validate_investigation_manifest(vector["manifest"], CORPUS["admission"])
    assert result["ok"] is vector["valid"], result
    if result["ok"]:
        canonical = canonical_investigation_json(result["value"])
        assert canonical == vector["canonical"]
        assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == vector["sha256"]
        assert result["value"] == vector["manifest"]
