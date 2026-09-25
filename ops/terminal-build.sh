#!/usr/bin/bash -p
# GIT-GATED zero-downtime build for the Mastermind Terminal (Next.js).
#
# ┌────────────────────────────────────────────────────────────────────────────┐
# │ SOURCE OF TRUTH = protected origin/master in mastermind-terminal.           │
# │ The caller MUST name one full commit SHA already contained by the freshly   │
# │ fetched protected ref. A W2A source receipt for the CURRENT generation must │
# │ be CLEAN before fetch/reset/clean/build. A moving branch is never a target.  │
# │ Working-tree edits and direct rsync/scp are never deployment authority.      │
# └────────────────────────────────────────────────────────────────────────────┘
#
# USAGE: /opt/terminal/terminal-build.sh --target-sha <full-lowercase-40-hex>
#
# AUTHORING SOURCE: ops/terminal-build.sh in the repo. The deployed copy at
# /opt/terminal/terminal-build.sh is installed from master by step 8 of every
# deploy (effective the NEXT run) — edit via PR, never in place on the box.
#
# One deploy ships TWO kinds of code from the same origin/master SHA (see DEPLOY.md):
#   1. the Next.js app: terminal/ -> staged build -> atomic .next swap
#   2. runtime code consumed by cron + systemd OUTSIDE the app:
#        ingest/ scripts/ config/ contracts/ hub/ signal_layer/
#                                                 (overlay, tracked files only)
#        ops/terminal-data     -> /usr/local/bin/terminal-data     (nightly cron)
#        ops/terminal-build.sh -> /opt/terminal/terminal-build.sh  (next deploy)
#      signal_layer/ synced since the 2026-07-10 reconciliation (box GC-v2 engine
#      committed, incl. confluence_v2.py) — master is canonical. See DEPLOY.md.
#
# Zero-downtime: builds into a staging tree, atomic-swaps `.next` only after the
# build verifies (BUILD_ID present); the live server keeps serving until the swap.
# Auto-rolls-back to the previous build if the new one fails its health check.
# W2B-A supplies the fail-closed source/target entrance gate. W2B-B then makes
# the pre-live Terminal build an isolated exact-runtime operation: fresh npm ci,
# closed public env/key inputs, immutable build receipt, serving-output digest,
# and same-input reproducibility fence before canonical/live-generation mutation.
# The live swap/rollback/runtime-overlay tail is still the inherited owner and is
# NOT independently production-adopted by W2B-B; W2B-C owns that transaction proof.
set -euo pipefail
# Both launcher passes use privileged-mode Bash so BASH_ENV/SHELLOPTS/imported
# functions cannot run before the first command. The initial pass is deliberately
# unprivileged and may only cross the reviewed sudo + env -i boundary below; the
# explicit scrub keeps every later child free of ambient language/process policy.
unset BASH_ENV ENV CDPATH GLOBIGNORE \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG LD_PROFILE GCONV_PATH LOCPATH \
  PYTHONPATH PYTHONHOME PYTHONINSPECT PYTHONSTARTUP \
  NODE_OPTIONS NODE_PATH \
  NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG npm_config_userconfig npm_config_globalconfig \
  PERL5OPT RUBYOPT 2>/dev/null || true
for inherited_function in env git python3 node npm npx flock systemd-run; do
  unset -f "$inherited_function" 2>/dev/null || true
done
export PATH="/usr/bin:/bin"

APP=/opt/terminal/terminal
SRC=/opt/terminal/.gitsrc            # canonical git checkout (read-only deploy key: github-mmterminal)
TSRC="$SRC/terminal"
BRANCH=master
AUTHORING_OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PREFLIGHT_RECEIPT_DIR=/var/lib/mastermind-terminal/release-preflight
BUILD_RECEIPT_DIR=/var/lib/mastermind-terminal/build-receipts
BUILD_WORK_ROOT_BASE=/opt/terminal/.build-work
BUILD_EVIDENCE_ROOT_BASE=/var/lib/mastermind-terminal/build-evidence
BUILD_PROJECTION_HELPER="$AUTHORING_OPS_DIR/terminal_build_projection.py"
BUILD_PROJECTION_POLICY="$AUTHORING_OPS_DIR/terminal_build_projection.json"
BUILD_LOCK_DIR=/run/mastermind-terminal
BUILD_LOCK_FILE="$BUILD_LOCK_DIR/deploy.lock"
EXPECTED_LOCK_UID=0
EXPECTED_LOCK_GID=0
EXPECTED_CONTROLLER_UID=0
EXPECTED_CONTROLLER_GID=0
EXPECTED_NODE_PATH="/usr/bin/node"
EXPECTED_NPM_PATH="/usr/bin/npm"
EXPECTED_NODE_VERSION="v20.20.2"
EXPECTED_NPM_VERSION="10.8.2"
EXPECTED_BUILD_OS="Linux"
EXPECTED_BUILD_ARCH="x86_64"
EXPECTED_OS_RELEASE_FILE="/usr/lib/os-release"
EXPECTED_OS_RELEASE_ALIAS="/etc/os-release"
EXPECTED_OS_ID="ubuntu"
EXPECTED_OS_VERSION_ID="24.04"
EXPECTED_GETCONF_PATH="/usr/bin/getconf"
EXPECTED_UNAME_PATH="/usr/bin/uname"
EXPECTED_FLOCK_PATH="/usr/bin/flock"
EXPECTED_SYSTEMD_RUN_PATH="/usr/bin/systemd-run"
EXPECTED_GIT_PATH="/usr/bin/git"
EXPECTED_PYTHON_PATH="/usr/bin/python3"
EXPECTED_PYTHON_REAL_PATH="/usr/bin/python3.12"
EXPECTED_ENV_PATH="/usr/bin/env"
EXPECTED_SUDO_PATH="/usr/bin/sudo"
EXPECTED_BASH_PATH="/usr/bin/bash"
EXPECTED_CONTROLLER_PATH="/opt/terminal/terminal-build.sh"
EXPECTED_TAR_PATH="/usr/bin/tar"
EXPECTED_SYSTEMCTL_PATH="/usr/bin/systemctl"
EXPECTED_CURL_PATH="/usr/bin/curl"
EXPECTED_RSYNC_PATH="/usr/bin/rsync"
EXPECTED_SHA256SUM_PATH="/usr/bin/sha256sum"
EXPECTED_NPX_PATH="/usr/bin/npx"
EXPECTED_BUILD_USER="mastermind-terminal-build"
EXPECTED_BUILD_GROUP="mastermind-terminal-build"
EXPECTED_BUILD_UID=980
EXPECTED_BUILD_GID=980
EXPECTED_BUILD_HOME="/nonexistent"
EXPECTED_BUILD_SHELL="/usr/sbin/nologin"
EXPECTED_LIBC="glibc 2.39"
CLEAN_BUILD_PATH="/usr/bin:/bin"
BUILD_NODE_VERSION=
BUILD_NPM_VERSION=
BUILD_OS=
BUILD_ARCH=
BUILD_OS_ID=
BUILD_OS_VERSION_ID=
BUILD_LIBC=
BUILD_PUBLIC_ENV_IDENTITY=
BUILD_KEY_IDENTITY=
BUILD_SANDBOX_IDENTITY=
BUILD_RECEIPT_PATH=
BUILD_RECEIPT_ID=
BUILD_INPUT_FINGERPRINT=
BUILD_SERVING_DIGEST=
BUILD_TARGET_ROOT=
BUILD_SOURCE_ROOT=
BUILD_DEPS_ROOT=
BUILD_HOME_DIR=
BUILD_NPM_CACHE=
BUILD_TMP_DIR=
BUILD_EVIDENCE_DIR=
BUILD_PROJECTION_MANIFEST=
BUILD_PROJECTION_DIGEST=
TARGET_TREE=
PREFLIGHT_SCRIPT=
PREFLIGHT_POLICY=
PREFLIGHT_RUNTIME_DIR=
PREFLIGHT_SCRIPT_SHA256=
PREFLIGHT_POLICY_DIGEST=
PREFLIGHT_RUNTIME_SHA256=
PREFLIGHT_ACCEPTED_SHA=
PREFLIGHT_RECEIPT_PATH=
PREFLIGHT_RECEIPT_ID=
PREFLIGHT_SOURCE_RECEIPT_ID=
ACCEPTED_REF_BEFORE=
ACCEPTED_REF_SHA=
log(){ echo "[build] $*"; }

# The deploy owner never accepts inherited Git routing or policy. `"$EXPECTED_GIT_PATH" -C`
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

# First adoption executes the exact protected ops/ artifact from a temporary
# directory. Later releases use the currently deployed canonical checkout. The
# script and policy always come from one complete, real, non-symlink directory;
# an incomplete first candidate never mixes with a second candidate.
select_preflight_artifacts(){
  local expected_uid=${1:-} directory script policy runtime resolved evidence
  if ! [[ "$expected_uid" =~ ^[0-9]+$ ]]; then
    log "FATAL: preflight bundle expected UID must be numeric"
    return 64
  fi
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
    policy="$directory/terminal_source_audit.production.json"
    runtime="$directory/terminal_audit"
    [ -f "$script" ] && [ ! -L "$script" ] || continue
    [ -f "$policy" ] && [ ! -L "$policy" ] || continue
    [ -d "$runtime" ] && [ ! -L "$runtime" ] || continue
    if ! evidence=$("$EXPECTED_PYTHON_PATH" -I - "$directory" "$expected_uid" <<'PY_BUNDLE'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
expected_uid = int(sys.argv[2])
script = root / "terminal_release_preflight.py"
policy = root / "terminal_source_audit.production.json"
runtime = root / "terminal_audit"


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
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
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
    for dirname in dirnames:
        if dirname == "__pycache__":
            raise ValueError("preflight runtime must not contain __pycache__")
        trusted_stat(current_path / dirname, "directory")
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
    PREFLIGHT_POLICY="$resolved/terminal_source_audit.production.json"
    PREFLIGHT_RUNTIME_DIR="$resolved/terminal_audit"
    return 0
  done
  log "FATAL: no complete trusted Terminal release-preflight artifact bundle is available"
  return 66
}

# Receipt publication is the only write admitted before source mutation. Never
# chmod/chown unexplained existing state into compliance: inspect first, create
# only missing directories, then inspect again. The W2A command performs its own
# resolved-path and immutable-publication checks too.
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
  local script=$1 policy=$2 canonical_repo=$3 receipt_dir=$4
  local temporary stdout_file stderr_file before_manifest rc parsed expected_policy_digest
  temporary=$(mktemp -d /tmp/terminal-build-preflight.XXXXXX) || return $?
  stdout_file="$temporary/stdout.json"
  stderr_file="$temporary/stderr.log"
  before_manifest="$temporary/before.json"

  if ! expected_policy_digest=$("$EXPECTED_PYTHON_PATH" -I - "$policy" <<'PY_POLICY_DIGEST'
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

  if ! "$EXPECTED_PYTHON_PATH" -I - "$receipt_dir" "$before_manifest" <<'PY_RECEIPT_BEFORE'
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
    PYTHONDONTWRITEBYTECODE=1 "$EXPECTED_PYTHON_PATH" -B -E -s "$script" \
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
    if [ -s "$stdout_file" ]; then cat "$stdout_file" >&2; fi
    rm -rf "$temporary"
    return "$rc"
  fi

  if ! parsed=$("$EXPECTED_PYTHON_PATH" -I - "$stdout_file" "$receipt_dir" "$before_manifest" \
    "$expected_policy_digest" <<'PY_RECEIPT'
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
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
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
if summary["result"] != "CLEAN":
    raise SystemExit("release-preflight summary is not CLEAN")
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
if outer.get("result") != "CLEAN":
    raise SystemExit("release-preflight receipt result is not CLEAN")
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
if inner.get("status") != "CLEAN":
    raise SystemExit("source-audit receipt is not CLEAN")
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
if inner.get("findings") != []:
    raise SystemExit("CLEAN source-audit receipt contains findings")
inner_summary = inner.get("summary")
if not isinstance(inner_summary, dict) or inner_summary.get("blocking_findings") != 0:
    raise SystemExit("CLEAN source-audit receipt has blocking findings")

print(
    "\t".join(
        (
            summary["accepted_sha"],
            str(receipt),
            outer["receipt_id"],
            inner["receipt_id"],
            expected_policy_digest,
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
    <<< "$parsed"
  rm -rf "$temporary"
  log "source preflight CLEAN: accepted=$PREFLIGHT_ACCEPTED_SHA receipt=$PREFLIGHT_RECEIPT_PATH policy_digest=$PREFLIGHT_POLICY_DIGEST"
}

refuse_git_replace_refs(){
  local repository=$1 replacement_refs
  replacement_refs=$("$EXPECTED_GIT_PATH" -C "$repository" for-each-ref --format='%(refname)' refs/replace/) \
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
  ACCEPTED_REF_BEFORE=$("$EXPECTED_GIT_PATH" -C "$repository" rev-parse --verify \
    "${accepted_ref}^{commit}" 2>/dev/null || printf '<absent>')
  "$EXPECTED_GIT_PATH" -C "$repository" fetch -q --no-tags "$remote" \
    "+refs/heads/$branch:$accepted_ref" || return $?
  refuse_git_replace_refs "$repository" || return $?
  observed=$("$EXPECTED_GIT_PATH" -C "$repository" rev-parse --verify \
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
admit_target_sha(){
  local repository=$1 target_sha=$2 accepted_sha=$3 resolved accepted_resolved
  sanitize_git_environment
  refuse_git_replace_refs "$repository" || return $?
  validate_target_sha "$target_sha" || return $?
  if ! [[ "$accepted_sha" =~ ^[0-9a-f]{40}$ ]]; then
    log "FATAL: captured accepted-ref observation is not one full lower-case commit"
    return 65
  fi
  if ! resolved=$("$EXPECTED_GIT_PATH" -C "$repository" rev-parse --verify "${target_sha}^{commit}" 2>/dev/null); then
    log "FATAL: requested target commit is unavailable after accepted-ref fetch: $target_sha"
    return 65
  fi
  if [ "$resolved" != "$target_sha" ]; then
    log "FATAL: requested target did not resolve to the exact full commit: $target_sha"
    return 65
  fi
  if ! accepted_resolved=$("$EXPECTED_GIT_PATH" -C "$repository" rev-parse --verify "${accepted_sha}^{commit}" 2>/dev/null); then
    log "FATAL: captured accepted-ref commit is unavailable after fetch: $accepted_sha"
    return 65
  fi
  if [ "$accepted_resolved" != "$accepted_sha" ]; then
    log "FATAL: captured accepted-ref observation did not resolve exactly: $accepted_sha"
    return 65
  fi
  if ! "$EXPECTED_GIT_PATH" -C "$repository" merge-base --is-ancestor "$target_sha" "$accepted_sha"; then
    log "FATAL: requested target is not contained by captured accepted-ref observation: target=$target_sha accepted=$accepted_sha"
    return 65
  fi
}
# W2B-B keeps serialization inside the one deploy owner.  The lock file is only
# a kernel mutex rendezvous; it carries no lifecycle or release state.
verify_lock_metadata(){
  local path=$1 kind=$2 mode=$3
  "$EXPECTED_PYTHON_PATH" -I - "$path" "$kind" "$mode" "$EXPECTED_LOCK_UID" "$EXPECTED_LOCK_GID" <<'PY_LOCK_META'
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
kind = sys.argv[2]
expected_mode = int(sys.argv[3], 8)
expected_uid = int(sys.argv[4])
expected_gid = int(sys.argv[5])
metadata = os.lstat(path)
if stat.S_ISLNK(metadata.st_mode):
    raise SystemExit(f"lock path must not be a symlink: {path}")
if kind == "directory" and not stat.S_ISDIR(metadata.st_mode):
    raise SystemExit(f"lock parent is not a directory: {path}")
if kind == "file" and not stat.S_ISREG(metadata.st_mode):
    raise SystemExit(f"lock path is not a regular file: {path}")
if stat.S_IMODE(metadata.st_mode) != expected_mode:
    raise SystemExit(f"lock path mode mismatch: {path}")
if metadata.st_uid != expected_uid or metadata.st_gid != expected_gid:
    raise SystemExit(f"lock path owner/group mismatch: {path}")
PY_LOCK_META
}

prepare_deploy_lock_dir(){
  if [ -e "$BUILD_LOCK_DIR" ] || [ -L "$BUILD_LOCK_DIR" ]; then
    verify_lock_metadata "$BUILD_LOCK_DIR" directory 0755 || {
      log "FATAL: deploy lock parent is untrusted: $BUILD_LOCK_DIR"
      return 73
    }
  else
    mkdir -m 0755 "$BUILD_LOCK_DIR" || {
      log "FATAL: cannot create deploy lock parent: $BUILD_LOCK_DIR"
      return 73
    }
    verify_lock_metadata "$BUILD_LOCK_DIR" directory 0755 || return 73
  fi
}

acquire_deploy_lock(){
  local old_umask
  prepare_deploy_lock_dir || return $?
  if [ -e "$BUILD_LOCK_FILE" ] || [ -L "$BUILD_LOCK_FILE" ]; then
    verify_lock_metadata "$BUILD_LOCK_FILE" file 0600 || {
      log "FATAL: deploy lock file is untrusted: $BUILD_LOCK_FILE"
      return 73
    }
  fi
  old_umask=$(umask)
  umask 077
  if ! exec 9>"$BUILD_LOCK_FILE"; then
    umask "$old_umask"
    log "FATAL: cannot open deploy lock: $BUILD_LOCK_FILE"
    return 73
  fi
  umask "$old_umask"
  verify_lock_metadata "$BUILD_LOCK_FILE" file 0600 || {
    log "FATAL: deploy lock file changed during open: $BUILD_LOCK_FILE"
    return 73
  }
  if ! "$EXPECTED_FLOCK_PATH" -n 9; then
    log "FATAL: another Terminal deploy owner already holds $BUILD_LOCK_FILE"
    return 75
  fi
}

verify_runtime_executable(){
  local runtime_path=$1 expected_link=${2:--} expected_resolved=${3:-$1}
  [ -x "$EXPECTED_PYTHON_REAL_PATH" ] && [ -f "$EXPECTED_PYTHON_REAL_PATH" ] && [ ! -L "$EXPECTED_PYTHON_REAL_PATH" ] || {
    log "FATAL: canonical Python validator is unavailable: $EXPECTED_PYTHON_REAL_PATH"
    return 69
  }
  "$EXPECTED_PYTHON_REAL_PATH" -I - "$runtime_path" "$expected_link" "$expected_resolved" <<'PY_RUNTIME_PATH'
import os
import stat
import sys
from pathlib import Path

requested = Path(sys.argv[1])
expected_link = None if sys.argv[2] == "-" else sys.argv[2]
expected_resolved = Path(sys.argv[3])
metadata = os.lstat(requested)
if expected_link is None:
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise SystemExit("runtime executable must be one real regular file")
    resolved = requested.resolve(strict=True)
    if resolved != expected_resolved or resolved != requested:
        raise SystemExit("runtime executable resolved path is not canonical")
else:
    if not stat.S_ISLNK(metadata.st_mode) or os.readlink(requested) != expected_link:
        raise SystemExit("runtime executable alias is not the reviewed package alias")
    if metadata.st_uid != 0 or metadata.st_gid != 0:
        raise SystemExit("runtime executable alias custody is invalid")
    resolved = requested.resolve(strict=True)
    if resolved != expected_resolved:
        raise SystemExit("runtime executable alias resolves to an unexpected target")

target = os.lstat(resolved)
if not stat.S_ISREG(target.st_mode):
    raise SystemExit("runtime executable target is not a regular file")
if target.st_uid != 0 or target.st_gid != 0:
    raise SystemExit("runtime executable target custody is invalid")
if target.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
    raise SystemExit("runtime executable target is group/other writable")
if not target.st_mode & stat.S_IXUSR:
    raise SystemExit("runtime executable target is not executable")

parent = resolved.parent
while True:
    parent_meta = os.lstat(parent)
    if stat.S_ISLNK(parent_meta.st_mode) or not stat.S_ISDIR(parent_meta.st_mode):
        raise SystemExit("runtime executable parent is aliased or not a directory")
    if parent_meta.st_uid != 0 or parent_meta.st_gid != 0:
        raise SystemExit("runtime executable parent custody is invalid")
    if parent_meta.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise SystemExit("runtime executable parent is group/other writable")
    if parent == parent.parent:
        break
    parent = parent.parent
PY_RUNTIME_PATH
}

verify_build_runtime(){
  local runtime_env os_values
  verify_runtime_executable "$EXPECTED_NODE_PATH" || return 69
  verify_runtime_executable "$EXPECTED_NPM_PATH" "../lib/node_modules/npm/bin/npm-cli.js" "/usr/lib/node_modules/npm/bin/npm-cli.js" || return 69
  verify_runtime_executable "$EXPECTED_NPX_PATH" "../lib/node_modules/npm/bin/npx-cli.js" "/usr/lib/node_modules/npm/bin/npx-cli.js" || return 69
  verify_runtime_executable "$EXPECTED_PYTHON_REAL_PATH" || return 69
  verify_runtime_executable "$EXPECTED_PYTHON_PATH" "python3.12" "$EXPECTED_PYTHON_REAL_PATH" || return 69
  for runtime_path in     "$EXPECTED_GETCONF_PATH" "$EXPECTED_UNAME_PATH" "$EXPECTED_FLOCK_PATH"     "$EXPECTED_SYSTEMD_RUN_PATH" "$EXPECTED_GIT_PATH" "$EXPECTED_ENV_PATH"     "$EXPECTED_TAR_PATH" "$EXPECTED_SYSTEMCTL_PATH" "$EXPECTED_CURL_PATH"     "$EXPECTED_RSYNC_PATH" "$EXPECTED_SHA256SUM_PATH"; do
    verify_runtime_executable "$runtime_path" || return 69
  done
  [ -f "$EXPECTED_OS_RELEASE_FILE" ] && [ ! -L "$EXPECTED_OS_RELEASE_FILE" ] || {
    log "FATAL: build OS release identity is unavailable or aliased: $EXPECTED_OS_RELEASE_FILE"
    return 69
  }
  runtime_env=("$EXPECTED_ENV_PATH" -i PATH="$CLEAN_BUILD_PATH" HOME=/nonexistent LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC)
  BUILD_NODE_VERSION=$("${runtime_env[@]}" "$EXPECTED_NODE_PATH" --version 2>/dev/null) || return 69
  BUILD_NPM_VERSION=$("${runtime_env[@]}" "$EXPECTED_NPM_PATH" --version 2>/dev/null) || return 69
  BUILD_OS=$("${runtime_env[@]}" "$EXPECTED_UNAME_PATH" -s 2>/dev/null) || return 69
  BUILD_ARCH=$("${runtime_env[@]}" "$EXPECTED_UNAME_PATH" -m 2>/dev/null) || return 69
  if ! os_values=$("${runtime_env[@]}" "$EXPECTED_PYTHON_PATH" -I - \
      "$EXPECTED_OS_RELEASE_FILE" "$EXPECTED_OS_RELEASE_ALIAS" <<'PY_OS_RELEASE'
import os
import re
import stat
import sys
from pathlib import Path
path = Path(sys.argv[1])
alias = Path(sys.argv[2])
expected = os.lstat(path)
if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
    raise SystemExit("os-release must be a real regular file")
if expected.st_uid != 0 or expected.st_gid != 0 or expected.st_mode & 0o022:
    raise SystemExit("os-release custody is invalid")
alias_metadata = os.lstat(alias)
if not stat.S_ISLNK(alias_metadata.st_mode) or os.readlink(alias) != "../usr/lib/os-release":
    raise SystemExit("canonical /etc/os-release alias is invalid")
if alias.resolve(strict=True) != path.resolve(strict=True):
    raise SystemExit("canonical /etc/os-release alias resolves to a different file")
flags = (
    os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
)
fd = os.open(path, flags)
try:
    before = os.fstat(fd)
    payload = os.read(fd, 65537)
    after = os.fstat(fd)
finally:
    os.close(fd)
identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid, item.st_size, item.st_mtime_ns)
if len(payload) > 65536 or identity(before) != identity(after):
    raise SystemExit("os-release changed or exceeded its bound")
values = {}
for raw in payload.decode("utf-8").splitlines():
    if not raw or raw.startswith("#") or "=" not in raw:
        continue
    key, value = raw.split("=", 1)
    if key not in {"ID", "VERSION_ID"}:
        continue
    value = value.strip().strip('"')
    if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
        raise SystemExit("os-release identity value is invalid")
    values[key] = value
if set(values) != {"ID", "VERSION_ID"}:
    raise SystemExit("os-release identity is incomplete")
print(values["ID"] + "	" + values["VERSION_ID"])
PY_OS_RELEASE
  ); then
    log "FATAL: build OS release identity could not be read safely"
    return 69
  fi
  IFS=$'	' read -r BUILD_OS_ID BUILD_OS_VERSION_ID <<< "$os_values"
  BUILD_LIBC=$("${runtime_env[@]}" "$EXPECTED_GETCONF_PATH" GNU_LIBC_VERSION 2>/dev/null) || return 69
  if [ "$BUILD_NODE_VERSION" != "$EXPECTED_NODE_VERSION" ]     || [ "$BUILD_NPM_VERSION" != "$EXPECTED_NPM_VERSION" ]     || [ "$BUILD_OS" != "$EXPECTED_BUILD_OS" ]     || [ "$BUILD_ARCH" != "$EXPECTED_BUILD_ARCH" ]     || [ "$BUILD_OS_ID" != "$EXPECTED_OS_ID" ]     || [ "$BUILD_OS_VERSION_ID" != "$EXPECTED_OS_VERSION_ID" ]     || [ "$BUILD_LIBC" != "$EXPECTED_LIBC" ]; then
    log "FATAL: build runtime mismatch: node=$BUILD_NODE_VERSION npm=$BUILD_NPM_VERSION os=$BUILD_OS arch=$BUILD_ARCH distro=$BUILD_OS_ID/$BUILD_OS_VERSION_ID libc=$BUILD_LIBC"
    log "       required: node=$EXPECTED_NODE_VERSION npm=$EXPECTED_NPM_VERSION os=$EXPECTED_BUILD_OS arch=$EXPECTED_BUILD_ARCH distro=$EXPECTED_OS_ID/$EXPECTED_OS_VERSION_ID libc=$EXPECTED_LIBC"
    return 69
  fi
}

prepare_build_receipt_dir(){
  prepare_preflight_receipt_dir "$BUILD_RECEIPT_DIR"
}

# Read ONLY a closed public-build vocabulary from the live env files.  Runtime
# secrets never enter the build process.  The identity artifact contains names,
# presence and value digests only; raw public values live only in the private
# staging .env.production.local consumed by Next.
prepare_public_build_env(){
  local live_app=$1 stage=$2 identity=$3
  if ! "$EXPECTED_PYTHON_PATH" -I - "$live_app" "$stage/.env.production.local" "$identity" <<'PY_PUBLIC_ENV'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

live = Path(sys.argv[1])
out = Path(sys.argv[2])
identity = Path(sys.argv[3])
allowed = (
    "NEXT_PUBLIC_LOGO_DEV_TOKEN",
    "NEXT_PUBLIC_MM_AUTH_COOKIE_DOMAIN",
    "NEXT_PUBLIC_POLYGON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
)
allowed_set = set(allowed)
values = {}
key_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
safe_value = re.compile(r"^[A-Za-z0-9._~:/?@%+=,;\-]*$")

def parse_value(raw: str, source: Path, line_no: int) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            raise ValueError(f"unterminated quoted public env value at {source}:{line_no}")
        value = value[1:-1]
    elif value.startswith('"'):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"unsupported quoted public env value at {source}:{line_no}") from exc
        if not isinstance(decoded, str):
            raise ValueError(f"public env value must be a string at {source}:{line_no}")
        value = decoded
    if "\n" in value or "\r" in value or "\x00" in value or not safe_value.fullmatch(value):
        raise ValueError(f"public env value uses unsupported syntax at {source}:{line_no}")
    return value

for name in (".env", ".env.local"):
    source = live / name
    if not os.path.lexists(source):
        continue
    expected = os.lstat(source)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
        raise ValueError(f"live env source must be a real file: {source}")
    if expected.st_size > 1024 * 1024:
        raise ValueError(f"live env source exceeds size bound: {source}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(source, flags)
    try:
        before = os.fstat(fd)
        payload = os.read(fd, 1024 * 1024 + 1)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    identity_tuple = lambda item: (
        item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
        item.st_size, item.st_mtime_ns,
    )
    if len(payload) > 1024 * 1024 or identity_tuple(expected) != identity_tuple(before) or identity_tuple(before) != identity_tuple(after):
        raise ValueError(f"live env source changed while read: {source}")
    try:
        source_text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"live env source must be UTF-8: {source}") from exc
    for line_no, raw in enumerate(source_text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key_re.fullmatch(key) or not key.startswith("NEXT_PUBLIC_"):
            continue
        if key not in allowed_set:
            raise ValueError(f"undeclared NEXT_PUBLIC build input: {key}")
        values[key] = parse_value(raw_value, source, line_no)

if out.exists() or out.is_symlink():
    raise ValueError(f"isolated build env path already exists: {out}")
lines = []
entries = []
for key in allowed:
    value = values.get(key)
    if value is None:
        entries.append({"name": key, "present": False, "bytes": 0, "sha256": None})
        continue
    payload = value.encode("utf-8")
    lines.append(f"{key}={value}")
    entries.append({
        "name": key,
        "present": True,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    })
out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
os.chmod(out, 0o600)
identity.write_text(json.dumps({
    "schema": "mastermind.terminal.public_build_env_identity.v1",
    "entries": entries,
}, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
os.chmod(identity, 0o600)
PY_PUBLIC_ENV
  then
    log "FATAL: could not derive the closed public build environment"
    return 64
  fi
  BUILD_PUBLIC_ENV_IDENTITY=$identity
}

# Reuse Next's incumbent cache pair when it is structurally valid and has at
# least one hour of lifetime.  Otherwise rotate the SAME cache formats once in
# the isolated stage.  These bytes become explicit secret build inputs and later
# move with .next; there is no second secret database/store.
prepare_next_build_keys(){
  local live_app=$1 stage=$2 identity=$3
  if ! "$EXPECTED_PYTHON_PATH" -I - "$live_app/.next/cache" "$stage/.next/cache" "$identity" <<'PY_BUILD_KEYS'
import base64
import hashlib
import json
import os
import re
import secrets
import stat
import sys
import time
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
identity = Path(sys.argv[3])
min_expire = int(time.time() * 1000) + 60 * 60 * 1000
rotation_expire = int(time.time() * 1000) + 14 * 24 * 60 * 60 * 1000
hex32 = re.compile(r"^[0-9a-f]{32}$")
hex64 = re.compile(r"^[0-9a-f]{64}$")

def metadata_identity(item):
    return (
        item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
        item.st_size, item.st_mtime_ns,
    )


def open_real_directory(path: Path):
    expected = os.lstat(path)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISDIR(expected.st_mode):
        raise ValueError("cache source directory is not a real directory")
    if expected.st_uid != os.geteuid() or expected.st_gid != os.getegid():
        raise ValueError("untrusted cache source directory owner/group")
    if expected.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("untrusted cache source directory metadata")
    flags = (
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    fd = os.open(path, flags)
    actual = os.fstat(fd)
    if metadata_identity(actual) != metadata_identity(expected):
        os.close(fd)
        raise ValueError("cache source directory changed before open")
    return fd, actual


def open_child_directory(parent_fd: int, name: str):
    expected = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISDIR(expected.st_mode):
        raise ValueError("cache source directory is symlinked or not a directory")
    if expected.st_uid != os.geteuid() or expected.st_gid != os.getegid():
        raise ValueError("untrusted cache source directory owner/group")
    if expected.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("untrusted cache source directory metadata")
    flags = (
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    fd = os.open(name, flags, dir_fd=parent_fd)
    actual = os.fstat(fd)
    if metadata_identity(actual) != metadata_identity(expected):
        os.close(fd)
        raise ValueError("cache source directory changed before open")
    return fd, actual


def child_exists(directory_fd: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def read_real_at(source_fd: int, name: str):
    expected = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
        raise ValueError("not a real cache file")
    if expected.st_uid != os.geteuid() or expected.st_gid != os.getegid():
        raise ValueError("untrusted cache file owner/group")
    if expected.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or expected.st_size > 4096:
        raise ValueError("untrusted cache file metadata")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(name, flags, dir_fd=source_fd)
    try:
        before = os.fstat(fd)
        if metadata_identity(before) != metadata_identity(expected):
            raise ValueError("cache file changed before open")
        payload = os.read(fd, 4097)
        if len(payload) > 4096:
            raise ValueError("cache file exceeds size bound")
        after = os.fstat(fd)
        if metadata_identity(before) != metadata_identity(after):
            raise ValueError("cache file changed while read")
        return payload
    finally:
        os.close(fd)

def decode_pair(preview_bytes: bytes, rsc_bytes: bytes):
    preview = json.loads(preview_bytes.decode("utf-8"))
    rsc = json.loads(rsc_bytes.decode("utf-8"))
    if set(preview) != {"previewModeId", "previewModeSigningKey", "previewModeEncryptionKey", "expireAt"}:
        raise ValueError("preview cache schema")
    if not hex32.fullmatch(preview["previewModeId"]): raise ValueError("preview id")
    if not hex64.fullmatch(preview["previewModeSigningKey"]): raise ValueError("preview signing key")
    if not hex64.fullmatch(preview["previewModeEncryptionKey"]): raise ValueError("preview encryption key")
    if not isinstance(preview["expireAt"], int) or preview["expireAt"] <= 0: raise ValueError("preview expiry")
    if set(rsc) != {"encryption.key", "encryption.expire_at"}: raise ValueError("rsc cache schema")
    raw = base64.b64decode(rsc["encryption.key"], validate=True)
    if len(raw) != 32: raise ValueError("rsc key")
    if not isinstance(rsc["encryption.expire_at"], int) or rsc["encryption.expire_at"] <= 0: raise ValueError("rsc expiry")
    return preview, rsc

next_root = source.parent
next_fd = None
source_fd = None
next_before = None
source_before = None
preview_present = False
rsc_present = False
try:
    if os.path.lexists(next_root):
        next_fd, next_before = open_real_directory(next_root)
        if child_exists(next_fd, source.name):
            source_fd, source_before = open_child_directory(next_fd, source.name)
            preview_present = child_exists(source_fd, ".previewinfo")
            rsc_present = child_exists(source_fd, ".rscinfo")
    if preview_present != rsc_present:
        raise ValueError("Next build-key cache pair is partial; refusing normalization")

    mode = "retained"
    rotate = not preview_present
    if preview_present:
        assert source_fd is not None
        preview_bytes = read_real_at(source_fd, ".previewinfo")
        rsc_bytes = read_real_at(source_fd, ".rscinfo")
        preview, rsc = decode_pair(preview_bytes, rsc_bytes)
        rotate = preview["expireAt"] < min_expire or rsc["encryption.expire_at"] < min_expire
    if source_fd is not None and metadata_identity(os.fstat(source_fd)) != metadata_identity(source_before):
        raise ValueError("source directory changed while read")
    if next_fd is not None and metadata_identity(os.fstat(next_fd)) != metadata_identity(next_before):
        raise ValueError("source directory changed while read")
finally:
    if source_fd is not None:
        os.close(source_fd)
    if next_fd is not None:
        os.close(next_fd)

if rotate:
    mode = "rotated"
    preview = {
        "previewModeId": secrets.token_hex(16),
        "previewModeSigningKey": secrets.token_hex(32),
        "previewModeEncryptionKey": secrets.token_hex(32),
        "expireAt": rotation_expire,
    }
    rsc = {
        "encryption.key": base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
        "encryption.expire_at": rotation_expire,
    }
    preview_bytes = json.dumps(preview, separators=(",", ":")).encode("utf-8")
    rsc_bytes = json.dumps(rsc, separators=(",", ":")).encode("utf-8")
    decode_pair(preview_bytes, rsc_bytes)

target.mkdir(parents=True, exist_ok=True)
os.chmod(target, 0o700)
files = {}
for name, payload, expire in (
    (".previewinfo", preview_bytes, preview["expireAt"]),
    (".rscinfo", rsc_bytes, rsc["encryption.expire_at"]),
):
    path = target / name
    path.write_bytes(payload)
    os.chmod(path, 0o600)
    files[name] = {"sha256": hashlib.sha256(payload).hexdigest(), "expire_at": expire}
identity.write_text(json.dumps({
    "schema": "mastermind.terminal.next_build_key_identity.v1",
    "source": mode,
    "files": files,
}, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
os.chmod(identity, 0o600)
PY_BUILD_KEYS
  then
    log "FATAL: could not prepare explicit Next build-key inputs"
    return 64
  fi
  BUILD_KEY_IDENTITY=$identity
}



verify_build_principal(){
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$EXPECTED_BUILD_USER" "$EXPECTED_BUILD_GROUP" \
      "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" \
      "$EXPECTED_BUILD_HOME" "$EXPECTED_BUILD_SHELL" <<'PY_BUILD_PRINCIPAL'
import grp
import os
import pwd
import sys
user_name, group_name, uid_raw, gid_raw, expected_home, expected_shell = sys.argv[1:]
uid = int(uid_raw)
gid = int(gid_raw)
try:
    user = pwd.getpwnam(user_name)
    group = grp.getgrnam(group_name)
except KeyError as exc:
    raise SystemExit(f"build principal is absent: {exc}") from exc
if (user.pw_uid, user.pw_gid, group.gr_gid) != (uid, gid, gid):
    raise SystemExit("build principal UID/GID mismatch")
if user.pw_dir != expected_home or user.pw_shell != expected_shell:
    raise SystemExit("build principal home/shell mismatch")
groups = os.getgrouplist(user_name, gid)
if set(groups) != {gid}:
    raise SystemExit("build principal must not carry supplementary groups")
if group.gr_mem:
    raise SystemExit("build principal group must not carry supplementary members")
PY_BUILD_PRINCIPAL
  then
    log "FATAL: static build principal is absent or differs from the reviewed contract"
    return 77
  fi
}

prepare_build_roots(){
  local prepared
  if ! prepared=$("$EXPECTED_PYTHON_PATH" -I - \
      "$BUILD_WORK_ROOT_BASE" "$BUILD_EVIDENCE_ROOT_BASE" "$TARGET_TREE" \
      "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" <<'PY_BUILD_ROOTS'
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

work_base = Path(sys.argv[1])
evidence_base = Path(sys.argv[2])
target_tree = sys.argv[3]
build_uid = int(sys.argv[4])
build_gid = int(sys.argv[5])
if len(target_tree) != 40 or any(char not in "0123456789abcdef" for char in target_tree):
    raise SystemExit("target tree is invalid")

def ensure_base(path: Path, mode: int) -> Path:
    if os.path.lexists(path):
        metadata = os.lstat(path)
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise SystemExit(f"build base is not a real directory: {path}")
    else:
        path.mkdir(parents=True, mode=mode)
    metadata = os.lstat(path)
    if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
        raise SystemExit(f"build base owner/group differs from controller: {path}")
    if metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise SystemExit(f"build base is group/other writable: {path}")
    os.chmod(path, mode)
    resolved = path.resolve(strict=True)
    if resolved != path:
        raise SystemExit(f"build base traverses an alias: {path}")
    return resolved

work_base = ensure_base(work_base, 0o755)
evidence_base = ensure_base(evidence_base, 0o750)
target_root = work_base / target_tree
if os.path.lexists(target_root):
    metadata = os.lstat(target_root)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise SystemExit("target build root is not a real directory")
    if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
        raise SystemExit("target build root owner/group differs from controller")
    shutil.rmtree(target_root)
target_root.mkdir(mode=0o755)
source_root = target_root / "source"
source_root.mkdir(mode=0o755)
owned = []
for name in ("deps", ".build-home", ".npm-cache", ".build-tmp"):
    child = target_root / name
    child.mkdir(mode=0o700)
    os.chown(child, build_uid, build_gid)
    owned.append(child)
evidence_root = Path(tempfile.mkdtemp(prefix=f"{target_tree}.", dir=evidence_base))
os.chmod(evidence_root, 0o700)
print("\t".join((
    str(target_root), str(source_root), str(owned[0]), str(owned[1]),
    str(owned[2]), str(owned[3]), str(evidence_root),
)))
PY_BUILD_ROOTS
  ); then
    log "FATAL: could not prepare deterministic build/evidence roots"
    return 73
  fi
  IFS=$'\t' read -r \
    BUILD_TARGET_ROOT BUILD_SOURCE_ROOT BUILD_DEPS_ROOT BUILD_HOME_DIR \
    BUILD_NPM_CACHE BUILD_TMP_DIR BUILD_EVIDENCE_DIR <<< "$prepared"
  [ "$BUILD_TARGET_ROOT" = "$BUILD_WORK_ROOT_BASE/$TARGET_TREE" ] || {
    log "FATAL: deterministic target build root disagrees with admitted tree"
    return 73
  }
}


bootstrap_controller_evidence(){
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$EXPECTED_GIT_PATH" "$SRC" "$TARGET_SHA" "$BUILD_EVIDENCE_DIR" <<'PY_CONTROLLER_EVIDENCE'
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

git_path = sys.argv[1]
repository = Path(sys.argv[2])
target_sha = sys.argv[3]
evidence = Path(sys.argv[4])
full_sha = re.compile(r"^[0-9a-f]{40}$")
files = {
    "ops/terminal_build_projection.py": "projection-helper.py",
    "ops/terminal_build_projection.json": "projection-policy.json",
    "ops/terminal_build_receipt.py": "receipt-helper.py",
    "terminal/package.json": "package.json",
    "terminal/package-lock.json": "package-lock.json",
}
env = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/nonexistent",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "TZ": "UTC",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_SYSTEM": "/dev/null",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_ASKPASS": "/bin/false",
    "GIT_LITERAL_PATHSPECS": "1",
}

def git(*args: str) -> bytes:
    result = subprocess.run(
        [git_path, "-C", str(repository), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.stderr.decode("utf-8", errors="replace"))
    return result.stdout

if not full_sha.fullmatch(target_sha):
    raise SystemExit("controller evidence target is invalid")
metadata = os.lstat(evidence)
if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
    raise SystemExit("controller evidence root is not a real directory")
if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid() or stat.S_IMODE(metadata.st_mode) != 0o700:
    raise SystemExit("controller evidence root custody is invalid")
if any(evidence.iterdir()):
    raise SystemExit("controller evidence root is not empty")
for source, output_name in files.items():
    rows = [row for row in git("ls-tree", "-z", target_sha, "--", source).split(b"\0") if row]
    if len(rows) != 1:
        raise SystemExit(f"controller evidence source is absent or ambiguous: {source}")
    header, raw_path = rows[0].split(b"\t", 1)
    mode, kind, oid = header.decode("ascii").split(" ", 2)
    if raw_path.decode("utf-8") != source or kind != "blob" or mode not in {"100644", "100755"} or not full_sha.fullmatch(oid):
        raise SystemExit(f"controller evidence source is not a regular blob: {source}")
    payload = git("cat-file", "blob", oid)
    output = evidence / output_name
    mode = 0o444 if output_name in {"package.json", "package-lock.json"} else 0o400
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), mode)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
        os.fchmod(fd, mode)
    finally:
        os.close(fd)
PY_CONTROLLER_EVIDENCE
  then
    log "FATAL: could not bind controller evidence to exact admitted Git objects"
    return 66
  fi
}

materialize_build_projection(){
  local summary parsed
  summary="$BUILD_TARGET_ROOT/.projection-summary.json"
  if ! "$EXPECTED_PYTHON_PATH" -I "$BUILD_EVIDENCE_DIR/projection-helper.py" \
      --repository "$SRC" \
      --target-sha "$TARGET_SHA" \
      --destination "$BUILD_SOURCE_ROOT" \
      --evidence-dir "$BUILD_EVIDENCE_DIR" \
      --policy "$BUILD_EVIDENCE_DIR/projection-policy.json" \
      --git-path "$EXPECTED_GIT_PATH" \
      > "$summary"; then
    log "FATAL: exact Git-object build projection failed"
    return 66
  fi
  if ! parsed=$("$EXPECTED_PYTHON_PATH" -I - \
      "$summary" "$BUILD_EVIDENCE_DIR" "$TARGET_SHA" "$TARGET_TREE" <<'PY_PROJECTION_SUMMARY'
import json
import os
import stat
import sys
from pathlib import Path

def stable(path: Path, limit: int = 8 * 1024 * 1024) -> bytes:
    expected = os.lstat(path)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
        raise SystemExit(f"expected real file: {path}")
    if expected.st_size > limit:
        raise SystemExit(f"file exceeds bound: {path}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        payload = os.read(fd, limit + 1)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid, item.st_size, item.st_mtime_ns)
    if len(payload) > limit or identity(expected) != identity(before) or identity(before) != identity(after):
        raise SystemExit(f"file changed while read: {path}")
    return payload

summary_path = Path(sys.argv[1])
evidence = Path(sys.argv[2]).resolve(strict=True)
target_sha = sys.argv[3]
target_tree = sys.argv[4]
value = json.loads(stable(summary_path).decode("utf-8"))
if set(value) != {"schema", "target_sha", "target_tree", "projection_sha256", "manifest"}:
    raise SystemExit("projection summary schema is open or incomplete")
if value["schema"] != "mastermind.terminal.build_projection.v1":
    raise SystemExit("projection summary schema is invalid")
if value["target_sha"] != target_sha or value["target_tree"] != target_tree:
    raise SystemExit("projection summary target/tree mismatch")
manifest = Path(value["manifest"])
if manifest.parent != evidence or manifest.resolve(strict=True) != manifest:
    raise SystemExit("projection manifest escaped or aliased its evidence root")
print("\t".join((str(manifest), value["projection_sha256"])))
PY_PROJECTION_SUMMARY
  ); then
    log "FATAL: exact build projection readback failed"
    return 66
  fi
  IFS=$'\t' read -r BUILD_PROJECTION_MANIFEST BUILD_PROJECTION_DIGEST <<< "$parsed"
  log "exact build projection materialized: target=$TARGET_SHA tree=$TARGET_TREE digest=$BUILD_PROJECTION_DIGEST"
}

prepare_build_mountpoints(){
  local stage=$1
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$stage" "$BUILD_DEPS_ROOT" "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" \
      "$EXPECTED_CONTROLLER_UID" "$EXPECTED_CONTROLLER_GID" <<'PY_BUILD_MOUNTS'
import os
import stat
import sys
from pathlib import Path
stage = Path(sys.argv[1])
deps = Path(sys.argv[2])
uid = int(sys.argv[3])
gid = int(sys.argv[4])
controller_uid = int(sys.argv[5])
controller_gid = int(sys.argv[6])
for path in (stage, deps):
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise SystemExit(f"build path is not a real directory: {path}")
for name in ("package.json", "package-lock.json"):
    package = stage / name
    item = os.lstat(package)
    if stat.S_ISLNK(item.st_mode) or not stat.S_ISREG(item.st_mode):
        raise SystemExit(f"accepted package input is not a real file: {package}")
    if (
        item.st_uid != controller_uid
        or item.st_gid != controller_gid
        or item.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        raise SystemExit(f"accepted package input custody differs from controller: {package}")
    if stat.S_IMODE(item.st_mode) != 0o644:
        raise SystemExit(f"accepted package input mode is not 0644: {package}")
    target = deps / name
    fd = os.open(
        target,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0),
        0o400,
    )
    os.close(fd)
next_dir = stage / ".next"
if os.path.lexists(next_dir):
    raise SystemExit(f"projection unexpectedly contains generated build path: {next_dir}")
next_dir.mkdir(mode=0o700)
os.chown(next_dir, uid, gid)
node_modules = stage / "node_modules"
if os.path.lexists(node_modules):
    raise SystemExit(f"projection unexpectedly contains generated build path: {node_modules}")
node_modules.mkdir(mode=0o555)
os.chmod(node_modules, 0o555)
next_env = stage / "next-env.d.ts"
if os.path.lexists(next_env):
    raise SystemExit("projection unexpectedly contains generated next-env.d.ts")
content = (
    '/// <reference types="next" />\n'
    '/// <reference types="next/image-types/global" />\n'
    'import "./.next/types/routes.d.ts";\n\n'
    '// NOTE: This file should not be edited\n'
    '// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n'
).encode("utf-8")
fd = os.open(
    next_env,
    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0),
    0o444,
)
try:
    view = memoryview(content)
    while view:
        written = os.write(fd, view)
        view = view[written:]
    os.fsync(fd)
    os.fchmod(fd, 0o444)
finally:
    os.close(fd)
PY_BUILD_MOUNTS
  then
    log "FATAL: could not prepare reviewed install/build bind mountpoints"
    return 73
  fi
}

grant_build_output_custody(){
  local stage=$1
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$stage/.next" "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" <<'PY_OUTPUT_CUSTODY'
import os
import stat
import sys
from pathlib import Path
root = Path(sys.argv[1])
uid = int(sys.argv[2])
gid = int(sys.argv[3])
metadata = os.lstat(root)
if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
    raise SystemExit("build output root is not a real directory")
for current, directories, files in os.walk(root, topdown=False, followlinks=False):
    current_path = Path(current)
    for name in files:
        path = current_path / name
        item = os.lstat(path)
        if stat.S_ISLNK(item.st_mode) or not stat.S_ISREG(item.st_mode):
            raise SystemExit(f"build output contains unsupported pre-build path: {path}")
        os.chown(path, uid, gid, follow_symlinks=False)
    for name in directories:
        path = current_path / name
        item = os.lstat(path)
        if stat.S_ISLNK(item.st_mode) or not stat.S_ISDIR(item.st_mode):
            raise SystemExit(f"build output contains unsupported pre-build directory: {path}")
        os.chown(path, uid, gid, follow_symlinks=False)
os.chown(root, uid, gid, follow_symlinks=False)
PY_OUTPUT_CUSTODY
  then
    log "FATAL: could not grant bounded output custody to build principal"
    return 73
  fi
}

run_sandboxed_phase(){
  local phase=$1 working_directory=$2 private_network=$3
  shift 3
  local unit="mastermind-terminal-build-${phase}-${TARGET_SHA:0:12}-$$"
  local -a command=(
    "$EXPECTED_SYSTEMD_RUN_PATH"
    --quiet --wait --collect --pipe --service-type=exec
    --expand-environment=no
    --unit="$unit"
    --uid="$EXPECTED_BUILD_UID"
    --gid="$EXPECTED_BUILD_GID"
    --working-directory="$working_directory"
    --property=NoNewPrivileges=yes
    --property=CapabilityBoundingSet=
    --property=AmbientCapabilities=
    --property=ProtectSystem=strict
    --property=ProtectHome=yes
    --property=PrivateTmp=yes
    --property=PrivateDevices=yes
    --property=ProtectKernelTunables=yes
    --property=ProtectKernelModules=yes
    --property=ProtectKernelLogs=yes
    --property=ProtectControlGroups=yes
    --property=RestrictSUIDSGID=yes
    --property=LockPersonality=yes
    --property=RestrictRealtime=yes
    --property=SupplementaryGroups=
    "--property=RestrictAddressFamilies=AF_INET AF_INET6"
    --property=UMask=0077
    --property="PrivateNetwork=$private_network"
    --property="InaccessiblePaths=$APP"
    --property="InaccessiblePaths=$SRC"
    --property="InaccessiblePaths=$PREFLIGHT_RECEIPT_DIR"
    --property="InaccessiblePaths=$BUILD_RECEIPT_DIR"
    --property="InaccessiblePaths=$BUILD_EVIDENCE_DIR"
    --property="InaccessiblePaths=$BUILD_LOCK_DIR"
  )
  case "$phase" in
    identity)
      command+=(
        --property="ReadOnlyPaths=$BUILD_HOME_DIR"
      )
      ;;
    install)
      command+=(
        --property="InaccessiblePaths=$BUILD_SOURCE_ROOT"
        --property="ReadWritePaths=$BUILD_DEPS_ROOT"
        --property="ReadWritePaths=$BUILD_HOME_DIR"
        --property="ReadWritePaths=$BUILD_NPM_CACHE"
        --property="ReadWritePaths=$BUILD_TMP_DIR"
        --property="BindReadOnlyPaths=$BUILD_EVIDENCE_DIR/package.json:$BUILD_DEPS_ROOT/package.json"
        --property="BindReadOnlyPaths=$BUILD_EVIDENCE_DIR/package-lock.json:$BUILD_DEPS_ROOT/package-lock.json"
      )
      ;;
    build)
      command+=(
        --property="ReadOnlyPaths=$BUILD_SOURCE_ROOT"
        --property="BindReadOnlyPaths=$BUILD_DEPS_ROOT/node_modules:$working_directory/node_modules"
        --property="ReadWritePaths=$working_directory/.next"
        --property="ReadWritePaths=$BUILD_HOME_DIR"
        --property="ReadWritePaths=$BUILD_NPM_CACHE"
        --property="ReadWritePaths=$BUILD_TMP_DIR"
      )
      ;;
    *)
      log "FATAL: unknown sandbox phase: $phase"
      return 64
      ;;
  esac
  "${command[@]}" -- "$@"
}

verify_sandbox_principal(){
  local observed expected
  expected="$EXPECTED_BUILD_UID"$'\t'"$EXPECTED_BUILD_GID"$'\t'0
  if ! observed=$(
    run_sandboxed_phase identity "$BUILD_HOME_DIR" yes \
      "$EXPECTED_ENV_PATH" -i \
        PATH="$CLEAN_BUILD_PATH" HOME="$EXPECTED_BUILD_HOME" \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
        "$EXPECTED_PYTHON_PATH" -I - \
          "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" <<'PY_SANDBOX_PRINCIPAL'
import os
import sys
uid = int(sys.argv[1])
gid = int(sys.argv[2])
groups = sorted(set(os.getgroups()))
extras = sorted(group for group in groups if group != gid)
if os.getuid() != uid or os.getgid() != gid or extras:
    raise SystemExit(77)
print(f"{os.getuid()}\t{os.getgid()}\t{len(extras)}")
PY_SANDBOX_PRINCIPAL
  ); then
    log "FATAL: could not execute the effective build-principal sandbox probe"
    return 77
  fi
  if [ "$observed" != "$expected" ]; then
    log "FATAL: effective sandbox credentials differ from the reviewed build principal: $observed"
    return 77
  fi
}


prepare_sandbox_identity(){
  BUILD_SANDBOX_IDENTITY="$BUILD_EVIDENCE_DIR/build-sandbox-identity.json"
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$BUILD_SANDBOX_IDENTITY" "$EXPECTED_SYSTEMD_RUN_PATH" \
      "$EXPECTED_CONTROLLER_PATH" "$EXPECTED_SUDO_PATH" \
      "$EXPECTED_ENV_PATH" "$EXPECTED_BASH_PATH" <<'PY_SANDBOX_IDENTITY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
systemd_run_path, controller_path, sudo_path, env_path, bash_path = sys.argv[2:]
controller = Path(controller_path)
expected = os.lstat(controller)
if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
    raise SystemExit("canonical controller must be a real regular file")
if expected.st_uid != 0 or expected.st_gid != 0 or stat.S_IMODE(expected.st_mode) != 0o755:
    raise SystemExit("canonical controller custody/mode is invalid")
if expected.st_size <= 0 or expected.st_size > 4 * 1024 * 1024:
    raise SystemExit("canonical controller size is invalid")
flags = (
    os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
)
fd = os.open(controller, flags)
try:
    before = os.fstat(fd)
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > 4 * 1024 * 1024:
            raise SystemExit("canonical controller exceeds size bound")
        digest.update(chunk)
    after = os.fstat(fd)
finally:
    os.close(fd)
identity = lambda item: (
    item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
    item.st_size, item.st_mtime_ns,
)
if identity(expected) != identity(before) or identity(before) != identity(after):
    raise SystemExit("canonical controller changed while read")
payload = {
    "schema": "mastermind.terminal.build_sandbox_identity.v1",
    "systemd_run_path": systemd_run_path,
    "controller_entry": {
        "controller_path": controller_path,
        "controller_sha256": digest.hexdigest(),
        "sudo_path": sudo_path,
        "env_path": env_path,
        "bash_path": bash_path,
        "privileged_mode": True,
        "clean_environment": True,
    },
    "common_properties": [
        "AmbientCapabilities=",
        "CapabilityBoundingSet=",
        "LockPersonality=yes",
        "NoNewPrivileges=yes",
        "PrivateDevices=yes",
        "PrivateTmp=yes",
        "ProtectControlGroups=yes",
        "ProtectHome=yes",
        "ProtectKernelLogs=yes",
        "ProtectKernelModules=yes",
        "ProtectKernelTunables=yes",
        "ProtectSystem=strict",
        "RestrictRealtime=yes",
        "RestrictSUIDSGID=yes",
        "SupplementaryGroups=",
        "RestrictAddressFamilies=AF_INET AF_INET6",
        "UMask=0077",
    ],
    "phases": {
        "identity": {
            "private_network": True,
            "read_only_inputs": [],
            "writable_roots": [],
        },
        "install": {
            "private_network": False,
            "read_only_inputs": ["package.json", "package-lock.json"],
            "writable_roots": ["dependencies", "home", "npm_cache", "temporary"],
        },
        "build": {
            "private_network": True,
            "read_only_inputs": ["source", "node_modules"],
            "writable_roots": [".next", "home", "npm_cache", "temporary"],
        },
    },
}
data = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o400)
try:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]
    os.fsync(fd)
    os.fchmod(fd, 0o400)
finally:
    os.close(fd)
PY_SANDBOX_IDENTITY
  then
    log "FATAL: could not publish closed sandbox identity before target code"
    return 73
  fi
}

prepare_npm_configs(){
  local userconfig=$1 globalconfig=$2
  if ! "$EXPECTED_PYTHON_PATH" -I - \
      "$userconfig" "$globalconfig" "$EXPECTED_BUILD_UID" "$EXPECTED_BUILD_GID" <<'PY_NPM_CONFIGS'
import os
import sys
from pathlib import Path
uid = int(sys.argv[3])
gid = int(sys.argv[4])
for raw in sys.argv[1:3]:
    path = Path(raw)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600)
    try:
        os.fchown(fd, uid, gid)
        os.fchmod(fd, 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)
PY_NPM_CONFIGS
  then
    log "FATAL: could not create private npm configuration under build-principal custody"
    return 73
  fi
}

run_isolated_terminal_build(){
  local stage=$1 live_app=$2 stage_root=$3 npm_userconfig npm_globalconfig rc
  npm_userconfig="$BUILD_HOME_DIR/.npm-userconfig"
  npm_globalconfig="$BUILD_HOME_DIR/.npm-globalconfig"
  prepare_npm_configs "$npm_userconfig" "$npm_globalconfig" || return $?
  prepare_build_mountpoints "$stage" || return $?

  BUILD_PUBLIC_ENV_IDENTITY="$BUILD_EVIDENCE_DIR/public-build-env-identity.json"
  BUILD_KEY_IDENTITY="$BUILD_EVIDENCE_DIR/next-build-key-identity.json"
  prepare_public_build_env \
    "$live_app" "$stage" "$BUILD_PUBLIC_ENV_IDENTITY" || { rc=$?; return "$rc"; }
  prepare_next_build_keys \
    "$live_app" "$stage" "$BUILD_KEY_IDENTITY" || { rc=$?; return "$rc"; }
  prepare_sandbox_identity || return $?
  chmod 0444 "$stage/.env.production.local" || return $?
  grant_build_output_custody "$stage" || return $?

  log "isolated dependency install: npm ci from accepted package-lock"
  run_sandboxed_phase install "$BUILD_DEPS_ROOT" no \
    "$EXPECTED_ENV_PATH" -i \
      PATH="$CLEAN_BUILD_PATH" \
      HOME="$BUILD_HOME_DIR" TMPDIR="$BUILD_TMP_DIR" TMP="$BUILD_TMP_DIR" TEMP="$BUILD_TMP_DIR" \
      LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
      NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false \
      NPM_CONFIG_CACHE="$BUILD_NPM_CACHE" \
      NPM_CONFIG_USERCONFIG="$npm_userconfig" \
      NPM_CONFIG_GLOBALCONFIG="$npm_globalconfig" \
      "$EXPECTED_NPM_PATH" ci || { rc=$?; return "$rc"; }

  [ -x "$BUILD_DEPS_ROOT/node_modules/.bin/next" ] || {
    log "FATAL: accepted dependency install did not provide Next build binary"
    return 66
  }
  log "next build (static principal; source/dependencies read-only; network disabled) ..."
  run_sandboxed_phase build "$stage" yes \
    "$EXPECTED_ENV_PATH" -i \
      PATH="$stage/node_modules/.bin:$CLEAN_BUILD_PATH" \
      HOME="$BUILD_HOME_DIR" TMPDIR="$BUILD_TMP_DIR" TMP="$BUILD_TMP_DIR" TEMP="$BUILD_TMP_DIR" \
      LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production \
      NEXT_TELEMETRY_DISABLED=1 \
      GIT_SHA="$TARGET_SHA" NEXT_DEPLOYMENT_ID="$TARGET_SHA" \
      "$stage/node_modules/.bin/next" build || { rc=$?; return "$rc"; }
}

publish_build_receipt(){
  local helper=$1 stage=$2 stage_root=$3 summary_file parsed
  [ -f "$helper" ] && [ ! -L "$helper" ] || {
    log "FATAL: target build receipt helper is missing or symlinked"
    return 66
  }
  prepare_build_receipt_dir || return $?
  summary_file="$stage_root/.build-receipt-summary.json"
  if ! "$EXPECTED_PYTHON_PATH" -I "$helper" \
      --terminal-root "$stage" \
      --receipt-dir "$BUILD_RECEIPT_DIR" \
      --target-sha "$TARGET_SHA" \
      --target-tree "$TARGET_TREE" \
      --accepted-ref-sha "$ACCEPTED_REF_SHA" \
      --preflight-accepted-sha "$PREFLIGHT_ACCEPTED_SHA" \
      --preflight-receipt-id "$PREFLIGHT_RECEIPT_ID" \
      --preflight-source-receipt-id "$PREFLIGHT_SOURCE_RECEIPT_ID" \
      --preflight-policy-digest "$PREFLIGHT_POLICY_DIGEST" \
      --node-path "$EXPECTED_NODE_PATH" \
      --node-version "$BUILD_NODE_VERSION" \
      --npm-path "$EXPECTED_NPM_PATH" \
      --npm-version "$BUILD_NPM_VERSION" \
      --build-os "$BUILD_OS" \
      --build-arch "$BUILD_ARCH" \
      --os-id "$BUILD_OS_ID" \
      --os-version-id "$BUILD_OS_VERSION_ID" \
      --libc "$BUILD_LIBC" \
      --public-env-identity "$BUILD_PUBLIC_ENV_IDENTITY" \
      --public-env-file "$stage/.env.production.local" \
      --build-key-identity "$BUILD_KEY_IDENTITY" \
      --projection-manifest "$BUILD_PROJECTION_MANIFEST" \
      --build-uid "$EXPECTED_BUILD_UID" \
      --build-gid "$EXPECTED_BUILD_GID" \
      --build-user "$EXPECTED_BUILD_USER" \
      --build-group "$EXPECTED_BUILD_GROUP" \
      --build-home "$EXPECTED_BUILD_HOME" \
      --build-shell "$EXPECTED_BUILD_SHELL" \
      --sandbox-identity "$BUILD_SANDBOX_IDENTITY" \
      --application-root "$stage" \
      > "$summary_file"; then
    log "FATAL: build receipt publication failed"
    return 64
  fi
  if ! parsed=$("$EXPECTED_PYTHON_PATH" -I - "$summary_file" "$TARGET_SHA" "$BUILD_RECEIPT_DIR" <<'PY_BUILD_SUMMARY'
import json
import re
import sys
from pathlib import Path
summary = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if summary.get("schema") != "mastermind.terminal.build_receipt.v1" or summary.get("result") != "BUILT":
    raise SystemExit("invalid build receipt summary")
if summary.get("target_sha") != sys.argv[2]:
    raise SystemExit("build receipt target mismatch")
for key in ("receipt_id", "input_fingerprint", "serving_digest"):
    if re.fullmatch(r"[0-9a-f]{64}", str(summary.get(key, ""))) is None:
        raise SystemExit(f"invalid build receipt summary field: {key}")
receipt_root = Path(sys.argv[3]).resolve(strict=True)
raw_path = Path(str(summary.get("receipt_path", "")))
path = raw_path.resolve(strict=True)
if raw_path != path or path.parent != receipt_root:
    raise SystemExit("build receipt escaped or aliased its reviewed directory")
print("\t".join((str(path), summary["receipt_id"], summary["input_fingerprint"], summary["serving_digest"])))
PY_BUILD_SUMMARY
  ); then
    log "FATAL: build receipt readback failed"
    return 64
  fi
  IFS=$'\t' read -r BUILD_RECEIPT_PATH BUILD_RECEIPT_ID BUILD_INPUT_FINGERPRINT BUILD_SERVING_DIGEST <<< "$parsed"
  log "build receipt BUILT: target=$TARGET_SHA receipt=$BUILD_RECEIPT_PATH input=$BUILD_INPUT_FINGERPRINT serving_digest=$BUILD_SERVING_DIGEST"
}

# ── deploy generation: the identity and the build it names move together ──────
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
# against a temp dir; sourcing stops at the guard below and deploys nothing.

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
# `"$EXPECTED_SYSTEMCTL_PATH" restart` terminated the deploy with the marker already advanced and
# .next possibly displaced, and rollback never ran at all. The swap case was the
# worst of them — the old .next has already been moved to .next.bak by then, so the
# box was left advertising the new commit with NO live build. Always returns
# non-zero; the caller exits on it.
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
    "$EXPECTED_SYSTEMCTL_PATH" restart terminal || { log "restart after rollback FAILED"; rc=1; }
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

# The only identity report. Routing every log line through one place is what stops
# a future edit from cheerfully reporting two of the three identities.
deploy_identity_line(){
  local app=$1 want_sha=$2 marker build
  marker=$(cat "$app/.deployment-id" 2>/dev/null || echo '<absent>')
  build=$(cat "$app/.next/BUILD_ID" 2>/dev/null || echo '<absent>')
  echo "intended=$want_sha marker=$marker BUILD_ID=$build"
}

# Sourced -> expose the library and stop. Executed -> deploy.
# Gated on sourced-ness, NOT an environment variable: an inherited env var would
# turn a real root deploy into a silent `exit 0` that shipped nothing while every
# caller recorded success — the same "certify a deploy that never happened" failure
# this script exists to prevent. Sourced-ness cannot be forged by the environment.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

# Argument shape and the immutable target syntax are pure and are checked on both
# passes. Invalid requests never cross the privilege boundary; the clean root pass
# rechecks the same bytes before any release effect.
if ! { [ "$#" -eq 2 ] && [ "$1" = "--target-sha" ]; }; then
  log "USAGE: $0 --target-sha <full-lowercase-40-hex-commit>"
  exit 64
fi
TARGET_SHA=$2
validate_target_sha "$TARGET_SHA" || exit $?

# Privilege is acquired only through sudo's setuid/sanitized boundary. The
# unprivileged first pass may inherit a hostile user environment, but it performs
# no release effect and can invoke only this exact controller through the reviewed
# sudoers command. The privileged pass starts under env -i + bash -p; direct root
# execution is refused so LD_PRELOAD/BASH_ENV cannot become an accepted root path.
if [ "${MMX_TERMINAL_BUILD_PRIVILEGED_ENTRY:-}" != 1 ]; then
  if [ "$EUID" -eq 0 ]; then
    log "FATAL: direct root controller entry is forbidden; use the admitted sudo launcher"
    exit 77
  fi
  [ -x "$EXPECTED_SUDO_PATH" ] && [ -x "$EXPECTED_ENV_PATH" ] && [ -x "$EXPECTED_BASH_PATH" ] || {
    log "FATAL: admitted sudo/env/bash launcher binaries are unavailable"
    exit 77
  }
  exec "$EXPECTED_SUDO_PATH" -n -- \
    "$EXPECTED_ENV_PATH" -i \
      PATH="$CLEAN_BUILD_PATH" HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
      MMX_TERMINAL_BUILD_PRIVILEGED_ENTRY=1 \
      "$EXPECTED_BASH_PATH" -p "$EXPECTED_CONTROLLER_PATH" "$@"
  log "FATAL: admitted sudo launcher returned without replacing the process"
  exit 77
fi
if [ "$EUID" -ne 0 ]; then
  log "FATAL: privileged controller entry did not obtain uid 0"
  exit 77
fi
if [ "$0" != "$EXPECTED_CONTROLLER_PATH" ]; then
  log "FATAL: privileged controller path is not canonical: $0"
  exit 77
fi
unset MMX_TERMINAL_BUILD_PRIVILEGED_ENTRY

sanitize_git_environment
acquire_deploy_lock || exit $?

# 0) CURRENT-GENERATION PREFLIGHT — before fetch/reset/clean/build/source writes.
if [ ! -d "$SRC/.git" ]; then
  log "FATAL: canonical checkout missing. Create it once with:"
  log "  git clone --branch $BRANCH git@github-mmterminal:mastermindx-market-intelligence/mastermind-terminal.git $SRC"
  exit 1
fi
select_preflight_artifacts 0 "$AUTHORING_OPS_DIR" "$SRC/ops"
log "preflight bundle selected: script_sha256=$PREFLIGHT_SCRIPT_SHA256 policy_digest=$PREFLIGHT_POLICY_DIGEST runtime_sha256=$PREFLIGHT_RUNTIME_SHA256"
prepare_preflight_receipt_dir "$PREFLIGHT_RECEIPT_DIR"
run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$SRC" "$PREFLIGHT_RECEIPT_DIR"

# 1) EXACT TARGET GATE — fetch the accepted ref, then pin every later step to
# the caller's admitted full SHA. A later branch movement cannot change target.
log "fetching accepted ref origin/$BRANCH for exact target admission ..."
ACCEPTED_REF="refs/remotes/origin/$BRANCH"
fetch_accepted_ref "$SRC" origin "$BRANCH" "$ACCEPTED_REF"
admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF_SHA"
verify_build_runtime || exit $?
verify_build_principal || exit $?
TARGET_TREE=$("$EXPECTED_GIT_PATH" -C "$SRC" rev-parse --verify "${TARGET_SHA}^{tree}" 2>/dev/null) || {
  log "FATAL: admitted target tree is unavailable: $TARGET_SHA"
  exit 65
}
[[ "$TARGET_TREE" =~ ^[0-9a-f]{40}$ ]] || {
  log "FATAL: admitted target tree did not resolve to one full object ID"
  exit 65
}
FULL_SHA=$TARGET_SHA
SHA=${FULL_SHA:0:12}
log "build runtime admitted: node=$BUILD_NODE_VERSION npm=$BUILD_NPM_VERSION os=$BUILD_OS arch=$BUILD_ARCH distro=$BUILD_OS_ID/$BUILD_OS_VERSION_ID libc=$BUILD_LIBC"
log "GIT-GATED: building accepted target $FULL_SHA from captured origin/$BRANCH tip $ACCEPTED_REF_SHA"

# 2) EXACT SOURCE PROJECTION + ISOLATED DEPENDENCIES — materialize the admitted
# Git tree path-by-path under one deterministic application root. Repository-local
# archive attributes and unrelated accepted roots cannot alter the build input.
prepare_build_receipt_dir || exit $?
prepare_build_roots || exit $?
verify_sandbox_principal || exit $?
bootstrap_controller_evidence || exit $?
materialize_build_projection || exit $?
STAGE_ROOT=$BUILD_TARGET_ROOT
STAGE="$BUILD_SOURCE_ROOT/terminal"
[ -f "$STAGE/package.json" ] && [ -f "$STAGE/package-lock.json" ] || {
  log "FATAL: admitted Terminal package contract is incomplete"
  exit 66
}
printf '%s\n' "$FULL_SHA" > "$STAGE/.deployment-id"
chmod 0644 "$STAGE/.deployment-id"
run_isolated_terminal_build "$STAGE" "$APP" "$STAGE_ROOT" || exit $?

# 3) BUILD PROOF — immutable receipt is required before any live generation or
# canonical-working-tree convergence effect.
if [ ! -f "$STAGE/.next/BUILD_ID" ]; then
  log "BUILD FAILED (no BUILD_ID) — live site untouched, aborting"
  exit 1
fi
NEW_BUILD_ID=$(cat "$STAGE/.next/BUILD_ID")
publish_build_receipt "$BUILD_EVIDENCE_DIR/receipt-helper.py" "$STAGE" "$STAGE_ROOT" || exit $?
log "new isolated build OK: BUILD_ID=$NEW_BUILD_ID sha=$FULL_SHA receipt=$BUILD_RECEIPT_ID"

# 4) CANONICAL CHECKOUT CONVERGENCE — only after the build is immutable and
# receipted.  Later W2B-C owns full transactional runtime-dependency/source effects.
"$EXPECTED_GIT_PATH" -C "$SRC" reset -q --hard "$TARGET_SHA"
"$EXPECTED_GIT_PATH" -C "$SRC" clean -qfd
FULL_SHA=$("$EXPECTED_GIT_PATH" -C "$SRC" rev-parse HEAD)
[ "$FULL_SHA" = "$TARGET_SHA" ] || {
  log "FATAL: canonical checkout did not land on receipted target: wanted=$TARGET_SHA actual=$FULL_SHA"
  exit 65
}


# 5) Pin the same deployment id for `next start`, which evaluates next.config.ts again.
#    Install it only after the staged build verifies, immediately before the atomic
#    build swap — and open a deploy generation as it goes, so the prior marker is
#    snapshotted and a failed health check can restore identity and build together.
deploy_generation_begin "$APP" "$STAGE/.deployment-id"

# 6) atomic swap (rename within one filesystem is atomic).
#    Every move is guarded. A bare `set -e` abort here would end the deploy with the
#    marker already advanced by step 5 and the live .next already moved aside, and
#    rollback would never run — see deploy_generation_abort.
SWAPPED=0
if ! rm -rf "$APP/.next.bak"; then
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "could not clear .next.bak" || exit 1
fi
if [ -d "$APP/.next" ] && ! mv "$APP/.next" "$APP/.next.bak"; then
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
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "could not swap in the new build" || exit 1
fi
log "swapped .next (previous build kept as .next.bak)"

# 7) restart onto the complete build, then accept the generation only if it is
#    coherent. A 200 is not proof of a deploy: a stale or rolled-back build answers
#    it just as happily. The generation is accepted only when the intended SHA, the
#    live marker and the live BUILD_ID all agree, and any rejection rolls identity
#    and build back TOGETHER.
if ! "$EXPECTED_SYSTEMCTL_PATH" restart terminal; then
  deploy_generation_abort "$APP" "$FULL_SHA" "$SWAPPED" "systemctl restart failed" || exit 1
fi
sleep 6
DEPLOY_OK=1
if "$EXPECTED_CURL_PATH" -fsS http://127.0.0.1:3000/ -o /dev/null -w "[build] localhost:3000 -> %{http_code}\n"; then
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

# 8) RUNTIME-CODE SYNC — cron + systemd consume code from /opt/terminal/<dir> that is
#    NOT part of the Next.js app; without this step, merged changes to those files
#    silently never reach the box (bit on 2026-07-10: PR #74's pull_macro_intel.py).
#    OVERLAY semantics (git archive | tar -x): tracked files are overwritten with
#    master; box-only untracked files (runtime caches like ingest/hk_universe_cache.json,
#    zh_cache.json, .polygon_*.json and *.bak-* backups) are left alone. NEVER convert
#    this to rsync --delete — those caches exist ONLY on the box.
#    signal_layer/ synced since 2026-07-10: the box↔master divergence was reconciled
#    (box GC-v2 engine incl. confluence_v2.py committed; master's inverted golden_gate
#    kept) — origin/master is now canonical for it, like ingest/.
RUNTIME_PATHS="ingest scripts config contracts hub signal_layer"
hub_state(){ find /opt/terminal/hub -type f -not -path '*/node_modules/*' -print0 2>/dev/null | sort -z | xargs -0 "$EXPECTED_SHA256SUM_PATH" 2>/dev/null | "$EXPECTED_SHA256SUM_PATH" || true; }
HUB_BEFORE=$(hub_state)
LOCK_BEFORE=$("$EXPECTED_SHA256SUM_PATH" /opt/terminal/hub/package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
log "runtime sync <- origin/$BRANCH: $RUNTIME_PATHS"
"$EXPECTED_GIT_PATH" -C "$SRC" archive HEAD -- $RUNTIME_PATHS | "$EXPECTED_TAR_PATH" -x -C /opt/terminal/

# quote-hub runs hub/hub.js as a systemd service — npm ci if the lockfile moved, and
# restart ONLY when hub/ actually changed (a restart briefly drops live WS clients).
LOCK_AFTER=$("$EXPECTED_SHA256SUM_PATH" /opt/terminal/hub/package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "hub lockfile changed — npm ci"
  ( cd /opt/terminal/hub && "$EXPECTED_NPM_PATH" ci --omit=dev || "$EXPECTED_NPM_PATH" install --omit=dev )
fi
HUB_AFTER=$(hub_state)
if [ "$HUB_BEFORE" != "$HUB_AFTER" ]; then
  "$EXPECTED_SYSTEMCTL_PATH" restart quote-hub
  log "quote-hub restarted (hub/ changed)"
else
  log "hub/ unchanged — quote-hub not restarted"
fi

# cron wrapper: crontab (30 21 * * *) runs /usr/local/bin/terminal-data; its authoring
# source is ops/terminal-data (ops/README.md). Installed via temp+rename so a mid-run
# nightly keeps executing its already-open copy.
install -m 0755 "$SRC/ops/terminal-data" /usr/local/bin/.terminal-data.new
mv -f /usr/local/bin/.terminal-data.new /usr/local/bin/terminal-data
log "installed ops/terminal-data -> /usr/local/bin/terminal-data"

# self-update: rename = new inode, so the currently-running instance is untouched;
# the new script takes effect on the NEXT deploy.
install -m 0755 "$SRC/ops/terminal-build.sh" /opt/terminal/.terminal-build.sh.new
mv -f /opt/terminal/.terminal-build.sh.new /opt/terminal/terminal-build.sh
log "installed ops/terminal-build.sh -> /opt/terminal/terminal-build.sh (effective next run)"

# 9) reflect canonical master into $APP source (so the on-box source == what is live/committed,
#    and any stray working-tree edits are cleared — enforcing 'master is the source of truth').
log "syncing $APP source <- origin/$BRANCH:terminal"
"$EXPECTED_RSYNC_PATH" -a --delete \
  --exclude='.next' --exclude='.next.bak' --exclude='.next.broken' --exclude='.stage.*' \
  --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='public/data' \
  --exclude='.deployment-id' --exclude='.deployment-id.bak' --exclude='.deployment-id.absent' \
  --exclude='.deployment-id.new' \
  "$TSRC/" "$APP/"

# 10) suite-alerts sidecar bundle: ingest/suite_alerts.ts imports terminal/lib (the real suite
#    modules — zero algorithm duplication), so the 5-min cron consumes an esbuild bundle at
#    ingest/dist/suite_alerts.mjs (untracked → preserved by the step-8 overlay). Bundled here,
#    AFTER steps 8+9, so both ingest/ and $APP/lib are already synced to this deploy's SHA.
#    Non-fatal on purpose: the app is live by now — a bundle failure must not roll it back
#    (the cron just keeps running the previous bundle).
log "bundling ingest/suite_alerts.ts -> ingest/dist/suite_alerts.mjs"
if ( cd "$APP" && "$EXPECTED_NPX_PATH" esbuild ../ingest/suite_alerts.ts --bundle --platform=node --format=esm \
      --outfile=../ingest/dist/suite_alerts.mjs "--alias:@=." --log-level=warning ); then
  log "installed ingest/dist/suite_alerts.mjs (suite_event alerts cron)"
else
  log "WARN: suite_alerts bundle FAILED — cron keeps the previous bundle"
fi

log "DONE — live = origin/$BRANCH @ $SHA (app + runtime code, git-gated, healthy)"
