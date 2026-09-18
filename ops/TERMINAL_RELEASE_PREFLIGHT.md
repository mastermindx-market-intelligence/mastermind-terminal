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

W2A was independently reviewed, merged in PR #600, and proven read-only on
production. W2B-A integrates this command into the incumbent
`ops/terminal-build.sh` as a mandatory entrance gate. The owner publishes and
binds a `CLEAN` receipt for the currently deployed generation before it may
fetch, reset, clean, install, build, synchronize source, or touch a service.
Every nonzero preflight result is propagated unchanged and stops the release.

## Deploy-owner integration (W2B-A)

The deploy owner now accepts exactly one explicit release intent from the
W2B-C-qualified unprivileged release operator:

```bash
/opt/terminal/terminal-build.sh \
  --target-sha <full-lowercase-40-hex-commit>
```

The first pass validates the argument without privilege, then may execute only
the reviewed setuid boundary:

```text
/usr/bin/sudo -n -- /usr/bin/env -i <closed environment> \
  /usr/bin/bash -p /opt/terminal/terminal-build.sh --target-sha <sha>
```

Direct root invocation is refused. The privileged pass requires its explicit
clean-entry marker, uid 0, and the canonical controller path before it may acquire
the deploy lock or run preflight. W2B-C owns the exact sudoers rule and operator
provisioning; neither is installed or production-proven by W2B-B.

There is no environment-variable target fallback and no branch-tip inference.
The owner performs these gates in order:

1. validate the exact target syntax before Node or Git access;
2. select one complete preflight bundle (script, policy, and real non-symlink
   `terminal_audit` package) from the executing `ops/` artifact, otherwise from
   the currently deployed canonical checkout;
3. create/verify the fixed receipt parent and leaf as root-owned mode `0750`;
4. run the W2A preflight against the current deployed checkout and require its
   immutable summary to be `CLEAN`;
5. fetch `origin/master`, prove the requested full SHA resolves exactly and is
   contained by the freshly observed `refs/remotes/origin/master`, then
   reset/clean only to that SHA.

For first adoption, W2B-C must bootstrap the exact reviewed controller bytes
to `/opt/terminal/terminal-build.sh`, provision the static build principal and
one exact least-privilege sudoers command, verify their identities, and publish a
bootstrap receipt **without** deploying the application. Only then may the
unprivileged release operator invoke the canonical path above. The controller
selects one complete preflight bundle from its authoring `ops/` directory when
present, otherwise from the currently deployed canonical checkout; subsequent
successful releases self-install the same controller through the incumbent path.
This is one lifecycle, not a second deployer, and a temporary archive path is not
an accepted privileged controller entry.

W2B-A proves current-source cleanliness and exact target admission. W2B-B adds
the next bounded gate before live-generation mutation: the sanitized sudo/root
entry above; exact production runtime admission including the canonical
`/etc/os-release` alias; a no-login build principal with zero supplementary
groups; exact Git-object source materialization with full symlink-graph
resolution; fresh `npm ci`; read-only in-root dependency binding and deterministic
`next-env.d.ts`; a network-disabled Next build; a closed public build environment;
explicit Next preview/RSC key identities; the stable SHA-256 of the
canonical controller bytes that actually executed; and an immutable
`mastermind.terminal.build_receipt.v1` receipt. All metadata/key reads use
no-follow nonblocking descriptors, and nested projection evidence is a closed
schema. The receipt binds the complete build-input fingerprint—including the
controller-entry and sandbox contracts—plus BUILD_ID and canonical serving-output
digest; identical complete inputs with divergent serving output fail closed.

W2B-B does **not** make the inherited live swap/runtime overlays a transactional
whole-release deployment and is not independently production-adoptable. W2B-C
still owns live-generation transaction/rollback receipts; W2C still owes served
browser/runtime identity and continuous drift proof.

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
commit. The receipt binds the policy by SHA-256 over its canonical parsed JSON —
`json.dumps(policy, sort_keys=True, separators=(",", ":"))` encoded as UTF-8 —
not over the artifact's whitespace-preserving file bytes. Release adjudication
must compare that digest with the reviewed artifact before treating a `CLEAN`
result as usable evidence. One exact recompute command is:

```bash
python3 - /path/to/reviewed/ops/terminal_source_audit.production.json <<'PY'
import hashlib, json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    policy = json.load(handle)
canonical = json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()
print(hashlib.sha256(canonical).hexdigest())
PY
```

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

Receipt filenames bind the UTC timestamp, accepted SHA, and receipt ID. The nested
source-audit receipt ID is deterministic for the audited state; the outer
release-preflight receipt ID is intentionally observation-bound because it covers
the nested audit timestamp. Files are published with mode `0640` by creating and
syncing a temporary inode, linking it to a never-before-used final name, syncing
the directory, and removing the temporary name. The receipt directory must be a
real directory and must not be group- or other-writable; otherwise publication
fails before creating a receipt. An existing final name causes a hard failure; it
is never replaced; that guard is defense in depth even though normal observations
produce unique outer receipt IDs.

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

Even then, the overall #483 program remains active. W2B-B supplies the isolated
exact-runtime build and immutable build receipt; W2B-C must still make the live
generation/runtime overlays one provable transaction with durable rollback
evidence. W2C must then prove the served browser/runtime SHA and arm continuous
drift detection.

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
