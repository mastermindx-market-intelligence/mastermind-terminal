#!/usr/bin/env bash
# SOURCE PREPARATION ONLY. This is not an OPEN activation transaction.
# Reuse the incumbent installer library; do not copy its receipt verifier,
# publish another accepted record, change admission, or start/restart a unit.
set -euo pipefail
INVESTIGATION_PREFLIGHT_OWNER_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$INVESTIGATION_PREFLIGHT_OWNER_DIR/terminal-build.sh"

investigation_open_preflight(){
  local profile=${1-} expected_sha=${2-}
  if [ "$#" -ne 2 ] || [ "$profile" != beta ] ||
     ! [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'Investigation preflight requires beta and one full target SHA' >&2
    return 64
  fi
  select_release_target beta || return $?
  sanitize_git_environment
  # No fetch: the incumbent release must already have qualified this exact
  # installed generation. This check cannot promote a branch name to a target.
  if ! git -C "$SRC" merge-base --is-ancestor "$expected_sha" refs/remotes/origin/master; then
    printf '%s\n' 'Investigation preflight target is not in the protected source snapshot' >&2
    return 65
  fi
  if ! git -C "$SRC" cat-file -e "$expected_sha:terminal/lib/investigationApiAdmission.ts"; then
    printf '%s\n' 'Investigation preflight target does not contain the common admission primitive' >&2
    return 65
  fi
  # The actual incumbent validator rejects source-only/pending/unknown records,
  # verifies provenance and rollback baseline, and binds the live marker/build.
  beta_ordinary_deploy_gate || return $?
  if [ "${BETA_PRIOR_SHA:-}" != "$expected_sha" ]; then
    printf '%s\n' 'Investigation preflight installed generation does not match target' >&2
    return 65
  fi
  require_investigation_closed_after_start "$expected_sha" "${BETA_PRIOR_BUILD:-}" || return $?

  # These are source-contract gaps, not accepted attestations. No ready/receipt
  # JSON argument exists. Health, CLOSED, a runtime record and source hashes do
  # not prove all ingress, direct RPC or original operation outcomes (P1.T15).
  # Do not add an OPEN branch until the incumbent observer/verifier contracts
  # and effect recovery are implemented and independently qualified.
  printf '{"status":"SOURCE_PREPARATION","open_transaction_implemented":false,"installed_sha":"%s","missing_source_contracts":["all-ingress-direct-rpc-drain-observer","original-operation-inventory-and-live-receipt-binding","lawfully-admitted-schema-grants-receipt-verifier","unified-open-adoption-and-recovery-transaction"]}\n' "$expected_sha"
  return 78
}

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi
if [ "$#" -ne 4 ] || [ "$1" != --target ] || [ "$3" != --target-sha ]; then
  printf '%s\n' 'usage: investigation-open-preflight.sh --target beta --target-sha <40-hex>' >&2
  exit 64
fi
investigation_open_preflight "$2" "$4"
