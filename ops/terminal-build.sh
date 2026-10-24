#!/usr/bin/env bash
# GIT-GATED zero-downtime build for the Mastermind Terminal (Next.js).
#
# ┌─────────────────────────────────────────────────────────────────────────────┐
# │ SOURCE OF TRUTH = protected origin/master in mastermind-terminal.           │
# │ The caller MUST name one full commit SHA already contained by the freshly   │
# │ fetched protected ref. A W2A source receipt for the CURRENT generation must │
# │ be CLEAN before fetch/reset/clean/build. A moving branch is never a target.  │
# │ Working-tree edits and direct rsync/scp are never deployment authority.     │
# └─────────────────────────────────────────────────────────────────────────────┘
#
# USAGE (production, the unchanged default):
#   /opt/terminal/terminal-build.sh --target-sha <full-lowercase-40-hex>
# USAGE (isolated beta target profile):
#   /opt/terminal/terminal-build.sh --target beta --target-sha <full-lowercase-40-hex>
# USAGE (beta-only one-shot failed dirty upgrade recovery; immutable IDs required):
#   /opt/terminal/terminal-build.sh --target beta --recover-attempt <32-hex> --pending-record-id <64-hex> --target-sha <40-hex>
# USAGE (beta-only FIRST-INSTALL bootstrap entrance; invalid for production):
#   /opt/terminal/terminal-build.sh --target beta --bootstrap --target-sha <full-lowercase-40-hex>
#
# TARGET PROFILES — one owner, one CLI, one source contract, two isolated sets of
# effects. `production` is the default and keeps every pre-existing path, service,
# port, policy and global install exactly as it was. `beta` re-roots every effect
# into beta-owned state; nothing a beta run reads, writes, restarts or rolls back
# is ever a production path, on the success path OR on any error path:
#
#   effect                   production                  beta
#   APP (live app root)      /opt/terminal/terminal      /opt/terminal/beta/terminal
#   SRC (canonical git)      /opt/terminal/.gitsrc       /opt/terminal/.gitsrc-beta
#   TSRC (source app dir)    $SRC/terminal               $SRC/terminal
#   deployment marker        $APP/.deployment-id         $APP/.deployment-id  (beta APP)
#   stage root               /opt/terminal/.stage.*      /opt/terminal/beta/.stage.*
#   systemd service          terminal                    terminal-beta
#   health URL               127.0.0.1:3000              127.0.0.1:3001
#   W2A receipts             /var/lib/mastermind-terminal/release-preflight
#                            /var/lib/mastermind-terminal-beta/release-preflight
#   audit policy (bundle)    terminal_source_audit.production.json
#                            terminal_source_audit.beta.json
#   build lock               ONE shared owner-managed lock for BOTH profiles
#   per-target lock marker   /var/lib/mastermind-terminal(-beta)/build-lock
#   build-time env source    $APP/.env*              /var/lib/mastermind-terminal-beta/host
#   beta lifecycle state     /var/lib/mastermind-terminal-beta/source-provisioned
#   first-install entrance   not applicable             --target beta --bootstrap
#   runtime overlay root     /opt/terminal/              /opt/terminal/beta/
#   global cron wrapper,     YES                         NO — never, on any path
#   quote-hub service,
#   owner self-install
#   MMX_SHARED_SHELL         never inherited (unset)     exactly 1 (owner-declared)
#
# The beta profile still deploys only an exact full commit contained by the freshly
# fetched protected ref, still requires a CLEAN (or sole-canonical-head-mismatch)
# W2A receipt for the generation it is about to mutate, still arms the same
# pre-swap canonical recovery, and still gates acceptance on the three-identity
# check. It is a narrower set of destinations, not a weaker set of rules.
#
# AUTHORING SOURCE: ops/terminal-build.sh in the repo. The deployed copy at
# /opt/terminal/terminal-build.sh is installed from master by step 8 of every
# production deploy (effective the NEXT run) — edit via PR, never in place on the
# box. The beta profile deliberately installs NO second copy of this owner: there
# is one release owner, selected with --target, so a beta run cannot drift from,
# overwrite, or be mistaken for the production authority.
#
# One deploy ships TWO kinds of code from the same origin/master SHA (see DEPLOY.md):
#   1. the Next.js app: terminal/ -> staged build -> atomic .next swap
#   2. runtime code consumed by cron + systemd OUTSIDE the app:
#        ingest/ scripts/ config/ contracts/ hub/ signal_layer/
#                                                 (overlay, tracked files only)
#        ops/terminal-data     -> /usr/local/bin/terminal-data (nightly cron)
#        ops/terminal-build.sh -> /opt/terminal/terminal-build.sh (next deploy)
#      signal_layer/ synced since the 2026-07-10 reconciliation (box GC-v2 engine
#      committed, incl. confluence_v2.py) — master is canonical. See DEPLOY.md.
#      Under --target beta only the overlay lands under /opt/terminal/beta, and the
#      two global installs above are not performed at all.
#
# Zero-downtime: builds into a staging tree, atomic-swaps `.next` only after the
# build verifies (BUILD_ID present); the live server keeps serving until the swap.
# Auto-rolls-back to the previous build if the new one fails its health check.
# W2B-A adds only the fail-closed source/target entrance gate. The downstream
# build, app rollback and runtime-overlay behavior is otherwise unchanged here;
# later W2B slices still owe reproducible build and whole-release effect receipts.
# This revision adds four things on top of W2B-A: the isolated beta target profile
# above, ONE shared non-stealing build-resource lock for both profiles (see
# deploy_lock_acquire), the enforced beta bootstrap lifecycle (see
# beta_bootstrap_admit / beta_bootstrap_provision, which provisions SOURCE only and
# never fabricates a runtime), and the release-owner acceptance repairs: the beta
# status check derives the EXACT protocol/bridge/document/registry tuple from the
# admitted commit's own producer files (see shared_shell_status_verified — a
# well-formed but different tuple is a refusal), and the beta runtime tree is
# published read/traverse-only for the dedicated service user with the unit's
# writable surface narrowed to the Next cache (see beta_publish_runtime_readable).
# Production paths, profiles, ports, policies, the protected commit identity and
# the incumbent HUB_BEFORE/LOCK_BEFORE capture order are unchanged.
set -euo pipefail

# ── production profile is the default; select_release_target is the only writer ──
APP=/opt/terminal/terminal
SRC=/opt/terminal/.gitsrc            # canonical git checkout (read-only deploy key: github-mmterminal)
TSRC="$SRC/terminal"
BRANCH=master
AUTHORING_OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PREFLIGHT_RECEIPT_DIR=/var/lib/mastermind-terminal/release-preflight
PREFLIGHT_SCRIPT=
PREFLIGHT_POLICY=
PREFLIGHT_POLICY_BASENAME=terminal_source_audit.production.json
PREFLIGHT_RUNTIME_DIR=
PREFLIGHT_SCRIPT_SHA256=
PREFLIGHT_POLICY_DIGEST=
PREFLIGHT_RUNTIME_SHA256=
PREFLIGHT_ACCEPTED_SHA=
PREFLIGHT_RECEIPT_PATH=
PREFLIGHT_RECEIPT_ID=
PREFLIGHT_SOURCE_RECEIPT_ID=
PREFLIGHT_CANONICAL_HEAD=
PREFLIGHT_RECOVERY_REQUIRED=0
ACCEPTED_REF_BEFORE=
ACCEPTED_REF_SHA=
TARGET=production
SERVICE_NAME=terminal
HEALTH_URL=http://127.0.0.1:3000/
RUNTIME_SYNC_ROOT=/opt/terminal/
STAGE_GATED_PATHS="ingest hub signal_layer config contracts"
INSTALLS_GLOBAL_RUNTIME=1
BUILD_LOCK_MARKER_DIR=/var/lib/mastermind-terminal/build-lock
BETA_BUILD_LOCK_DIR=/var/lib/mastermind-terminal-beta/build-lock
SHARED_BUILD_LOCK_DIR=/opt/terminal/.terminal-build-resource.lock
PRODUCTION_APP_DEFAULT=/opt/terminal/terminal
PRODUCTION_SRC_DEFAULT=/opt/terminal/.gitsrc
PRODUCTION_RECEIPT_DEFAULT=/var/lib/mastermind-terminal/release-preflight
BETA_TARGET_ROOT=/opt/terminal/beta
BETA_APP_DEFAULT=/opt/terminal/beta/terminal
BETA_SRC_DEFAULT=/opt/terminal/.gitsrc-beta
BETA_RECEIPT_DEFAULT=/var/lib/mastermind-terminal-beta/release-preflight
BETA_HOST_ENV_DIR=/var/lib/mastermind-terminal-beta/host
BETA_SERVICE_USER=terminal-beta
SOURCE_PROVISIONED_STATE_DIR=/var/lib/mastermind-terminal-beta/source-provisioned
BETA_STATUS_URL=http://127.0.0.1:3001/api/shared-shell/status
ENV_SOURCE_DIR="$APP"
DEPLOY_LOCK_HELD=0
BOOTSTRAP_REQUESTED=0
DEMOTE_ON_FAILURE=0
BOOTSTRAP_MODE=
BETA_BOOTSTRAP_SCRATCH=
BETA_BOOTSTRAP_SCRATCH_IDENTITY=
RUNTIME_RECORD_PATH=
log(){ echo "[build] $*"; }

# The deploy owner never accepts inherited Git routing or policy. `git -C`
# does not override GIT_DIR/GIT_WORK_TREE, and replacement/config variables can
# change object/ref interpretation. Remove the complete ambient namespace, then
# reinstate only narrow noninteractive/no-replacement settings shared by every
# later Git child in this process.
sanitize_git_environment(){
  local variable
  for variable in "${!GIT_@}"; do
    unset "$variable"
  done
  export GIT_CONFIG_NOSYSTEM=1
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null
  export GIT_NO_REPLACE_OBJECTS=1
  export GIT_TERMINAL_PROMPT=0
  export GIT_ASKPASS=/bin/false
  export GIT_LITERAL_PATHSPECS=1
}

# One explicit full commit is the release intent. Never infer it from a moving
# branch, a short SHA, or an inherited environment variable.
validate_target_sha(){
  local value=${1:-}
  if ! [[ "$value" =~ ^[0-9a-f]{40}$ ]]; then
    log "FATAL: --target-sha must be one full lower-case 40-hex commit SHA"
    return 64
  fi
}

# ── target profile resolution: pure, and it happens before ANY side effect ──────
# Exactly two labels are accepted. A label is never interpolated into a path:
# it selects a fixed, source-declared tuple of destinations. Anything else —
# "Beta", "staging", a short SHA, a path, an empty string — is refused at 64,
# because an attacker- or typo-controlled profile name that became a directory
# name is exactly how one profile ends up writing another profile's state.
# Every profile-scoped variable is assigned in BOTH branches, so a caller cannot
# half-configure a beta run by exporting one of them, and a production run can
# never inherit beta state from a previous call inside this process.
select_release_target(){
  local requested=${1-}
  if [ "$#" -ne 1 ]; then
    log "FATAL: target resolution needs exactly one label"
    return 64
  fi
  case "$requested" in
    production)
      APP="$PRODUCTION_APP_DEFAULT"
      SRC="$PRODUCTION_SRC_DEFAULT"
      BUILD_LOCK_MARKER_DIR=/var/lib/mastermind-terminal/build-lock
      PREFLIGHT_RECEIPT_DIR="$PRODUCTION_RECEIPT_DEFAULT"
      PREFLIGHT_POLICY_BASENAME=terminal_source_audit.production.json
      SERVICE_NAME=terminal
      HEALTH_URL=http://127.0.0.1:3000/
      RUNTIME_SYNC_ROOT=/opt/terminal/
      STAGE_GATED_PATHS="ingest hub signal_layer config contracts"
      INSTALLS_GLOBAL_RUNTIME=1
      ENV_SOURCE_DIR="$APP"
      ;;
    beta)
      APP="$BETA_APP_DEFAULT"
      SRC="$BETA_SRC_DEFAULT"
      BUILD_LOCK_MARKER_DIR=/var/lib/mastermind-terminal-beta/build-lock
      PREFLIGHT_RECEIPT_DIR="$BETA_RECEIPT_DEFAULT"
      PREFLIGHT_POLICY_BASENAME=terminal_source_audit.beta.json
      SERVICE_NAME=terminal-beta
      HEALTH_URL=http://127.0.0.1:3001/
      RUNTIME_SYNC_ROOT=/opt/terminal/beta/
      STAGE_GATED_PATHS="ingest hub signal_layer config contracts scripts"
      INSTALLS_GLOBAL_RUNTIME=0
      ENV_SOURCE_DIR="$BETA_HOST_ENV_DIR"
      ;;
    *)
      log "FATAL: --target accepts exactly one of: production beta. Arbitrary labels are never a path."
      return 64
      ;;
  esac
  TSRC="$SRC/terminal"
  DEPLOYMENT_MARKER="$APP/.deployment-id"
  TARGET="$requested"
}

# The shared-shell opt-in is profile state, not caller state.
#  * production: MMX_SHARED_SHELL is removed from this process and therefore from
#    every child (npm build, systemd unit restart). A production deploy can never
#    be turned into a shared-shell deploy by an inherited environment.
#  * beta: the flag is required. If the caller did not name it, this owner declares
#    it (exactly 1) so the build and the beta unit agree. If the caller named it
#    with ANY other value, that is a disagreement about what is being deployed and
#    it is fatal: the owner never silently overwrites a caller's setting, and it
#    never silently reads a caller's secrets either.
apply_profile_environment(){
  if [ "$TARGET" = production ]; then
    unset MMX_SHARED_SHELL
    log "profile environment: production; MMX_SHARED_SHELL is never inherited from the caller"
    return 0
  fi
  case "${MMX_SHARED_SHELL-}" in
    "")
      export MMX_SHARED_SHELL=1
      log "profile environment: beta; MMX_SHARED_SHELL=1 declared by this owner"
      ;;
    1)
      export MMX_SHARED_SHELL=1
      log "profile environment: beta; caller already declared exactly MMX_SHARED_SHELL=1"
      ;;
    *)
      log "FATAL: beta requires MMX_SHARED_SHELL to be absent or exactly 1 (got a different value); refusing to override the caller's runtime setting"
      return 64
      ;;
  esac
}

# Beta runtime settings are verified against the source-managed unit, never
# assumed: the process that will serve this build must already declare the same
# shared-shell opt-in the build was made with, and the approved root must have
# enabled the unit. $1 is the required activity state — "inactive" for the
# bootstrap entrance (nothing may be serving a target that has not been
# provisioned yet) and "active" once a beta start/restart has been claimed.
#
# Only presence is ever inspected and only presence is ever logged. systemctl's
# Environment= line can carry secret values, so this owner NEVER prints an
# inspected unit environment, in the log, in a refusal, or in a receipt.
beta_unit_declares_shared_shell(){
  local required_state=${1:-active} required_enablement=${2:-enabled} value
  [ "$TARGET" = beta ] || return 0
  if ! command -v systemctl >/dev/null 2>&1; then
    log "FATAL: beta requires the $SERVICE_NAME unit to be inspected and systemctl is unavailable"
    return 65
  fi
  if ! value=$(systemctl show -p LoadState --value "$SERVICE_NAME" 2>/dev/null) \
    || [ "$value" != loaded ]; then
    log "FATAL: unit $SERVICE_NAME is not loaded (observed LoadState=${value:-<empty>})"
    return 65
  fi
  case "$required_enablement" in enabled|disabled) ;; *) return 64 ;; esac
  if ! value=$(systemctl show -p UnitFileState --value "$SERVICE_NAME" 2>/dev/null) \
    || [ "$value" != "$required_enablement" ]; then
    log "FATAL: unit $SERVICE_NAME must be $required_enablement for this beta phase (observed UnitFileState=${value:-<empty>})"
    return 65
  fi
  if ! value=$(systemctl show -p ActiveState --value "$SERVICE_NAME" 2>/dev/null); then
    log "FATAL: beta cannot inspect the active state of unit $SERVICE_NAME"
    return 65
  fi
  if [ "$required_state" = inactive ]; then
    if [ "$value" != inactive ]; then
      log "FATAL: a beta bootstrap entrance requires $SERVICE_NAME to be inactive (observed ActiveState=$value); an active service is never bootstrapped over"
      return 65
    fi
  elif [ "$value" != active ]; then
    log "FATAL: beta acceptance requires $SERVICE_NAME to be active (observed ActiveState=$value)"
    return 65
  fi
  if ! value=$(systemctl show -p Environment --value "$SERVICE_NAME" 2>/dev/null); then
    log "FATAL: beta cannot inspect the runtime settings of unit $SERVICE_NAME"
    return 65
  fi
  # A trailing space is appended to the observed value so a single-variable
  # environment still matches the bounded " VAR=1 " token below.
  case " $value " in
    *" MMX_SHARED_SHELL=1 "*)
      log "beta unit settings verified: $SERVICE_NAME declares MMX_SHARED_SHELL=1 (presence only; the environment is never logged)"
      return 0
      ;;
  esac
  log "FATAL: unit $SERVICE_NAME does not declare MMX_SHARED_SHELL=1; refusing to build and activate a beta generation the beta service would not run correctly"
  return 65
}

# Safe custody inspection for every beta prerequisite path. A symlink alias, a
# non-directory, a foreign owner or group/other-writable mode is a refusal — the
# owner never normalises unexplained state, and never follows a link it did not
# create. Used for the beta target root, the beta host env dir, the lifecycle
# state tree and the shared build lock directory.
verify_owned_directory(){
  python3 -I - "$1" "$2" <<'PY_VERIFY_DIR'
import os
import stat
import sys

label, path = sys.argv[1], sys.argv[2]
try:
    metadata = os.lstat(path)
except OSError as exc:
    raise SystemExit(f"{label} cannot be inspected ({path}): {exc.strerror or exc}")
if stat.S_ISLNK(metadata.st_mode):
    raise SystemExit(f"{label} is a symlink alias, which is never followed: {path}")
if not stat.S_ISDIR(metadata.st_mode):
    raise SystemExit(f"{label} is not a real directory: {path}")
if metadata.st_uid != os.geteuid():
    raise SystemExit(f"{label} is not owned by the deployment principal (uid {metadata.st_uid} != {os.geteuid()}): {path}")
if stat.S_IMODE(metadata.st_mode) & 0o022:
    raise SystemExit(f"{label} is group or other writable: {path}")
PY_VERIFY_DIR
}

# A path may only be mutated by a beta run when it is inside the beta target root
# declared by this source file. This is the guard that makes "beta can never touch
# production" a property of the code path rather than of operator discipline.
beta_target_scoped_path(){
  local label=$1 path=$2 resolved_root
  [ "$TARGET" = beta ] || { log "FATAL: $label is beta-profile-only"; return 64; }
  case "$path" in
    /*) ;;
    *) log "FATAL: $label must be an absolute path: $path"; return 64 ;;
  esac
  if ! resolved_root=$(cd "$BETA_TARGET_ROOT" 2>/dev/null && pwd -P); then
    log "FATAL: $label cannot be scoped because the beta target root is unavailable"; return 73
  fi
  case "$path" in
    "$resolved_root"|"$resolved_root"/*) return 0 ;;
  esac
  log "FATAL: $label is outside the beta target root ($resolved_root): $path"
  return 64
}

# The post-deploy proof for a shared-shell generation. `curl -fsS /` cannot make
# this decision — a stale or rolled-back build answers a 200 at / just as happily.
# The expected tuple is DERIVED from the exact admitted protected source, never
# hardcoded here and never supplied by a caller: `git cat-file` reads the frozen
# blobs of the admitted commit ($want_sha) out of the profile's canonical checkout
# ($repository) — the same identity the W2A admission and the source audit pinned.
#   terminal/lib/sharedShellContracts.ts
#       -> SHARED_SHELL_PROTOCOL / SHARED_SHELL_BRIDGE_VERSION /
#          SHARED_SHELL_DOCUMENT_VERSION, each declared exactly once
#   terminal/lib/sharedShellRoutes.generated.json
#       -> sources.registrySha256 (the projection metadata the status route exports)
# terminal/app/api/shared-shell/status answers with exactly those values plus
# SHARED_SHELL_BUILD, which next.config.ts pins to the deployment id this owner
# built with — the admitted full SHA. Acceptance requires enabled === true,
# buildId === the admitted SHA, and EVERY derived field matching EXACTLY. A
# syntactically valid but different protocol/bridge/document/registry tuple is a
# refusal, and so is any derivation failure (missing file, ambiguous constant
# declaration, malformed digest): shape-only acceptance was defect (2) and is
# gone. There is deliberately no environment variable, policy field or argument
# that can hand this function an expected value — the admitted source is the only
# authority. Production health semantics are unchanged.
shared_shell_status_verified(){
  local url=$1 want_sha=$2 repository=$3
  local payload temporary response contracts_file routes_file rc=0
  validate_target_sha "$want_sha" || return $?
  if [ -z "$repository" ] || [ ! -d "$repository" ] || [ -L "$repository" ]; then
    log "FATAL: shared-shell acceptance needs the profile's canonical checkout to derive the admitted tuple"
    return 65
  fi
  temporary=$(mktemp -d /tmp/terminal-build-status.XXXXXX) || return $?
  response="$temporary/status.json"
  contracts_file="$temporary/sharedShellContracts.ts"
  routes_file="$temporary/sharedShellRoutes.generated.json"
  sanitize_git_environment
  if ! git -C "$repository" cat-file blob "$want_sha:terminal/lib/sharedShellContracts.ts" \
      >"$contracts_file" 2>/dev/null; then
    log "FATAL: the admitted commit carries no terminal/lib/sharedShellContracts.ts; acceptance cannot be derived and is refused"
    rm -rf "$temporary"
    return 65
  fi
  if ! git -C "$repository" cat-file blob "$want_sha:terminal/lib/sharedShellRoutes.generated.json" \
      >"$routes_file" 2>/dev/null; then
    log "FATAL: the admitted commit carries no terminal/lib/sharedShellRoutes.generated.json; acceptance cannot be derived and is refused"
    rm -rf "$temporary"
    return 65
  fi
  if ! payload=$(curl -fsS --max-time 20 "$url"); then
    log "FATAL: the beta status endpoint did not answer: $url"
    rm -rf "$temporary"
    return 65
  fi
  printf '%s' "$payload" >"$response"
  # The captured response and both admitted blobs are handed over as FILES: this
  # interpreter's stdin is the heredoc carrying the validator itself, so a piped
  # body would read as empty — and an empty body must never be mistaken for a
  # healthy endpoint.
  python3 -I - "$want_sha" "$url" "$response" "$contracts_file" "$routes_file" <<'PY_STATUS' || rc=$?
import json
import os
import re
import stat
import sys

MAX_STATUS_BYTES = 64 * 1024
MAX_CONTRACTS_BYTES = 1024 * 1024
MAX_ROUTES_BYTES = 8 * 1024 * 1024
TOKEN_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
HEX_RE = re.compile(r"\A[0-9a-f]{64}\Z")

want_sha, url, response_path, contracts_path, routes_path = sys.argv[1:6]


def read_bounded(path, maximum, label):
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise SystemExit(f"the captured {label} is not a regular file")
    if metadata.st_size > maximum:
        raise SystemExit(f"{label} exceeds its bound")
    with open(path, "rb") as handle:
        raw = handle.read(maximum + 1)
    if len(raw) > maximum:
        raise SystemExit(f"{label} exceeds its bound")
    return raw


def derive_constant(raw, name):
    pattern = (
        rb'export\s+const\s+' + name.encode("ascii")
        + rb'\s*=\s*"([^"\n]+)"\s*as\s+const\s*;'
    )
    found = re.findall(pattern, raw)
    if len(found) != 1:
        raise SystemExit(
            f"the admitted contracts file must declare {name} exactly once (found {len(found)})"
        )
    try:
        value = found[0].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SystemExit(f"admitted {name} is not UTF-8: {exc}")
    if TOKEN_RE.fullmatch(value) is None:
        raise SystemExit(f"admitted {name} is not one well-formed version token")
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SystemExit(f"duplicate JSON key in the admitted projection: {key}")
        result[key] = value
    return result


contracts_raw = read_bounded(contracts_path, MAX_CONTRACTS_BYTES, "admitted contracts blob")
routes_raw = read_bounded(routes_path, MAX_ROUTES_BYTES, "admitted projection blob")
try:
    routes = json.loads(routes_raw.decode("utf-8"), object_pairs_hook=unique_object)
except (UnicodeDecodeError, json.JSONDecodeError) as exc:
    raise SystemExit(f"the admitted projection JSON is invalid: {exc}")
if not isinstance(routes, dict):
    raise SystemExit("the admitted projection JSON root must be an object")
sources = routes.get("sources")
if not isinstance(sources, dict):
    raise SystemExit("the admitted projection JSON carries no sources object")
registry = sources.get("registrySha256")
if not isinstance(registry, str) or HEX_RE.fullmatch(registry) is None:
    raise SystemExit("the admitted sources.registrySha256 is not one lower-case sha256 digest")

admitted = {
    "protocol": derive_constant(contracts_raw, "SHARED_SHELL_PROTOCOL"),
    "bridgeVersion": derive_constant(contracts_raw, "SHARED_SHELL_BRIDGE_VERSION"),
    "documentVersion": derive_constant(contracts_raw, "SHARED_SHELL_DOCUMENT_VERSION"),
    "registrySha256": registry,
}

raw = read_bounded(response_path, MAX_STATUS_BYTES, "beta status response")
try:
    body = json.loads(raw.decode("utf-8"))
except Exception as exc:
    raise SystemExit(f"beta status response from {url} is not JSON: {exc}")
if not isinstance(body, dict):
    raise SystemExit(f"beta status response from {url} is not an object")
if body.get("enabled") is not True:
    raise SystemExit(f"beta runtime is not shared-shell enabled: {body.get('enabled')!r}")
build_id = body.get("buildId")
if not isinstance(build_id, str) or build_id != want_sha:
    raise SystemExit(f"beta build identity is not the admitted generation: got {build_id!r}")
for key in ("protocol", "bridgeVersion", "documentVersion", "registrySha256"):
    expected = admitted[key]
    observed = body.get(key)
    if not isinstance(observed, str) or observed != expected:
        raise SystemExit(
            f"beta status {key}={observed!r} does not match the admitted source {expected!r}"
        )
print(
    f"beta status verified against the admitted tuple: protocol={admitted['protocol']} "
    f"bridge={admitted['bridgeVersion']} document={admitted['documentVersion']} "
    f"registry={admitted['registrySha256'][:12]}... build={build_id[:12]}"
)
PY_STATUS
  rm -rf "$temporary"
  return "$rc"
}

# ── ONE shared build-resource lock, per-target guards kept ───────────────────
# The candidate locked each target separately, so a production npm build and a beta
# npm build could run at the same instant on one 3.9 GB host — each raising a 3 GB
# Node heap — while both extracted the same protected commit into the same
# filesystem. Separating the two profiles' *state* was right; making that also the
# mutual-exclusion boundary was wrong. This owner therefore takes ONE
# owner-managed, non-stealing lock at a single shared path before ANY mutable
# deploy/build/source effect: before the first receipt write, the first
# provisioning archive, the first staging directory, the first Git command and the
# first service effect. A per-target subdirectory of the shared lock names which
# profile holds it, so a beta run is never blamed for (or allowed to clear) a
# production hold, and the per-target identity/path guards in
# assert_deploy_paths_scoped stay exactly as load-bearing as before.
#
# There is no stale-lock deletion and no retry that forces possession: this owner
# cannot prove a pid is dead-and-never-recycled, and guessing wrong means building
# on top of a live deploy. A held lock is a refusal (exit 75) plus the holder
# record. Release is ownership-tested — an EXIT path removes only the record this
# pid wrote, and nothing else. The holder record also names the target it was taken
# for, and release refuses if that label is not the one this run resolved.
deploy_lock_acquire(){
  local lock_dir=${1:-} target=${2:-} record
  if [ "$DEPLOY_LOCK_HELD" = 1 ]; then
    log "FATAL: this process already holds the shared build lock; refusing to nest locks"
    return 64
  fi
  if [ "$lock_dir" != "$SHARED_BUILD_LOCK_DIR" ]; then
    log "FATAL: the build lock path is not the single shared owner-managed path"
    return 64
  fi
  case "$target" in
    production|beta) ;;
    *) log "FATAL: the shared build lock needs the resolved target label"; return 64 ;;
  esac
  if ! mkdir -- "$lock_dir" 2>/dev/null; then
    if [ ! -d "$lock_dir" ] || [ -L "$lock_dir" ]; then
      log "FATAL: the shared build lock path exists and is not a real directory: $lock_dir"
      return 73
    fi
  fi
  if ! verify_owned_directory "shared build lock directory" "$lock_dir"; then
    log "FATAL: refusing to take the build lock in a directory this owner does not exclusively control: $lock_dir"
    return 73
  fi
  # One hold, no matter which profile is asking: this is the resource the two
  # profiles share, so a beta run contends with a production run by design. The
  # label below records WHO holds it; it never creates a second, parallel lock.
  if ! mkdir -- "$lock_dir/hold" 2>/dev/null; then
    record=$(tr '\n' ' ' <"$lock_dir/hold/owner" 2>/dev/null || true)
    log "FATAL: another deploy already holds the shared build lock ($lock_dir/hold); refusing to overlap source, staging, build or activation effects"
    log "  held lock record: ${record:-<no readable owner record>}"
    log "  this owner never steals a lock, never deletes one as stale and never retries for possession; reconcile out of band only after confirming the holder process is gone"
    return 75
  fi
  if ! chmod 0700 "$lock_dir/hold"; then
    log "FATAL: cannot set mode 0700 on the freshly created build lock hold $lock_dir/hold"
    rmdir -- "$lock_dir/hold" 2>/dev/null
    return 73
  fi
  if ! ( umask 077
         printf 'pid=%s\nuid=%s\ntarget=%s\nshared=%s\nstarted=%s\n' \
           "$$" "$EUID" "$target" "$lock_dir" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
           >"$lock_dir/hold/owner" ); then
    log "FATAL: cannot record build lock ownership in $lock_dir/hold"
    rm -f -- "$lock_dir/hold/owner" 2>/dev/null
    rmdir -- "$lock_dir/hold" 2>/dev/null
    return 73
  fi
  # Per-target marker directory: a harmless, best-effort record of which targets
  # this shared lock serves. Its absence never grants or waives anything, and a
  # refusal to create it is not fatal — see the report. This is also the identity
  # proof that the shared lock path belongs to this host's owner.
  if ! mkdir -p -- "$BUILD_LOCK_MARKER_DIR" 2>/dev/null \
    && [ ! -d "$BUILD_LOCK_MARKER_DIR" ]; then
    log "WARN: could not create the per-target build lock marker directory $BUILD_LOCK_MARKER_DIR"
  fi
  DEPLOY_LOCK_HELD=1
  log "build lock acquired: shared=$lock_dir/hold target=$target pid=$$"
  return 0
}

deploy_lock_release(){
  local lock_dir=${1-$SHARED_BUILD_LOCK_DIR} held=${2-$DEPLOY_LOCK_HELD} target=${3-$TARGET} pid
  [ "$held" = 1 ] || return 0
  [ -n "$lock_dir" ] && [ -n "$target" ] || return 0
  DEPLOY_LOCK_HELD=0
  if [ ! -f "$lock_dir/hold/owner" ]; then
    log "FATAL: the build lock record vanished from $lock_dir/hold; the hold is left exactly where it is"
    return 1
  fi
  pid=$(sed -n 's/^pid=//p' "$lock_dir/hold/owner" 2>/dev/null | head -n 1 || true)
  if [ "$pid" != "$$" ]; then
    log "FATAL: build lock $lock_dir/hold is recorded as pid=${pid:-<unreadable>}, not this process ($$); it is not this run's lock to remove"
    return 1
  fi
  holder_target=$(sed -n 's/^target=//p' "$lock_dir/hold/owner" 2>/dev/null | head -n 1 || true)
  if [ -n "$holder_target" ] && [ "$holder_target" != "$target" ]; then
    log "FATAL: the build lock this process wrote is recorded for target=$holder_target, not $target"
    return 1
  fi
  if ! rm -f -- "$lock_dir/hold/owner"; then
    log "FATAL: could not remove the build lock record in $lock_dir/hold"
    return 1
  fi
  if ! rmdir -- "$lock_dir/hold"; then
    log "FATAL: could not remove the now-empty build lock hold $lock_dir/hold"
    return 1
  fi
  log "build lock released: $lock_dir/hold"
}

# Per-target identity and path guards, kept in force beside the shared lock: the
# selected tuple must be exactly the one this source declares, no profile may
# resolve into the other profile's tree, and every mutable root must be a real,
# owned, non-symlink directory. Aliases and half-configured profiles are refused
# before the first write, not discovered afterwards.
assert_deploy_paths_scoped(){
  local app_parent declared_receipt declared_src production_parent beta_parent
  case "$TARGET" in
    production)
      declared_src="$PRODUCTION_SRC_DEFAULT"
      declared_receipt="$PRODUCTION_RECEIPT_DEFAULT"
      ;;
    beta)
      declared_src="$BETA_SRC_DEFAULT"
      declared_receipt="$BETA_RECEIPT_DEFAULT"
      ;;
    *) log "FATAL: path scoping needs a resolved target"; return 64 ;;
  esac
  production_parent=$(dirname "$PRODUCTION_APP_DEFAULT")
  beta_parent=$(dirname "$BETA_APP_DEFAULT")
  app_parent=$(dirname "$APP")
  case "$APP" in
    "$PRODUCTION_APP_DEFAULT"|"$BETA_APP_DEFAULT") ;;
    *) log "FATAL: the app root is not a source-declared profile root: $APP"; return 64 ;;
  esac
  if [ "$SRC" != "$declared_src" ]; then
    log "FATAL: target=$TARGET must use its declared canonical checkout $declared_src (got $SRC)"
    return 64
  fi
  if [ "$PREFLIGHT_RECEIPT_DIR" != "$declared_receipt" ]; then
    log "FATAL: target=$TARGET must publish to its declared receipt tree $declared_receipt"
    return 64
  fi
  case "$TARGET:$app_parent" in
    "production:$production_parent"|beta:"$beta_parent") ;;
    "production:$beta_parent"|beta:"$production_parent")
      log "FATAL: target=$TARGET resolved into the other profile's tree: $app_parent"
      return 64 ;;
    *) log "FATAL: target=$TARGET has an unexpected staging parent: $app_parent"; return 64 ;;
  esac
  verify_owned_directory "canonical checkout for target=$TARGET" "$SRC" || return $?
  if [ ! -d "$SRC/.git" ] || [ -L "$SRC/.git" ]; then
    log "FATAL: target=$TARGET canonical checkout has no real .git directory: $SRC/.git"
    return 73
  fi
  verify_owned_directory "staging parent for target=$TARGET" "$app_parent" || return $?
  if [ -e "$APP" ] || [ -L "$APP" ]; then
    verify_owned_directory "live app root for target=$TARGET" "$APP" || return $?
  elif [ "$TARGET" = production ]; then
    log "FATAL: the production app root must already exist and is never created by this owner: $APP"
    return 73
  fi
  if [ "$TARGET" = beta ]; then
    verify_owned_directory "beta target root" "$BETA_TARGET_ROOT" || return $?
    case "$APP" in
      "$BETA_TARGET_ROOT"/*) ;;
      *) log "FATAL: the beta app root is not inside the beta target root: $APP"; return 64 ;;
    esac
    case "$SRC" in
      "$BETA_TARGET_ROOT"|"$BETA_TARGET_ROOT"/*)
        log "FATAL: the beta canonical checkout must not live inside the beta target root"
        return 64 ;;
    esac
  fi
  return 0
}

# Beta prerequisites are created only where they are absent; existing state is
# inspected and never normalised. The unit file and the secret EnvironmentFile stay
# OUTSIDE the audited app target (the unit lives in the system unit path and
# $BETA_HOST_ENV_DIR sits in the beta state tree, not under the target root) so a
# harmless source-managed prerequisite can never be mistaken for unknown target
# data during the bootstrap admission.
ensure_beta_workspace(){
  local path
  [ "$TARGET" = beta ] || return 0
  for path in "$BETA_TARGET_ROOT" "$BETA_HOST_ENV_DIR" "$SOURCE_PROVISIONED_STATE_DIR" \
            "$BETA_BUILD_LOCK_DIR"; do
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then
      install -d -o root -g root -m 0750 "$path" || return $?
    fi
    verify_owned_directory "beta prerequisite directory" "$path" || return $?
  done
  return 0
}

# Next's TypeScript check runs in a forked build worker that inherits NODE_OPTIONS.
# On this 3.9 GB host Node's default old-space ceiling is ~2 GB, and the f7bce8dc
# release (#972) aborted at 1952 MB during "Running TypeScript" (2026-10-13) — a
# pre-swap failure that shipped nothing. Raise the ceiling for the build unless the
# caller already chose one; the host's 8 GB swap absorbs overlap with `next start`.
BUILD_NODE_HEAP_MB=3072
build_node_options(){
  local inherited=${1:-}
  case " $inherited " in
    *" --max-old-space-size"*|*" --max_old_space_size"*) printf '%s\n' "$inherited" ;;
    *) printf '%s\n' "${inherited:+$inherited }--max-old-space-size=$BUILD_NODE_HEAP_MB" ;;
  esac
}

# First adoption executes the exact protected ops/ artifact from a temporary
# directory. Later releases use the currently deployed canonical checkout. The
# script and policy always come from one complete, real, non-symlink directory;
# an incomplete first candidate never mixes with a second candidate.
#
# The bundle mechanism is unchanged; only the POLICY FILE NAME is profile-scoped.
# A beta run is admitted by ops/terminal_source_audit.beta.json from the beta
# canonical checkout, selected by the same trusted-directory, same-owner,
# not-group/other-writable, non-symlink, stable-inode, canonical-JSON-digest and
# runtime-hash validations as production. The basename is one plain file name
# chosen by the profile, never a path, and production's policy file is never a
# candidate for a beta run or vice versa: a beta deploy audited against production
# marker/live mappings would be a beta deploy claiming to prove something it never
# looked at.
select_preflight_artifacts(){
  local expected_uid=${1:-} directory script policy runtime resolved evidence
  if ! [[ "$expected_uid" =~ ^[0-9]+$ ]]; then
    log "FATAL: preflight bundle expected UID must be numeric"
    return 64
  fi
  case "$PREFLIGHT_POLICY_BASENAME" in
    ""|*/*|.|..)
      log "FATAL: the selected profile's preflight policy basename must be one plain file name"
      return 64
      ;;
  esac
  shift
  PREFLIGHT_SCRIPT=
  PREFLIGHT_POLICY=
  PREFLIGHT_RUNTIME_DIR=
  PREFLIGHT_SCRIPT_SHA256=
  PREFLIGHT_POLICY_DIGEST=
  PREFLIGHT_RUNTIME_SHA256=
  for directory in "$@"; do
    [ -d "$directory" ] && [ ! -L "$directory" ] || continue
    script="$directory/terminal_release_preflight.py"
    policy="$directory/$PREFLIGHT_POLICY_BASENAME"
    runtime="$directory/terminal_audit"
    [ -f "$script" ] && [ ! -L "$script" ] || continue
    [ -f "$policy" ] && [ ! -L "$policy" ] || continue
    [ -d "$runtime" ] && [ ! -L "$runtime" ] || continue
    if ! evidence=$(python3 -I - "$directory" "$expected_uid" "$PREFLIGHT_POLICY_BASENAME" <<'PY_BUNDLE'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
expected_uid = int(sys.argv[2])
policy_basename = sys.argv[3]
script = root / "terminal_release_preflight.py"
policy = root / policy_basename
runtime = root / "terminal_audit"

if "/" in policy_basename or policy_basename in ("", ".", ".."):
    raise ValueError("preflight policy basename must be one plain file name")


def trusted_stat(path: Path, kind: str) -> os.stat_result:
    metadata = os.lstat(path)
    if metadata.st_uid != expected_uid:
        raise ValueError(f"unexpected owner for {path}")
    if stat.S_IMODE(metadata.st_mode) & 0o022:
        raise ValueError(f"group/other writable preflight artifact: {path}")
    if kind == "directory" and not stat.S_ISDIR(metadata.st_mode):
        raise ValueError(f"expected real directory: {path}")
    if kind == "file" and not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"expected real regular file: {path}")
    return metadata


def stable_bytes(path: Path, limit: int = 4 * 1024 * 1024) -> tuple[bytes, int]:
    expected = trusted_stat(path, "file")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        if (before.st_dev, before.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError(f"artifact changed before open: {path}")
        if before.st_size > limit:
            raise ValueError(f"artifact exceeds bound: {path}")
        chunks: list[bytes] = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > limit:
            raise ValueError(f"artifact exceeds bound: {path}")
        after = os.fstat(descriptor)
        identity = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_uid,
            item.st_gid,
            item.st_size,
            item.st_mtime_ns,
        )
        if identity(before) != identity(after):
            raise ValueError(f"artifact changed while read: {path}")
        return payload, stat.S_IMODE(after.st_mode)
    finally:
        os.close(descriptor)


trusted_stat(root, "directory")
script_bytes, _ = stable_bytes(script)
policy_bytes, _ = stable_bytes(policy)
policy_object = json.loads(policy_bytes.decode("utf-8"))
if not isinstance(policy_object, dict):
    raise ValueError("preflight policy root must be an object")
policy_digest = hashlib.sha256(
    json.dumps(policy_object, sort_keys=True, separators=(",", ":")).encode("utf-8")
).hexdigest()

trusted_stat(runtime, "directory")
runtime_hash = hashlib.sha256()
runtime_files = 0
for current, dirnames, filenames in os.walk(runtime, topdown=True, followlinks=False):
    dirnames.sort()
    filenames.sort()
    current_path = Path(current)
    current_meta = trusted_stat(current_path, "directory")
    relative_dir = current_path.relative_to(runtime).as_posix()
    runtime_hash.update(
        f"D\0{relative_dir}\0{stat.S_IMODE(current_meta.st_mode):o}\n".encode()
    )
    # Python bytecode caches are derived, gitignored state this owner provably
    # cannot clean: `git clean -fd` keeps ignored paths, so one stray root import
    # under the canonical `ops/` aborts the deploy at its FIRST gate, before any
    # work, and only an out-of-band `rm -rf` clears it. Measured on the production
    # host, not inferred: three releases died on this in five days --
    # deploy-sol-ci-scroll-hotfix-20260924T1451Z, deploy-paper-research-20260925-
    # 8bc5f946 and deploy-static-boundary-repair-20260928T0025Z -- each ending in
    # `ValueError: preflight runtime must not contain __pycache__` and
    # `FATAL: no complete trusted ... bundle is available`, and each rescued by a
    # manual re-run minutes later that selected this same canonical bundle
    # (runtime_sha256=accd6734...). So the cost is a hard, hands-on deploy abort
    # with a healthy bundle sitting right there (#483). The production
    # source-audit policy already classifies __pycache__ as generated_python_cache,
    # so classify it the same way here: custody is still proven, the contents are
    # never descended into, and nothing inside reaches the runtime digest.
    #
    # Tolerating it is only safe because run_release_preflight redirects
    # sys.pycache_prefix off the source tree. -B alone stops WRITES; Python still
    # READS a source-adjacent .pyc, so without that redirect a cache entry would
    # execute in place of the .py beside it.
    #
    # What contains this is CUSTODY, not the digest: trusted_stat proves every
    # directory on the way here is owned by the expected principal and is not
    # group/other writable, so nothing else can place bytes in them.
    # PREFLIGHT_RUNTIME_SHA256 is OBSERVATIONAL -- it is logged, never compared to a
    # pinned value and never carried in the receipt -- so do not reason about it as
    # though hashing were the control that stops execution.
    for dirname in dirnames:
        trusted_stat(current_path / dirname, "directory")
    dirnames[:] = [name for name in dirnames if name != "__pycache__"]
    for filename in filenames:
        candidate = current_path / filename
        if candidate.suffix != ".py":
            raise ValueError(f"unexpected preflight runtime artifact: {candidate}")
        payload, mode = stable_bytes(candidate)
        relative = candidate.relative_to(runtime).as_posix()
        runtime_hash.update(
            f"F\0{relative}\0{mode:o}\0".encode()
            + hashlib.sha256(payload).hexdigest().encode()
            + b"\n"
        )
        runtime_files += 1
if runtime_files == 0 or not (runtime / "__init__.py").is_file():
    raise ValueError("preflight runtime package is incomplete")

print(
    "\t".join(
        (
            hashlib.sha256(script_bytes).hexdigest(),
            policy_digest,
            runtime_hash.hexdigest(),
        )
    )
)
PY_BUNDLE
    ); then
      continue
    fi
    IFS=$'\t' read -r PREFLIGHT_SCRIPT_SHA256 PREFLIGHT_POLICY_DIGEST \
      PREFLIGHT_RUNTIME_SHA256 <<< "$evidence"
    resolved=$(cd "$directory" && pwd -P) || continue
    PREFLIGHT_SCRIPT="$resolved/terminal_release_preflight.py"
    PREFLIGHT_POLICY="$resolved/$PREFLIGHT_POLICY_BASENAME"
    PREFLIGHT_RUNTIME_DIR="$resolved/terminal_audit"
    return 0
  done
  log "FATAL: no complete trusted Terminal release-preflight artifact bundle is available (target=$TARGET policy basename=$PREFLIGHT_POLICY_BASENAME)"
  return 66
}

# Receipt publication is the only write admitted before source mutation. Never
# chmod/chown unexplained existing state into compliance: inspect first, create
# only missing directories, then inspect again. The W2A command performs its own
# resolved-path and immutable-publication checks too.
# The receipt directory is profile-scoped, so a beta run publishes to
# /var/lib/mastermind-terminal-beta and can neither consume nor invalidate a
# production receipt. Both profiles hold the identical custody requirement.
verify_preflight_receipt_directory(){
  local path=$1 identity
  if [ ! -d "$path" ] || [ -L "$path" ]; then
    log "FATAL: release-preflight receipt path is not a real directory: $path"
    return 73
  fi
  identity=$(stat -c '%F:%a:%u:%g' "$path" 2>/dev/null) || {
    log "FATAL: cannot inspect release-preflight receipt path: $path"
    return 73
  }
  if [ "$identity" != "directory:750:0:0" ]; then
    log "FATAL: receipt path $path is not root-owned 0750; existing state is never normalized"
    return 73
  fi
}

prepare_preflight_receipt_dir(){
  local receipt_dir=$1 parent path
  case "$receipt_dir" in
    /*/*) ;;
    *) log "FATAL: release-preflight receipt directory must be absolute"; return 64 ;;
  esac
  parent=${receipt_dir%/*}

  for path in "$parent" "$receipt_dir"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      verify_preflight_receipt_directory "$path" || return $?
    fi
  done

  if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then
    install -d -o root -g root -m 0750 "$parent" || return $?
  fi
  if [ ! -e "$receipt_dir" ] && [ ! -L "$receipt_dir" ]; then
    install -d -o root -g root -m 0750 "$receipt_dir" || return $?
  fi

  verify_preflight_receipt_directory "$parent" || return $?
  verify_preflight_receipt_directory "$receipt_dir"
}

# Run the accepted W2A gate and bind its immutable evidence to shell variables
# consumed by this owner. Every non-zero result is propagated unchanged. A
# successful summary is not enough: exactly one new receipt must appear, and its
# complete content, policy digest and deterministic IDs must agree with summary.
run_release_preflight(){
  local script=$1 policy=$2 canonical_repo=$3 receipt_dir=$4 mode=${5:-clean}
  local temporary stdout_file stderr_file before_manifest rc parsed expected_policy_digest
  PREFLIGHT_CANONICAL_HEAD=
  PREFLIGHT_RECOVERY_REQUIRED=0
  temporary=$(mktemp -d /tmp/terminal-build-preflight.XXXXXX) || return $?
  stdout_file="$temporary/stdout.json"
  stderr_file="$temporary/stderr.log"
  before_manifest="$temporary/before.json"

  if ! expected_policy_digest=$(python3 -I - "$policy" <<'PY_POLICY_DIGEST'
import hashlib
import json
import sys
from pathlib import Path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


payload = Path(sys.argv[1]).read_bytes()
policy = json.loads(payload.decode("utf-8"), object_pairs_hook=unique_object)
if not isinstance(policy, dict):
    raise SystemExit("release-preflight policy root must be an object")
print(
    hashlib.sha256(
        json.dumps(policy, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
)
PY_POLICY_DIGEST
  ); then
    rm -rf "$temporary"
    return 64
  fi
  if [ -n "$PREFLIGHT_POLICY_DIGEST" ] \
    && [ "$PREFLIGHT_POLICY_DIGEST" != "$expected_policy_digest" ]; then
    log "FATAL: selected preflight policy digest changed before execution"
    rm -rf "$temporary"
    return 64
  fi
  PREFLIGHT_POLICY_DIGEST=$expected_policy_digest

  if ! python3 -I - "$receipt_dir" "$before_manifest" <<'PY_RECEIPT_BEFORE'
import json
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
metadata = os.lstat(root)
if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
    raise SystemExit("release-preflight receipt root is not a real directory")
names = sorted(entry.name for entry in root.iterdir())
Path(sys.argv[2]).write_text(
    json.dumps(names, ensure_ascii=True, separators=(",", ":")),
    encoding="utf-8",
)
PY_RECEIPT_BEFORE
  then
    rm -rf "$temporary"
    return 64
  fi

  if (
    umask 027
    # `-E` makes this interpreter ignore PYTHON* entirely: -B is the live control
    # for bytecode WRITES here, and the variable only covers a future child that
    # does not pass -E. Never drop -B on the strength of the variable.
    # -X pycache_prefix governs bytecode READS; it survives -E because it is a
    # command-line option, and it is why the selector may tolerate residue at all.
    PYTHONDONTWRITEBYTECODE=1 python3 -B -E -s \
      -X pycache_prefix="$temporary/pycache" "$script" \
      --canonical-repo "$canonical_repo" \
      --policy "$policy" \
      --receipt-dir "$receipt_dir"
  ) >"$stdout_file" 2>"$stderr_file"; then
    rc=0
  else
    rc=$?
  fi

  if [ -s "$stderr_file" ]; then
    cat "$stderr_file" >&2
  fi
  if [ "$rc" -ne 0 ]; then
    if { [ "$mode" != "canonical-head-mismatch" ] && [ "$mode" != "auto" ]; } \
      || [ "$rc" -ne 2 ] || [ ! -s "$stdout_file" ]; then
      if [ -s "$stdout_file" ]; then cat "$stdout_file" >&2; fi
      rm -rf "$temporary"
      return "$rc"
    fi
  fi

  if ! parsed=$(python3 -I - "$stdout_file" "$receipt_dir" "$before_manifest" \
    "$expected_policy_digest" "$mode" "$rc" <<'PY_RECEIPT'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

MAX_SUMMARY_BYTES = 64 * 1024
MAX_RECEIPT_BYTES = 2 * 1024 * 1024


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json_bytes(payload: bytes, label: str):
    try:
        return json.loads(payload.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(f"invalid {label} JSON: {exc}") from exc


def deterministic_id(payload: dict) -> str:
    canonical = {
        key: value
        for key, value in payload.items()
        if key not in {"generated_at", "receipt_id"}
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def stable_regular_bytes(path: Path, limit: int) -> tuple[bytes, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise SystemExit(f"receipt is not a regular file: {path}")
        if before.st_size > limit:
            raise SystemExit(f"receipt exceeds size bound: {path}")
        chunks = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > limit:
            raise SystemExit(f"receipt exceeds size bound: {path}")
        after = os.fstat(descriptor)
        identity = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_uid,
            item.st_gid,
            item.st_size,
            item.st_mtime_ns,
        )
        if identity(before) != identity(after):
            raise SystemExit(f"receipt changed while read: {path}")
        return payload, after
    finally:
        os.close(descriptor)


summary_path = Path(sys.argv[1])
receipt_root = Path(sys.argv[2]).resolve(strict=True)
before_names = set(load_json_bytes(Path(sys.argv[3]).read_bytes(), "before-manifest"))
expected_policy_digest = sys.argv[4]
mode = sys.argv[5]
try:
    cli_rc = int(sys.argv[6])
except ValueError:
    raise SystemExit("release-preflight CLI status is invalid")
if mode not in {"clean", "canonical-head-mismatch", "auto"}:
    raise SystemExit("invalid release-preflight validation mode")
summary_bytes = summary_path.read_bytes()
if len(summary_bytes) > MAX_SUMMARY_BYTES:
    raise SystemExit("release-preflight summary exceeds size bound")
summary = load_json_bytes(summary_bytes, "release-preflight summary")
if not isinstance(summary, dict):
    raise SystemExit("release-preflight summary root must be an object")
if summary.get("schema") != "mastermind.terminal.release_preflight_receipt.v1":
    raise SystemExit("release-preflight summary schema is invalid")
required = (
    "result",
    "accepted_sha",
    "receipt_path",
    "receipt_id",
    "source_audit_receipt_id",
)
for key in required:
    value = summary.get(key)
    if not isinstance(value, str) or not value or any(char in value for char in "\r\n\t"):
        raise SystemExit(f"invalid release-preflight summary field: {key}")
if mode == "clean":
    expected_result = "CLEAN"
elif mode == "canonical-head-mismatch":
    expected_result = "UNKNOWN_STOP"
else:
    if summary["result"] not in {"CLEAN", "UNKNOWN_STOP"}:
        raise SystemExit(f"release-preflight summary result is invalid for auto mode: {summary['result']!r}")
    expected_result = summary["result"]
expected_status = expected_result
expected_cli_rc = 0 if expected_result == "CLEAN" else 2
if cli_rc != expected_cli_rc:
    raise SystemExit(
        f"release-preflight CLI status {cli_rc} disagrees with result {expected_result!r}"
    )
if summary["result"] != expected_result:
    raise SystemExit(
        f"release-preflight summary result {summary['result']!r} does not match mode {mode!r}"
    )
if re.fullmatch(r"[0-9a-f]{40}", summary["accepted_sha"]) is None:
    raise SystemExit("release-preflight accepted SHA is not one full lower-case commit")

receipt = Path(summary["receipt_path"])
if not receipt.is_absolute():
    raise SystemExit("release-preflight receipt path must be absolute")
resolved_receipt = receipt.resolve(strict=True)
if resolved_receipt.parent != receipt_root or receipt != resolved_receipt:
    raise SystemExit("release-preflight receipt escaped or aliased its reviewed directory")
after_names = {entry.name for entry in receipt_root.iterdir()}
new_names = after_names - before_names
if new_names != {receipt.name}:
    raise SystemExit("release-preflight did not publish exactly one newly named receipt")

receipt_bytes, receipt_stat = stable_regular_bytes(receipt, MAX_RECEIPT_BYTES)
if stat.S_IMODE(receipt_stat.st_mode) != 0o640:
    raise SystemExit("release-preflight receipt mode is not 0640")
if receipt_stat.st_uid != os.geteuid() or receipt_stat.st_gid != os.getegid():
    raise SystemExit("release-preflight receipt owner/group differs from executor")
outer = load_json_bytes(receipt_bytes, "release-preflight receipt")
if not isinstance(outer, dict):
    raise SystemExit("release-preflight receipt root must be an object")
if outer.get("schema") != "mastermind.terminal.release_preflight_receipt.v1":
    raise SystemExit("release-preflight receipt schema is invalid")
if outer.get("result") != expected_result:
    raise SystemExit("release-preflight receipt result disagrees with validation mode")
if outer.get("accepted_sha") != summary["accepted_sha"]:
    raise SystemExit("release-preflight receipt accepted SHA disagrees with summary")
if outer.get("policy_digest") != expected_policy_digest:
    raise SystemExit("release-preflight receipt policy digest disagrees with executed policy")
if outer.get("receipt_id") != summary["receipt_id"]:
    raise SystemExit("release-preflight receipt ID disagrees with summary")
if outer.get("receipt_id") != deterministic_id(outer):
    raise SystemExit("release-preflight receipt ID is not deterministic")

inner = outer.get("source_audit")
if not isinstance(inner, dict):
    raise SystemExit("release-preflight receipt lacks source-audit evidence")
if inner.get("schema") != "mastermind.terminal.source_audit_receipt.v1":
    raise SystemExit("source-audit receipt schema is invalid")
if inner.get("status") != expected_status:
    raise SystemExit("source-audit receipt status disagrees with validation mode")
if inner.get("accepted_sha") != summary["accepted_sha"]:
    raise SystemExit("source-audit accepted SHA disagrees with summary")
if inner.get("policy_digest") != expected_policy_digest:
    raise SystemExit("source-audit policy digest disagrees with executed policy")
if inner.get("receipt_id") != summary["source_audit_receipt_id"]:
    raise SystemExit("source-audit receipt ID disagrees with summary")
if inner.get("receipt_id") != deterministic_id(inner):
    raise SystemExit("source-audit receipt ID is not deterministic")
if outer.get("source_audit_receipt_id") != inner.get("receipt_id"):
    raise SystemExit("outer receipt does not bind the nested source-audit receipt")
findings = inner.get("findings")
inner_summary = inner.get("summary")
canonical_head = inner.get("canonical_repo_head", "")

if expected_result == "CLEAN":
    if findings != []:
        raise SystemExit("CLEAN source-audit receipt contains findings")
    if not isinstance(inner_summary, dict) or inner_summary.get("blocking_findings") != 0:
        raise SystemExit("CLEAN source-audit receipt has blocking findings")
else:
    if not isinstance(canonical_head, str) or re.fullmatch(r"[0-9a-f]{40}", canonical_head) is None:
        raise SystemExit("recovery source-audit canonical HEAD is invalid")
    if not isinstance(findings, list) or len(findings) != 1:
        raise SystemExit("recovery requires exactly one source-audit finding")
    finding = findings[0]
    if not isinstance(finding, dict) or finding.get("code") != "CANONICAL_HEAD_MISMATCH":
        raise SystemExit("recovery finding is not CANONICAL_HEAD_MISMATCH")
    if finding.get("canonical_repo_head") != canonical_head:
        raise SystemExit("recovery finding canonical HEAD disagrees with receipt")
    if canonical_head == summary["accepted_sha"]:
        raise SystemExit("recovery canonical HEAD already equals accepted generation")
    if not isinstance(inner_summary, dict) or inner_summary.get("blocking_findings") != 1:
        raise SystemExit("recovery receipt does not contain exactly one blocker")
    deployment = inner.get("deployment")
    if not isinstance(deployment, dict):
        raise SystemExit("recovery receipt lacks deployment evidence")
    if deployment.get("marker_state") != "VALID":
        raise SystemExit("recovery deployment marker is not VALID")
    if deployment.get("sha") != summary["accepted_sha"]:
        raise SystemExit("recovery deployment marker disagrees with accepted generation")
    accepted_ref = inner.get("accepted_ref")
    if not isinstance(accepted_ref, dict) or accepted_ref.get("contains_sha") is not True:
        raise SystemExit("recovery accepted ref does not contain the live generation")

print(
    "\t".join(
        (
            summary["accepted_sha"],
            str(receipt),
            outer["receipt_id"],
            inner["receipt_id"],
            expected_policy_digest,
            canonical_head if canonical_head else "-",
            "1" if expected_result == "UNKNOWN_STOP" else "0",
        )
    )
)
PY_RECEIPT
  ); then
    rm -rf "$temporary"
    return 64
  fi

  IFS=$'\t' read -r PREFLIGHT_ACCEPTED_SHA PREFLIGHT_RECEIPT_PATH \
    PREFLIGHT_RECEIPT_ID PREFLIGHT_SOURCE_RECEIPT_ID PREFLIGHT_POLICY_DIGEST \
    PREFLIGHT_CANONICAL_HEAD PREFLIGHT_RECOVERY_REQUIRED <<< "$parsed"
  rm -rf "$temporary"
  if [ "$PREFLIGHT_RECOVERY_REQUIRED" = 1 ]; then
    log "source preflight recovery evidence: accepted=$PREFLIGHT_ACCEPTED_SHA canonical_head=$PREFLIGHT_CANONICAL_HEAD receipt=$PREFLIGHT_RECEIPT_PATH"
  else
    log "source preflight CLEAN: accepted=$PREFLIGHT_ACCEPTED_SHA receipt=$PREFLIGHT_RECEIPT_PATH policy_digest=$PREFLIGHT_POLICY_DIGEST"
  fi
}

# Read the live deployment marker without following symlinks or trusting a
# changing inode. This is used only after a W2A receipt has established the
# marker as the deployment identity for the accepted generation.
# The marker read is always DEPLOYMENT_MARKER, which select_release_target derives
# from the selected APP root: a beta run reads the beta marker and can never be
# satisfied by the production marker, and a production run can never be satisfied
# by a beta marker. There is no cross-profile fallback anywhere in this owner.
read_live_deployment_marker(){
  python3 -I - "$1" <<'PY_LIVE_MARKER'
import os
import re
import stat
import sys

path = sys.argv[1]
flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(path, flags)
try:
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_size > 128:
        raise SystemExit(65)
    payload = os.read(fd, 129)
    after = os.fstat(fd)
    identity = lambda item: (
        item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
        item.st_size, item.st_mtime_ns,
    )
    if identity(before) != identity(after):
        raise SystemExit(65)
finally:
    os.close(fd)
try:
    value = payload.decode("ascii").strip()
except UnicodeDecodeError:
    raise SystemExit(65)
if re.fullmatch(r"[0-9a-f]{40}", value) is None:
    raise SystemExit(65)
print(value)
PY_LIVE_MARKER
}

# Recover only the one state produced by a failed post-admission/pre-swap build:
# the live accepted generation is still coherent, while the canonical checkout
# was advanced to the admitted target. The immutable W2A receipt must prove that
# CANONICAL_HEAD_MISMATCH is the sole blocker before this owner moves HEAD.
recover_canonical_head_mismatch(){
  local canonical_repo=$1 deployment_marker=$2
  local current_head live_marker dirty restored_head

  if [ "$PREFLIGHT_RECOVERY_REQUIRED" != 1 ] \
    || [ -z "$PREFLIGHT_ACCEPTED_SHA" ] \
    || [ -z "$PREFLIGHT_CANONICAL_HEAD" ] \
    || [ -z "$PREFLIGHT_RECEIPT_PATH" ]; then
    log "FATAL: canonical recovery was not admitted by the current preflight receipt"
    return 65
  fi
  current_head=$(git -C "$canonical_repo" rev-parse HEAD 2>/dev/null) || {
    log "FATAL: cannot read canonical checkout HEAD during recovery"
    return 65
  }
  if [ "$current_head" != "$PREFLIGHT_CANONICAL_HEAD" ]; then
    log "FATAL: canonical checkout HEAD changed after recovery receipt publication"
    return 65
  fi
  dirty=$(git -C "$canonical_repo" status --porcelain=v1 --untracked-files=all) || return $?
  if [ -n "$dirty" ]; then
    log "FATAL: canonical checkout became dirty after recovery receipt publication"
    return 65
  fi

  if ! live_marker=$(read_live_deployment_marker "$deployment_marker"); then
    log "FATAL: live deployment marker became unreadable during canonical recovery"
    return 65
  fi
  if [ "$live_marker" != "$PREFLIGHT_ACCEPTED_SHA" ]; then
    log "FATAL: live deployment marker changed after recovery receipt publication"
    return 65
  fi

  log "canonical recovery admitted by receipt $PREFLIGHT_RECEIPT_PATH: head=$current_head live=$PREFLIGHT_ACCEPTED_SHA"
  sanitize_git_environment
  git -C "$canonical_repo" reset -q --hard "$PREFLIGHT_ACCEPTED_SHA" || return $?
  git -C "$canonical_repo" clean -qfd || return $?
  restored_head=$(git -C "$canonical_repo" rev-parse HEAD 2>/dev/null) || return $?
  dirty=$(git -C "$canonical_repo" status --porcelain=v1 --untracked-files=all) || return $?
  if [ "$restored_head" != "$PREFLIGHT_ACCEPTED_SHA" ] || [ -n "$dirty" ]; then
    log "FATAL: canonical recovery did not converge to the live accepted generation"
    return 65
  fi
  log "canonical checkout restored to live accepted generation $PREFLIGHT_ACCEPTED_SHA"
}

refuse_git_replace_refs(){
  local repository=$1 replacement_refs
  replacement_refs=$(git -C "$repository" for-each-ref --format='%(refname)' refs/replace/) \
    || return $?
  if [ -n "$replacement_refs" ]; then
    log "FATAL: canonical checkout contains forbidden refs/replace entries"
    return 65
  fi
}

# Observe the accepted branch with an explicit destination refspec. Local
# remote.origin.fetch configuration cannot leave the authority ref stale.
fetch_accepted_ref(){
  local repository=$1 remote=$2 branch=$3 accepted_ref=$4 observed
  sanitize_git_environment
  refuse_git_replace_refs "$repository" || return $?
  ACCEPTED_REF_BEFORE=$(git -C "$repository" rev-parse --verify \
    "${accepted_ref}^{commit}" 2>/dev/null || printf '<absent>')
  git -C "$repository" fetch -q --no-tags "$remote" \
    "+refs/heads/$branch:$accepted_ref" || return $?
  refuse_git_replace_refs "$repository" || return $?
  observed=$(git -C "$repository" rev-parse --verify \
    "${accepted_ref}^{commit}" 2>/dev/null) || {
      log "FATAL: accepted ref is unavailable after explicit fetch: $accepted_ref"
      return 65
    }
  if ! [[ "$observed" =~ ^[0-9a-f]{40}$ ]]; then
    log "FATAL: accepted ref did not resolve to one full lower-case commit"
    return 65
  fi
  ACCEPTED_REF_SHA=$observed
  log "accepted ref observed: before=$ACCEPTED_REF_BEFORE after=$ACCEPTED_REF_SHA"
}

# Admission is separate from fetching: callers first update the accepted ref,
# then this function proves that the exact requested commit is available and
# contained by that immutable local observation of the protected branch.
# Containment is the reason the beta profile needs no second authority: a beta
# target is only ever a commit already on protected origin/master, observed in the
# beta-owned checkout. A commit from any other ref, branch or fork is refused here,
# before the beta checkout is reset and before anything is built.
admit_target_sha(){
  local repository=$1 target_sha=$2 accepted_sha=$3 resolved accepted_resolved
  sanitize_git_environment
  refuse_git_replace_refs "$repository" || return $?
  validate_target_sha "$target_sha" || return $?
  if ! [[ "$accepted_sha" =~ ^[0-9a-f]{40}$ ]]; then
    log "FATAL: captured accepted-ref observation is not one full lower-case commit"
    return 65
  fi
  if ! resolved=$(git -C "$repository" rev-parse --verify "${target_sha}^{commit}" 2>/dev/null); then
    log "FATAL: requested target commit is unavailable after accepted-ref fetch: $target_sha"
    return 65
  fi
  if [ "$resolved" != "$target_sha" ]; then
    log "FATAL: requested target did not resolve to the exact full commit: $target_sha"
    return 65
  fi
  if ! accepted_resolved=$(git -C "$repository" rev-parse --verify "${accepted_sha}^{commit}" 2>/dev/null); then
    log "FATAL: captured accepted-ref commit is unavailable after fetch: $accepted_sha"
    return 65
  fi
  if [ "$accepted_resolved" != "$accepted_sha" ]; then
    log "FATAL: captured accepted-ref observation did not resolve exactly: $accepted_sha"
    return 65
  fi
  if ! git -C "$repository" merge-base --is-ancestor "$target_sha" "$accepted_sha"; then
    log "FATAL: requested target is not contained by captured accepted-ref observation: target=$target_sha accepted=$accepted_sha"
    return 65
  fi
}

# ── deploy generation: the identity and the build it names move together ───────
# .deployment-id and the .next it describes are ONE generation. Installing the
# marker before the swap and then rolling back only .next leaves the box serving
# the OLD build while .gitsrc HEAD and .deployment-id both read the NEW commit —
# so a verifier trusting source-HEAD + marker certifies a deploy that was rolled
# back, and only .next/BUILD_ID still witnesses what is actually live. Every
# marker mutation below is therefore paired with a same-filesystem rollback
# record, and rollback restores identity and build together or reports neither:
#   .deployment-id.bak      exact prior marker (cp -p keeps bytes AND metadata)
#   .deployment-id.absent   sentinel — there was no prior marker, so rollback deletes
#   .deployment-id.new      staged marker, never left behind
# tests/test_terminal_build_rollback.py sources this file to drive the state machine
# against a temp dir; sourcing stops at the guard below and deploys nothing. Every
# generation function takes the app root as an argument, so the beta profile's
# generation state lives and dies entirely under the beta app root.

# Set by deploy_generation_rollback: 1 once the live .next has been moved, so the
# caller knows a restart is mandatory even when the identity is unresolved.
DEPLOY_ROLLBACK_MOVED_BUILD=0

# Purge rollback records left by an interrupted earlier attempt. Deliberately
# never touches .deployment-id itself: a stale .absent would delete a valid live
# marker, and a stale .bak would later restore a long-dead SHA.
deploy_generation_reset(){
  rm -f "$1/.deployment-id.bak" "$1/.deployment-id.absent" "$1/.deployment-id.new"
}

# Snapshot the current identity, then install the staged one ($2).
deploy_generation_begin(){
  local app=$1 staged=$2
  deploy_generation_reset "$app"
  if [ -f "$app/.deployment-id" ]; then
    cp -p "$app/.deployment-id" "$app/.deployment-id.bak"
  else
    : > "$app/.deployment-id.absent"
  fi
  install -m 0644 "$staged" "$app/.deployment-id.new"
  mv -f "$app/.deployment-id.new" "$app/.deployment-id"
}

# Reached only once health AND the three-identity gate agree.
deploy_generation_commit(){
  deploy_generation_reset "$1"
}

# Restore the previous generation whole. $2 is 1 when the .next swap already
# happened, which is what makes "there is no .next.bak" a FAILURE rather than a
# no-op: after the swap, nothing to restore means the build that just failed its
# health check is still the live one. Non-zero means the generation could not be
# fully restored, so the caller must report it unresolved instead of claiming a
# clean rollback. Sets DEPLOY_ROLLBACK_MOVED_BUILD when the live .next moved.
#
# $swapped gates the WHOLE .next branch, not just the "no .next.bak" fallback
# (#504 review M1). Before this guard the function branched on `[ -d .next.bak ]`
# alone: a pre-swap abort (swapped=0) with a leftover STALE .next.bak — e.g. a
# prior deploy's `rm -rf .next.bak` failed to clear it — moved the still-good
# live `.next` to `.next.broken` and restored the two-generations-old
# `.next.bak` over it, destroying a healthy build on a path that must be a
# no-op. When swapped=0, `.next` was never touched by this attempt and stays
# exactly as it is, regardless of what `.next.bak` happens to contain.
deploy_generation_rollback(){
  local app=$1 swapped=$2 rc=0
  DEPLOY_ROLLBACK_MOVED_BUILD=0
  if [ "$swapped" = 1 ]; then
    if [ -d "$app/.next.bak" ]; then
      rm -rf "$app/.next.broken"
      if [ -d "$app/.next" ]; then
        mv "$app/.next" "$app/.next.broken" || rc=1
      fi
      mv "$app/.next.bak" "$app/.next" || rc=1
      DEPLOY_ROLLBACK_MOVED_BUILD=1
    else
      rc=1   # swapped with no previous build to return to — the failing build is live
    fi
  fi
  if [ -f "$app/.deployment-id.bak" ]; then
    mv -f "$app/.deployment-id.bak" "$app/.deployment-id" || rc=1
  elif [ -f "$app/.deployment-id.absent" ]; then
    rm -f "$app/.deployment-id" || rc=1
  else
    rc=1   # no rollback record — the marker cannot be proven correct
  fi
  rm -f "$app/.deployment-id.absent" "$app/.deployment-id.new"
  return $rc
}

# Fail-closed over all three identities.
#
# READ THIS BEFORE TRUSTING THE BUILD_ID LEG. Next 16.2.9 returns the constant
# literal 'build-TfctsWXpff2fKS' from getBuildId() whenever config.deploymentId is
# set, and terminal/next.config.ts always sets it to the deployed SHA. So
# .next/BUILD_ID is the SAME string before and after every deploy and every
# rollback: here it proves the live .next is present and complete, and it does NOT
# discriminate an old build from a new one.
#
# What makes this gate discriminating is the MARKER, and only because rollback now
# restores it (deploy_generation_rollback). After a rolled-back deploy the marker
# reads the previous SHA, so live_marker != want_sha and this returns non-zero —
# which is exactly the certification failure the old script could not produce.
# Keep all three compared anyway: the BUILD_ID leg is cheap, it catches a truncated
# or missing .next, and it stays correct if deploymentId is ever removed.
deploy_identity_verified(){
  local app=$1 want_sha=$2 want_build=$3 live_marker live_build
  [ -f "$app/.deployment-id" ] || return 1
  [ -f "$app/.next/BUILD_ID" ] || return 1
  live_marker=$(cat "$app/.deployment-id")
  live_build=$(cat "$app/.next/BUILD_ID")
  [ "$live_marker" = "$want_sha" ] || return 1
  [ "$live_build" = "$want_build" ]
}

# The ONE way out of a failed deploy generation. Every failure after the marker was
# installed must come through here.
#
# Rolling back only from the health check was not enough: `set -euo pipefail` aborts
# the script on any bare failing command, so a failed swap `mv` or a failed
# `systemctl restart` terminated the deploy with the marker already advanced and
# .next possibly displaced, and rollback never ran at all. The swap case was the
# worst of them — the old .next has already been moved to .next.bak by then, so the
# box was left advertising the new commit with NO live build. Always returns
# non-zero; the caller exits on it.
#
# The restart names the SELECTED profile's unit and nothing else. A beta rollback
# that restarted the production unit would be the one bug this file must never be
# able to cause: the beta profile's rollback is the beta service's business alone.
deploy_generation_abort(){
  local app=$1 want_sha=$2 swapped=$3 reason=$4 rc=0
  log "DEPLOY FAILED: $reason"
  log "rolling back the deploy generation (build + identity)"
  deploy_generation_rollback "$app" "$swapped" || rc=$?
  # Restart whenever the live .next moved, INCLUDING when the identity is
  # unresolved. `next start` resolves .next/* at request time, so a server left
  # bound to a renamed tree serves the restored build's chunks against the failed
  # build's in-memory manifests. "Identity unresolved" is a reporting state; it is
  # never a reason to leave the process pointed at a directory that moved.
  if [ "$DEPLOY_ROLLBACK_MOVED_BUILD" = 1 ]; then
    if [ "$SERVICE_NAME" = terminal ]; then
      # Incumbent anchor: the production unit is named literally here, and only
      # when the resolved profile IS production. A beta rollback below can only
      # ever name its own unit; beta never restarts terminal on any path.
      systemctl restart terminal || { log "restart after rollback FAILED"; rc=1; }
    else
      systemctl restart "$SERVICE_NAME" || { log "restart after rollback FAILED"; rc=1; }
    fi
  fi
  if [ "$rc" = 0 ]; then
    log "rolled back — $(deploy_identity_line "$app" "$want_sha")"
  else
    log "ROLLBACK INCOMPLETE — deployment identity UNRESOLVED"
    log "  $(deploy_identity_line "$app" "$want_sha")"
    log "  this box is NOT serving any provable commit — reconcile by hand before trusting it"
    log "  the failed build, if it was swapped in, is kept at $app/.next.broken"
  fi
  return 1
}

# ── beta lifecycle state: the ONE writer/reader ──────────────────────────────
# Everything that separates "this beta target has been given its SOURCE" from
# "this beta target has a verified RUNNING generation" lives in exactly one place,
# driven by the shell below. Two immutable record kinds in a root-owned state tree,
# addressed by two pointers inside the beta target root (which is itself NOT an
# audited live root, so lifecycle plumbing can never look like unknown source
# drift):
#
#   .source-provisioned -> source-provisioned-<sha>-<id>.json
#       authorized provisioning of the mapped beta source roots at one exact commit
#       under one exact policy digest. Fields: accepted_sha, policy_digest,
#       policy_path, canonical_repo, target_root, app_root, deployment_marker,
#       provisioned[{repo_path,live_path,git_tree}]. It states plainly that it is
#       NOT runtime acceptance and NOT a rollback baseline.
#   .runtime-accepted   -> runtime-accepted-<sha>-<id>.json
#       published ONLY after the real status endpoint, the three-identity gate and a
#       post-activation source audit agreed, binding the same SHA/digest plus the
#       release receipt ids and the build id.
#
# Enforcement, not convention:
#  * bootstrap is admitted only with no runtime pointer and either a provably empty
#    target root or a pointer whose record matches THIS run's SHA, policy digest,
#    canonical repo, app root and the beta policy's own mapping inventory;
#  * an ordinary beta deploy refuses while a provisioning pointer has no matching
#    runtime pointer, because deploy_generation_begin would otherwise snapshot the
#    provisioned SOURCE marker as the rollback baseline;
#  * demotion removes the runtime POINTER only when it resolves inside the state
#    tree, and nothing else — an unknown path is never cleaned up.
beta_statectl(){
  python3 -I - "$@" <<'PY_STATECTL' || return $?
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys

PROVISION_SCHEMA = "mastermind.terminal.beta_source_provisioned.v1"
RUNTIME_SCHEMA = "mastermind.terminal.beta_runtime_accepted.v1"
DEMOTE_SCHEMA = "mastermind.terminal.beta_generation_demoted.v1"
POLICY_SCHEMA = "mastermind.terminal.source_audit_policy.v1"
PROVISION_POINTER = ".source-provisioned"
RUNTIME_POINTER = ".runtime-accepted"
SHA_RE = re.compile(r"\A[0-9a-f]{40}\Z")
HEX_RE = re.compile(r"\A[0-9a-f]{64}\Z")
TOKEN_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
MAX_JSON_BYTES = 1024 * 1024


def fail(message):
    raise SystemExit(message)


def norm(path):
    return os.path.normpath(str(path))


def inside(child, root):
    child, root = norm(child), norm(root)
    return child == root or child.startswith(root + os.sep)


def full_sha(value, label):
    if not SHA_RE.match(value):
        fail(f"{label} is not one full lower-case commit SHA")
    return value


def hex64(value, label):
    if not HEX_RE.match(value):
        fail(f"{label} is not one lower-case sha256 digest")
    return value


def canonical(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def record_id(payload):
    body = {k: v for k, v in payload.items() if k not in {"generated_at", "record_id"}}
    return hashlib.sha256(canonical(body)).hexdigest()


def lstat(path):
    try:
        return os.lstat(path)
    except OSError as exc:
        fail(f"cannot inspect {path}: {exc.strerror or exc}")


def require_dir(path, label):
    meta = lstat(path)
    if stat.S_ISLNK(meta.st_mode):
        fail(f"{label} is a symlink alias, which is never followed: {path}")
    if not stat.S_ISDIR(meta.st_mode):
        fail(f"{label} is not a real directory: {path}")
    if meta.st_uid != os.geteuid():
        fail(f"{label} is not owned by the deployment principal (uid {meta.st_uid}): {path}")
    if stat.S_IMODE(meta.st_mode) & 0o022:
        fail(f"{label} is group or other writable: {path}")
    return meta


def require_regular(path, label):
    meta = lstat(path)
    if stat.S_ISLNK(meta.st_mode) or not stat.S_ISREG(meta.st_mode):
        fail(f"{label} must be a real regular file, never a link or special file: {path}")
    if meta.st_uid != os.geteuid():
        fail(f"{label} is not owned by the deployment principal (uid {meta.st_uid}): {path}")
    if stat.S_IMODE(meta.st_mode) & 0o022:
        fail(f"{label} is group or other writable: {path}")
    if not 0 < meta.st_size <= MAX_JSON_BYTES:
        fail(f"{label} size is out of bounds: {path}")
    return meta


def read_bytes(path, label):
    meta = require_regular(path, label)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
    try:
        chunks = []
        remaining = meta.st_size + 1
        while remaining:
            chunk = os.read(descriptor, min(remaining, 65536))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(payload) != meta.st_size or os.lstat(path).st_ino != meta.st_ino:
        fail(f"{label} changed while it was read: {path}")
    return payload


def read_json_object(path, label):
    try:
        payload = json.loads(read_bytes(path, label).decode("utf-8"))
    except UnicodeDecodeError as exc:
        fail(f"{label} is not UTF-8 JSON: {exc}")
    except json.JSONDecodeError as exc:
        fail(f"{label} is not JSON: {exc}")
    if not isinstance(payload, dict):
        fail(f"{label} root must be an object: {path}")
    return payload


def read_record(path):
    record = read_json_object(path, "beta lifecycle record")
    if record.get("record_id") != record_id(record):
        fail(f"beta lifecycle record identity does not match its content: {path}")
    return record


def safe_relative(value, label):
    if not isinstance(value, str) or not value:
        fail(f"{label} must be a non-empty string")
    if value.startswith("/") or value.endswith("/"):
        fail(f"{label} must be a normalized relative path: {value}")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        fail(f"{label} must not contain '.' or '..' segments: {value}")
    return value


def policy_inventory(policy_path, target_root, app_root, production_app):
    payload = read_json_object(policy_path, "beta audit policy")
    if payload.get("schema") != POLICY_SCHEMA:
        fail("beta audit policy schema is not the reviewed source-audit policy schema")
    mappings = payload.get("mappings")
    if not isinstance(mappings, list) or not mappings:
        fail("beta audit policy declares no mappings")
    marker = payload.get("deployment_id_file")
    if not isinstance(marker, str) or norm(os.path.dirname(marker)) != norm(app_root):
        fail("beta audit policy deployment marker must live directly in the beta app root")
    target_root, app_root = norm(target_root), norm(app_root)
    rows, seen = [], set()
    for item in mappings:
        if not isinstance(item, dict):
            fail("beta audit policy mapping must be an object")
        repo_path = safe_relative(item.get("repo_path"), "beta audit policy repo_path")
        live_value = item.get("live_path")
        if not isinstance(live_value, str) or not os.path.isabs(live_value):
            fail(f"beta audit policy live_path must be absolute: {live_value!r}")
        live_path = norm(live_value)
        if not inside(live_path, target_root):
            fail(f"beta audit policy maps source outside the beta target root: {live_path}")
        if inside(live_path, production_app) or inside(production_app, live_path):
            fail(f"beta audit policy overlaps the production app tree: {live_path}")
        if repo_path.split("/")[-1] != os.path.basename(live_path):
            fail(f"beta audit policy live path must mirror its repo path basename: {repo_path} -> {live_path}")
        if live_path in seen:
            fail(f"beta audit policy maps the same live path twice: {live_path}")
        seen.add(live_path)
        rows.append((repo_path, live_path))
    if app_root not in seen:
        fail("beta audit policy does not map the beta app root it is supposed to audit")
    return rows


def pointer_destination(target_root, name):
    link = os.path.join(target_root, name)
    meta = lstat(link)
    if not stat.S_ISLNK(meta.st_mode):
        fail(f"beta lifecycle pointer {name} must be a symlink this owner created: {link}")
    destination = os.readlink(link)
    if not os.path.isabs(destination):
        destination = norm(os.path.join(target_root, destination))
    return destination, link


def create_pointer(target_root, name, destination):
    link = os.path.join(target_root, name)
    try:
        os.symlink(destination, link)
    except FileExistsError:
        existing, _ = pointer_destination(target_root, name)
        if existing != norm(destination):
            fail(f"beta lifecycle pointer {name} already addresses a different record: {existing}")
        fsync_directory(target_root)
        return link
    fsync_directory(target_root)
    return link


def publish(state_dir, filename, payload):
    # A complete immutable record is installed atomically. Orphans from an
    # interrupted pointer publication may be reused only by semantic identity.
    payload = dict(payload)
    payload["record_id"] = record_id(payload)
    raw = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    path = os.path.join(state_dir, filename)
    if os.path.lexists(path):
        existing = read_record(path)
        if record_id(existing) != payload["record_id"]:
            fail(f"an immutable beta lifecycle record with this name carries different content: {path}")
        return path
    temporary = os.path.join(state_dir, f".record-{os.getpid()}-{__import__('uuid').uuid4().hex}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                         | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0), 0o640)
    try:
        written = 0
        while written < len(raw):
            count = os.write(descriptor, raw[written:])
            if count <= 0:
                fail("short write while publishing beta lifecycle record")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if record_id(read_record(path)) != payload["record_id"]:
                fail(f"an immutable beta record appeared with different content: {path}")
        fsync_directory(state_dir)
    finally:
        os.unlink(temporary)
    return path

def provision_filename(sha, identifier):
    return f"source-provisioned-{sha}-{identifier}.json"


def runtime_filename(sha, identifier):
    return f"runtime-accepted-{sha}-{identifier}.json"


def read_trees(path):
    rows = []
    for line in read_bytes(path, "beta provisioning inventory").decode("utf-8").splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) != 3 or not all(parts):
            fail(f"beta provisioning inventory row is malformed: {line!r}")
        tree = parts[2]
        if re.fullmatch(r"\A[0-9a-f]{40}\Z", tree) is None:
            fail(f"beta provisioning inventory names no full Git tree id: {line!r}")
        rows.append({"repo_path": parts[0], "live_path": norm(parts[1]), "git_tree": tree})
    if not rows:
        fail("beta provisioning inventory is empty")
    return rows


def verified_provision_record(*, target_root, state_dir, sha, policy_digest, canonical_repo,
                              policy_path, app_root, production_app,
                              require_record_exists=True):
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta source-provisioned state directory")
    destination, link = pointer_destination(target_root, PROVISION_POINTER)
    if not inside(destination, state_dir):
        fail("the beta source-provisioned pointer addresses a path outside the state tree")
    record = read_record(destination)
    if record.get("schema") != PROVISION_SCHEMA:
        fail("the beta pointer does not address a source-provisioned record")
    if record.get("target") != "beta":
        fail("the beta source-provisioned record is not a beta record")
    if full_sha(record.get("accepted_sha", ""), "record accepted_sha") != sha:
        fail("the source-provisioned record authorizes a different commit; it is never reused")
    if hex64(record.get("policy_digest", ""), "record policy_digest") != policy_digest:
        fail("the source-provisioned record authorizes a different policy digest")
    if norm(record.get("canonical_repo", "")) != norm(canonical_repo):
        fail("the source-provisioned record names a different canonical checkout")
    if norm(record.get("target_root", "")) != norm(target_root):
        fail("the source-provisioned record names a different target root")
    if norm(record.get("app_root", "")) != norm(app_root):
        fail("the source-provisioned record names a different app root")
    if record.get("deployment_marker") != os.path.join(norm(app_root), ".deployment-id"):
        fail("the source-provisioned record names a different deployment marker path")
    if record.get("policy_path") != norm(policy_path):
        fail("the source-provisioned record binds a different policy path")
    if record.get("provision_authorized") is not True:
        fail("the source-provisioned record does not authorize provisioning")
    if record.get("accepted_runtime") is not False or record.get("rollback_baseline") is not False:
        fail("a source-provisioned record must claim neither runtime acceptance nor a rollback baseline")
    provisioned = record.get("provisioned")
    if not isinstance(provisioned, list) or not provisioned:
        fail("the source-provisioned record carries no provisioned paths")
    rows = []
    for item in provisioned:
        if not isinstance(item, dict):
            fail("the source-provisioned record carries a malformed provisioned path")
        rows.append({"repo_path": safe_relative(item.get("repo_path"), "record repo_path"),
                     "live_path": norm(item.get("live_path", "")),
                     "git_tree": item.get("git_tree")})
    expected = list(policy_inventory(policy_path, target_root, app_root, production_app))
    recorded = [(row["repo_path"], row["live_path"]) for row in rows]
    if sorted(expected) != sorted(recorded):
        fail("the source-provisioned record does not match the beta policy mapping inventory")
    if require_record_exists:
        require_regular(destination, "beta source-provisioned record")
    return destination, rows


def action_inventory(args):
    policy_path, target_root, app_root, production_app = args
    for repo_path, live_path in policy_inventory(policy_path, target_root, app_root, production_app):
        print(f"{repo_path}\t{live_path}")
    return 0


def action_members(args):
    # The member list arrives as a FILE: this interpreter's stdin is the heredoc
    # that carries this code, so a piped member list can never be read here.
    target_root, trees_file, member_file = args
    rows = read_trees(trees_file)
    allowed = {os.path.basename(row["live_path"]) for row in rows}
    roots = {norm(os.path.join(target_root, name)) for name in allowed}
    count = 0
    for line in read_bytes(member_file, "archive member list").decode("utf-8").splitlines():
        member = line.rstrip("/")
        if not member:
            continue
        if member.startswith("/") or ".." in member.split("/"):
            fail(f"archive member escapes the beta target: {line!r}")
        head = member.split("/")[0]
        if head not in allowed:
            fail(f"archive member is not inside a mapped beta source root: {line!r}")
        if not inside(norm(os.path.join(target_root, member)), target_root):
            fail(f"archive member resolves outside the beta target root: {line!r}")
        count += 1
    if count == 0 or len(roots) != len(allowed):
        fail("the provisioning archive carries no members for the mapped beta source roots")
    print(count)
    return 0


def action_admit(args):
    target_root, state_dir, app_root, sha, policy_digest, repo, policy_path, production_app = args
    full_sha(sha, "requested target SHA")
    hex64(policy_digest, "selected policy digest")
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta source-provisioned state directory")
    names = sorted(entry.name for entry in os.scandir(target_root))
    if ATTEMPT_POINTER in names:
        fail("a pending beta attempt requires reconciliation before bootstrap")
    if RUNTIME_POINTER in names:
        fail("a beta target that already carries a runtime-accepted generation is never bootstrapped over")
    if PROVISION_POINTER not in names:
        if names:
            fail("the beta target root is not provably empty and is never wiped to bootstrap: "
                 + ", ".join(names[:12]))
        print("EMPTY")
        return 0
    destination, rows = verified_provision_record(
        target_root=target_root, state_dir=state_dir, sha=sha, policy_digest=policy_digest,
        canonical_repo=repo, policy_path=policy_path, app_root=app_root,
        production_app=production_app)
    allowed = {PROVISION_POINTER} | {os.path.basename(row["live_path"]) for row in rows}
    unknown = [name for name in names if name not in allowed]
    if unknown:
        fail("the beta target root carries state this owner cannot account for and is never cleaned up "
             "by a bootstrap: " + ", ".join(unknown[:12]))
    print("RESUME\t{}".format(destination))
    return 0


def action_trees(args):
    (record_path,) = args
    record = read_record(record_path)
    if record.get("schema") != PROVISION_SCHEMA:
        fail("beta provisioning inventory names no source-provisioned record")
    rows = record.get("provisioned")
    if not isinstance(rows, list) or not rows:
        fail("the source-provisioned record carries no provisioned paths")
    for row in rows:
        if not isinstance(row, dict):
            fail("the source-provisioned record carries a malformed provisioned path")
        print(f"{row.get('repo_path')}\t{norm(row.get('live_path', ''))}\t{row.get('git_tree')}")
    return 0


def action_begin(args):
    (target_root, state_dir, app_root, sha, policy_digest, repo, policy_path, trees_file,
     production_app) = args
    full_sha(sha, "requested target SHA")
    hex64(policy_digest, "selected policy digest")
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta source-provisioned state directory")
    rows = read_trees(trees_file)
    expected = list(policy_inventory(policy_path, target_root, app_root, production_app))
    recorded = [(row["repo_path"], row["live_path"]) for row in rows]
    if sorted(expected) != sorted(recorded):
        fail("the provisioning inventory does not match the beta policy mapping inventory")
    if any(os.path.lexists(os.path.join(target_root, name)) for name in
           (PROVISION_POINTER, RUNTIME_POINTER)):
        fail("a beta lifecycle pointer already exists; provisioning is authorized once per record")
    payload = {
        "schema": PROVISION_SCHEMA,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        .isoformat().replace("+00:00", "Z"),
        "target": "beta",
        "accepted_sha": sha,
        "policy_digest": policy_digest,
        "policy_path": norm(policy_path),
        "canonical_repo": norm(repo),
        "target_root": norm(target_root),
        "app_root": norm(app_root),
        "deployment_marker": os.path.join(norm(app_root), ".deployment-id"),
        "provisioned": rows,
        "provision_authorized": True,
        "accepted_runtime": False,
        "rollback_baseline": False,
    }
    path = publish(state_dir, provision_filename(sha, record_id(payload)[:16]), payload)
    create_pointer(target_root, PROVISION_POINTER, path)
    print(path)
    return 0


def action_marker(args):
    target_root, state_dir, app_root, sha, record_path = args
    full_sha(sha, "requested target SHA")
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta source-provisioned state directory")
    record = read_record(record_path)
    if record.get("accepted_sha") != sha or norm(record.get("app_root", "")) != norm(app_root):
        fail("the provisioned source identity does not match this run's admitted target")
    require_dir(app_root, "beta app root")
    marker = os.path.join(norm(app_root), ".deployment-id")
    body = (sha + "\n").encode("utf-8")
    if os.path.lexists(marker):
        meta = lstat(marker)
        if stat.S_ISLNK(meta.st_mode) or not stat.S_ISREG(meta.st_mode):
            fail(f"the beta deployment marker must be a real regular file: {marker}")
        if read_bytes(marker, "beta deployment marker") == body:
            print("unchanged")
            return 0
        fail(f"refusing to overwrite an existing beta deployment marker with different bytes: {marker}")
    temporary = f"{marker}.provisioning.{os.getpid()}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o644)
    try:
        os.write(descriptor, body)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, marker)
    print("written")
    return 0


# Beta-only lifecycle additions, embedded in beta_statectl by assemble_transaction.py.
ATTEMPT_SCHEMA = "mastermind.terminal.beta_release_attempt.v1"
ATTEMPT_POINTER = ".release-pending"


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def replace_pointer(target_root, name, destination, expected):
    # The owner holds its one shared lock throughout this conditional update.
    # Never replace a pointer that was not the exact one admitted by this attempt.
    link = os.path.join(target_root, name)
    if expected:
        current, _ = pointer_destination(target_root, name)
        if norm(current) != norm(expected):
            fail(f"beta {name} changed underneath the admitted attempt")
    elif os.path.lexists(link):
        fail(f"beta {name} appeared underneath the admitted attempt")
    temporary = f"{link}.new.{os.getpid()}.{__import__('uuid').uuid4().hex}"
    os.symlink(destination, temporary)
    try:
        os.replace(temporary, link)
        fsync_directory(target_root)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def provision_anchor(target_root, state_dir, app_root, repo, production_app):
    destination, _ = pointer_destination(target_root, PROVISION_POINTER)
    if not inside(destination, state_dir):
        fail("the beta provisioning anchor is outside its state tree")
    record = read_record(destination)
    # Provisioning is installation provenance. Its original SHA is deliberately
    # retained, not rewritten to pretend that every later runtime was bootstrapped.
    verified_provision_record(
        target_root=target_root, state_dir=state_dir,
        sha=full_sha(record.get("accepted_sha", ""), "provisioning SHA"),
        policy_digest=hex64(record.get("policy_digest", ""), "provisioning policy"),
        canonical_repo=repo, policy_path=record.get("policy_path", ""),
        app_root=app_root, production_app=production_app)
    return destination, record


def validated_runtime(target_root, state_dir, app_root, repo, production_app, destination):
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta lifecycle state directory")
    if not inside(destination, state_dir):
        fail("the accepted runtime record is outside the beta state tree")
    record = read_record(destination)
    if (record.get("schema") != RUNTIME_SCHEMA or record.get("target") != "beta"
            or record.get("runtime_accepted") is not True
            or record.get("rollback_baseline") is not True):
        fail("the beta record is not an accepted rollback baseline")
    for key, value in (("target_root", target_root), ("app_root", app_root),
                       ("canonical_repo", repo)):
        if record.get(key) != norm(value):
            fail(f"the beta accepted record names another {key}")
    full_sha(record.get("accepted_sha", ""), "accepted runtime SHA")
    hex64(record.get("policy_digest", ""), "accepted runtime policy digest")
    build_id = record.get("build_id")
    if not isinstance(build_id, str) or TOKEN_RE.fullmatch(build_id) is None:
        fail("the accepted build ID is malformed")
    for key in ("release_receipt_path", "release_receipt_id", "source_audit_receipt_id"):
        value = record.get(key)
        if not isinstance(value, str) or not value or any(c in value for c in "\r\n\t"):
            fail(f"the accepted runtime has no valid {key}")
    anchor, provisioned = provision_anchor(target_root, state_dir, app_root, repo, production_app)
    if (record.get("source_provisioned_record") != norm(anchor)
            or record.get("source_provisioned_record_id") != record_id(provisioned)):
        fail("the accepted runtime is not bound to this installation's provenance")
    return record


def require_live_identity(app_root, sha, build_id):
    if read_bytes(os.path.join(app_root, ".deployment-id"), "beta deployment marker").decode("ascii").strip() != sha:
        fail("the live marker is not the admitted accepted generation")
    if read_bytes(os.path.join(app_root, ".next", "BUILD_ID"), "beta build ID").decode("ascii").strip() != build_id:
        fail("the live build is not the admitted accepted generation")


def read_attempt(target_root, state_dir, attempt_id):
    destination, _ = pointer_destination(target_root, ATTEMPT_POINTER)
    if not inside(destination, state_dir):
        fail("the pending beta attempt is outside its state tree")
    record = read_record(destination)
    if (record.get("schema") != ATTEMPT_SCHEMA or record.get("target") != "beta"
            or record.get("attempt_id") != attempt_id
            or record.get("target_root") != norm(target_root)):
        fail("the pending beta attempt is not owned by this invocation")
    return destination, record


def attempt_runtime_committed(target_root, state_dir, attempt):
    link = os.path.join(target_root, RUNTIME_POINTER)
    if not os.path.lexists(link):
        return False
    destination, _ = pointer_destination(target_root, RUNTIME_POINTER)
    if not inside(destination, state_dir):
        fail("the accepted pointer escaped beta state during the attempt")
    record = read_record(destination)
    if (record.get("schema") == RUNTIME_SCHEMA and record.get("runtime_accepted") is True
            and record.get("acceptance_attempt_id") == attempt["attempt_id"]
            and record.get("accepted_sha") == attempt["target_sha"]):
        require_live_identity(attempt["app_root"], record["accepted_sha"], record["build_id"])
        return True
    return False


def action_attempt_begin(args):
    (target_root, state_dir, app_root, repo, sha, policy_digest, production_app,
     mode, prior_path, prior_id) = args
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta lifecycle state directory")
    full_sha(sha, "new target SHA")
    hex64(policy_digest, "new target policy")
    if os.path.lexists(os.path.join(target_root, ATTEMPT_POINTER)):
        fail("a pending beta attempt requires reconciliation before another release")
    anchor, provisioned = provision_anchor(target_root, state_dir, app_root, repo, production_app)
    prior = None
    if mode == "bootstrap":
        if prior_path or prior_id or os.path.lexists(os.path.join(target_root, RUNTIME_POINTER)):
            fail("bootstrap cannot replace an accepted runtime")
        if provisioned["accepted_sha"] != sha or provisioned["policy_digest"] != policy_digest:
            fail("bootstrap must use its exact provisioned source and policy")
    elif mode == "upgrade":
        current, _ = pointer_destination(target_root, RUNTIME_POINTER)
        if norm(current) != norm(prior_path):
            fail("the accepted pointer changed after admission")
        prior = validated_runtime(target_root, state_dir, app_root, repo, production_app, current)
        if record_id(prior) != prior_id:
            fail("the accepted record changed after admission")
        require_live_identity(app_root, prior["accepted_sha"], prior["build_id"])
    else:
        fail("unknown beta transaction entrance")
    identifier = __import__("uuid").uuid4().hex
    payload = {
        "schema": ATTEMPT_SCHEMA, "target": "beta", "attempt_id": identifier,
        "target_root": norm(target_root), "app_root": norm(app_root),
        "canonical_repo": norm(repo), "target_sha": sha, "policy_digest": policy_digest,
        "mode": mode, "phase": "staging", "live_inputs_dirty": False,
        "build_id": None, "prior_runtime_record": norm(prior_path) if prior else None,
        "prior_runtime_record_id": prior_id if prior else None,
        "prior_sha": prior["accepted_sha"] if prior else None,
        "prior_build_id": prior["build_id"] if prior else None,
        "source_provisioned_record": norm(anchor),
        "source_provisioned_record_id": record_id(provisioned),
    }
    path = publish(state_dir, f"attempt-{identifier}-staging.json", payload)
    replace_pointer(target_root, ATTEMPT_POINTER, path, None)
    print(identifier)
    return 0



def recovery_candidate(args):
    (target_root, state_dir, app_root, repo, sha, policy_digest, production_app,
     identifier, expected_id) = args
    full_sha(sha, "recovery target SHA")
    hex64(expected_id, "expected failed attempt record")
    hex64(policy_digest, "recovery policy digest")
    old_path, attempt = read_attempt(target_root, state_dir, identifier)
    if record_id(attempt) != expected_id:
        fail("pending attempt is not the exact failed record selected for recovery")
    if (attempt.get("phase") != "failed" or attempt.get("mode") != "upgrade"
            or attempt.get("live_inputs_dirty") is not True
            or attempt.get("recovery_from_record_id") is not None):
        fail("only an original failed dirty upgrade may consume one recovery entrance")
    for key, value in (("app_root", norm(app_root)), ("canonical_repo", norm(repo)),
                       ("target_sha", sha), ("policy_digest", policy_digest)):
        if attempt.get(key) != value:
            fail(f"recovery cannot change the captured {key}")
    current, _ = pointer_destination(target_root, RUNTIME_POINTER)
    if norm(current) != attempt.get("prior_runtime_record"):
        fail("prior accepted pointer changed before recovery")
    prior = validated_runtime(target_root, state_dir, app_root, repo, production_app, current)
    if (record_id(prior) != attempt.get("prior_runtime_record_id")
            or prior.get("accepted_sha") != attempt.get("prior_sha")
            or prior.get("build_id") != attempt.get("prior_build_id")):
        fail("prior accepted runtime identity changed before recovery")
    if attempt_runtime_committed(target_root, state_dir, attempt):
        fail("an already committed attempt is never recovered again")
    if read_bytes(os.path.join(app_root, ".deployment-id"), "failed target marker").decode("ascii").strip() != sha:
        fail("recovery marker is not the captured failed target")
    if os.path.lexists(os.path.join(app_root, ".next")):
        fail("recovery requires the failed generation stopped and quarantined")
    if read_bytes(os.path.join(app_root, ".deployment-id.bak"), "retained prior marker").decode("ascii").strip() != attempt["prior_sha"]:
        fail("retained marker does not name the captured prior generation")
    retained = {}
    for name, expected_sha, expected_build in (
            (".next.bak", attempt["prior_sha"], attempt["prior_build_id"]),
            (".next.broken", sha, attempt.get("build_id"))):
        root = os.path.join(app_root, name)
        require_dir(root, "retained generation")
        build = read_bytes(os.path.join(root, "BUILD_ID"), "retained build ID").decode("ascii").strip()
        raw = read_bytes(os.path.join(root, "required-server-files.json"), "retained server manifest")
        try:
            manifest = json.loads(raw)
        except (ValueError, UnicodeError):
            fail("retained server manifest is invalid")
        if (build != expected_build or not isinstance(manifest, dict)
                or not isinstance(manifest.get("config"), dict)
                or manifest["config"].get("deploymentId") != expected_sha):
            fail("retained build evidence does not match the captured generation")
        retained[name] = {"build_id": build, "deployment_id": expected_sha,
                          "server_manifest_sha256": hashlib.sha256(raw).hexdigest()}
    return old_path, attempt, retained


def action_attempt_recovery_check(args):
    _, attempt, _ = recovery_candidate(args)
    print("RECOVERABLE\t" + attempt["attempt_id"])
    return 0


def action_attempt_recover(args):
    old_path, attempt, retained = recovery_candidate(args)
    original_id = record_id(attempt)
    attempt.pop("record_id", None)
    attempt.update({"phase": "recovering", "recovery_from_record": old_path,
                    "recovery_from_record_id": original_id,
                    "recovery_retained_builds": retained,
                    "recovery_build_id": None})
    path = publish(args[1], f"attempt-{attempt['attempt_id']}-recovering-{record_id(attempt)[:16]}.json", attempt)
    replace_pointer(args[0], ATTEMPT_POINTER, path, old_path)
    print("RECOVERY\t{}\t{}\t{}\t{}".format(
        attempt["prior_runtime_record"], attempt["prior_runtime_record_id"],
        attempt["prior_sha"], attempt["prior_build_id"]))
    return 0


def action_attempt_phase(args):
    target_root, state_dir, identifier, phase, build_id = args
    old_path, attempt = read_attempt(target_root, state_dir, identifier)
    allowed = {
        "recovering": {"activation", "inputs-dirty", "failed"},
        "staging": {"staging", "activation", "inputs-dirty", "failed"},
        "activation": {"activation", "inputs-dirty", "failed"},
        "inputs-dirty": {"inputs-dirty", "activation", "validated", "failed"},
        "validated": {"committing", "failed"},
        "committing": {"committing", "failed"},
        "failed": {"failed"},
    }
    if phase not in allowed.get(attempt.get("phase"), set()):
        fail("invalid beta release phase transition")
    attempt.pop("record_id", None)
    attempt["phase"] = phase
    if phase == "inputs-dirty":
        attempt["live_inputs_dirty"] = True
    if build_id:
        if TOKEN_RE.fullmatch(build_id) is None:
            fail("the staged beta build ID is malformed")
        key = "recovery_build_id" if attempt.get("recovery_from_record_id") else "build_id"
        if attempt.get(key) and attempt[key] != build_id:
            fail("the beta attempt cannot change its staged build identity")
        attempt[key] = build_id
    path = publish(state_dir, f"attempt-{identifier}-{phase}-{record_id(attempt)[:16]}.json", attempt)
    replace_pointer(target_root, ATTEMPT_POINTER, path, old_path)
    print(path)
    return 0


def action_attempt_state(args):
    target_root, state_dir, identifier = args
    _, attempt = read_attempt(target_root, state_dir, identifier)
    if attempt_runtime_committed(target_root, state_dir, attempt):
        print("COMMITTED")
    else:
        print("PENDING")
    return 0


def action_attempt_finish(args):
    target_root, state_dir, identifier, outcome = args
    _, attempt = read_attempt(target_root, state_dir, identifier)
    committed = attempt_runtime_committed(target_root, state_dir, attempt)
    if outcome == "committed":
        if not committed:
            fail("cannot finish a beta attempt without its committed runtime pointer")
    elif outcome == "restored":
        if committed or attempt.get("mode") != "upgrade" or attempt.get("live_inputs_dirty"):
            fail("this beta attempt cannot claim restoration of an accepted baseline")
        current, _ = pointer_destination(target_root, RUNTIME_POINTER)
        if norm(current) != attempt["prior_runtime_record"]:
            fail("the prior accepted pointer moved during rollback")
        if record_id(read_record(current)) != attempt["prior_runtime_record_id"]:
            fail("the prior accepted record changed during rollback")
        require_live_identity(attempt["app_root"], attempt["prior_sha"], attempt["prior_build_id"])
    elif outcome == "source-only":
        if committed or attempt.get("mode") != "bootstrap":
            fail("only an uncommitted bootstrap can return to source-only state")
        if os.path.lexists(os.path.join(target_root, RUNTIME_POINTER)):
            fail("a bootstrap cannot clear another accepted runtime")
    else:
        fail("unknown beta attempt completion")
    os.unlink(os.path.join(target_root, ATTEMPT_POINTER))
    fsync_directory(target_root)
    print(outcome)
    return 0


def action_ordinary_gate(args):
    target_root, state_dir, app_root, repo, production_app = args
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta lifecycle state directory")
    if os.path.lexists(os.path.join(target_root, ATTEMPT_POINTER)):
        fail("a pending beta release must be reconciled before ordinary admission")
    if not os.path.lexists(os.path.join(target_root, RUNTIME_POINTER)):
        if os.path.lexists(os.path.join(target_root, PROVISION_POINTER)):
            print("NEED_BOOTSTRAP")
            return 0
        fail("ordinary beta admission requires a recorded accepted runtime")
    destination, _ = pointer_destination(target_root, RUNTIME_POINTER)
    record = validated_runtime(target_root, state_dir, app_root, repo, production_app, destination)
    require_live_identity(app_root, record["accepted_sha"], record["build_id"])
    print("BASELINE\t{}\t{}\t{}\t{}".format(
        destination, record_id(record), record["accepted_sha"], record["build_id"]))
    return 0


def action_runtime(args):
    (target_root, state_dir, app_root, repo, sha, policy_digest, policy_path,
     production_app, previous_record, receipt_path, receipt_id,
     source_receipt_id, build_id, attempt_id) = args
    full_sha(sha, "requested target SHA")
    hex64(policy_digest, "selected policy digest")
    _, attempt = read_attempt(target_root, state_dir, attempt_id)
    if (attempt.get("phase") != "committing" or attempt.get("target_sha") != sha
            or (attempt.get("recovery_build_id") if attempt.get("recovery_from_record_id") else attempt.get("build_id")) != build_id or attempt.get("policy_digest") != policy_digest
            or attempt.get("app_root") != norm(app_root) or attempt.get("canonical_repo") != norm(repo)):
        fail("runtime publication is not the validated pending beta transaction")
    destination, provenance = provision_anchor(target_root, state_dir, app_root, repo, production_app)
    expected_previous = attempt.get("prior_runtime_record")
    if (norm(previous_record) if previous_record else None) != expected_previous:
        fail("the caller's previous accepted record is not the captured baseline")
    if expected_previous:
        current, _ = pointer_destination(target_root, RUNTIME_POINTER)
        if norm(current) != expected_previous:
            fail("the beta accepted pointer moved underneath this release")
        previous = validated_runtime(target_root, state_dir, app_root, repo, production_app, current)
        if record_id(previous) != attempt.get("prior_runtime_record_id"):
            fail("the beta accepted record changed underneath this release")
    elif os.path.lexists(os.path.join(target_root, RUNTIME_POINTER)):
        fail("bootstrap cannot overwrite a newly appeared accepted runtime")
    require_live_identity(app_root, sha, build_id)
    for label, value in (("release receipt path", receipt_path),
                         ("release receipt id", receipt_id),
                         ("source audit receipt id", source_receipt_id)):
        if not isinstance(value, str) or not value or any(ch in value for ch in "\r\n\t"):
            fail(f"the beta runtime acceptance needs a well-formed {label}")
    payload = {
        "schema": RUNTIME_SCHEMA,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        .isoformat().replace("+00:00", "Z"),
        "target": "beta", "accepted_sha": sha, "policy_digest": policy_digest,
        "policy_path": norm(policy_path), "canonical_repo": norm(repo),
        "target_root": norm(target_root), "app_root": norm(app_root),
        "source_provisioned_record": norm(destination),
        "source_provisioned_record_id": record_id(provenance),
        "release_receipt_path": receipt_path, "release_receipt_id": receipt_id,
        "source_audit_receipt_id": source_receipt_id, "build_id": build_id,
        "acceptance_attempt_id": attempt_id,
        "previous_runtime_record": expected_previous,
        "previous_runtime_record_id": attempt.get("prior_runtime_record_id"),
        "runtime_accepted": True, "rollback_baseline": True,
    }
    if attempt.get("recovery_from_record_id"):
        payload.update({key: attempt[key] for key in (
            "recovery_from_record", "recovery_from_record_id", "recovery_retained_builds")})
    path = publish(state_dir, runtime_filename(sha, record_id(payload)[:16]), payload)
    replace_pointer(target_root, RUNTIME_POINTER, path, expected_previous)
    print(path)
    return 0

def action_demote(args):
    target_root, state_dir, sha = args
    require_dir(target_root, "beta target root")
    require_dir(state_dir, "beta source-provisioned state directory")
    names = {entry.name for entry in os.scandir(target_root)}
    if RUNTIME_POINTER not in names:
        print("no runtime-accepted claim to remove")
        return 0
    destination, link = pointer_destination(target_root, RUNTIME_POINTER)
    if not inside(destination, state_dir):
        fail("refusing to demote a runtime pointer that addresses a path outside the state tree")
    payload = {
        "schema": DEMOTE_SCHEMA,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        .isoformat().replace("+00:00", "Z"),
        "target": "beta",
        "demoted_sha": full_sha(sha, "demotion SHA") if SHA_RE.match(sha or "") else None,
        "previous_record": norm(destination),
        "previous_record_id": read_record(destination).get("record_id"),
        "reason": "the beta generation failed its acceptance; beta is stopped, its evidence is retained, and the source-provisioned record is not a runtime claim",
    }
    path = publish(state_dir,
                   f"generation-demoted-{os.getpid()}-{record_id(payload)[:16]}.json", payload)
    os.unlink(link)
    print(f"runtime-accepted claim removed; demotion evidence {path}")
    return 0


ACTIONS = {
    "inventory": action_inventory,
    "members": action_members,
    "admit": action_admit,
    "trees": action_trees,
    "begin": action_begin,
    "marker": action_marker,
    "ordinary-gate": action_ordinary_gate,
    "runtime": action_runtime,
    "demote": action_demote,
    "attempt-recovery-check": action_attempt_recovery_check,
    "attempt-recover": action_attempt_recover,
    "attempt-begin": action_attempt_begin,
    "attempt-phase": action_attempt_phase,
    "attempt-state": action_attempt_state,
    "attempt-finish": action_attempt_finish,
}


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] not in ACTIONS:
        fail("beta state control needs one of: " + ", ".join(sorted(ACTIONS)))
    return ACTIONS[argv[0]](argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())

PY_STATECTL
}


# The bootstrap entrance: admit an untouched beta target, or resume exactly the
# verified source-provisioned state an interrupted attempt left behind. Nothing
# here deletes, moves or "normalises" anything it cannot account for.
beta_bootstrap_admit(){
  local target_sha=$1 outcome
  [ "$TARGET" = beta ] || { log "FATAL: --bootstrap is a beta-only entrance"; return 64; }
  BOOTSTRAP_MODE=
  BOOTSTRAP_STATE_RECORD=
  if ! outcome=$(beta_statectl admit "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
      "$APP" "$target_sha" "$PREFLIGHT_POLICY_DIGEST" "$SRC" "$PREFLIGHT_POLICY" \
      "$PRODUCTION_APP_DEFAULT" 2>&1); then
    log "FATAL: the beta bootstrap entrance was refused:"
    printf '%s\n' "$outcome" | while IFS= read -r line; do log "  $line"; done
    return 75
  fi
  case "$outcome" in
    EMPTY)
      BOOTSTRAP_MODE=fresh
      log "beta bootstrap admitted: the beta target root is provably empty and never accepted"
      ;;
    RESUME*)
      IFS=$'\t' read -r _ BOOTSTRAP_STATE_RECORD <<<"$outcome"
      BOOTSTRAP_MODE=resume
      log "beta bootstrap admitted: resuming verified source-provisioned state $BOOTSTRAP_STATE_RECORD"
      ;;
    *)
      log "FATAL: the beta bootstrap entrance returned an unrecognized decision: $outcome"
      return 75
      ;;
  esac
  return 0
}

# Bootstrap scratch belongs beside the shared hold on the admitted build volume.
# Keep it outside both source trees. Only this attempt's exact private directory
# and the two files this function creates are eligible for cleanup.
beta_bootstrap_archive_state(){
  local action=$1
  [ "$TARGET" = beta ] && [ "$DEPLOY_LOCK_HELD" = 1 ] || {
    log "FATAL: beta archive custody requires this owner's shared build hold"; return 73;
  }
  python3 -I - "$action" "$SHARED_BUILD_LOCK_DIR" "$BETA_BOOTSTRAP_SCRATCH" \
    "$BETA_BOOTSTRAP_SCRATCH_IDENTITY" <<'PY_BOOTSTRAP_ARCHIVE'
import os
import re
import stat
import sys

action, parent, path, expected = sys.argv[1:]
name = os.path.basename(path)
if os.path.dirname(path) != parent or not re.fullmatch(r"beta-bootstrap\.[A-Za-z0-9]{6}", name):
    raise SystemExit("beta archive cleanup path is outside its recorded owner parent")
if action not in {"capture", "remove"}:
    raise SystemExit("unknown beta archive custody action")
parent_fd = scratch_fd = None

def owned_directory(info, private=False):
    return (stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and not stat.S_IMODE(info.st_mode) & 0o022
            and (not private or stat.S_IMODE(info.st_mode) == 0o700))

def identity(info):
    return info.st_dev, info.st_ino

def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns)

try:
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    parent_info = os.fstat(parent_fd)
    if not owned_directory(parent_info):
        raise SystemExit("beta archive parent custody is not exclusive")
    scratch_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                         dir_fd=parent_fd)
    info = os.fstat(scratch_fd)
    if not owned_directory(info, private=True):
        raise SystemExit("beta archive directory is not private owner custody")
    signature = ":".join(str(v) for v in (*identity(parent_info), *identity(info)))
    if action == "capture":
        print(signature)
    else:
        if not expected or signature != expected:
            raise SystemExit("beta archive directory custody changed; preserved for recovery")
        entries = os.listdir(scratch_fd)
        if set(entries) - {"source.tar", "members.txt"}:
            raise SystemExit("beta archive directory contains unfamiliar entries; preserved for recovery")
        captured = {}
        for entry in entries:
            item = os.stat(entry, dir_fd=scratch_fd, follow_symlinks=False)
            if not stat.S_ISREG(item.st_mode) or item.st_uid != os.geteuid() or item.st_nlink != 1:
                raise SystemExit("beta archive file custody changed; preserved for recovery")
            captured[entry] = file_identity(item)
        for entry in entries:
            if file_identity(os.stat(entry, dir_fd=scratch_fd, follow_symlinks=False)) != captured[entry]:
                raise SystemExit("beta archive file changed before cleanup; preserved for recovery")
            os.unlink(entry, dir_fd=scratch_fd)
        bound = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if identity(bound) != identity(info) or not owned_directory(bound, private=True):
            raise SystemExit("beta archive directory binding changed; replacement preserved")
        os.rmdir(name, dir_fd=parent_fd)
except OSError as exc:
    raise SystemExit(f"beta archive custody or cleanup refused: {exc}")
finally:
    if scratch_fd is not None:
        os.close(scratch_fd)
    if parent_fd is not None:
        os.close(parent_fd)
PY_BOOTSTRAP_ARCHIVE
}

beta_bootstrap_archive_cleanup(){
  [ -n "$BETA_BOOTSTRAP_SCRATCH" ] || return 0
  if ! beta_bootstrap_archive_state remove; then
    log "FATAL: beta archive cleanup refused; exact path retained for recovery: $BETA_BOOTSTRAP_SCRATCH"
    return 73
  fi
  BETA_BOOTSTRAP_SCRATCH=
  BETA_BOOTSTRAP_SCRATCH_IDENTITY=
}

# Source provisioning, archive-first: the mapped beta source roots are read from
# the digest-selected beta policy itself (there is no second path list to drift),
# each root's tree is pinned against the admitted commit, the archive is written to
# a file and its member paths proven to stay inside the beta target root BEFORE
# anything is extracted, and only then does the target mutate. The published record
# authorizes SOURCE identity; it claims neither runtime acceptance nor a rollback
# baseline, and the marker it writes is therefore only ever the provisioned source
# identity until the acceptance record says otherwise.
beta_bootstrap_provision(){
  local repository=$1 target_sha=$2
  local scratch inventory_file trees_file observed repo live tree
  local -a provision_paths=()
  [ "$TARGET" = beta ] || { log "FATAL: source provisioning is beta-profile-only"; return 64; }
  beta_target_scoped_path "beta target root" "$BETA_TARGET_ROOT" || return $?
  [ "$DEPLOY_LOCK_HELD" = 1 ] || { log "FATAL: beta provisioning requires the shared build hold"; return 73; }
  verify_owned_directory "beta archive parent" "$SHARED_BUILD_LOCK_DIR" || return 73
  inventory_file=$(mktemp /tmp/terminal-build-inventory.XXXXXX) || return $?
  trees_file=$(mktemp /tmp/terminal-build-trees.XXXXXX) || { rm -f "$inventory_file"; return 73; }
  if ! observed=$(beta_statectl inventory "$PREFLIGHT_POLICY" "$BETA_TARGET_ROOT" "$APP" \
      "$PRODUCTION_APP_DEFAULT" 2>&1); then
    log "FATAL: the beta audit policy does not describe a provisionable beta target:"
    printf '%s\n' "$observed" | while IFS= read -r line; do log "  $line"; done
    rm -f "$inventory_file" "$trees_file"; return 65
  fi
  printf '%s\n' "$observed" >"$inventory_file"
  while IFS=$'\t' read -r repo live; do
    [ -n "$repo" ] || continue
    if ! observed=$(git -C "$repository" rev-parse "$target_sha:$repo" 2>/dev/null); then
      log "FATAL: the admitted commit does not carry the mapped beta source path: $repo"
      rm -f "$inventory_file" "$trees_file"; return 65
    fi
    printf '%s\t%s\t%s\n' "$repo" "$live" "$observed" >>"$trees_file"
  done <"$inventory_file"
  if [ ! -s "$trees_file" ]; then
    log "FATAL: the beta policy maps no source paths"; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  if [ "$BOOTSTRAP_MODE" = resume ]; then
    if ! cmp -s <(sort "$trees_file") \
      <(beta_statectl trees "$BOOTSTRAP_STATE_RECORD" 2>/dev/null | sort); then
      log "FATAL: the recorded source-provisioned state does not match the admitted commit or the beta policy mappings"
      rm -f "$inventory_file" "$trees_file"; return 75
    fi
    log "beta bootstrap resume verified: recorded SHA, digest, paths and trees all match"
  else
    if ! observed=$(beta_statectl begin "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
        "$APP" "$target_sha" "$PREFLIGHT_POLICY_DIGEST" "$SRC" "$PREFLIGHT_POLICY" \
        "$trees_file" "$PRODUCTION_APP_DEFAULT" 2>&1); then
      log "FATAL: could not publish the source-provisioned authorization:"
      printf '%s\n' "$observed" | while IFS= read -r line; do log "  $line"; done
      rm -f "$inventory_file" "$trees_file"; return 65
    fi
    BOOTSTRAP_STATE_RECORD=$observed
    log "beta source-provisioned authorization published: $BOOTSTRAP_STATE_RECORD"
  fi
  mapfile -t provision_paths < <(cut -f1 "$trees_file")
  if ! BETA_BOOTSTRAP_SCRATCH=$(mktemp -d "$SHARED_BUILD_LOCK_DIR/beta-bootstrap.XXXXXX"); then
    log "FATAL: could not allocate the private beta archive on the admitted build volume"
    rm -f "$inventory_file" "$trees_file"; return 73
  fi
  scratch=$BETA_BOOTSTRAP_SCRATCH
  if ! BETA_BOOTSTRAP_SCRATCH_IDENTITY=$(beta_bootstrap_archive_state capture); then
    log "FATAL: could not capture beta archive custody; path and hold retained for recovery: $scratch"
    rm -f "$inventory_file" "$trees_file"; return 73
  fi
  # Root tar preserves archive permissions. Pin the beta source archive to
  # owner-only custody instead of inheriting Git's group-writable tar default.
  if ! git -C "$repository" -c tar.umask=0077 archive --format=tar "$target_sha" -- "${provision_paths[@]}" \
    >"$scratch/source.tar"; then
    log "FATAL: the protected commit produced no source archive for beta provisioning"
    beta_bootstrap_archive_cleanup || true; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  if [ ! -s "$scratch/source.tar" ]; then
    log "FATAL: refusing to provision beta from an empty source archive"
    beta_bootstrap_archive_cleanup || true; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  if ! tar -tf "$scratch/source.tar" >"$scratch/members.txt"; then
    log "FATAL: the provisioning archive could not be listed for containment verification"
    beta_bootstrap_archive_cleanup || true; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  if ! observed=$(beta_statectl members "$BETA_TARGET_ROOT" "$trees_file" "$scratch/members.txt" 2>&1); then
    log "FATAL: refused to extract a provisioning archive that is not confined to the beta target:"
    printf '%s\n' "$observed" | while IFS= read -r line; do log "  $line"; done
    beta_bootstrap_archive_cleanup || true; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  log "beta provisioning archive verified: $observed members, every one inside $BETA_TARGET_ROOT"
  if ! tar -xf "$scratch/source.tar" -C "$BETA_TARGET_ROOT"; then
    log "FATAL: source provisioning extraction failed; the authorization record stands and nothing else is guessed at"
    beta_bootstrap_archive_cleanup || true; rm -f "$inventory_file" "$trees_file"; return 65
  fi
  if ! beta_bootstrap_archive_cleanup; then
    rm -f "$inventory_file" "$trees_file"; return 73
  fi
  if ! observed=$(beta_statectl marker "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
      "$APP" "$target_sha" "$BOOTSTRAP_STATE_RECORD" 2>&1); then
    log "FATAL: the provisioned source identity could not be recorded: $observed"
    rm -f "$inventory_file" "$trees_file"; return 65
  fi
  rm -f "$inventory_file" "$trees_file"
  log "provisioned SOURCE identity recorded ($observed); it is never a runtime or rollback claim"
  return 0
}

# An ordinary beta deploy may only proceed against a generation that has actually
# been runtime-accepted. Otherwise the first thing it does — snapshot the live
# marker as the rollback baseline — would promote provisioned SOURCE to a rollback
# baseline, which is exactly what this lifecycle forbids.
beta_ordinary_deploy_gate(){
  local decision label
  [ "$TARGET" = beta ] || return 0
  if ! decision=$(beta_statectl ordinary-gate "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
      "$APP" "$SRC" "$PRODUCTION_APP_DEFAULT" 2>&1); then
    log "FATAL: beta accepted-baseline admission refused: $decision"
    return 75
  fi
  if [ "$decision" = NEED_BOOTSTRAP ]; then
    log "FATAL: beta is source-provisioned only; complete the exact bootstrap instead of adopting a rollback baseline"
    return 75
  fi
  IFS=$'\t' read -r label BETA_PRIOR_RECORD BETA_PRIOR_RECORD_ID BETA_PRIOR_SHA BETA_PRIOR_BUILD <<<"$decision"
  if [ "$label" != BASELINE ] || [ -z "$BETA_PRIOR_RECORD_ID" ]; then
    log "FATAL: beta admission did not identify an accepted baseline"
    return 75
  fi
  # The immutable record and on-disk pair must also name the running process.
  shared_shell_status_verified "$BETA_STATUS_URL" "$BETA_PRIOR_SHA" "$SRC" || return $?
  RUNTIME_RECORD_PATH=$BETA_PRIOR_RECORD
  log "beta accepted baseline verified: sha=$BETA_PRIOR_SHA record=$BETA_PRIOR_RECORD_ID"
}

# The only transition to runtime-accepted. It is called after the real status
# endpoint agreed, after the three-identity gate passed, and (for a bootstrap)
# after a fresh CLEAN source audit of the activated generation; it records the
# receipt evidence that proves all three.
beta_publish_runtime_accepted(){
  local want_sha=$1 build_id=$2 outcome
  [ "$TARGET" = beta ] || return 0
  if ! outcome=$(beta_statectl runtime "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
      "$APP" "$SRC" "$want_sha" "$PREFLIGHT_POLICY_DIGEST" "$PREFLIGHT_POLICY" \
      "$PRODUCTION_APP_DEFAULT" "${RUNTIME_RECORD_PATH:-}" "${PREFLIGHT_RECEIPT_PATH:-}" \
      "${PREFLIGHT_RECEIPT_ID:-}" "${PREFLIGHT_SOURCE_RECEIPT_ID:-}" "$build_id" "$BETA_TXN_ID" 2>&1); then
    log "FATAL: the beta runtime acceptance record could not be published: $outcome"
    return 73
  fi
  RUNTIME_RECORD_PATH=$outcome
  log "beta generation runtime-accepted: $RUNTIME_RECORD_PATH"
  return 0
}

beta_bootstrap_demote(){
  local outcome
  [ "$TARGET" = beta ] || return 0
  if ! outcome=$(beta_statectl demote "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
      "${TARGET_SHA:-}" 2>&1); then
    log "FATAL: beta demotion refused: $outcome"
    return 75
  fi
  RUNTIME_RECORD_PATH=
  DEMOTE_ON_FAILURE=0
  log "beta lifecycle: $outcome"
  return 0
}

# npm may create hardlinks between package-local executables (for example
# esbuild and its platform package). Before the beta publisher can enforce its
# nlink==1 rule, give only fully accounted dependency groups private inodes.
# The check pass has no file effects; the caller records inputs-dirty before
# apply. Both passes run under the existing release lock and pending attempt.
beta_prepare_dependency_inodes(){
  local app=$1 mode=${2:-apply} outcome
  [ "$TARGET" = beta ] || { log "FATAL: dependency inode preparation is beta-profile-only"; return 64; }
  case "$mode" in check|apply) ;; *) return 64 ;; esac
  beta_target_scoped_path "beta dependency app root" "$app" || return $?
  if ! outcome=$(python3 -I - "$app" "$BETA_TARGET_ROOT" "$mode" 2>&1 <<'PY_DEPENDENCIES'
import hashlib
import os
import stat
import sys
import uuid

app, target_root, mode = map(os.path.normpath, sys.argv[1:])
owner = os.geteuid()
directories = {}
groups = {}
prepared = []


def fail(message):
    raise SystemExit(message)


def directory(path):
    info = os.lstat(path)
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != owner or stat.S_IMODE(info.st_mode) & 0o022):
        fail(f"dependency directory custody is not exclusive: {path}")
    identity = (info.st_dev, info.st_ino, info.st_uid, info.st_gid,
                stat.S_IMODE(info.st_mode))
    if path in directories and directories[path] != identity:
        fail(f"dependency directory changed during preparation: {path}")
    directories[path] = identity
    return info


def signature(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid,
            stat.S_IMODE(info.st_mode), info.st_size, info.st_mtime_ns)


def verify_file(path, expected, links):
    info = os.lstat(path)
    if (not stat.S_ISREG(info.st_mode) or signature(info) != signature(expected)
            or info.st_nlink != links):
        fail(f"dependency inode or membership changed during preparation: {path}")
    return info


def digest_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    while chunk := os.read(fd, 1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def verify_staged(item):
    expected = item["expected"]
    fd = os.open(item["temporary"], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=item["fd"])
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or (before.st_dev, before.st_ino)
                != (item["identity"].st_dev, item["identity"].st_ino)
                or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode),
                    before.st_size, before.st_mtime_ns)
                != (expected.st_uid, expected.st_gid, stat.S_IMODE(expected.st_mode),
                    expected.st_size, expected.st_mtime_ns)):
            fail("private dependency staging custody changed")
        if digest_fd(fd) != item["digest"]:
            fail("private dependency staging bytes changed")
        after = os.fstat(fd)
        named = os.stat(item["temporary"], dir_fd=item["fd"], follow_symlinks=False)
        if (signature(before) != signature(after) or signature(after) != signature(named)
                or after.st_nlink != 1 or named.st_nlink != 1):
            fail("private dependency staging changed during verification")
    finally:
        os.close(fd)


if app == target_root or not app.startswith(target_root + os.sep):
    fail("dependency app root must be strictly inside the beta target")
current = app
while True:
    directory(current)
    if current == target_root:
        break
    current = os.path.dirname(current)
root = os.path.join(app, "node_modules")
directory(root)
stack = [root]
while stack:
    parent = stack.pop()
    directory(parent)
    with os.scandir(parent) as entries:
        children = sorted(entries, key=lambda entry: entry.name)
    for entry in children:
        path = os.path.join(parent, entry.name)
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode):
            continue  # npm bin links are never followed or changed
        if stat.S_ISDIR(info.st_mode):
            directory(path)
            stack.append(path)
        elif stat.S_ISREG(info.st_mode):
            if entry.name == ".env" or entry.name.startswith(".env."):
                continue  # a secret alias cannot count toward an eligible group
            if (info.st_uid != owner or stat.S_IMODE(info.st_mode) & 0o6022):
                fail(f"dependency file custody is not exclusive: {path}")
            if info.st_nlink > 1:
                groups.setdefault((info.st_dev, info.st_ino), []).append((path, info))
        else:
            fail(f"special dependency file will not be prepared: {path}")

# Inventory every group before staging any replacement. Links outside this
# eligible dependency tree (including cache/evidence/secret aliases) do not count.
for members in groups.values():
    expected = members[0][1]
    if expected.st_nlink != len(members):
        fail(f"unaccounted dependency hardlink (nlink={expected.st_nlink}, "
             f"eligible={len(members)}): {members[0][0]}")
    for path, info in members:
        verify_file(path, expected, len(members))
if mode == "check":
    print(len(groups))
    raise SystemExit(0)

try:
    for members in groups.values():
        expected = members[0][1]
        paths = sorted(path for path, _ in members)
        source_fd = os.open(paths[0], os.O_RDONLY | os.O_NOFOLLOW)
        try:
            if signature(os.fstat(source_fd)) != signature(expected):
                fail("dependency source changed before staging private inodes")
            digest = digest_fd(source_fd)
            # N-1 replacements suffice: the last original name becomes private.
            for path in paths[:-1]:
                parent, name = os.path.split(path)
                directory(parent)
                parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                temporary = ".mmx-dependency-" + uuid.uuid4().hex
                temp_fd = None
                try:
                    if ((os.fstat(parent_fd).st_dev, os.fstat(parent_fd).st_ino)
                            != directories[parent][:2]):
                        fail("dependency parent changed before staging")
                    temp_fd = os.open(temporary,
                                      os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                      0o600, dir_fd=parent_fd)
                    staged = {"parent": parent, "fd": parent_fd, "name": name,
                              "temporary": temporary, "path": path, "expected": expected,
                              "digest": digest, "identity": os.fstat(temp_fd), "committed": False}
                    prepared.append(staged)
                    os.lseek(source_fd, 0, os.SEEK_SET)
                    copied = hashlib.sha256()
                    while chunk := os.read(source_fd, 1024 * 1024):
                        copied.update(chunk)
                        view = memoryview(chunk)
                        while view:
                            written = os.write(temp_fd, view)
                            if written <= 0:
                                fail("could not write a complete private dependency")
                            view = view[written:]
                    if copied.hexdigest() != digest:
                        fail("dependency bytes changed while staging private inodes")
                    if (os.fstat(temp_fd).st_uid, os.fstat(temp_fd).st_gid) != (expected.st_uid, expected.st_gid):
                        os.fchown(temp_fd, expected.st_uid, expected.st_gid)
                    os.fchmod(temp_fd, stat.S_IMODE(expected.st_mode))
                    os.utime(temp_fd, ns=(expected.st_atime_ns, expected.st_mtime_ns))
                    os.fsync(temp_fd)
                finally:
                    if temp_fd is not None:
                        os.close(temp_fd)
                    if not any(item["fd"] == parent_fd for item in prepared):
                        os.close(parent_fd)
            if digest_fd(source_fd) != digest:
                fail("dependency source changed after staging private inodes")
        finally:
            os.close(source_fd)

    # No destination changes before the complete staged plan is revalidated.
    for path in directories:
        directory(path)
    for members in groups.values():
        for path, info in members:
            verify_file(path, info, len(members))
    for item in prepared:
        verify_staged(item)
    remaining = {key: len(members) for key, members in groups.items()}
    for item in prepared:
        expected = item["expected"]
        key = (expected.st_dev, expected.st_ino)
        directory(item["parent"])
        for path, info in groups[key]:
            if path not in {p["path"] for p in prepared if p["committed"]}:
                verify_file(path, info, remaining[key])
        verify_staged(item)
        os.replace(item["temporary"], item["name"],
                   src_dir_fd=item["fd"], dst_dir_fd=item["fd"])
        item["committed"] = True
        remaining[key] -= 1
        os.fsync(item["fd"])

    for members in groups.values():
        for path, expected in members:
            info = os.lstat(path)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), info.st_size)
                    != (expected.st_uid, expected.st_gid, stat.S_IMODE(expected.st_mode), expected.st_size)):
                fail(f"dependency did not become private with preserved custody: {path}")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                if (os.fstat(fd).st_dev, os.fstat(fd).st_ino) != (info.st_dev, info.st_ino):
                    fail("prepared dependency changed before byte verification")
                wanted = next(item["digest"] for item in prepared
                              if (item["expected"].st_dev, item["expected"].st_ino)
                              == (expected.st_dev, expected.st_ino))
                if digest_fd(fd) != wanted:
                    fail("private dependency bytes differ from the original")
            finally:
                os.close(fd)
finally:
    for item in prepared:
        if not item["committed"]:
            try:
                info = os.stat(item["temporary"], dir_fd=item["fd"], follow_symlinks=False)
                if (info.st_dev, info.st_ino) == (item["identity"].st_dev, item["identity"].st_ino):
                    os.unlink(item["temporary"], dir_fd=item["fd"])
            except FileNotFoundError:
                pass
        os.close(item["fd"])
print(f"groups={len(groups)} replacements={len(prepared)}; bytes and custody preserved")
PY_DEPENDENCIES
  ); then
    log "FATAL: beta dependency inode preparation failed: ${outcome:-<no reason reported>}"
    return 73
  fi
  if [ "$mode" = check ]; then printf '%s\n' "$outcome"
  else log "beta dependency inodes prepared: $outcome"; fi
}

# Turbopack 16.2.9 explicitly writes generated regular files as 0664, even
# under a restrictive umask. Qualify that explained mode only while this
# invocation's new output remains inside its private, identity-pinned stage.
# This is not live-input repair: cache ownership and the final runtime publisher
# retain their separate guards and responsibilities. No prior/live/quarantined
# build is accepted here, and no shared inode or path alias is chmodded.
beta_prepare_build_output(){
  local outcome
  [ "$TARGET" = beta ] || { log "FATAL: build output preparation is beta-profile-only"; return 64; }
  [ -n "${STAGE_ROOT:-}" ] && [ -n "${BETA_BUILD_STAGE_ID:-}" ] || {
    log "FATAL: beta build output has no current private-stage binding"; return 64;
  }
  if ! outcome=$(python3 -I - "$STAGE_ROOT" "$BETA_TARGET_ROOT" "$BETA_BUILD_STAGE_ID" 2>&1 <<'PY_BUILD_OUTPUT'
import contextlib
import hashlib
import os
import stat
import sys

stage, target, expected_id = sys.argv[1:]
owner = (os.geteuid(), os.getegid())
directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
pins = {}
ancestor_pins = None


def fail(message):
    raise SystemExit(message)


def signature(info):
    # Reading changes atime; permission preparation is allowed to change ctime.
    # All other original identity/content metadata must remain stable.
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def preserved(info):
    value = signature(info)
    return value[:4] + value[5:7] + value[8:]


def no_extended_metadata(fd, label):
    if os.listxattr(fd):
        fail(f"unexplained extended metadata in private build output: {label}")


def directory(fd, label, private=False):
    info = os.fstat(fd)
    mode = stat.S_IMODE(info.st_mode)
    if (not stat.S_ISDIR(info.st_mode) or (info.st_uid, info.st_gid) != owner
            or mode & 0o7022 or mode & 0o700 != 0o700
            or (private and mode != 0o700)):
        fail(f"private build directory custody is not exclusive: {label}")
    no_extended_metadata(fd, label)
    return info


def regular(fd, label):
    info = os.fstat(fd)
    mode = stat.S_IMODE(info.st_mode)
    if (not stat.S_ISREG(info.st_mode) or (info.st_uid, info.st_gid) != owner
            or info.st_nlink != 1 or mode & 0o7000 or not mode & 0o400
            or (mode & 0o022 and mode != 0o664)):
        fail(f"unexplained generated file custody or mode: {label}")
    no_extended_metadata(fd, label)
    return info


def digest(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    result = hashlib.sha256()
    while chunk := os.read(fd, 1024 * 1024):
        result.update(chunk)
    return result.hexdigest()


def pin(label, info):
    value = signature(info)
    if label in pins and pins[label] != value:
        fail(f"private build ancestry changed: {label}")
    pins.setdefault(label, value)


@contextlib.contextmanager
def output_handle():
    # Open every absolute ancestor and every stage component without following
    # links. Reopen/revalidate the named chain on every use; a retained descriptor
    # alone would not notice that an ancestor had been renamed out of this stage.
    global ancestor_pins
    with contextlib.ExitStack() as handles:
        fd = os.open(os.sep, directory_flags)
        handles.callback(os.close, fd)
        chain = []
        for component in target.split(os.sep)[1:]:
            fd = os.open(component, directory_flags, dir_fd=fd)
            handles.callback(os.close, fd)
            info = os.fstat(fd)
            chain.append((info.st_dev, info.st_ino, info.st_uid, info.st_gid,
                          stat.S_IMODE(info.st_mode)))
        if ancestor_pins is not None and chain != ancestor_pins:
            fail("absolute beta target ancestry changed")
        ancestor_pins = chain
        pin("beta target", directory(fd, target))
        fd = os.open(os.path.basename(stage), directory_flags, dir_fd=fd)
        handles.callback(os.close, fd)
        info = directory(fd, stage, private=True)
        if f"{info.st_dev}:{info.st_ino}" != expected_id:
            fail("current private build stage identity changed")
        pin("stage", info)
        stage_device = info.st_dev
        for component in ("terminal", ".next"):
            fd = os.open(component, directory_flags, dir_fd=fd)
            handles.callback(os.close, fd)
            info = directory(fd, component)
            if info.st_dev != stage_device:
                fail("private build output crossed a filesystem boundary")
            pin(component, info)
        yield fd, stage_device


def inventory():
    result = {}
    with output_handle() as (root_fd, device):
        def walk(fd, parts):
            before = directory(fd, "/".join(parts) or ".next")
            if before.st_dev != device:
                fail("private generated directory crossed a filesystem boundary")
            result[parts] = (signature(before), None)
            names = sorted(os.listdir(fd))
            for name in names:
                child = parts + (name,)
                label = "/".join(child)
                if name == ".env" or name.startswith(".env."):
                    fail(f"secret-style name is not generated runtime output: {label}")
                named = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(named.st_mode):
                    child_fd = os.open(name, directory_flags, dir_fd=fd)
                    try:
                        if signature(os.fstat(child_fd)) != signature(named):
                            fail(f"generated directory changed before inventory: {label}")
                        walk(child_fd, child)
                    finally:
                        os.close(child_fd)
                elif stat.S_ISREG(named.st_mode):
                    child_fd = os.open(name, file_flags, dir_fd=fd)
                    try:
                        before_file = regular(child_fd, label)
                        if (signature(before_file) != signature(named)
                                or before_file.st_dev != device):
                            fail(f"generated file changed before inventory: {label}")
                        content = digest(child_fd)
                        after = regular(child_fd, label)
                        if (signature(before_file) != signature(after)
                                or signature(after) != signature(os.stat(
                                    name, dir_fd=fd, follow_symlinks=False))):
                            fail(f"generated file changed during inventory: {label}")
                        result[child] = (signature(after), content)
                    finally:
                        os.close(child_fd)
                else:
                    fail(f"generated output contains an alias or special entry: {label}")
            if (names != sorted(os.listdir(fd))
                    or signature(before) != signature(directory(fd, "/".join(parts)))):
                fail("generated directory membership changed during inventory")
        walk(root_fd, ())
    return result


@contextlib.contextmanager
def file_handle(parts, snapshot):
    with output_handle() as (root_fd, device), contextlib.ExitStack() as handles:
        fd = root_fd
        for offset, component in enumerate(parts[:-1], 1):
            fd = os.open(component, directory_flags, dir_fd=fd)
            handles.callback(os.close, fd)
            info = directory(fd, "/".join(parts[:offset]))
            if signature(info) != snapshot[parts[:offset]][0]:
                fail("generated file ancestry changed before preparation")
        fd = os.open(parts[-1], file_flags, dir_fd=fd)
        handles.callback(os.close, fd)
        info = regular(fd, "/".join(parts))
        if info.st_dev != device or signature(info) != snapshot[parts][0]:
            fail("generated file identity, membership or mode changed before preparation")
        yield fd


if (not os.path.isabs(stage) or os.path.normpath(stage) != stage
        or not os.path.isabs(target) or os.path.normpath(target) != target
        or os.path.dirname(stage) != target
        or not os.path.basename(stage).startswith(".stage.")
        or len(os.path.basename(stage)) <= len(".stage.")):
    fail("only this invocation's private beta stage may prepare generated output")
try:
    # Complete inventory first. Static unexplained state refuses before any mode
    # changes. Descriptor use is bounded by directory depth, not the file count.
    original = inventory()
    expected = dict(original)
    converted = 0
    for parts, (before, content) in sorted(original.items()):
        if content is None or stat.S_IMODE(before[4]) != 0o664:
            continue
        if parts[0] == "cache":
            continue  # beta_prepare_next_cache owns this subtree after the swap
        with file_handle(parts, original) as fd:
            current = regular(fd, "/".join(parts))
            if digest(fd) != content or signature(regular(fd, "/".join(parts))) != before:
                fail("generated bytes or custody changed before permission preparation")
            with output_handle():
                pass  # catch ancestor replacement after this file was opened
            os.fchmod(fd, 0o644)
            after = regular(fd, "/".join(parts))
            if (preserved(after) != preserved(current)
                    or stat.S_IMODE(after.st_mode) != 0o644 or digest(fd) != content
                    or signature(regular(fd, "/".join(parts))) != signature(after)):
                fail("generated bytes or custody changed during permission preparation")
            expected[parts] = (signature(after), content)
            converted += 1
    # No late replacement, new inode alias, membership change, byte change or
    # unexplained metadata may carry this preparation past the activation seam.
    if inventory() != expected:
        fail("generated output changed before private preparation completed")
except OSError as exc:
    fail(f"private build output could not be safely inspected/prepared: {exc}")
print(f"inspected={len(original)} converted={converted}; bytes, inodes and custody preserved")
PY_BUILD_OUTPUT
  ); then
    log "FATAL: beta build output preparation failed: ${outcome:-<no reason reported>}"
    return 73
  fi
  log "beta build output prepared: $outcome"
}

# Explicit custody preparation for the beta Next cache. The repaired unit keeps
# only the beta app's .next/cache writable; that is useless unless that cache
# actually belongs to the service user, so it is created and owned deliberately
# rather than assumed. Nothing outside the beta app root's cache directory is
# chowned, and the production tree is never in scope for this call. The
# read/traverse publication of the rest of the runtime tree (see
# beta_publish_runtime_readable) skips this cache subtree and never grants the
# service user any write access to the executable build.
beta_prepare_next_cache(){
  local app=$1 outcome
  beta_target_scoped_path "beta cache app root" "$app" || return $?
  if ! outcome=$(python3 -I - "$app" "$BETA_SERVICE_USER" <<'PY_CACHE'
import os
import pwd
import stat
import sys

app, service_user = sys.argv[1], sys.argv[2]
live = os.path.join(app, ".next")
try:
    metadata = os.lstat(live)
except OSError as exc:
    raise SystemExit(f"the beta live .next must already exist ({exc.strerror or exc})")
if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
    raise SystemExit("the beta live .next must be a real directory before cache preparation")
try:
    account = pwd.getpwnam(service_user)
except KeyError:
    raise SystemExit(f"the beta service user does not exist: {service_user}")
cache = os.path.join(live, "cache")
try:
    os.mkdir(cache, mode=0o750)
except FileExistsError:
    existing = os.lstat(cache)
    if stat.S_ISLNK(existing.st_mode) or not stat.S_ISDIR(existing.st_mode):
        raise SystemExit(f"the beta Next cache must be a real directory: {cache}")
# Inventory the whole cache before changing ownership. A cache built by root
# under umask 077 can contain unreadable subdirectories and files; changing only
# its root does not make those entries usable by the runtime service user.
# Never follow a link or change a shared inode, including a hardlink into a
# production tree. Publication of executable output remains outside this scope.
entries = []
pending = [cache]
while pending:
    path = pending.pop()
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode):
        raise SystemExit(f"the beta Next cache cannot contain symlinks: {path}")
    if stat.S_ISDIR(metadata.st_mode):
        entries.append((path, metadata.st_dev, metadata.st_ino, True))
        with os.scandir(path) as children:
            pending.extend(entry.path for entry in children)
    elif stat.S_ISREG(metadata.st_mode):
        if metadata.st_nlink != 1:
            raise SystemExit(f"the beta Next cache cannot contain a shared inode: {path}")
        entries.append((path, metadata.st_dev, metadata.st_ino, False))
    else:
        raise SystemExit(f"the beta Next cache cannot contain special files: {path}")

for path, device, inode, directory in entries:
    current = os.lstat(path)
    if (current.st_dev, current.st_ino) != (device, inode):
        raise SystemExit(f"the beta Next cache changed during custody preparation: {path}")
    if stat.S_ISLNK(current.st_mode) or (not directory and current.st_nlink != 1):
        raise SystemExit(f"the beta Next cache custody is no longer exclusive: {path}")
    mode = 0o750 if directory else 0o640
    os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
    os.chmod(path, mode, follow_symlinks=False)
    final = os.lstat(path)
    if ((final.st_dev, final.st_ino) != (device, inode)
            or (final.st_uid, final.st_gid) != (account.pw_uid, account.pw_gid)
            or stat.S_IMODE(final.st_mode) != mode):
        raise SystemExit(f"the beta Next cache custody could not be verified: {path}")
print(f"{cache} and {len(entries) - 1} descendants owned by {service_user} "
      f"({account.pw_uid}:{account.pw_gid})")
PY_CACHE
  ); then
    log "FATAL: beta Next cache preparation failed: ${outcome:-<no reason reported>}"
    return 73
  fi
  log "beta Next cache prepared: $outcome"
  return 0
}

# Defect (3): the root-owned stage/build runs under the host umask (077 on this
# box), so the freshly swapped .next, the npm ci node_modules and the reflected
# source are 0700/0600 root-owned — the dedicated terminal-beta service user could
# neither traverse nor read them, and `next start` inside the unit's sandbox would
# simply fail. This adds ONE narrowly scoped, NON-SECRET runtime read/traverse
# publication for the beta-owned app/dependency/build tree: every real directory
# gains group/other r-x and every real regular file gains group/other r — never
# any write bit, and never outside the beta target root. It is publication for
# runtime READING only; the writable surface stays exactly what the unit declares
# (.next/cache, service-owned, prepared by beta_prepare_next_cache) plus nothing
# else. Guards, all fail-closed:
#   * production is refused outright — this is a beta-profile effect;
#   * the app root and every visited directory must be real directories inside
#     the beta target root (re-proven through beta_target_scoped_path); symlinks
#     are never followed and never mutated, so a data alias pointing toward the
#     production tree cannot be walked through;
#   * regular files with nlink>1 are refused BY NAME: chmod on a shared inode
#     would mutate bytes this owner cannot prove are beta-only — which is why the
#     beta flow releases the cp -al staging tree immediately after a successful
#     swap, before this call, and why a planted production hardlink is a refusal
#     rather than a silent permission change onto production;
#   * the public/data subtree is skipped entirely (runtime market coverage arrives
#     through the unit's read-only bind; local beta data is not a runtime read
#     path and must not be world-published through any alias);
#   * .next/cache, .next.bak and .next.broken are skipped — the cache is the
#     service user's own prepared directory, rollback trees are never executed,
#     and publication must not disturb service ownership or evidence state;
#   * .env-style secret filenames are skipped: this step publishes the non-secret
#     runtime tree only, and secrets live outside the app root in the root-owned
#     host environment path;
#   * a pre-existing group/other write bit, or a non-directory/non-regular entry
#     where the walk expects one, is a refusal — unexplained state is never
#     normalised, and the service user is never granted write access to the
#     executable build;
#   * every mutation is owner-preserving ((mode & 0700) | 055/044), re-proven by
#     a post-chmod lstat, and every target path is under the beta root by
#     construction (only real, non-symlink directories are descended).
# What fixtures provably check (see the repaired contract): requested modes are
# added exactly, nothing gains group/other write, skipped surfaces keep their
# modes, an alias target and a shared inode are left untouched, and production is
# out of scope. What fixtures cannot prove is the real terminal-beta uid's
# effective access through systemd's mount namespace and the BindReadOnlyPaths
# alias — that remains an explicit on-host service-user probe (see the report).
beta_publish_runtime_readable(){
  local app=$1 outcome
  [ "$TARGET" = beta ] || { log "FATAL: runtime read publication is beta-profile-only"; return 64; }
  beta_target_scoped_path "beta publication app root" "$app" || return $?
  if ! outcome=$(python3 -I - "$app" "$BETA_TARGET_ROOT" <<'PY_PUBLISH'
import os
import stat
import sys

app, target_root = sys.argv[1], sys.argv[2]
DENY_WRITE = 0o022
READ_TRAVERSE = 0o055
READ_FILE = 0o044
SKIP_SUBTREES = ("public/data", ".next/cache", ".next.bak", ".next.broken")


def norm(path):
    return os.path.normpath(str(path))


def fail(message):
    raise SystemExit(message)


def lstat_or_fail(path, label):
    try:
        return os.lstat(path)
    except OSError as exc:
        fail(f"{label} cannot be inspected ({path}): {exc.strerror or exc}")


def skipped(relative):
    return any(relative == skip or relative.startswith(skip + "/") for skip in SKIP_SUBTREES)


root = norm(app)
parent_root = norm(target_root)
if not (root == parent_root or root.startswith(parent_root + os.sep)):
    fail(f"the publication root is outside the beta target root: {root}")

changed_dirs = 0
changed_files = 0
skipped_links = 0
skipped_secrets = 0


def publish_directory(path):
    global changed_dirs
    metadata = lstat_or_fail(path, "directory")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        fail(f"a publication target stopped being a real directory: {path}")
    mode = stat.S_IMODE(metadata.st_mode)
    if mode & DENY_WRITE:
        fail(f"group/other writable state will not be published over: {path}")
    desired = (mode & 0o700) | READ_TRAVERSE
    if desired != mode:
        os.chmod(path, desired)
        after = lstat_or_fail(path, "directory after publication")
        if (stat.S_ISLNK(after.st_mode) or not stat.S_ISDIR(after.st_mode)
                or stat.S_IMODE(after.st_mode) != desired
                or stat.S_IMODE(after.st_mode) & DENY_WRITE):
            fail(f"the published directory did not end read-only-traversable: {path}")
        changed_dirs += 1


def publish_file(path, name):
    global changed_files, skipped_secrets
    if name == ".env" or name.startswith(".env."):
        skipped_secrets += 1
        return
    metadata = lstat_or_fail(path, "file")
    if stat.S_ISLNK(metadata.st_mode):
        fail(f"a publication entry became a symlink: {path}")
    if not stat.S_ISREG(metadata.st_mode):
        fail(f"only regular files are published: {path}")
    if metadata.st_nlink != 1:
        fail(f"refusing to chmod a shared inode (nlink={metadata.st_nlink}): {path}")
    mode = stat.S_IMODE(metadata.st_mode)
    if mode & DENY_WRITE:
        fail(f"group/other writable state will not be published over: {path}")
    desired = (mode & 0o700) | READ_FILE
    if desired != mode:
        os.chmod(path, desired)
        after = lstat_or_fail(path, "file after publication")
        if not stat.S_ISREG(after.st_mode) or stat.S_IMODE(after.st_mode) != desired:
            fail(f"the published file did not end readable: {path}")
        changed_files += 1


top = lstat_or_fail(root, "publication root")
if stat.S_ISLNK(top.st_mode) or not stat.S_ISDIR(top.st_mode):
    fail(f"the publication root must be a real directory: {root}")

# The chain from the beta target root down to the app root must be traversable
# for the unit to reach WorkingDirectory at all; the beta target root itself is
# beta-owned state this owner created, so r-x publication there is in scope.
publish_directory(root)
chain = []
current_dir = root
while current_dir != parent_root and current_dir.startswith(parent_root + os.sep):
    current_dir = os.path.dirname(current_dir)
    chain.append(current_dir)
for directory in reversed(chain):
    publish_directory(directory)

stack = [("", root)]
while stack:
    relative, current = stack.pop()
    try:
        entries = sorted(os.scandir(current), key=lambda entry: entry.name)
    except OSError as exc:
        fail(f"cannot descend into {current}: {exc.strerror or exc}")
    for entry in entries:
        child_relative = f"{relative}/{entry.name}" if relative else entry.name
        child = os.path.join(current, entry.name)
        if skipped(child_relative):
            continue
        try:
            kind = entry.stat(follow_symlinks=False)
        except OSError as exc:
            fail(f"cannot inspect {child}: {exc.strerror or exc}")
        if stat.S_ISLNK(kind.st_mode):
            skipped_links += 1
            continue
        if stat.S_ISDIR(kind.st_mode):
            publish_directory(child)
            stack.append((child_relative, child))
        elif stat.S_ISREG(kind.st_mode):
            publish_file(child, entry.name)
        else:
            fail(f"refusing to publish a special file: {child}")

print(
    f"directories+{changed_dirs} files+{changed_files} symlinks-skipped={skipped_links} "
    f"secret-names-skipped={skipped_secrets}; read/traverse only, never group/other write"
)
PY_PUBLISH
  ); then
    log "FATAL: beta runtime read publication failed: ${outcome:-<no reason reported>}"
    return 73
  fi
  log "beta runtime published read-only for the service user: $outcome"
  return 0
}

# The bootstrap's only failure path. There is no accepted generation to restore, so
# it never restarts one: beta is stopped, the failed build is retained as evidence,
# stray rollback artifacts this attempt could not have made are purged, and the
# enforced lifecycle state goes back to "provisioned source only".
deploy_bootstrap_abort(){
  local app=$1 want_sha=$2 reason=$3 rc=0
  log "BOOTSTRAP FAILED: $reason"
  log "stopping the beta service; there is no accepted generation to restart onto"
  systemctl stop "$SERVICE_NAME" || { log "WARN: could not stop $SERVICE_NAME"; rc=1; }
  if [ -d "$app/.next" ] && [ ! -L "$app/.next" ]; then
    rm -rf "$app/.next.broken"
    if mv "$app/.next" "$app/.next.broken"; then
      log "the build that failed acceptance is retained at $app/.next.broken"
    else
      rc=1
    fi
  fi
  rm -f "$app/.deployment-id.bak" "$app/.deployment-id.absent" "$app/.deployment-id.new"
  if ! beta_bootstrap_demote; then
    log "FATAL: the accepted-runtime claim could not be removed"
    rc=1
  fi
  if [ "$rc" = 0 ]; then
    log "beta stopped at source-provisioned state — $(deploy_identity_line "$app" "$want_sha")"
  else
    log "BOOTSTRAP INCOMPLETE — beta lifecycle state UNRESOLVED"
    log "  $(deploy_identity_line "$app" "$want_sha")"
    log "  beta is NOT serving any provable commit; reconcile by hand before trusting it"
  fi
  return 1
}

# The only identity report. Routing every log line through one place is what stops
# a future edit from cheerfully reporting two of the three identities.
deploy_identity_line(){
  local app=$1 want_sha=$2 marker build
  marker=$(cat "$app/.deployment-id" 2>/dev/null || echo '<absent>')
  build=$(cat "$app/.next/BUILD_ID" 2>/dev/null || echo '<absent>')
  echo "intended=$want_sha marker=$marker BUILD_ID=$build"
}

# Beta-only transaction. Production retains the incumbent generation machinery.
BETA_TXN_ACTIVE=0
BETA_TXN_COMMITTED=0
BETA_TXN_CLEANING=0
BETA_TXN_ABORT_HANDLED=0
BETA_TXN_INPUTS_DIRTY=0
BETA_TXN_ID=
BETA_PRIOR_RECORD=
BETA_PRIOR_RECORD_ID=
BETA_PRIOR_SHA=
BETA_PRIOR_BUILD=

beta_txn_begin(){
  local mode=upgrade outcome required_state=active
  [ "$TARGET" = beta ] || return 0
  if [ "$BOOTSTRAP_REQUESTED" = 1 ]; then mode=bootstrap; required_state=inactive; fi
  outcome=$(beta_statectl attempt-begin "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
    "$APP" "$SRC" "$FULL_SHA" "$PREFLIGHT_POLICY_DIGEST" "$PRODUCTION_APP_DEFAULT" \
    "$mode" "$BETA_PRIOR_RECORD" "$BETA_PRIOR_RECORD_ID") || return $?
  BETA_TXN_ID=$outcome
  BETA_TXN_ACTIVE=1
  BETA_TXN_ABORT_HANDLED=0
  SWAPPED=0
  NEW_BUILD_ID=
  BETA_TXN_COMMITTED=0
  BETA_TXN_INPUTS_DIRTY=0
  # Before any live dependency/source write or generation move, prevent a reboot
  # from starting the not-yet-accepted candidate. Existing A may keep serving.
  systemctl disable "$SERVICE_NAME" || return $?
  beta_unit_declares_shared_shell "$required_state" disabled || return $?
  log "beta transaction pending: attempt=$BETA_TXN_ID prior=${BETA_PRIOR_SHA:-<first-install>} target=$FULL_SHA; automatic startup disabled"
}


beta_runtime_prune_owned(){
  # beta-only protected runtime-source deletion helper (bounded fabric artifact).
  # Frozen interface: beta_runtime_prune_owned "$prior_sha" "$target_sha"
  # Shell globals consumed: TARGET (must be exactly "beta"), SRC (canonical git
  # repo), RUNTIME_SYNC_ROOT and BETA_TARGET_ROOT (identical physical
  # destination root). Read-only against git: no fetch, no ref/index mutation.
  # Deletes only prior-tracked regular files that are absent from the target
  # commit inside the exact six runtime roots (config, contracts, hub, ingest,
  # signal_layer, scripts), and only after a full preflight of every candidate.
  # Any refusal happens before the first unlink. Emits compact deleted
  # path/count evidence; never prints file content.
  local _brp_prior="${1-}" _brp_target="${2-}" _brp_rc=0
  if [ "$#" -ne 2 ]; then
    printf '%s: refuse: expected exactly 2 arguments (prior_sha target_sha), got %s\n' \
      'beta_runtime_prune_owned' "$#" >&2
    return 2
  fi
  MMX_PRUNE_TARGET_NAME="${TARGET-}" \
  MMX_PRUNE_SRC="${SRC-}" \
  MMX_PRUNE_ROOT="${RUNTIME_SYNC_ROOT-}" \
  MMX_PRUNE_ROOT_ALIAS="${BETA_TARGET_ROOT-}" \
  python3 -I - "$_brp_prior" "$_brp_target" <<'MMX_PRUNE_PY_V1'
import errno
import hashlib
import os
import re
import stat
import subprocess
import sys

PROG = "beta_runtime_prune_owned"
SHA_RE = re.compile(r"\A[0-9a-f]{40}\Z")
RUNTIME_ROOTS = ("config", "contracts", "hub", "ingest", "signal_layer", "scripts")
GIT_MODE_REGULAR = ("100644", "100755")
GIT_MODE_KNOWN = ("100644", "100755", "120000", "160000")
RC_REFUSAL = 2
RC_PREFLIGHT = 3
RC_DELETION = 4


def refuse(msg):
    sys.stderr.write(PROG + ": refuse: " + msg + "\n")
    sys.exit(RC_REFUSAL)


def errname(exc):
    code = getattr(exc, "errno", None)
    return errno.errorcode.get(code, str(exc))


def normalize_physical_dir(raw, label):
    if not raw:
        refuse(label + " is empty or unset")
    if not os.path.isabs(raw):
        refuse(label + " must be an absolute path (got %r)" % (raw,))
    if os.path.normpath(raw) != raw:
        refuse(label + " is not a normalized single-spelling path (alias form refused)")
    real = os.path.realpath(raw)
    if real != raw:
        refuse(label + " is not a physical directory (symlink component refused)")
    if not os.path.isdir(real):
        refuse(label + " is not an existing directory")
    return real


def safe_git_path(path):
    if not path or path.startswith("/"):
        return False
    for bad in ("\n", "\r"):
        if bad in path:
            return False
    for comp in path.split("/"):
        if comp in ("", ".", ".."):
            return False
    return True


def in_runtime_roots(path):
    for root in RUNTIME_ROOTS:
        if path.startswith(root + "/"):
            return True
    return False


def git_bytes(src, args):
    proc = subprocess.run(["git", "-C", src] + args,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        first = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        refuse("read-only git %s failed: %s"
               % (args[0], first[0] if first else "unknown error"))
    return proc.stdout


def require_commit(src, sha, label):
    kind = git_bytes(src, ["cat-file", "-t", sha]).decode("ascii", "replace").strip()
    if kind != "commit":
        refuse(label + " is not a commit object (git reports %r)" % (kind,))


def tracked_entries(src, sha, label):
    entries = {}
    for rec in git_bytes(src, ["ls-tree", "-r", "-z", sha]).split(b"\x00"):
        if not rec:
            continue
        meta, sep, raw_path = rec.partition(b"\t")
        if not sep:
            refuse("malformed ls-tree record in " + label + " tree")
        fields = meta.split(b" ")
        if len(fields) != 3:
            refuse("malformed ls-tree metadata in " + label + " tree")
        mode = fields[0].decode("ascii", "replace")
        kind = fields[1].decode("ascii", "replace")
        oid = fields[2].decode("ascii", "replace")
        path = os.fsdecode(raw_path)
        if not safe_git_path(path):
            refuse("unsafe git path in " + label + " tree: " + repr(path))
        if not in_runtime_roots(path):
            continue
        if mode not in GIT_MODE_KNOWN:
            refuse("unsafe git mode " + mode + " for tracked path " + repr(path))
        if kind != "blob":
            refuse("unexpected tracked object type " + kind + " for path " + repr(path))
        entries[path] = (mode, oid)
    return entries


def open_under_root(root_fd, rel):
    # Walk every path component with O_NOFOLLOW starting from the already
    # verified physical root fd, so no symlink or traversal can escape.
    parts = rel.split("/")
    opened = []
    cur = root_fd
    try:
        for comp in parts[:-1]:
            cur = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                          dir_fd=cur)
            opened.append(cur)
            require_directory_custody(cur)
        entry = os.stat(parts[-1], dir_fd=cur, follow_symlinks=False)
        if not stat.S_ISREG(entry.st_mode):
            raise OSError(errno.EINVAL, "candidate is not a regular source file")
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=cur)
    except OSError:
        for fd in opened:
            os.close(fd)
        raise
    return leaf, opened


def require_directory_custody(fd):
    meta = os.fstat(fd)
    if (not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.geteuid()
            or stat.S_IMODE(meta.st_mode) & 0o022):
        raise OSError(errno.EPERM, "runtime directory custody is not exclusive")


def close_all(fds):
    for fd in fds:
        os.close(fd)


def blob_sha1(fd):
    digest = hashlib.sha1()
    size = os.fstat(fd).st_size
    digest.update(("blob %d\0" % (size,)).encode("ascii"))
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(fd, 1 << 20)
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()


def preflight_candidate(root, root_fd, rel, entry):
    mode, oid = entry
    disk = os.path.join(root, rel)
    try:
        leaf_fd, opened = open_under_root(root_fd, rel)
    except FileNotFoundError:
        return ("missing", "")
    except OSError as exc:
        return ("blocked",
                "path is not directly addressable under the physical root ("
                + errname(exc) + ")")
    try:
        st = os.fstat(leaf_fd)
        if not stat.S_ISREG(st.st_mode):
            return ("blocked",
                    "on-disk entry is not a regular file (mode 0%o)"
                    % (st.st_mode & 0o7777,))
        if st.st_nlink != 1:
            return ("blocked",
                    "shared inode (st_nlink=%d); aliased deletion refused"
                    % (st.st_nlink,))
        if st.st_uid != os.geteuid() or st.st_mode & 0o022:
            return ("blocked",
                    "world-writable or group-writable/foreign custody (mode 0%o); refused"
                    % (st.st_mode & 0o7777,))
        if (mode == "100755") != bool(st.st_mode & 0o100):
            return ("blocked",
                    "executable bit incompatible with prior git mode %s (disk 0%o)"
                    % (mode, st.st_mode & 0o7777))
        if blob_sha1(leaf_fd) != oid:
            return ("blocked", "on-disk bytes differ from prior git blob " + oid)
        if signature(os.fstat(leaf_fd)) != signature(st):
            return ("blocked", "candidate changed during its content check")
        if os.path.realpath(disk) != disk:
            return ("blocked", "path resolves outside the physical root")
    finally:
        os.close(leaf_fd)
        close_all(opened)
    return ("plan", signature(st))


def signature(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_gid,
            st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def delete_planned(root_fd, plan):
    deleted = []
    for rel, expected_identity, expected_oid in plan:
        parts = rel.split("/")
        opened = []
        cur = root_fd
        try:
            for comp in parts[:-1]:
                cur = os.open(comp,
                              os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                              dir_fd=cur)
                opened.append(cur)
                require_directory_custody(cur)
            leaf_name = parts[-1]
            st = os.stat(leaf_name, dir_fd=cur, follow_symlinks=False)
            if not stat.S_ISREG(st.st_mode) or signature(st) != expected_identity:
                raise OSError(errno.EINVAL, "candidate identity changed before unlink", rel)
            fd = os.open(leaf_name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=cur)
            try:
                if (signature(os.fstat(fd)) != expected_identity
                        or blob_sha1(fd) != expected_oid
                        or signature(os.fstat(fd)) != expected_identity):
                    raise OSError(errno.EINVAL, "candidate bytes changed before unlink", rel)
            finally:
                os.close(fd)
            if signature(os.stat(leaf_name, dir_fd=cur, follow_symlinks=False)) != expected_identity:
                raise OSError(errno.EINVAL, "candidate path changed before unlink", rel)
            os.unlink(leaf_name, dir_fd=cur)
        except OSError as exc:
            close_all(opened)
            sys.stderr.write("%s: deletion-failed after %d deletion(s) at %s: %s\n"
                             % (PROG, len(deleted), rel, errname(exc)))
            sys.exit(RC_DELETION)
        close_all(opened)
        deleted.append(rel)
    return deleted


def main(argv):
    if len(argv) != 3:
        refuse("expected exactly 2 arguments: prior_sha target_sha")
    prior, target = argv[1], argv[2]

    profile = os.environ.get("MMX_PRUNE_TARGET_NAME", "")
    if profile != "beta":
        refuse("TARGET profile must be exactly 'beta' for this helper (got %r)"
               % (profile,))

    if not SHA_RE.match(target):
        refuse("target_sha must be a full 40-character lowercase hex commit id")
    if prior != "" and not SHA_RE.match(prior):
        refuse("prior_sha must be empty (first bootstrap) or a full 40-character "
               "lowercase hex commit id")

    root_raw = os.environ.get("MMX_PRUNE_ROOT", "")
    alias_raw = os.environ.get("MMX_PRUNE_ROOT_ALIAS", "")
    src_raw = os.environ.get("MMX_PRUNE_SRC", "")
    if not root_raw or not alias_raw:
        refuse("RUNTIME_SYNC_ROOT and BETA_TARGET_ROOT must both be set")
    if root_raw != alias_raw:
        refuse("destination root mismatch/alias: RUNTIME_SYNC_ROOT and "
               "BETA_TARGET_ROOT are not the identical path")
    root = normalize_physical_dir(root_raw, "RUNTIME_SYNC_ROOT/BETA_TARGET_ROOT")
    src = normalize_physical_dir(src_raw, "SRC canonical git repo")

    require_commit(src, target, "target_sha")
    if prior == "":
        sys.stdout.write("%s: first_bootstrap prior_revision_empty candidates=0 "
                         "deleted_count=0 target=%s\n" % (PROG, target))
        return 0
    require_commit(src, prior, "prior_sha")

    prior_entries = tracked_entries(src, prior, "prior")
    target_entries = tracked_entries(src, target, "target")
    # Candidates: regular files tracked in prior, absent from target, inside the
    # exact six roots. Tracked overlap is untouched by design.
    candidates = sorted(
        path for path, (mode, _oid) in prior_entries.items()
        if mode in GIT_MODE_REGULAR and path not in target_entries
    )

    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require_directory_custody(root_fd)
        plan = []
        blocked = []
        missing = 0
        for rel in candidates:
            status, why = preflight_candidate(root, root_fd, rel, prior_entries[rel])
            if status == "plan":
                plan.append((rel, why, prior_entries[rel][1]))
            elif status == "missing":
                missing += 1
            else:
                blocked.append((rel, why))
        if blocked:
            for rel, why in blocked:
                sys.stderr.write("%s: blocked candidate %s: %s\n" % (PROG, rel, why))
            sys.stderr.write("%s: preflight blocked=%d planned=%d missing=%d "
                             "candidates=%d; no deletion performed\n"
                             % (PROG, len(blocked), len(plan), missing, len(candidates)))
            sys.exit(RC_PREFLIGHT)
        deleted = delete_planned(root_fd, plan)
    finally:
        os.close(root_fd)

    sys.stdout.write("%s: deleted_count=%d candidates=%d missing_noop=%d "
                     "prior=%s target=%s\n"
                     % (PROG, len(deleted), len(candidates), missing, prior, target))
    for rel in deleted:
        sys.stdout.write("deleted " + rel + "\n")
    return 0


sys.exit(main(sys.argv))
MMX_PRUNE_PY_V1
  _brp_rc=$?
  return "$_brp_rc"
}

# End beta runtime source prune.

beta_recovery_check(){
  local field value head dirty
  [ "$TARGET" = beta ] || return 64
  beta_unit_declares_shared_shell inactive disabled || return $?
  for field in MainPID ControlPID; do
    value=$(systemctl show -p "$field" --value "$SERVICE_NAME") || return $?
    [ "$value" = 0 ] || { log "FATAL: recovery requires $field=0"; return 75; }
  done
  head=$(git -C "$SRC" rev-parse HEAD) || return $?
  dirty=$(git -C "$SRC" status --porcelain=v1 --untracked-files=all) || return $?
  [ "$head" = "$TARGET_SHA" ] && [ -z "$dirty" ] || {
    log "FATAL: recovery requires the exact clean failed target checkout"; return 75;
  }
  beta_statectl attempt-recovery-check "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
    "$APP" "$SRC" "$TARGET_SHA" "$PREFLIGHT_POLICY_DIGEST" "$PRODUCTION_APP_DEFAULT" \
    "$RECOVERY_ATTEMPT" "$RECOVERY_RECORD_ID" >/dev/null
}

beta_txn_recover(){
  local outcome tag
  beta_recovery_check || return $?
  outcome=$(beta_statectl attempt-recover "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
    "$APP" "$SRC" "$TARGET_SHA" "$PREFLIGHT_POLICY_DIGEST" "$PRODUCTION_APP_DEFAULT" \
    "$RECOVERY_ATTEMPT" "$RECOVERY_RECORD_ID") || return $?
  IFS=$'\t' read -r tag BETA_PRIOR_RECORD BETA_PRIOR_RECORD_ID BETA_PRIOR_SHA BETA_PRIOR_BUILD <<<"$outcome"
  [ "$tag" = RECOVERY ] || return 75
  RUNTIME_RECORD_PATH=$BETA_PRIOR_RECORD
  BETA_TXN_ID=$RECOVERY_ATTEMPT
  BETA_TXN_ACTIVE=1
  BETA_TXN_INPUTS_DIRTY=1
  BETA_TXN_ABORT_HANDLED=0
  BETA_TXN_COMMITTED=0
  SWAPPED=0
  NEW_BUILD_ID=
  CANONICAL_RECOVERY_ARMED=0
  log "beta same-attempt recovery claimed once: attempt=$BETA_TXN_ID failed_record=$RECOVERY_RECORD_ID target=$TARGET_SHA; exact target will be rebuilt"
}

beta_txn_phase(){
  [ "$TARGET" = beta ] || return 0
  [ "$BETA_TXN_ACTIVE" = 1 ] || { log "FATAL: beta has no admitted pending transaction"; return 75; }
  beta_statectl attempt-phase "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
    "$BETA_TXN_ID" "$1" "${2:-}" >/dev/null
}

beta_txn_inputs_dirty(){
  [ "$TARGET" = beta ] || return 0
  # Arm this before the first write. The retained build/marker alone cannot prove
  # rollback after runtime source or dependency content may have changed.
  BETA_TXN_INPUTS_DIRTY=1
  beta_txn_phase inputs-dirty "${NEW_BUILD_ID:-}"
}

beta_txn_stop(){
  local observed
  systemctl stop "$SERVICE_NAME" || return $?
  observed=$(systemctl show -p ActiveState --value "$SERVICE_NAME") || return $?
  case "$observed" in inactive|failed) return 0 ;; esac
  log "FATAL: $SERVICE_NAME did not stop; observed ActiveState=$observed"
  return 75
}

beta_txn_quarantine(){
  # Only the candidate installed by this attempt belongs in .next.broken.
  # A staging failure must never rename the still-accepted baseline's build.
  if [ "${SWAPPED:-0}" = 1 ] && [ -d "$APP/.next" ] && [ ! -L "$APP/.next" ]; then
    if [ "${RECOVERY_REQUESTED:-0}" = 1 ]; then
      # Keep both original retained generations. A failed recovery is not retried.
      local recovery_failed="$APP/.next.recovery-failed-$BETA_TXN_ID"
      [ ! -e "$recovery_failed" ] && [ ! -L "$recovery_failed" ] || return 75
      mv "$APP/.next" "$recovery_failed" || return $?
    else
      rm -rf "$APP/.next.broken" || return $?
      mv "$APP/.next" "$APP/.next.broken" || return $?
    fi
  fi
}

beta_txn_abort(){
  local reason=$1 state marker rollback_swapped=${SWAPPED:-0} rc=0
  [ "$TARGET" = beta ] || return 1
  if [ "$BETA_TXN_CLEANING" = 1 ] || [ "$BETA_TXN_ABORT_HANDLED" = 1 ]; then return 1; fi
  BETA_TXN_ABORT_HANDLED=1
  BETA_TXN_CLEANING=1
  DEMOTE_ON_FAILURE=0
  log "BETA RELEASE FAILED: $reason"
  if [ "$BETA_TXN_ACTIVE" != 1 ]; then
    # Provisioning can fail before an activation transaction exists. First beta
    # stays stopped/disabled; an ordinary pre-admission refusal leaves A alone.
    if [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
      systemctl disable "$SERVICE_NAME" || rc=1
      beta_txn_stop || rc=1
    fi
    BETA_TXN_CLEANING=0
    return 1
  fi
  # A pointer rename can succeed before fsync/reporting fails. Observe the exact
  # attempt's accepted pointer before deciding to roll anything back.
  if ! state=$(beta_statectl attempt-state "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" "$BETA_TXN_ID"); then
    beta_txn_stop || true
    log "BETA UNRESOLVED: transaction state cannot be read; evidence retained, no rollback claim"
    BETA_TXN_CLEANING=0
    return 1
  fi
  if [ "$BETA_TXN_COMMITTED" = 1 ] || [ "$state" = COMMITTED ]; then
    BETA_TXN_COMMITTED=1
    log "BETA ACCEPTED POINTER ALREADY COMMITTED: preserving the accepted runtime; completion is unresolved and pending evidence remains"
    BETA_TXN_CLEANING=0
    return 1
  fi
  # No interruption after this point may enable an unaccepted generation.
  systemctl disable "$SERVICE_NAME" || rc=1
  if [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
    CANONICAL_RECOVERY_ARMED=0
    beta_txn_stop || rc=1
    beta_txn_quarantine || rc=1
    if [ "$rc" = 0 ]; then
      rm -f "$APP/.deployment-id.bak" "$APP/.deployment-id.absent" "$APP/.deployment-id.new" || rc=1
    fi
    if [ "$rc" = 0 ] && beta_statectl attempt-finish "$BETA_TARGET_ROOT" \
        "$SOURCE_PROVISIONED_STATE_DIR" "$BETA_TXN_ID" source-only >/dev/null; then
      BETA_TXN_ACTIVE=0
      log "beta stopped at source-provisioned state; no accepted runtime and no automatic startup"
    else
      log "BETA UNRESOLVED: first-install recovery did not complete; pending evidence retained"
    fi
    BETA_TXN_CLEANING=0
    return 1
  fi
  if [ "$BETA_TXN_INPUTS_DIRTY" = 1 ]; then
    beta_txn_stop || rc=1
    beta_txn_quarantine || rc=1
    beta_txn_phase failed "${NEW_BUILD_ID:-}" || rc=1
    CANONICAL_RECOVERY_ARMED=0
    if [ "$rc" = 0 ]; then
      log "BETA UNRESOLVED: live source/dependencies may have changed; beta stopped, prior accepted record and rollback artifacts retained; A was NOT claimed restored"
    else
      log "BETA UNRESOLVED: live source/dependencies may have changed and stop/quarantine could not be verified; evidence retained; A was NOT claimed restored"
    fi
    BETA_TXN_CLEANING=0
    return 1
  fi
  # The snapshot was admitted as A and live inputs have not changed. Account for
  # interruption just after moving A aside, before the in-memory SWAPPED flag.
  if [ ! -d "$APP/.next" ] && [ -d "$APP/.next.bak" ]; then rollback_swapped=1; fi
  marker=$(cat "$APP/.deployment-id" 2>/dev/null || true)
  if [ "$rollback_swapped" = 1 ] || [ "$marker" != "$BETA_PRIOR_SHA" ]; then
    deploy_generation_rollback "$APP" "$rollback_swapped" || rc=1
  fi
  CANONICAL_RECOVERY_ARMED=0
  if [ "$rc" = 0 ]; then
    sanitize_git_environment
    git -C "$SRC" reset -q --hard "$BETA_PRIOR_SHA" || rc=1
    git -C "$SRC" clean -qfd || rc=1
  fi
  if [ "$rc" = 0 ]; then
    systemctl restart "$SERVICE_NAME" || rc=1
  fi
  if [ "$rc" = 0 ]; then
    sleep 6 || rc=1
  fi
  if [ "$rc" = 0 ]; then
    deploy_identity_verified "$APP" "$BETA_PRIOR_SHA" "$BETA_PRIOR_BUILD" || rc=1
    shared_shell_status_verified "$BETA_STATUS_URL" "$BETA_PRIOR_SHA" "$SRC" || rc=1
    run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR" || rc=1
    [ "$PREFLIGHT_ACCEPTED_SHA" = "$BETA_PRIOR_SHA" ] || rc=1
  fi
  if [ "$rc" = 0 ]; then
    systemctl enable "$SERVICE_NAME" || rc=1
    beta_unit_declares_shared_shell active enabled || rc=1
  fi
  if [ "$rc" = 0 ] && beta_statectl attempt-finish "$BETA_TARGET_ROOT" \
      "$SOURCE_PROVISIONED_STATE_DIR" "$BETA_TXN_ID" restored >/dev/null; then
    deploy_generation_commit "$APP" || rc=1
    BETA_TXN_ACTIVE=0
    log "beta rolled back and verified: accepted=$BETA_PRIOR_SHA"
  else
    systemctl disable "$SERVICE_NAME" || true
    if beta_txn_stop; then
      log "BETA UNRESOLVED: the captured accepted generation could not be fully verified; beta stopped and pending evidence retained"
    else
      log "BETA UNRESOLVED: the captured accepted generation and stopped state could not be verified; pending evidence retained"
    fi
  fi
  BETA_TXN_CLEANING=0
  return 1
}

beta_txn_commit(){
  # All fatal beta source/dependency publication is complete before this call.
  [ "$TARGET" = beta ] || return 0
  shared_shell_status_verified "$BETA_STATUS_URL" "$FULL_SHA" "$SRC" || return $?
  deploy_identity_verified "$APP" "$FULL_SHA" "$NEW_BUILD_ID" || return $?
  run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR" || return $?
  [ "$PREFLIGHT_ACCEPTED_SHA" = "$FULL_SHA" ] || { log "FATAL: beta final source receipt is not the candidate SHA"; return 75; }
  beta_unit_declares_shared_shell active disabled || return $?
  beta_txn_phase validated "$NEW_BUILD_ID" || return $?
  beta_txn_phase committing "$NEW_BUILD_ID" || return $?
  beta_publish_runtime_accepted "$FULL_SHA" "$NEW_BUILD_ID" || return $?
  BETA_TXN_COMMITTED=1
  DEMOTE_ON_FAILURE=0
  # A hard stop before this line leaves startup disabled; after it, the only
  # automatically startable generation is the durably accepted one.
  systemctl enable "$SERVICE_NAME" || return $?
  beta_unit_declares_shared_shell active enabled || return $?
  if [ "${RECOVERY_REQUESTED:-0}" != 1 ]; then deploy_generation_commit "$APP" || return $?; fi
  beta_statectl attempt-finish "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \
    "$BETA_TXN_ID" committed >/dev/null || return $?
  BETA_TXN_ACTIVE=0
  log "beta transaction committed: accepted=$FULL_SHA attempt=$BETA_TXN_ID"
}

# Before live identity begins moving, the current-generation W2A receipt owns the
# recovery target. Any failure after target checkout mutation and before
# deploy_generation_begin succeeds must put the canonical checkout back on that
# live generation. This keeps a failed build from poisoning the next W2A.
CANONICAL_RECOVERY_ARMED=0
CANONICAL_RECOVERY_SHA=
DEPLOYMENT_MARKER="$APP/.deployment-id"
STAGE_ROOT=
BOOTSTRAP_STATE_RECORD=
cleanup_deploy_attempt(){
  local rc=$? live_marker restored_head dirty archive_cleanup_failed=0
  trap - EXIT
  if [ "$TARGET" = beta ]; then trap '' HUP INT TERM; fi
  set +e
  if [ "$rc" -ne 0 ] && [ "$TARGET" = beta ] && \
      { [ "${BETA_TXN_ACTIVE:-0}" = 1 ] || [ "${DEMOTE_ON_FAILURE:-0}" = 1 ]; }; then
    beta_txn_abort "nonzero exit or trapped interruption (status=$rc)" || true
  fi
  if ! beta_bootstrap_archive_cleanup; then
    archive_cleanup_failed=1
    rc=73
  fi
  # A failed stage can exhaust the filesystem. Release this attempt's staging
  # bytes before Git needs space for the canonical recovery index.
  if [ -n "${STAGE_ROOT:-}" ] && [ -d "$STAGE_ROOT" ]; then
    rm -rf "$STAGE_ROOT" || log "WARN: could not remove staging directory $STAGE_ROOT"
  fi
  if [ "$rc" -ne 0 ] && [ "${CANONICAL_RECOVERY_ARMED:-0}" = 1 ]; then
    if live_marker=$(read_live_deployment_marker "$DEPLOYMENT_MARKER") \
      && [ -n "${CANONICAL_RECOVERY_SHA:-}" ] \
      && [ "$live_marker" = "$CANONICAL_RECOVERY_SHA" ]; then
      log "pre-swap failure: restoring canonical checkout to live accepted generation $CANONICAL_RECOVERY_SHA"
      sanitize_git_environment
      if git -C "$SRC" reset -q --hard "$CANONICAL_RECOVERY_SHA" \
        && git -C "$SRC" clean -qfd; then
        restored_head=$(git -C "$SRC" rev-parse HEAD 2>/dev/null)
        dirty=$(git -C "$SRC" status --porcelain=v1 --untracked-files=all 2>/dev/null)
        if [ "$restored_head" = "$CANONICAL_RECOVERY_SHA" ] && [ -z "$dirty" ]; then
          log "pre-swap canonical checkout recovery OK"
        else
          log "FATAL: pre-swap canonical checkout recovery verification failed"
          rc=74
        fi
      else
        log "FATAL: pre-swap canonical checkout recovery failed"
        rc=74
      fi
    else
      log "FATAL: pre-swap recovery refused because live identity changed or became unreadable"
      rc=74
    fi
  fi
  # Ordinary exits release only this process's verified hold, including guarded
  # failures and a bare set-e abort. Unexplained archive custody instead retains
  # the hold for attended recovery; neither profile may clear another owner.
  if [ "$archive_cleanup_failed" = 1 ]; then
    log "FATAL: beta archive custody remains unresolved; the shared build hold is retained for attended recovery"
  else
    deploy_lock_release "$SHARED_BUILD_LOCK_DIR" "$DEPLOY_LOCK_HELD" "$TARGET" || {
      log "FATAL: the shared build lock was NOT released; the next deploy of ANY target will refuse until $SHARED_BUILD_LOCK_DIR is reconciled"
      [ "$rc" = 0 ] && rc=73
    }
  fi
  exit "$rc"
}

# Sourced -> expose the library and stop. Executed -> deploy.
# Gated on sourced-ness, NOT an environment variable: an inherited env var would
# turn a real root deploy into a silent `exit 0` that shipped nothing while every
# caller recorded success — the same "certify a deploy that never happened" failure
# this script exists to prevent. Sourced-ness cannot be forged by the environment.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

# ── argument form -> profile -> SHA. Nothing here touches the filesystem. ──────
# Four explicit forms are accepted: the production default, ordinary beta,
# beta bootstrap, and exact one-shot beta recovery. The profile flag,
# when present, comes first and --bootstrap is valid only with --target beta. There
# is no environment variable, config file or positional shortcut that selects a
# profile or an entrance: the release intent is the command line, in full, every
# time.
TARGET_REQUESTED=production
BOOTSTRAP_REQUESTED=0
RECOVERY_REQUESTED=0
RECOVERY_ATTEMPT=
RECOVERY_RECORD_ID=
TARGET_SHA=
if [ "$#" -eq 2 ] && [ "$1" = "--target-sha" ]; then
  TARGET_SHA=$2
elif [ "$#" -eq 4 ] && [ "$1" = "--target" ] && [ "$3" = "--target-sha" ]; then
  TARGET_REQUESTED=$2
  TARGET_SHA=$4
elif [ "$#" -eq 5 ] && [ "$1" = "--target" ] && [ "$3" = "--bootstrap" ] && [ "$4" = "--target-sha" ]; then
  TARGET_REQUESTED=$2
  TARGET_SHA=$5
  BOOTSTRAP_REQUESTED=1
elif [ "$#" -eq 8 ] && [ "$1" = "--target" ] && [ "$2" = beta ] \
    && [ "$3" = "--recover-attempt" ] && [ "$5" = "--pending-record-id" ] && [ "$7" = "--target-sha" ]; then
  TARGET_REQUESTED=beta
  RECOVERY_REQUESTED=1
  RECOVERY_ATTEMPT=$4
  RECOVERY_RECORD_ID=$6
  TARGET_SHA=$8
  if [[ ! "$RECOVERY_ATTEMPT" =~ ^[0-9a-f]{32}$ ]] || [[ ! "$RECOVERY_RECORD_ID" =~ ^[0-9a-f]{64}$ ]]; then
    log "FATAL: recovery requires exact attempt and pending record identities"; exit 64
  fi
else
  log "USAGE: $0 [--target production|beta] [--bootstrap] --target-sha <full-lowercase-40-hex-commit>"
  log "       --bootstrap is beta-only; failed dirty upgrades use --target beta --recover-attempt <32-hex> --pending-record-id <64-hex> --target-sha <40-hex>"
  exit 64
fi
if [ "$BOOTSTRAP_REQUESTED" = 1 ] && [ "$TARGET_REQUESTED" != beta ]; then
  log "FATAL: --bootstrap is invalid for --target $TARGET_REQUESTED. Production is adopted through a PR and a W2A receipt, never bootstrapped."
  exit 64
fi
select_release_target "$TARGET_REQUESTED" || exit $?
validate_target_sha "$TARGET_SHA" || exit $?
apply_profile_environment || exit $?
sanitize_git_environment
log "target profile resolved: target=$TARGET app=$APP src=$SRC service=$SERVICE_NAME health=$HEALTH_URL"
log "target profile resolved: receipts=$PREFLIGHT_RECEIPT_DIR policy=$PREFLIGHT_POLICY_BASENAME lock=$SHARED_BUILD_LOCK_DIR installs_global_runtime=$INSTALLS_GLOBAL_RUNTIME"
log "beta lifecycle state tree: $SOURCE_PROVISIONED_STATE_DIR; build-time env source: $ENV_SOURCE_DIR (secret values are never logged and never live in the audited beta target)"
if [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
  log "entrance: beta bootstrap — provisions SOURCE, then must still earn runtime acceptance"
fi

# Volume-backed hosts must admit storage before preflight or deploy effects.
# Hosts without the separately installed guard retain their existing entrance.
# The guard is read-only (it refuses on /etc/terminal-storage-maintenance, then
# verifies the storage and app-root mounts resolve to one device), so it is safe —
# and required — for both profiles. It is never waived, never re-implemented and
# never given a beta variant here.
if [ -e /usr/local/sbin/terminal-volume-guard ] || [ -L /usr/local/sbin/terminal-volume-guard ]; then
  /usr/local/sbin/terminal-volume-guard || exit $?
fi

# 0a) THE ONE SHARED BUILD-RESOURCE LOCK — before the first receipt write, the
# first provisioning archive, the first staging directory, the first Git command
# and the first service effect, for EITHER profile. The per-target identity and
# path guards run immediately behind it and stay exactly as strict.
deploy_lock_acquire "$SHARED_BUILD_LOCK_DIR" "$TARGET" || exit $?
trap cleanup_deploy_attempt EXIT
if [ "$TARGET" = beta ]; then
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi
if [ "$TARGET" = beta ]; then
  ensure_beta_workspace || exit $?
fi
assert_deploy_paths_scoped || exit $?

# 0b) canonical checkout, the trusted preflight bundle, the profile's receipt tree.
if [ ! -d "$SRC/.git" ]; then
  log "FATAL: canonical checkout missing. Create it once with:"
  log "  git clone --branch $BRANCH git@github-mmterminal:mastermindx-market-intelligence/mastermind-terminal.git $SRC"
  exit 1
fi
select_preflight_artifacts 0 "$AUTHORING_OPS_DIR" "$SRC/ops"
log "preflight bundle selected: script_sha256=$PREFLIGHT_SCRIPT_SHA256 policy_digest=$PREFLIGHT_POLICY_DIGEST runtime_sha256=$PREFLIGHT_RUNTIME_SHA256"
prepare_preflight_receipt_dir "$PREFLIGHT_RECEIPT_DIR"

# 0c) two entrances, one source contract. The BRANCH TEXT ORDER is load-bearing
# for the incumbent admission contract: the executable body must perform its first
# run_release_preflight before its first fetch/reset/clean/build/rsync/restart, so
# the ordinary entrance is written first and calls the gate INLINE, exactly as the
# incumbent always did. The bootstrap entrance is second and unchanged in
# behaviour; its own gate runs against the provisioned generation.
if [ "$BOOTSTRAP_REQUESTED" != 1 ] && [ "$RECOVERY_REQUESTED" != 1 ]; then
  # The incumbent order, exactly restored: current-generation preflight (plus the
  # receipted sole-canonical-head-mismatch recovery and its second preflight)
  # BEFORE fetch, admission, reset, clean, build and every source write.
  if [ "$TARGET" = beta ]; then
    beta_ordinary_deploy_gate || exit $?
  fi
  run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR" auto
  if [ "$PREFLIGHT_RECOVERY_REQUIRED" = 1 ]; then
    log "current-generation preflight admitted the sole canonical-head mismatch recovery state"
    recover_canonical_head_mismatch "$SRC" "$DEPLOYMENT_MARKER" || exit $?
    run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR"
  fi

  # 1) EXACT TARGET GATE — fetch the accepted ref, then pin every later step to
  # the caller's admitted full SHA. A later branch movement cannot change target.
  log "fetching accepted ref origin/$BRANCH for exact target admission ..."
  ACCEPTED_REF="refs/remotes/origin/$BRANCH"
  fetch_accepted_ref "$SRC" origin "$BRANCH" "$ACCEPTED_REF"
  admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF_SHA"
  if [ "$TARGET" = beta ]; then
    # The process that is about to be restarted must already declare the same
    # shared-shell opt-in the build is about to be made with. Refusing here costs a
    # build; activating here would cost the beta generation.
    beta_unit_declares_shared_shell active || exit $?
  fi
  CANONICAL_RECOVERY_SHA=$PREFLIGHT_ACCEPTED_SHA
  CANONICAL_RECOVERY_ARMED=1
  git -C "$SRC" reset -q --hard "$TARGET_SHA"
  git -C "$SRC" clean -qfd
elif [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
  # Bootstrap order is load-bearing: unit prerequisite -> admission of an empty or
  # exactly-verified target -> fetch the protected ref -> prove the requested
  # commit is contained by it -> bind the beta checkout -> provision SOURCE from the
  # protected archive -> publish the enforced source-provisioned record -> THEN the
  # ordinary W2A gate. Nothing mutable happens before containment is proven, no
  # unknown state is wiped to make room, and the audit is not weakened one bit
  # because the beta target started out empty.
  beta_unit_declares_shared_shell inactive disabled || exit $?
  beta_bootstrap_admit "$TARGET_SHA" || exit $?
  log "fetching accepted ref origin/$BRANCH for exact target admission (bootstrap: before any source provisioning) ..."
  ACCEPTED_REF="refs/remotes/origin/$BRANCH"
  fetch_accepted_ref "$SRC" origin "$BRANCH" "$ACCEPTED_REF"
  admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF_SHA"
  sanitize_git_environment
  git -C "$SRC" reset -q --hard "$TARGET_SHA" || exit $?
  git -C "$SRC" clean -qfd || exit $?
  if [ "$(git -C "$SRC" rev-parse HEAD)" != "$TARGET_SHA" ]; then
    log "FATAL: the beta canonical checkout did not bind the admitted target"
    exit 65
  fi
  beta_bootstrap_provision "$SRC" "$TARGET_SHA" || exit $?
  DEMOTE_ON_FAILURE=1
  CANONICAL_RECOVERY_SHA=$TARGET_SHA
  CANONICAL_RECOVERY_ARMED=1
  log "beta bootstrap: the current-generation W2A gate now runs against the provisioned generation"
  run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR" auto
  if [ "$PREFLIGHT_RECOVERY_REQUIRED" = 1 ]; then
    log "current-generation preflight admitted the sole canonical-head mismatch recovery state"
    recover_canonical_head_mismatch "$SRC" "$DEPLOYMENT_MARKER" || exit $?
    run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR"
  fi
else
  # Dirty failed-attempt recovery is an explicit, one-shot entrance. It does not
  # reinterpret the original UNKNOWN_STOP as CLEAN or open a replacement attempt.
  beta_recovery_check || exit $?
  ACCEPTED_REF="refs/remotes/origin/$BRANCH"
  fetch_accepted_ref "$SRC" origin "$BRANCH" "$ACCEPTED_REF"
  admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF_SHA"
  beta_txn_recover || exit $?
fi
FULL_SHA=$(git -C "$SRC" rev-parse HEAD)
[ "$FULL_SHA" = "$TARGET_SHA" ] || {
  log "FATAL: canonical checkout did not land on admitted target: wanted=$TARGET_SHA actual=$FULL_SHA"
  exit 65
}
SHA=${FULL_SHA:0:12}
if [ "$TARGET" = beta ] && [ "$RECOVERY_REQUESTED" != 1 ]; then
  beta_txn_begin || exit $?
fi
log "node $(node -v)"
log "GIT-GATED: deploying accepted target $FULL_SHA from origin/$BRANCH for target=$TARGET (working-tree edits in $APP are IGNORED)"

# 1) deps — from the canonical lockfile. Reuse $APP/node_modules unless the lock changed.
if [ ! -d "$APP/node_modules" ] || ! cmp -s "$TSRC/package-lock.json" "$APP/package-lock.json" 2>/dev/null; then
  log "installing deps (npm ci) — lockfile changed"
  if [ "$TARGET" = beta ]; then beta_txn_inputs_dirty || exit $?; fi
  cp -f "$TSRC/package.json" "$TSRC/package-lock.json" "$APP/" 2>/dev/null || true
  ( cd "$APP" && npm ci || npm install )
else
  log "deps unchanged — skipping npm ci"
fi

if [ "$TARGET" = beta ]; then
  if ! BETA_DEPENDENCY_GROUPS=$(beta_prepare_dependency_inodes "$APP" check); then
    log "$BETA_DEPENDENCY_GROUPS"
    beta_txn_abort "beta dependency inode inventory refused" || exit 1
  fi
  case "$BETA_DEPENDENCY_GROUPS" in
    ''|*[!0-9]*) beta_txn_abort "beta dependency inode inventory was not a count" || exit 1 ;;
  esac
  if [ "$BETA_DEPENDENCY_GROUPS" != 0 ]; then
    beta_txn_inputs_dirty || exit $?
    if ! beta_prepare_dependency_inodes "$APP" apply; then
      beta_txn_abort "could not give beta dependencies private inodes" || exit 1
    fi
  fi
fi

# 2) stage: canonical terminal/ source + $APP runtime (node_modules/.env*/public/data — all gitignored)
# The stage is NESTED: $STAGE_ROOT/terminal is the app, and the gated commit's sibling
# source dirs (ingest/ hub/ signal_layer/ config/ contracts/) sit beside it, so every
# `../<dir>` the build follows — Next's type-check walks a terminal/ import into
# ingest/, and ingest/ imports back into ../terminal/lib — resolves to origin/$BRANCH,
# not to the live /opt/terminal/<dir> copies (which stay untouched until step 8).
# Without this a terminal/ test that imports ../../../ingest/... type-checks the OLD
# sidecar and the build fails on code master never had (deploy of #558, 2026-09-10).
# scripts/ is deliberately a symlink to the live dir: the prebuild coverage script
# writes next to its own resolved location, and that must remain the live app.
#
# For the beta profile the same nesting is built entirely from beta-owned inputs:
# the stage root is created under the beta app's parent (dirname "$APP"), the gated
# siblings come from the admitted commit in the beta checkout, and scripts/ is a real
# archived directory rather than a link onto a live runtime directory. That removes
# the one production-only filesystem assumption in this step, and keeps any
# build-time write inside the ephemeral stage instead of a live tree.
STAGE_ROOT=$(mktemp -d "$(dirname "$APP")/.stage.XXXXXX")
if [ "$TARGET" = beta ]; then
  # Capture this invocation's private directory identity before archive/build code
  # runs. Later output preparation must reopen exactly this directory.
  BETA_BUILD_STAGE_ID=$(python3 -I -c 'import os,sys; s=os.lstat(sys.argv[1]); print(str(s.st_dev)+":"+str(s.st_ino))' "$STAGE_ROOT") || exit $?
fi
STAGE="$STAGE_ROOT/terminal"
mkdir -p "$STAGE"
# The gated dirs are archived to a file first: an EMPTY stream (a commit without them, or a
# stubbed git) must stage the app alone rather than abort — GNU tar rejects empty stdin.
GATED_TAR="$STAGE_ROOT/.gated.tar"
log "target=$TARGET gated stage paths: $STAGE_GATED_PATHS"
if [ "$TARGET" = beta ]; then
  git -C "$SRC" -c tar.umask=0077 archive HEAD -- $STAGE_GATED_PATHS > "$GATED_TAR"
else
  git -C "$SRC" archive HEAD -- $STAGE_GATED_PATHS > "$GATED_TAR"
fi
if [ -s "$GATED_TAR" ]; then
  tar -x -f "$GATED_TAR" -C "$STAGE_ROOT/"
else
  log "gated runtime dirs: nothing archived from origin/$BRANCH — staging the app alone"
fi
rm -f "$GATED_TAR"
if [ "$TARGET" = beta ]; then
  log "beta stage: scripts/ is taken from the admitted commit inside the stage; no link onto a live runtime directory"
else
  ln -s "$(dirname "$APP")/scripts" "$STAGE_ROOT/scripts"
fi
log "staging origin/$BRANCH:terminal in $STAGE (+ gated ingest/hub/signal_layer/config/contracts beside it)"
rsync -a --delete \
  --exclude='.next' --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='public/data' \
  "$TSRC/" "$STAGE/"
if [ "$TARGET" = beta ]; then
  # A beta build cannot alter the accepted runtime's dependencies through shared
  # inodes. Production keeps its incumbent hardlink behavior below.
  cp -a "$APP/node_modules" "$STAGE/node_modules"
else
  cp -al "$APP/node_modules" "$STAGE/node_modules"     # hardlink copy: Turbopack rejects out-of-tree symlinks
fi
# Build-time env comes from the profile's declared source directory: production keeps
# $APP/.env* exactly as before; beta reads them from the beta-owned host directory
# OUTSIDE the audited app target, so a bootstrap never has to choose between "target
# must be empty" and "the build needs its secrets". Their values are never logged.
cp -a "$ENV_SOURCE_DIR/.env" "$STAGE/.env" 2>/dev/null || true
cp -a "$ENV_SOURCE_DIR/.env.local" "$STAGE/.env.local" 2>/dev/null || true
if [ "$TARGET" = beta ]; then
  log "beta stage identity: GIT_SHA/NEXT_DEPLOYMENT_ID come from the admitted commit; env files are read only from the beta app root"
  log "beta stage runtime data: staged only from beta-owned $APP/public/data; production runtime data is never hardlinked, copied or prebuilt into beta"
fi
printf '%s\n' "$FULL_SHA" > "$STAGE/.deployment-id"
mkdir -p "$STAGE/public"
cp -al "$APP/public/data" "$STAGE/public/data" 2>/dev/null || rsync -a "$APP/public/data/" "$STAGE/public/data/" 2>/dev/null || true

# 3) build into the staging tree — the slow part; live site stays up throughout.
log "next build (staging) ..."
# next.config.ts is evaluated in more than one build worker. Pin both supported
# deployment-id inputs to the ONE deployed commit so every HTML/RSC response and
# every static chunk uses the same ?dpl= value. The Date.now fallback is only for
# ad-hoc local builds. NODE_OPTIONS carries the heap ceiling (see build_node_options).
# MMX_SHARED_SHELL is present only because apply_profile_environment declared it for
# beta and removed it for production; the build command itself is identical for both.
BUILD_NODE_OPTIONS=$(build_node_options "${NODE_OPTIONS:-}")
( cd "$STAGE" && NODE_OPTIONS="$BUILD_NODE_OPTIONS" GIT_SHA="$FULL_SHA" NEXT_DEPLOYMENT_ID="$FULL_SHA" npm run build )

# 4) verify the new build is complete before touching anything live.
if [ ! -f "$STAGE/.next/BUILD_ID" ]; then
  log "BUILD FAILED (no BUILD_ID) — live site untouched, aborting"
  exit 1
fi
NEW_BUILD_ID=$(cat "$STAGE/.next/BUILD_ID")
# BUILD_ID is a constant literal while deploymentId is set (see deploy_identity_verified),
# so print the SHA beside it — the bare BUILD_ID line makes a healthy deploy look like a no-op.
log "new build OK: BUILD_ID=$NEW_BUILD_ID sha=$FULL_SHA"

if [ "$TARGET" = beta ]; then
  # Only the fresh private stage is touched; preserve any existing live-input
  # dirty state, and refuse before activation or any live build/marker swap.
  if ! beta_prepare_build_output; then
    beta_txn_abort "could not qualify private beta build output" || exit 1
  fi
fi

# 5) Pin the same deployment id for `next start`, which evaluates next.config.ts
#    again. Install it only after the staged build verifies, immediately before the
#    atomic build swap — and open a deploy generation as it goes, so the prior
#    marker is snapshotted and a failed health check can restore identity and build
#    together.
#
#    A bootstrap differs in exactly one way here, and it is the important one:
#    there is no previous accepted generation, and the marker that exists carries
#    the provisioned SOURCE identity. Snapshotting it into .deployment-id.bak would
#    silently promote provisioned source to a rollback baseline, so no generation is
#    opened at all on that entrance.
if [ "$TARGET" = beta ]; then beta_txn_phase activation "$NEW_BUILD_ID" || exit $?; fi
if [ "$RECOVERY_REQUESTED" = 1 ]; then
  # The original prior marker/build remain rollback evidence. Never snapshot
  # the failed target as a new accepted baseline merely because its ID is present.
  [ "$(read_live_deployment_marker "$DEPLOYMENT_MARKER")" = "$FULL_SHA" ] || exit 75
elif [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
  log "beta bootstrap: no deploy generation is opened; a provisioned source marker is never a rollback baseline"
else
  deploy_generation_begin "$APP" "$STAGE/.deployment-id"
fi
CANONICAL_RECOVERY_ARMED=0

# 6) atomic swap (rename within one filesystem is atomic).
#    Every move is guarded. A bare `set -e` abort here would end the deploy with the
#    marker already advanced by step 5 and the live .next already moved aside, and
#    rollback would never run — see deploy_generation_abort.
SWAPPED=0
if [ "$RECOVERY_REQUESTED" = 1 ]; then
  [ ! -e "$APP/.next" ] && [ ! -L "$APP/.next" ] || exit 75
elif ! rm -rf "$APP/.next.bak"; then
  if [ "$TARGET" = beta ]; then beta_txn_abort "could not clear .next.bak" || exit 1; fi
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "could not clear .next.bak" || exit 1
fi
if [ -d "$APP/.next" ] && ! mv "$APP/.next" "$APP/.next.bak"; then
  if [ "$TARGET" = beta ]; then
    beta_txn_abort "could not vacate the beta .next slot" || exit 1
  fi
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "could not move the live .next aside" || exit 1
fi
# From here the live .next slot has been vacated — moved to .next.bak, or there
# was none to begin with (bootstrap deploy) — so any abort from this point on
# must go through the swapped=1 path: restore .next.bak, or fail loudly. It must
# never take the swapped=0 no-op path, which would silently leave no live build
# at all while claiming a clean rollback (#504 review M1's mirror case: the
# THIRD mv, moving the new build in, can still fail after the old one already
# moved out).
SWAPPED=1
if ! mv "$STAGE/.next" "$APP/.next"; then
  if [ "$TARGET" = beta ]; then
    beta_txn_abort "could not install the beta build" || exit 1
  fi
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "could not swap in the new build" || exit 1
fi
log "swapped .next (previous build kept as .next.bak)"
if [ "$TARGET" = beta ]; then
  # Beta copies dependencies independently (cp -a). Release this attempt's stage
  # after the swap to return build space, then clear STAGE_ROOT for the EXIT
  # harness. Package-local dependency hardlinks were prepared before staging;
  # runtime publication still refuses every remaining shared regular inode.
  # Production keeps its incumbent hardlink copy and stage lifetime.
  if ! rm -rf "$STAGE_ROOT"; then
    beta_txn_abort "could not release the beta staging tree" || exit 1
  fi
  STAGE_ROOT=
fi

# 7) Beta activates a pending candidate; publication is deliberately deferred
# until all beta source/dependency finalization and fresh verification are done.
if [ "$TARGET" = beta ]; then
  if ! beta_publish_runtime_readable "$APP"; then
    beta_txn_abort "could not publish the beta runtime tree for the service user" || exit 1
  fi
  if ! beta_prepare_next_cache "$APP"; then beta_txn_abort "could not prepare beta cache" || exit 1; fi
  if [ "$BOOTSTRAP_REQUESTED" = 1 ]; then
    if ! systemctl start "$SERVICE_NAME"; then beta_txn_abort "systemctl start failed" || exit 1; fi
  else
    if ! systemctl restart "$SERVICE_NAME"; then beta_txn_abort "systemctl restart failed" || exit 1; fi
  fi
  sleep 6
  if ! shared_shell_status_verified "$BETA_STATUS_URL" "$FULL_SHA" "$SRC" \
      || ! deploy_identity_verified "$APP" "$FULL_SHA" "$NEW_BUILD_ID" \
      || ! beta_unit_declares_shared_shell active disabled; then
    beta_txn_abort "pending beta health, identity or unit verification failed" || exit 1
  fi
  log "beta candidate active but pending: $FULL_SHA; accepted pointer has not advanced"
else
if ! systemctl restart terminal; then
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "systemctl restart failed" || exit 1
fi
sleep 6
DEPLOY_OK=1
if curl -fsS http://127.0.0.1:3000/ -o /dev/null -w "[build] localhost:3000 -> %{http_code}\n"; then
  log "health OK"
else
  log "post-restart health check FAILED"
  DEPLOY_OK=0
fi
if [ "$DEPLOY_OK" = 1 ] && ! deploy_identity_verified "$APP" "$FULL_SHA" "$NEW_BUILD_ID"; then
  log "deploy identity MISMATCH — the live build is not the commit being deployed"
  DEPLOY_OK=0
fi

if [ "$DEPLOY_OK" = 1 ]; then
  deploy_generation_commit "$APP"
  log "identity verified: $(deploy_identity_line "$APP" "$FULL_SHA")"
else
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" \
    "post-restart health or identity verification failed" || exit 1
fi
fi

# 8) RUNTIME-CODE SYNC — cron + systemd consume code from /opt/terminal/<dir> that
#    is NOT part of the Next.js app; without this step, merged changes to those
#    files silently never reach the box (bit on 2026-07-10: PR #74's
#    pull_macro_intel.py). OVERLAY semantics (git archive | tar -x): tracked files
#    are overwritten with master; box-only untracked files (runtime caches like
#    ingest/hk_universe_cache.json, zh_cache.json, .polygon_*.json and *.bak-*
#    backups) are left alone. NEVER convert this to rsync --delete — those caches
#    exist ONLY on the box.
#    signal_layer/ synced since 2026-07-10: the box↔master divergence was reconciled
#    (box GC-v2 engine incl. confluence_v2.py committed; master's inverted
#    golden_gate kept) — origin/master is now canonical for it, like ingest/.
#
#    ORDER IS LOAD-BEARING AND RESTORED EXACTLY (defect #2): the hub content state
#    and the hub lockfile digest are sampled BEFORE the archive lands, because
#    "did the dependency change" is only answerable against the pre-overlay
#    filesystem. Sampling them after the overlay makes LOCK_BEFORE == LOCK_AFTER
#    forever and silently disables the hub `npm ci` on every dependency change.
RUNTIME_PATHS="ingest scripts config contracts hub signal_layer"
if [ "$INSTALLS_GLOBAL_RUNTIME" = 1 ]; then
hub_state(){ find /opt/terminal/hub -type f -not -path '*/node_modules/*' -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum || true; }
HUB_BEFORE=$(hub_state)
LOCK_BEFORE=$(sha256sum /opt/terminal/hub/package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
log "runtime sync <- origin/$BRANCH: $RUNTIME_PATHS"
git -C "$SRC" archive HEAD -- $RUNTIME_PATHS | tar -x -C /opt/terminal/

# quote-hub runs hub/hub.js as a systemd service — npm ci if the lockfile moved, and
# restart ONLY when hub/ actually changed (a restart briefly drops live WS clients).
LOCK_AFTER=$(sha256sum /opt/terminal/hub/package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "hub lockfile changed — npm ci"
  ( cd /opt/terminal/hub && npm ci --omit=dev || npm install --omit=dev )
fi
HUB_AFTER=$(hub_state)
if [ "$HUB_BEFORE" != "$HUB_AFTER" ]; then
  systemctl restart quote-hub
  log "quote-hub restarted (hub/ changed)"
else
  log "hub/ unchanged — quote-hub not restarted"
fi

# cron wrapper: crontab (30 21 * * *) runs /usr/local/bin/terminal-data; its
# authoring source is ops/terminal-data (ops/README.md). Installed via temp+rename
# so a mid-run nightly keeps executing its already-open copy.
install -m 0755 "$SRC/ops/terminal-data" /usr/local/bin/.terminal-data.new
mv -f /usr/local/bin/.terminal-data.new /usr/local/bin/terminal-data
log "installed ops/terminal-data -> /usr/local/bin/terminal-data"

# self-update: rename = new inode, so the currently-running instance is untouched;
# the new script takes effect on the NEXT deploy.
install -m 0755 "$SRC/ops/terminal-build.sh" /opt/terminal/.terminal-build.sh.new
mv -f /opt/terminal/.terminal-build.sh.new /opt/terminal/terminal-build.sh
log "installed ops/terminal-build.sh -> /opt/terminal/terminal-build.sh (effective next run)"
else
  # Beta overlays ONLY its own runtime tree. The whole global-effect block above is
  # structurally absent for this profile — no hub content/lockfile sampling, no hub
  # npm ci, no quote-hub install or restart, no nightly cron wrapper, no owner
  # self-install — and the destination is re-proven to be inside the beta target
  # root immediately before the extract, so a mis-scoped profile can never overlay
  # onto the production tree.
  if ! beta_target_scoped_path "beta runtime sync root" "$RUNTIME_SYNC_ROOT"; then
    beta_txn_abort "the beta runtime sync root escaped the beta target" || exit 1
  fi
  beta_txn_inputs_dirty || exit $?
  log "runtime sync <- target=beta origin/$BRANCH: $RUNTIME_PATHS -> $RUNTIME_SYNC_ROOT"
  # The profile's legacy destination has a trailing slash; bind the helper to
  # its one physical spelling without changing the production profile/overlay.
  RUNTIME_SYNC_ROOT="${RUNTIME_SYNC_ROOT%/}" beta_runtime_prune_owned "$BETA_PRIOR_SHA" "$FULL_SHA"
  git -C "$SRC" -c tar.umask=0077 archive HEAD -- $RUNTIME_PATHS | tar -x -C "$RUNTIME_SYNC_ROOT"
  log "beta profile: no hub dependency detection, no hub npm ci, no quote-hub effect"
  log "beta profile: no nightly cron wrapper, no owner self-install, no global cron bundles"
fi

# 9) reflect canonical master into $APP source (so the on-box source == what is live/committed,
#    and any stray working-tree edits are cleared — enforcing 'master is the source of truth').
log "syncing $APP source <- origin/$BRANCH:terminal"
rsync -a --delete \
  --exclude='.next' --exclude='.next.bak' --exclude='.next.broken' --exclude='.stage.*' \
  --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='public/data' \
  --exclude='.deployment-id' --exclude='.deployment-id.bak' --exclude='.deployment-id.absent' \
  --exclude='.deployment-id.new' \
  --exclude='scripts/dist' \
  "$TSRC/" "$APP/"
if [ "$TARGET" = beta ]; then
  # Canonical source reflection can restore restrictive checkout modes. Publish
  # final read/traverse custody before a restart reads these exact source inputs.
  # Every failure here is still part of the pending transaction.
  if ! beta_publish_runtime_readable "$APP"; then
    beta_txn_abort "could not publish beta runtime readability after source reflection" || exit 1
  fi
  if ! beta_prepare_next_cache "$APP"; then
    beta_txn_abort "could not finalize beta cache custody" || exit 1
  fi
  if ! systemctl restart "$SERVICE_NAME"; then
    beta_txn_abort "final beta restart after source reflection failed" || exit 1
  fi
  sleep 6
fi

# Beta's last fatal source/dependency operation is complete. Runtime acceptance
# is now a conditional pointer commit; the old generation remains available until
# that commit succeeds. The following cron bundles are production-only.
if [ "$TARGET" = beta ]; then
  if ! beta_txn_commit; then
    beta_txn_abort "beta finalization or acceptance transaction failed" || exit 1
  fi
fi

# 10) suite-alerts sidecar bundle: ingest/suite_alerts.ts imports terminal/lib (the real suite
#    modules — zero algorithm duplication), so the 5-min cron consumes an esbuild bundle at
#    ingest/dist/suite_alerts.mjs (untracked → preserved by the step-8 overlay). Bundled here,
#    AFTER steps 8+9, so both ingest/ and $APP/lib are already synced to this deploy's SHA.
#    Non-fatal on purpose: the app is live by now — a bundle failure must not roll it back
#    (the cron just keeps running the previous bundle).
#    Production-only: these three bundles are the inputs of the GLOBAL cron bundles, and the
#    beta profile neither installs nor runs them, so it also must not write their
#    production destinations. beta stops at "the app and the beta overlay are deployed".
if [ "$INSTALLS_GLOBAL_RUNTIME" = 1 ]; then
log "bundling ingest/suite_alerts.ts -> ingest/dist/suite_alerts.mjs"
if ( cd "$APP" && npx esbuild ../ingest/suite_alerts.ts --bundle --platform=node --format=esm \
      --outfile=../ingest/dist/suite_alerts.mjs "--alias:@=." --log-level=warning ); then
  log "installed ingest/dist/suite_alerts.mjs (suite_event alerts cron)"
else
  log "WARN: suite_alerts bundle FAILED — cron keeps the previous bundle"
fi

# Frozen-node source reader bundle only. Packaging does not opt in the Python
# evaluator, install lifecycle SQL, enroll alerts or authorize delivery.
# BEGIN frozen-node source bundle
log "bundling ingest/frozen_node_source_cli.ts -> ingest/dist/frozen_node_source.mjs"
if ( cd "$APP" && npx esbuild ../ingest/frozen_node_source_cli.ts --bundle --platform=node --format=esm \
      --conditions=react-server --outfile=../ingest/dist/frozen_node_source.mjs.new \
      "--alias:@=." --log-level=warning ) && \
    mv -f "$APP/../ingest/dist/frozen_node_source.mjs.new" \
      "$APP/../ingest/dist/frozen_node_source.mjs"; then
  log "installed ingest/dist/frozen_node_source.mjs (reader remains opt-in)"
else
  rm -f "$APP/../ingest/dist/frozen_node_source.mjs.new"
  log "WARN: frozen_node_source bundle FAILED — previous bundle retained"
fi
# END frozen-node source bundle

# personal-accuracy nightly worker: terminal-data invokes the generated artifact after the
# US-equity OHLC refresh. Stage atomically so a failed bundle leaves the prior artifact in
# place; scripts/dist is excluded above because the app-source rsync would otherwise delete
# the known-good untracked artifact before this rebuild.
log "bundling terminal/scripts/score_personal_accuracy_entry.ts -> terminal/scripts/dist/score_personal_accuracy.mjs"
if ( cd "$APP" && npx esbuild scripts/score_personal_accuracy_entry.ts --bundle --platform=node --format=esm \
      --packages=external --outfile=scripts/dist/score_personal_accuracy.mjs.new \
      "--alias:@=." --log-level=warning ); then
  mv -f "$APP/scripts/dist/score_personal_accuracy.mjs.new" \
    "$APP/scripts/dist/score_personal_accuracy.mjs"
  log "installed terminal/scripts/dist/score_personal_accuracy.mjs (personal accuracy nightly)"
else
  rm -f "$APP/scripts/dist/score_personal_accuracy.mjs.new"
  log "WARN: personal_accuracy bundle FAILED — nightly keeps the previous bundle"
fi

# fundamental scan nightly producer (E02): terminal-data runs this bundle to publish
# public/data/scan/fundamental.json from the per-symbol fund.json files, through the SAME
# projector the Screener's company evidence runs (terminal/lib/fundamentalScanProducer.ts).
# Staged atomically like the worker above; a failed bundle keeps the previous one.
log "bundling terminal/scripts/gen_fundamental_scan.ts -> terminal/scripts/dist/gen_fundamental_scan.mjs"
if ( cd "$APP" && npx esbuild scripts/gen_fundamental_scan.ts --bundle --platform=node --format=esm \
      --packages=external --outfile=scripts/dist/gen_fundamental_scan.mjs.new \
      "--alias:@=." --log-level=warning ); then
  mv -f "$APP/scripts/dist/gen_fundamental_scan.mjs.new" \
    "$APP/scripts/dist/gen_fundamental_scan.mjs"
  log "installed terminal/scripts/dist/gen_fundamental_scan.mjs (fundamental scan nightly)"
else
  rm -f "$APP/scripts/dist/gen_fundamental_scan.mjs.new"
  log "WARN: gen_fundamental_scan bundle FAILED — nightly keeps the previous bundle"
fi

else
  log "beta profile: the suite-alerts, personal-accuracy and fundamental-scan cron bundles are NOT built, installed or run"
fi

log "DONE — target=$TARGET live = origin/$BRANCH @ $SHA (app + runtime code, git-gated, healthy)"
