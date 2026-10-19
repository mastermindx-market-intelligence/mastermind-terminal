# Shared Shell beta release and recovery

This programme adds a persistent web application at `https://beta.mastermind-x.com` while preserving the current Macro documents as independently rendered pages inside the shell. Terminal owns the outer application, navigation, history, locale and theme state; the legacy document bridge acknowledges the same versioned contract. Existing pages can then move to native application routes individually.

## One release owner, isolated beta effects

`ops/terminal-build.sh` remains the sole Terminal release owner. Its default target is production. The explicit `--target beta` profile uses a separate canonical checkout, app tree, receipt tree, service and port. It does not install global cron wrappers, restart quote-hub, overlay production runtime code, or install a second release owner. Both profiles contend for the same non-stealing build-resource lock.

| Resource | Production | Beta |
| --- | --- | --- |
| Canonical checkout | `/opt/terminal/.gitsrc` | `/opt/terminal/.gitsrc-beta` |
| Application | `/opt/terminal/terminal` | `/opt/terminal/beta/terminal` |
| Runtime siblings | `/opt/terminal/` | `/opt/terminal/beta/` |
| Unit / loopback port | `terminal` / `3000` | `terminal-beta` / `3001` |
| Source audit policy | `terminal_source_audit.production.json` | `terminal_source_audit.beta.json` |
| Receipt and lifecycle parent | `/var/lib/mastermind-terminal` | `/var/lib/mastermind-terminal-beta` |
| Shell opt-in | Removed from owner environment | Exactly `MMX_SHARED_SHELL=1` |

Every invocation names one full lowercase 40-character commit already contained by a freshly fetched protected `origin/master`. A current-generation source receipt precedes ordinary source mutation. Existing preflight, protected-target admission, volume admission, and production health and rollback contracts remain in force.

## Host prerequisites

Provision the reviewed `ops/terminal-beta.service` through the attended host configuration lane. The service starts **disabled and inactive**. Create a dedicated `terminal-beta` system user and group with no login and no added privileged groups. Verify that this user can traverse the existing `/opt/terminal` parent; beta does not change production-owned parent custody.

Create `/var/lib/mastermind-terminal-beta` as root:root `0750` explicitly. Its `host` subdirectory is root-owned and private. Keep runtime secrets in `host/environment`, and the build-time `.env` and optional `.env.local` in the same host directory. Those files remain root-owned `0600`, outside the audited beta app root. Do not print their contents. Do not carry a prior `GIT_SHA`, `NEXT_DEPLOYMENT_ID`, conflicting `MMX_SHARED_SHELL`, or production `PORT` into the beta runtime environment. The release owner pins the build SHA, and the accepted application marker supplies restart identity.

Clone the authorized Terminal origin into the separate root-owned beta canonical checkout. The beta app target must remain absent or provably empty before bootstrap; host configuration must not populate it. Preserve the installed volume guard and its maintenance refusal. Do not delete or steal an existing shared build lock.

The service runs as `terminal-beta`, without capabilities, under `ProtectSystem=strict`. Its only application write exception is `.next/cache`; systemd also supplies the declared private temporary directory. Both the production data path and its beta bind alias are read-only in the service namespace. The owner publishes read/traverse permission on non-secret beta app, dependency and executable build files, without granting write permission. Cache preparation handles the complete existing cache tree and refuses symlinks, shared regular inodes and special files.

## Source and document publication order

The Macro source PR retains all behavior changes, source templates, bridge assets and required paired outputs. Bulk generated-document bridge and asset-stamp changes belong to Macro's established render workflow. The in-memory projection check is not evidence of published pages.

Before public beta acceptance, observe the normal render workflow's generated commit, its publication through `macro-update`, and the actual served document tree. Verify that every rendered document carries one current owned bridge block and the emitted bridge asset matches its source; fragments remain fragments. The detailed source/generated boundary lives in Macro's `research/market_os/SHARED_SHELL_GENERATED_PUBLICATION_2026-10-18.md`.

## First installation and upgrades

Use the merged source identity; never execute an unlanded candidate against the host.

```sh
/opt/terminal/terminal-build.sh --target beta --bootstrap --target-sha FULL_MERGED_SHA
```

Bootstrap first proves an empty target or an exact resumable source-provisioned record. Protected-source containment precedes the archive extraction. Provisioning records **source identity only**. The normal source-audit gate must then accept that source; a provisioned marker is not an accepted runtime or rollback baseline.

An ordinary upgrade uses:

```sh
/opt/terminal/terminal-build.sh --target beta --target-sha FULL_MERGED_SHA
```

Admission binds the accepted record to the actual deployment marker, build ID and responding status endpoint. A missing, stale, source-only or pending baseline refuses the upgrade. An accepted A may advance to a distinct B without rewriting A's original provisioning provenance.

Every beta release writes a durable pending attempt and disables automatic startup before live input changes or generation moves. The candidate starts while pending. Runtime source overlay, app-source reflection, final permission publication and a final restart occur before final source and health verification. Acceptance requires enabled status and an exact protocol, bridge, document, registry and build identity derived from the admitted source blobs. A shape-compatible or stale status does not pass.

Only after those steps may the owner conditionally replace the exact captured accepted pointer. Marker rollback evidence survives until that commit. Startup is enabled only for the durably accepted runtime.

## Failures and recovery

| Observed phase | Enforced result |
| --- | --- |
| Ordinary admission refused | Existing accepted runtime is left alone. No source mutation is authorized. |
| First installation fails or receives a trapped signal | Stop and quarantine the unaccepted candidate; retain source provenance; startup stays disabled. Resume only the exact verified source-provisioned state. |
| Upgrade fails before live source/dependency changes | Restore captured A, then verify marker, build, responding SHA and a fresh source receipt before enabling it. |
| Upgrade fails after possible live input changes | Stop and quarantine beta; retain the pending attempt, historical accepted record and rollback evidence. Do not claim that restoring `.next` alone restored A. |
| Hard interruption leaves a pending attempt | Subsequent ordinary or bootstrap admission refuses. Disabled startup prevents boot enablement; a killed owner cannot itself stop an already running process. Reconcile the exact pending attempt through attended recovery. |
| Acceptance pointer committed but later enablement/cleanup fails | Preserve accepted B and report incomplete completion. Do not restore A beneath B's accepted pointer. |

Never remove pending evidence, a source record, an accepted record or a lock to make a command pass. Determine the recorded attempt, actual process, source identity, marker and build first. There is no silent automatic reconciliation of an unexplained state.

## Release acceptance evidence

Repository tests exercise the transaction, exact status derivation, custody refusals, real source audit and incumbent production admission. Confined command fixtures do not establish an installed service namespace.

On the actual host, verify the admitted source receipt, accepted record, marker, build and status tuple; loaded unit configuration; effective UID, groups and capabilities; service-user traversal; read access to app/dependencies/build; cache create/update access; and nontruncating write refusal through both production-data aliases. Observe that production data publication remains visible through the beta read-only bind without copying or mutating it.

After the healthy beta service is available, apply the reviewed Caddy configuration and beta-only DNS change. Verify public TLS, exact frame policy, no-cache behavior, legacy bridge loading and the ordinary site's embedding denial. Complete fresh-session browser acceptance at 1440×900, 820×1180 and 390×844, including navigation, back/forward, theme/language, native Terminal handoff, authentication return and visible failure/recovery. Retain actual public screenshots. Local fixtures or a successful build are not public-beta completion.
