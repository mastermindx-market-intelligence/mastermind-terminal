#!/usr/bin/env bash
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
# W2B-A adds only the fail-closed source/target entrance gate. The downstream
# build, app rollback and runtime-overlay behavior is otherwise unchanged here;
# later W2B slices still owe reproducible build and whole-release effect receipts.
set -euo pipefail

APP=/opt/terminal/terminal
SRC=/opt/terminal/.gitsrc            # canonical git checkout (read-only deploy key: github-mmterminal)
TSRC="$SRC/terminal"
BRANCH=master
AUTHORING_OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PREFLIGHT_RECEIPT_DIR=/var/lib/mastermind-terminal/release-preflight
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
    if ! evidence=$(python3 -I - "$directory" "$expected_uid" <<'PY_BUNDLE'
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
    PYTHONDONTWRITEBYTECODE=1 python3 -B -E -s "$script" \
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

  if ! parsed=$(python3 -I - "$stdout_file" "$receipt_dir" "$before_manifest" \
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
# `systemctl restart` terminated the deploy with the marker already advanced and
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
    systemctl restart terminal || { log "restart after rollback FAILED"; rc=1; }
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

if ! { [ "$#" -eq 2 ] && [ "$1" = "--target-sha" ]; }; then
  log "USAGE: $0 --target-sha <full-lowercase-40-hex-commit>"
  exit 64
fi
TARGET_SHA=$2
validate_target_sha "$TARGET_SHA" || exit $?
sanitize_git_environment

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
git -C "$SRC" reset -q --hard "$TARGET_SHA"
git -C "$SRC" clean -qfd
FULL_SHA=$(git -C "$SRC" rev-parse HEAD)
[ "$FULL_SHA" = "$TARGET_SHA" ] || {
  log "FATAL: canonical checkout did not land on admitted target: wanted=$TARGET_SHA actual=$FULL_SHA"
  exit 65
}
SHA=${FULL_SHA:0:12}
log "node $(node -v)"
log "GIT-GATED: deploying accepted target $FULL_SHA from origin/$BRANCH (working-tree edits in $APP are IGNORED)"

# 1) deps — from the canonical lockfile. Reuse $APP/node_modules unless the lock changed.
if [ ! -d "$APP/node_modules" ] || ! cmp -s "$TSRC/package-lock.json" "$APP/package-lock.json" 2>/dev/null; then
  log "installing deps (npm ci) — lockfile changed"
  cp -f "$TSRC/package.json" "$TSRC/package-lock.json" "$APP/" 2>/dev/null || true
  ( cd "$APP" && npm ci || npm install )
else
  log "deps unchanged — skipping npm ci"
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
STAGE_ROOT=$(mktemp -d "$(dirname "$APP")/.stage.XXXXXX")
trap 'rm -rf "$STAGE_ROOT"' EXIT
STAGE="$STAGE_ROOT/terminal"
mkdir -p "$STAGE"
# The gated dirs are archived to a file first: an EMPTY stream (a commit without them, or a
# stubbed git) must stage the app alone rather than abort — GNU tar rejects empty stdin.
GATED_TAR="$STAGE_ROOT/.gated.tar"
git -C "$SRC" archive HEAD -- ingest hub signal_layer config contracts > "$GATED_TAR"
if [ -s "$GATED_TAR" ]; then
  tar -x -f "$GATED_TAR" -C "$STAGE_ROOT/"
else
  log "gated runtime dirs: nothing archived from origin/$BRANCH — staging the app alone"
fi
rm -f "$GATED_TAR"
ln -s "$(dirname "$APP")/scripts" "$STAGE_ROOT/scripts"
log "staging origin/$BRANCH:terminal in $STAGE (+ gated ingest/hub/signal_layer/config/contracts beside it)"
rsync -a --delete \
  --exclude='.next' --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='public/data' \
  "$TSRC/" "$STAGE/"
cp -al "$APP/node_modules" "$STAGE/node_modules"     # hardlink copy: Turbopack rejects out-of-tree symlinks
cp -a "$APP/.env" "$STAGE/.env" 2>/dev/null || true
cp -a "$APP/.env.local" "$STAGE/.env.local" 2>/dev/null || true
printf '%s\n' "$FULL_SHA" > "$STAGE/.deployment-id"
mkdir -p "$STAGE/public"
cp -al "$APP/public/data" "$STAGE/public/data" 2>/dev/null || rsync -a "$APP/public/data/" "$STAGE/public/data/" 2>/dev/null || true

# 3) build into the staging tree — the slow part; live site stays up throughout.
log "next build (staging) ..."
# next.config.ts is evaluated in more than one build worker. Pin both supported
# deployment-id inputs to the ONE deployed commit so every HTML/RSC response and
# every static chunk uses the same ?dpl= value. The Date.now fallback is only for
# ad-hoc local builds.
( cd "$STAGE" && GIT_SHA="$FULL_SHA" NEXT_DEPLOYMENT_ID="$FULL_SHA" npm run build )

# 4) verify the new build is complete before touching anything live.
if [ ! -f "$STAGE/.next/BUILD_ID" ]; then
  log "BUILD FAILED (no BUILD_ID) — live site untouched, aborting"
  exit 1
fi
NEW_BUILD_ID=$(cat "$STAGE/.next/BUILD_ID")
# BUILD_ID is a constant literal while deploymentId is set (see deploy_identity_verified),
# so print the SHA beside it — the bare BUILD_ID line makes a healthy deploy look like a no-op.
log "new build OK: BUILD_ID=$NEW_BUILD_ID sha=$FULL_SHA"

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
rsync -a --delete \
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
if ( cd "$APP" && npx esbuild ../ingest/suite_alerts.ts --bundle --platform=node --format=esm \
      --outfile=../ingest/dist/suite_alerts.mjs "--alias:@=." --log-level=warning ); then
  log "installed ingest/dist/suite_alerts.mjs (suite_event alerts cron)"
else
  log "WARN: suite_alerts bundle FAILED — cron keeps the previous bundle"
fi

log "DONE — live = origin/$BRANCH @ $SHA (app + runtime code, git-gated, healthy)"
