"""Migration-ledger hygiene.

There is NO remote migration history in this estate: the `supabase_migrations` schema does not
exist in the production project, the Supabase CLI has never been run against it, and every file in
`supabase/migrations/` is applied by hand, out of band (see `supabase/migrations/README.md`).

That removes the usual safety net. With a ledger, two files sharing a version collide loudly the
first time anyone pushes. Without one, they simply coexist — which is exactly what happened when
PR #426 and PR #427 both landed a `0008_` file, each unaware of the other, and each describing a
separate manual operator action under the same version. Nothing detected it; a human did, later.

These tests are that missing detection.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"

# `<version>_<name>.sql` — the version is the identity, the name is for humans.
MIGRATION_RE = re.compile(r"^(?P<version>\d+)_(?P<name>[a-z0-9_]+)\.sql$")


def migration_files() -> list[Path]:
    return sorted(p for p in MIGRATIONS.glob("*.sql"))


def test_migrations_directory_is_present_and_non_empty():
    # A wrong-path bug here would make every other assertion below vacuously pass.
    assert MIGRATIONS.is_dir(), f"missing migrations directory: {MIGRATIONS}"
    assert migration_files(), f"no .sql migrations found in {MIGRATIONS}"


def test_every_migration_filename_parses():
    bad = [p.name for p in migration_files() if not MIGRATION_RE.match(p.name)]
    assert not bad, (
        "migration filenames must be `<version>_<lowercase_name>.sql`; offending: "
        + ", ".join(sorted(bad))
    )


def test_no_two_migrations_share_a_version():
    """The guard the 0008 collision asked for.

    Two files under one version is not a cosmetic problem. Each of the two `0008_` files documented
    its own manual operator action, so "has 0008 been applied?" had two different answers at once —
    and it did: the census on 2026-08-20 found `wls_watchlist_symbol` live in production and
    `chart_layouts_user_name` absent, both claiming the same version.
    """
    by_version: dict[str, list[str]] = defaultdict(list)
    for path in migration_files():
        match = MIGRATION_RE.match(path.name)
        if match:
            by_version[match.group("version")].append(path.name)

    collisions = {v: sorted(names) for v, names in by_version.items() if len(names) > 1}
    assert not collisions, (
        "two or more migrations share a version prefix — the version IS the migration's identity, "
        "so this makes 'was it applied?' unanswerable:\n"
        + "\n".join(f"  {v}: {', '.join(names)}" for v, names in sorted(collisions.items()))
        + "\nRenumber the later-merged file (git log the two paths) and update every in-repo "
        "reference to its filename."
    )


def test_versions_are_zero_padded_to_a_common_width():
    # Files are applied in lexical order by a human reading `ls`. Mixed widths make `10` sort
    # before `9`, which is how an ordering mistake gets made by eye rather than by tooling.
    widths = {len(MIGRATION_RE.match(p.name).group("version")) for p in migration_files() if MIGRATION_RE.match(p.name)}
    assert len(widths) == 1, f"migration version prefixes use mixed widths: {sorted(widths)}"


def test_referenced_migration_filenames_exist():
    """A renumber must carry its references with it.

    `lib/watchlists.ts` names a migration file in a runtime error string an operator is meant to act
    on, and `watchlistOwner.test.ts` reads one off disk. A stale name in either is a dead end at
    exactly the moment someone is debugging production.
    """
    repo = MIGRATIONS.parents[1]
    referenced: dict[str, list[str]] = defaultdict(list)
    pattern = re.compile(r"supabase/migrations/(\d+_[a-z0-9_]+\.sql)")

    for source in list(repo.glob("terminal/lib/**/*.ts")) + list(repo.glob("terminal/app/**/*.ts*")):
        if "node_modules" in source.parts:
            continue
        for name in pattern.findall(source.read_text(encoding="utf-8", errors="ignore")):
            referenced[name].append(str(source.relative_to(repo)))

    missing = {
        name: sorted(set(sources))
        for name, sources in referenced.items()
        if not (MIGRATIONS / name).exists()
    }
    assert not missing, (
        "code references migration files that do not exist:\n"
        + "\n".join(f"  {name} <- {', '.join(sources)}" for name, sources in sorted(missing.items()))
    )


def test_application_table_has_one_row_per_version():
    """The README application table answers "was it applied?" for each version.

    Two rows for one version can disagree about that answer, and a reader can stop at either. PR #804
    carried two `0029` rows after a later edit re-added the row instead of updating it.
    """
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    versions = re.findall(r"^\| `(\d{4})` \|", readme, flags=re.MULTILINE)
    assert versions, "no application-table rows found in supabase/migrations/README.md"
    repeated = sorted({v for v in versions if versions.count(v) > 1})
    assert not repeated, "README application table repeats version rows: " + ", ".join(repeated)
