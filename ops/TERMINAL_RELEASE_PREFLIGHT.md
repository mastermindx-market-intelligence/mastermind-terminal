# Terminal Release Preflight

`ops/terminal_release_preflight.py` is the read-only W2A entrance gate for the
GitHub-canonical deployment program tracked by Terminal issue #483. It composes
the accepted source audit with the reviewed production policy and publishes one
immutable, sanitized receipt.

It answers one bounded question:

> Does the current deployed source projection match the full commit named by the
> live deployment marker, under the exact reviewed production policy?

A `CLEAN` preflight is required evidence for the later W2B deployment controller.
It is **not** build provenance, a deploy authorization, a health proof, a browser
proof, rollback proof, or drift-sentinel proof by itself.

## No mutation

The command does not fetch, reset, clean, checkout, build, install dependencies,
synchronize source, restart a service, or alter runtime data. Its only intended
write is a new receipt below the caller-supplied receipt directory. Existing
receipts are never replaced.

The current `ops/terminal-build.sh` does not invoke this command yet. Integrating
the gate into the deployment owner belongs to W2B; this W2A capability must first
be independently reviewed, merged, and proven read-only on production.

## Inputs and authority

The preflight reads:

- the canonical Git checkout, normally `/opt/terminal/.gitsrc`;
- a reviewed `mastermind.terminal.source_audit_policy.v1` artifact;
- the deployment marker named by that policy;
- every configured live source mapping.

The deployment marker supplies the accepted SHA. The source audit then requires
that the canonical checkout is clean, has `HEAD` at that exact SHA, and that the
SHA is contained by the configured accepted ref.

The reviewed policy may be supplied from an immutable artifact outside the
currently deployed checkout. This is necessary for first adoption: the W2A policy
can be reviewed in a newer Git commit while production still serves the previous
commit. The receipt binds the policy by its canonical SHA-256 digest, so release
adjudication must compare that digest with the reviewed artifact before treating
a `CLEAN` result as usable evidence.

## Production policy

`ops/terminal_source_audit.production.json` was derived from the fresh production
census at deployed SHA `5224015c9c87b65457fc598b85b78a2be322bfc7`.
It maps the application, every runtime-code overlay, and both installed wrappers:

| Git source | Live projection |
|---|---|
| `terminal/` | `/opt/terminal/terminal` |
| `ingest/` | `/opt/terminal/ingest` |
| `scripts/` | `/opt/terminal/scripts` |
| `config/` | `/opt/terminal/config` |
| `contracts/` | `/opt/terminal/contracts` |
| `hub/` | `/opt/terminal/hub` |
| `signal_layer/` | `/opt/terminal/signal_layer` |
| `ops/terminal-data` | `/usr/local/bin/terminal-data` |
| `ops/terminal-build.sh` | `/opt/terminal/terminal-build.sh` |

Retained host-owned classes are explicit and narrow: generated builds and
dependencies, local environment files, known runtime caches, generated sidecar
bundles, exact historical backup files observed by the census, and the live
market-data subtree.

Three exceptional contracts are intentionally visible in the receipt:

1. `.env.example` is an exact tracked regular blob temporarily allowed to be
   absent because the incumbent deploy owner's broad `.env.*` exclusion omits
   it. The policy pins both its blob object and `100644` Git mode; either changing
   invalidates the exception. W2B must narrow that exclusion, converge the live
   template, and remove this exception in the same release.
2. `terminal/public/data` is host-owned runtime market data even though Git also
   contains reviewed snapshots and fixtures under that path. The policy pins the
   exact Git tree object. Any tracked addition, deletion, rename, mode change, or
   content change below that path invalidates the policy until reviewed again.
3. `ingest/hk_universe_cache.json` is generated and independently synchronized
   runtime data even though one historical snapshot remains tracked. The policy
   pins that exact Git blob and `100644` mode while treating the live bytes as
   host-owned; a canonical content or mode change invalidates the policy. W2B
   must remove the historical snapshot from Git without deleting or rewriting
   the live cache, then remove this exception in the same release.

The runtime-data contracts never read or hash file content. The subtree contract verifies that
the root is a real directory and performs a metadata-only traversal. Symlinks,
special files, or unreadable descendants fail closed so the static-data server
cannot silently escape its intended root. The single-file contract requires one
real regular file and blocks missing, unreadable, symlinked, or special state.

Ordinary allowed roots declare `expected_live_type` as `file` or `directory`.
A symlink, special file, or wrong root type is blocking. Sensitive allowed files
are inspected only for root metadata; their content is never read or included in
a receipt.

## Usage

Run the merged, reviewed preflight implementation and policy artifact against the
current canonical checkout. Keep receipts outside every source root:

```bash
python /path/to/reviewed/ops/terminal_release_preflight.py \
  --canonical-repo /opt/terminal/.gitsrc \
  --policy /path/to/reviewed/ops/terminal_source_audit.production.json \
  --receipt-dir /var/lib/mastermind-terminal/release-preflight
```

The command prints a small JSON summary containing the result, accepted SHA,
receipt IDs, and receipt path. The complete evidence remains in the receipt file.

Exit codes:

| Code | Meaning |
|---:|---|
| `0` | `CLEAN`: policy, marker, accepted ref, canonical checkout, and all mapped live source state agree |
| `2` | `UNKNOWN_STOP`: the audit completed but at least one blocking finding exists |
| `64` | invalid input, policy, marker, Git evidence, audit prerequisite, or receipt publication failure |
| `70` | unexpected internal failure |

Every nonzero exit is a hard stop. A caller must preserve and reconcile the
finding; it must not normalize the host or blindly retry a mutation.

## Immutable receipt

The receipt schema is
`mastermind.terminal.release_preflight_receipt.v1`. Each receipt contains:

- observed UTC timestamp;
- exact accepted/deployed SHA from the marker;
- canonical checkout and reviewed policy locations;
- canonical policy digest;
- nested `mastermind.terminal.source_audit_receipt.v1` evidence;
- nested deterministic source-audit receipt ID;
- release-preflight receipt ID and result.

Receipt filenames bind the UTC timestamp, accepted SHA, and receipt ID. Files are
published with mode `0640` by creating and syncing a temporary inode, linking it
to a never-before-used final name, syncing the directory, and removing the
temporary name. The receipt directory must be a real directory and must not be
group- or other-writable; otherwise publication fails before creating a receipt.
An existing final name causes a hard failure; it is never replaced.

The receipt is sanitized evidence. It may include paths, Git object identities,
file modes, sizes, and hashes of ordinary unexplained files. It never contains
secret-file content or runtime-data content.

## W2A acceptance and non-claims

W2A is accepted only after:

1. the exact PR head passes required CI and independent security/operations review;
2. the protected commit is read back from GitHub;
3. the merged implementation and policy are executed read-only against production;
4. the production result is `CLEAN` and its policy digest matches the reviewed artifact;
5. the immutable receipt is read back from the host.

Even then, the overall #483 program remains active. W2B/W2C must still bind an
exact target SHA and dependency lock to a reproducible build, capture rollback
inputs, deploy through the existing owner, prove the served browser/runtime SHA,
prove rollback, and arm continuous drift detection.

## Focused verification

```bash
python -m pytest \
  tests/test_terminal_source_audit.py \
  tests/test_terminal_source_audit_cli_failures.py \
  tests/test_terminal_source_audit_trust_boundary.py \
  tests/test_terminal_source_audit_policy_contracts.py \
  tests/test_terminal_release_preflight.py \
  -q

python -m compileall -q ops \
  tests/test_terminal_source_audit.py \
  tests/test_terminal_source_audit_cli_failures.py \
  tests/test_terminal_source_audit_trust_boundary.py \
  tests/test_terminal_source_audit_policy_contracts.py \
  tests/test_terminal_release_preflight.py
```
