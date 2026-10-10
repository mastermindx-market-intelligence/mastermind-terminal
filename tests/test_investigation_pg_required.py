"""CI must exercise actual PostgreSQL invariants, not silently skip them."""
from types import SimpleNamespace

import pytest

import test_investigation_postgres as owner


def test_ci_fails_before_fixture_setup_when_postgres_is_unavailable(monkeypatch):
    monkeypatch.setenv("CI", "true")
    monkeypatch.setattr(owner, "_resolve_binaries", lambda names: dict.fromkeys(names))
    fixture = owner.pg.__wrapped__(None)
    with pytest.raises(pytest.fail.Exception, match="PostgreSQL binaries unavailable"):
        next(fixture)


def test_pg_config_finds_executable_binaries_outside_path(monkeypatch, tmp_path):
    binary = tmp_path / "initdb"
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o700)
    monkeypatch.setattr(owner.shutil, "which", lambda name: "/owner/pg_config" if name=="pg_config" else None)
    calls=[]
    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0,stdout=str(tmp_path)+"\n")
    monkeypatch.setattr(owner.subprocess,"run",run)
    assert owner._resolve_binaries(("initdb","psql")) == {"initdb":str(binary),"psql":None}
    assert calls == [["/owner/pg_config","--bindir"]]
