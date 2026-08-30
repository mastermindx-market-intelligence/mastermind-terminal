# Terminal Source Audit

`ops/terminal_source_audit.py` is the fail-closed, read-only source preflight for the Terminal deployment-canonicalization program tracked by Terminal issue #483.

It answers one bounded question:

> Does the inspected live implementation exactly match one full Git commit that is accepted on the configured canonical ref, with every host-only path explicitly classified?

It does **not** deploy, fetch, checkout, reset, clean, delete, restart, or change a service. The only optional write is an atomic JSON receipt at a caller-supplied output path.

## Authority boundary

- GitHub owns implementation truth.
- The target must be a full 40-character commit SHA already contained by the configured accepted ref.
- The canonical checkout must be clean and have `HEAD` at that exact SHA. A later deployment controller may satisfy this with an isolated read-only worktree or equivalent immutable source staging.
- Runtime data, generated artifacts, dependencies, host-local configuration, secrets, and deployment markers are allowed only through explicit policy entries.
- An ignored path is not automatically safe. A host-only path ignored by Git is reported as `IGNORED_IMPLEMENTATION_CANDIDATE` unless the policy explicitly classifies it.
- Missing, unreadable, modified, unaccepted, unexplained, special-file, or type-divergent state returns `UNKNOWN_STOP`.
- Git inspection disables replacement refs, optional index locks, configured fsmonitor commands, the untracked cache, and global/system Git configuration so local Git machinery cannot rewrite or distort the evidence.

This command is not yet a production deploy authorization by itself. A production policy must be derived from the read-only host archaeology, reviewed, committed, and then integrated as a mandatory preflight before any source mutation.

## Usage

```bash
python ops/terminal_source_audit.py \
  --canonical-repo /path/to/clean/canonical-checkout \
  --accepted-sha 0123456789abcdef0123456789abcdef01234567 \
  --policy /path/to/reviewed-policy.json \
  --output /path/to/receipt.json \
  --pretty
```

Without `--output`, the receipt is written to standard output. A receipt file must be outside the canonical checkout and every configured live source root, and it cannot replace the policy or deployment marker.

Exit codes:

| Code | Meaning |
|---:|---|
| `0` | `CLEAN`: all source mappings match and no blocking finding exists |
| `2` | `UNKNOWN_STOP`: the audit completed, but at least one blocking finding exists |
| `64` | invalid input, policy, Git object/ref, or audit I/O prerequisite |
| `70` | unexpected internal failure |

A deploy controller must treat every nonzero code as a hard stop. It must never normalize the host and retry automatically.

## Policy schema

The policy root is `mastermind.terminal.source_audit_policy.v1`.

```json
{
  "schema": "mastermind.terminal.source_audit_policy.v1",
  "accepted_ref": "refs/remotes/origin/master",
  "deployment_id_file": "/absolute/live/path/.deployment-id",
  "mappings": [
    {
      "name": "terminal-app",
      "repo_path": "terminal",
      "live_path": "/absolute/live/path",
      "allowances": [
        {
          "path": ".next",
          "classification": "generated_build_artifact"
        },
        {
          "path": "node_modules",
          "classification": "generated_dependency_tree"
        },
        {
          "path": ".env.local",
          "classification": "host_local_secret_config",
          "sensitive": true
        },
        {
          "path": ".deployment-id",
          "classification": "deployment_marker"
        }
      ]
    }
  ]
}
```

All repository and allowance paths must be normalized relative paths. Every live path and the deployment marker path must be absolute. A mapping may point to a Git tree or a single tracked blob. Single-file mappings cannot have subtree allowances.

An allowance applies to the exact path and its descendants. Keep allowances narrow. Never classify a broad source directory as runtime merely to obtain a green result.

`sensitive: true` records only the existence and classification of the allowance root. The audit does not read or hash allowed content, and no file content is ever included in a receipt.

## Receipt

The receipt schema is `mastermind.terminal.source_audit_receipt.v1`. It includes:

- exact accepted SHA;
- policy digest;
- canonical checkout HEAD;
- accepted-ref SHA and ancestry result;
- deployment marker state and SHA;
- each repository-to-live mapping and tracked/allowed counts;
- sorted blocking findings;
- deterministic receipt ID (excluding timestamp and the ID itself).

For tracked content, evidence is limited to Git blob identities, modes, sizes, and paths. For ordinary host-only regular files, the receipt may include a streamed SHA-256 and size. Git-ignored candidates are deliberately not hashed because they may be secret-bearing; they remain blocking until classified. FIFOs, sockets, devices, and other special files are never opened or hashed; they block with an explicit special-file finding. Regular files are opened without following symlinks and must remain stable while hashed.

## Blocking findings

Representative codes include:

- `CANONICAL_HEAD_MISMATCH`
- `CANONICAL_WORKTREE_DIRTY`
- `SHA_NOT_ACCEPTED_ON_REF`
- `ACCEPTED_REF_UNKNOWN`
- `DEPLOYMENT_MARKER_MISSING`
- `DEPLOYMENT_MARKER_INVALID`
- `DEPLOYMENT_SHA_MISMATCH`
- `LIVE_PATH_MISSING`
- `LIVE_PATH_TYPE_MISMATCH`
- `LIVE_PATH_UNREADABLE`
- `TRACKED_MISSING`
- `TRACKED_MODIFIED`
- `TRACKED_SYMLINK_MODIFIED`
- `TRACKED_MODE_MISMATCH`
- `TRACKED_UNREADABLE`
- `HOST_ONLY_UNTRACKED`
- `HOST_ONLY_SPECIAL_FILE`
- `TRACKED_SPECIAL_FILE`
- `IGNORED_IMPLEMENTATION_CANDIDATE`
- `IGNORE_CLASSIFICATION_FAILED`

Finding codes are evidence states, not cleanup instructions. Reconciliation belongs in the canonical GitHub carrier and must preserve unexplained production state until it is classified.

## Tests

The root Python CI automatically runs `tests/test_terminal_source_audit.py` through the existing `Ingest + signal-layer tests` required check.

Local focused proof:

```bash
python -m pytest tests/test_terminal_source_audit.py -q
python -m compileall -q ops tests/test_terminal_source_audit.py
```
