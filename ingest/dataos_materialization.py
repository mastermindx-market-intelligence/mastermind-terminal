"""Read-only file adapter for the existing Data OS Terminal materializer.

The nightly is still the sole writer of its per-symbol output. This adapter
loads the owner's stdlib leaf and canonical identity reader once, by explicit
file path; Macro never enters Terminal's sys.path or replaces its packages.
Missing owner/reference evidence keeps the price observation unqualified.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

API_VERSION = "dataos.terminal_yahoo_materialization.v1"
OWNER_FILES = ("lib/dataos/terminal_materialization.py", "lib/dataos/identity.py")
PRODUCER_FILES = ("ingest/build_polygon_universe.py", "ingest/polygon_bars.py",
                  "ingest/session_anchor.py", "ingest/dataos_materialization.py")
REFERENCE_FILES = ("security_master.parquet", "vendor_aliases.parquet")
MAX_REFERENCE_BYTES = 64 * 1024 * 1024


def _bytes(path: Path, limit: int) -> bytes:
    with path.open("rb") as handle:
        if not path.is_file():
            raise ValueError("not a file")
        value = handle.read(limit + 1)
    if not value or len(value) > limit:
        raise ValueError("file size")
    return value


def _load_leaf(path: Path, raw: bytes):
    name = "_terminal_dataos_" + path.stem + "_" + hashlib.sha256(raw).hexdigest()[:16]
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_loader(name, loader=None, origin=str(path))
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(path)
    sys.modules[name] = module  # dataclasses resolves its defining module here.
    try:
        exec(compile(raw, str(path), "exec"), module.__dict__)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def _code_version(root: Path, repository: str, sources: dict[str, bytes]) -> dict:
    """Hash the actual loaded/source files; attach git identity only if equal.

    The production Terminal runs vendored ingest files beside its .gitsrc
    checkout. A new checkout HEAD cannot describe older installed file bytes.
    """
    commit = None
    for checkout in (root, root / ".gitsrc"):
        if not (checkout / ".git").exists():
            continue
        try:
            run = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"],
                                 capture_output=True, timeout=10, check=True)
            candidate = run.stdout.decode("ascii").strip()
            if len(candidate) != 40:
                continue
            matches = all(subprocess.run(["git", "-C", str(checkout), "show",
                                           candidate + ":" + name],
                                          capture_output=True, timeout=10, check=True).stdout == raw
                          for name, raw in sources.items())
            if matches:
                commit = candidate
                break
        except (OSError, subprocess.SubprocessError, UnicodeError):
            continue
    return {"repository": repository, "commit": commit,
            "files_sha256": {name: hashlib.sha256(raw).hexdigest() for name, raw in sources.items()}}


@dataclass(frozen=True)
class MaterializationContext:
    owner: object | None = None
    identity: object | None = None
    aliases: object | None = None
    master_records: list | None = None
    producer_version: dict | None = None
    owner_version: dict | None = None
    reference: dict | None = None
    refusal: str | None = None

    def bind(self, document: dict) -> dict:
        if self.refusal or self.owner is None:
            return {"status": "refused", "view": None,
                    "refusal_reasons": [self.refusal or "MATERIALIZATION_OWNER_UNAVAILABLE"]}
        try:
            return self.owner.bind_terminal_yahoo_materialization(
                document, alias_table=self.aliases, master_records=self.master_records,
                parse_listing_key=self.identity.parse_listing_key,
                producer_version=self.producer_version, owner_version=self.owner_version,
                reference=self.reference,
            )
        except Exception:
            # Typed absence of qualification; do not expose paths or vendor data.
            return {"status": "refused", "view": None,
                    "refusal_reasons": ["MATERIALIZATION_BINDING_UNAVAILABLE"]}


def load_materialization_context(terminal_root: Path, macro_root: Path | None = None) -> MaterializationContext:
    configured = macro_root if macro_root is not None else os.environ.get("MACRO_REPO")
    if not configured:
        return MaterializationContext(refusal="MATERIALIZATION_OWNER_UNAVAILABLE")
    macro = Path(configured).resolve()
    try:
        owner_sources = {name: _bytes(macro / name, 2 * 1024 * 1024) for name in OWNER_FILES}
        owner = _load_leaf(macro / OWNER_FILES[0], owner_sources[OWNER_FILES[0]])
        if getattr(owner, "API_VERSION", None) != API_VERSION:
            return MaterializationContext(refusal="MATERIALIZATION_OWNER_VERSION_UNSUPPORTED")
        identity = _load_leaf(macro / OWNER_FILES[1], owner_sources[OWNER_FILES[1]])
        producer_sources = {name: _bytes(terminal_root / name, 2 * 1024 * 1024)
                            for name in PRODUCER_FILES}
    except Exception:
        return MaterializationContext(refusal="MATERIALIZATION_OWNER_UNAVAILABLE")
    try:
        reference_dir = macro / "data" / "reference"
        raw = {name: _bytes(reference_dir / name, MAX_REFERENCE_BYTES) for name in REFERENCE_FILES}
        # Current exact files only. This is not an attested identity generation;
        # reading both files twice detects a change during this bounded snapshot.
        if any(_bytes(reference_dir / name, MAX_REFERENCE_BYTES) != raw[name]
               for name in REFERENCE_FILES):
            return MaterializationContext(refusal="MATERIALIZATION_REFERENCE_CHANGED")
        alias_frame = pd.read_parquet(io.BytesIO(raw["vendor_aliases.parquet"]))
        master_frame = pd.read_parquet(io.BytesIO(raw["security_master.parquet"]))
        if len(alias_frame) > 300_000 or len(master_frame) > 100_000:
            return MaterializationContext(refusal="MATERIALIZATION_REFERENCE_UNAVAILABLE")
        # Only the two current-catalog spaces enter their existing reader.
        # Revisioned polygon/listing or historical yahoo naming is not repurposed.
        alias_frame = alias_frame[alias_frame["vendor"].isin(["store", "yahoo_fetch"])]
        alias_records = alias_frame.astype(object).where(pd.notna(alias_frame), None).to_dict("records")
        master_records = master_frame.astype(object).where(pd.notna(master_frame), None).to_dict("records")
        aliases = identity.VendorAliasTable.from_records(alias_records)
        reference = {
            "files_sha256": {name: hashlib.sha256(raw[name]).hexdigest() for name in REFERENCE_FILES},
            "read_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "generation_id": None, "generation_attested": False,
        }
    except Exception:
        return MaterializationContext(refusal="MATERIALIZATION_REFERENCE_UNAVAILABLE")
    return MaterializationContext(
        owner=owner, identity=identity, aliases=aliases, master_records=master_records,
        producer_version=_code_version(terminal_root, "mastermindx-market-intelligence/mastermind-terminal",
                                       producer_sources),
        owner_version=_code_version(macro, "mastermindx-market-intelligence/macro", owner_sources),
        reference=reference,
    )
