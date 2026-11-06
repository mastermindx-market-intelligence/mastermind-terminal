"""Pure source assembly for the incumbent one-statement SQL interface.

No apply entry, credentials, network, database, attestation or activation. The
held original qualification is not retried. Exact migration source identity is
necessary for assembly, never approval to execute the composed statement.
"""
import hashlib
from pathlib import Path
import sys

# House bootstrap: import the existing owner's pure parser from any cwd/-I.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from scripts.supabase_apply import readback_statements, split_statements  # noqa: E402

PINNED_0030_SHA256 = "e98d5a59cfb1932ebf4e562ecf89b6d08b7a5c9365b3e2fbe0b612eaaeff4694"
OUTER_TAG = "$iw2_closed_cutover$"
INNER_TAG = "$iw2_exact_0030$"
_APPLY = "public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)"
_RECONCILE = "public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)"
FINAL_REVOKE = f"REVOKE EXECUTE ON FUNCTION {_APPLY},{_RECONCILE} FROM PUBLIC,anon,authenticated;"
_CHECKS = [f"pg_catalog.has_function_privilege('{role}','{function}','EXECUTE')"
           for role in ("anon", "authenticated") for function in (_APPLY, _RECONCILE)]
GRANT_READBACK = "select " + ",".join(f"{value} as closed_check_{i}" for i, value in enumerate(_CHECKS)) + ";"
GRANT_ASSERTION = "IF " + " OR ".join(_CHECKS) + " THEN RAISE EXCEPTION 'iw2_cutover_grants_not_closed'; END IF;"


class CompositionRefused(ValueError):
    pass


def compose_closed_migration(migration_bytes):
    """Return a single DO source statement; never execute or approve it."""
    if type(migration_bytes) is not bytes or hashlib.sha256(migration_bytes).hexdigest() != PINNED_0030_SHA256:
        raise CompositionRefused("pinned_migration_identity_mismatch")
    text = migration_bytes.decode("utf-8", errors="strict")
    if OUTER_TAG in text or INNER_TAG in text:
        raise CompositionRefused("dollar_quote_collision")
    if len(split_statements(text)) != 1:
        raise CompositionRefused("pinned_migration_not_one_statement")
    # Front-load metadata: the incumbent helper chooses the first anchor, so
    # inner preserved comments must not become the outer qualification block.
    readbacks = readback_statements(text) + [GRANT_READBACK]
    metadata = "-- SOURCE ONLY: original runtime qualification remains held.\n-- readback:\n"
    for query in readbacks:
        terminated = query.rstrip().rstrip(";") + ";"
        metadata += "\n".join("-- " + line for line in terminated.splitlines()) + "\n"
    metadata += "\n-- down: " + FINAL_REVOKE + "\n\n"
    result = (metadata + "DO " + OUTER_TAG + "\nBEGIN\nEXECUTE " + INNER_TAG
              + text + INNER_TAG + ";\n" + FINAL_REVOKE + "\n"
              + GRANT_ASSERTION + "\nEND\n" + OUTER_TAG + ";\n").encode("utf-8")
    if len(split_statements(result.decode("utf-8"))) != 1:
        raise CompositionRefused("composition_not_one_statement")
    return result


def validate_closed_composition(migration_bytes, composed_bytes):
    """Validate exact construction, not PostgreSQL execution or cutover truth."""
    if type(composed_bytes) is not bytes or compose_closed_migration(migration_bytes) != composed_bytes:
        raise CompositionRefused("composition_changed")
