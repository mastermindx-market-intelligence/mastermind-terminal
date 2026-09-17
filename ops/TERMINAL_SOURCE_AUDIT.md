# Terminal Source Audit

`ops/terminal_source_audit.py` is the fail-closed, read-only source preflight for the Terminal deployment-canonicalization program tracked by Terminal issue #483.

It answers one bounded question:

> Do the configured live source mappings exactly match one full Git commit that is contained by the configured accepted ref, with every host-only path explicitly classified?

It does **not** deploy, fetch, checkout, reset, clean, delete, restart, or change a service. The only optional write is an atomic JSON receipt at a caller-supplied output path.

## Authority boundary

- GitHub owns implementation truth.
- The target must be a full 40-character commit SHA already contained by the configured accepted ref.
- The canonical checkout must be clean and have `HEAD` at that exact SHA. A later deployment controller may satisfy this with an isolated read-only worktree or equivalent immutable source staging.
- Runtime data, generated artifacts, dependencies, host-local configuration, secrets, and deployment markers are allowed only through explicit policy entries.
- An ignored path is not automatically safe. A host-only path ignored by Git is reported as `IGNORED_IMPLEMENTATION_CANDIDATE` unless the policy explicitly classifies it.
- Missing, unreadable, modified, unaccepted, unexplained, special-file, or type-divergent state returns `UNKNOWN_STOP`.
- Git inspection removes the entire ambient `GIT_*` namespace, then reinstates only the audit's controlled no-global-config, no-system-config, no-replacement, no-optional-lock and no-prompt settings. Configured fsmonitor execution and the untracked cache are also disabled. A caller cannot redirect the repository, worktree, index, object store, refs or config used as evidence.
- The deployment marker must be one stable, bounded, real regular file. The audit never follows a marker symlink and never opens a FIFO, socket, device or other special file as a marker.

This command is not yet a production deploy authorization by itself. A production policy must be derived from the read-only host archaeology, reviewed, committed, and then integrated as a mandatory preflight before any source mutation.

`CLEAN` is intentionally narrower than production proof: it proves the configured source mappings and marker relationship only. A policy may classify `.next` or another generated artifact without validating that artifact's build provenance. The actually served build, service identity, health and browser behavior remain unproven until the later exact-build, deploy-receipt and production-proof waves complete.

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
| `0` | `CLEAN`: all configured source mappings match and no blocking finding exists |
| `2` | `UNKNOWN_STOP`: the audit completed, but at least one blocking finding exists |
| `64` | invalid input, policy, Git object/ref, audit I/O prerequisite, or receipt-write failure |
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
          "classification": "generated_build_artifact",
          "expected_live_type": "directory"
        },
        {
          "path": "node_modules",
          "classification": "generated_dependency_tree",
          "expected_live_type": "directory"
        },
        {
          "path": ".env.local",
          "classification": "host_local_secret_config",
          "sensitive": true,
          "expected_live_type": "file"
        },
        {
          "path": ".env.example",
          "classification": "tracked_non_deployed_template",
          "allow_tracked_absence": true,
          "canonical_git_blob": "0123456789abcdef0123456789abcdef01234567",
          "canonical_git_mode": "100644"
        },
        {
          "path": "public/data",
          "classification": "host_owned_runtime_market_data",
          "allow_tracked_runtime_subtree": true,
          "canonical_git_tree": "0123456789abcdef0123456789abcdef01234567"
        },
        {
          "path": ".deployment-id",
          "classification": "deployment_marker",
          "expected_live_type": "file"
        }
      ]
    }
  ]
}
```

All repository and allowance paths must be normalized relative paths. Every live path and the deployment marker path must be absolute. A mapping may point to a Git tree or a single tracked blob. Single-file mappings cannot have subtree allowances.

An allowance applies to the exact path and its descendants. Keep allowances narrow. Never classify a broad source directory as runtime merely to obtain a green result.

`sensitive: true` records only the existence and classification of the allowance root. The audit does not read or hash allowed content, and no file content is ever included in a receipt. `sensitive`, `allow_tracked_absence`, `allow_tracked_runtime_subtree`, and `allow_tracked_runtime_file` must be real JSON booleans.

The policy root, every mapping, and every allowance reject unknown fields. A misspelled safety key therefore fails closed instead of silently disabling its constraint.

Ordinary allowance roots may declare `expected_live_type` as `file` or `directory`. A present root that is a symlink, a special file, unreadable, or the wrong declared type blocks. This validates only the allowance root metadata; allowed dependency/build subtrees are not recursively interpreted as implementation source.

If an ordinary allowance path is also tracked in the accepted Git tree, the audit never reads or hashes that tracked path to decide whether it drifted. It blocks with `ALLOWANCE_SHADOWS_TRACKED_PATH` instead, for every allowance regardless of `sensitive`, so an overlapping allowance can never silently suppress a tracked-file comparison. Fix the overlap in the policy (narrow the allowance or move the tracked path) rather than treating this as a normal drift finding.

### Exact tracked-absence contract

`allow_tracked_absence: true` is a closed exception for one exact tracked regular blob. `canonical_git_blob` and `canonical_git_mode` must equal the accepted SHA's exact object ID and mode (`100644` or `100755`). If that exact live file is absent, the mapping records its path, classification, canonical Git blob, and mode under `allowed_tracked_absences` instead of emitting `TRACKED_MISSING`. A canonical content or mode change invalidates the policy until reviewed again. If the path is present it is compared normally; modified content, wrong mode, or a type mismatch still blocks. Trees, symlinks, nonexistent Git paths, prefixes, and wildcards cannot use this contract.

### Pinned host-owned tracked-runtime subtree

`allow_tracked_runtime_subtree: true` is a closed contract for one exact tracked Git tree whose live projection is owned by runtime data producers. `canonical_git_tree` must equal that tree's full 40-character object ID at the audited SHA. Any tracked change below the subtree invalidates the policy until reviewed again.

The live root must be a real directory. The audit does not open or hash content below it, but it performs a metadata-only traversal: descendant symlinks, special files, or unreadable paths block. The receipt records the allowance path, classification, pinned tree ID, tracked-path count, and live-root state under `allowed_tracked_runtime_subtrees`. A tracked-runtime subtree cannot overlap any other allowance.

### Pinned host-owned tracked-runtime file

`allow_tracked_runtime_file: true` is the single-file equivalent for one exact tracked regular blob whose live bytes are owned by a runtime producer. `canonical_git_blob` and `canonical_git_mode` must equal the accepted SHA's full 40-character blob object ID and exact mode (`100644` or `100755`). Any tracked path, mode, or content change invalidates the policy until reviewed again.

The live path must exist as a real regular file. Missing, unreadable, symlinked, special, or type-divergent state blocks. The source audit inspects only metadata and never opens or hashes the live runtime file. The receipt records path, classification, pinned blob, canonical mode, and live state under `allowed_tracked_runtime_files`. Trees, prefixes, wildcards, and nonexistent Git paths cannot use this contract.

## Receipt

The receipt schema is `mastermind.terminal.source_audit_receipt.v1`. It includes:

- exact accepted SHA;
- policy digest;
- canonical checkout HEAD;
- accepted-ref SHA and ancestry result;
- deployment marker state and SHA;
- each repository-to-live source mapping and ordinary allowed counts;
- exact tracked-absence evidence plus pinned tracked-runtime-subtree and tracked-runtime-file evidence;
- sorted blocking findings;
- deterministic receipt ID (excluding timestamp and the ID itself).

For tracked content, evidence is limited to Git blob identities, modes, sizes, and paths. For ordinary host-only regular files, the receipt may include a streamed SHA-256 and size. Git-ignored candidates are deliberately not hashed because they may be secret-bearing; they remain blocking until classified. FIFOs, sockets, devices, and other special files are never opened or hashed; they block with an explicit special-file finding. Regular files are opened without following symlinks and must remain stable while read or hashed.

The receipt does not assert that an allowed generated build artifact was produced from the accepted SHA. That requires the later build/deployment provenance receipt.

## Blocking findings

Representative codes include:

- `CANONICAL_HEAD_MISMATCH`
- `CANONICAL_WORKTREE_DIRTY`
- `SHA_NOT_ACCEPTED_ON_REF`
- `ACCEPTED_REF_UNKNOWN`
- `DEPLOYMENT_MARKER_MISSING`
- `DEPLOYMENT_MARKER_INVALID`
- `DEPLOYMENT_MARKER_INVALID_TYPE`
- `DEPLOYMENT_MARKER_UNREADABLE`
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
- `ALLOWANCE_SHADOWS_TRACKED_PATH`
- `ALLOWANCE_LIVE_UNREADABLE`
- `ALLOWANCE_LIVE_TYPE_MISMATCH`
- `ALLOWED_RUNTIME_SUBTREE_MISSING`
- `ALLOWED_RUNTIME_SUBTREE_TYPE_MISMATCH`
- `ALLOWED_RUNTIME_SUBTREE_UNREADABLE`
- `ALLOWED_RUNTIME_SUBTREE_SYMLINK`
- `ALLOWED_RUNTIME_SUBTREE_SPECIAL_FILE`
- `ALLOWED_RUNTIME_FILE_MISSING`
- `ALLOWED_RUNTIME_FILE_TYPE_MISMATCH`
- `ALLOWED_RUNTIME_FILE_UNREADABLE`

Finding codes are evidence states, not cleanup instructions. Reconciliation belongs in the canonical GitHub carrier and must preserve unexplained production state until it is classified.

## Tests

The root Python CI automatically runs the source-audit suites through the existing `Ingest + signal-layer tests` required check.

Local focused proof:

```bash
python -m pytest \
  tests/test_terminal_source_audit.py \
  tests/test_terminal_source_audit_trust_boundary.py \
  tests/test_terminal_source_audit_cli_failures.py \
  tests/test_terminal_source_audit_policy_contracts.py \
  tests/test_terminal_release_preflight.py \
  -q
python -m compileall -q \
  ops \
  tests/test_terminal_source_audit.py \
  tests/test_terminal_source_audit_trust_boundary.py \
  tests/test_terminal_source_audit_cli_failures.py \
  tests/test_terminal_source_audit_policy_contracts.py \
  tests/test_terminal_release_preflight.py
```

The production composition and immutable receipt contract are documented in [`TERMINAL_RELEASE_PREFLIGHT.md`](TERMINAL_RELEASE_PREFLIGHT.md).
