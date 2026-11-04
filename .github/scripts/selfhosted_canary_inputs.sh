#!/usr/bin/env bash
# Validate the self-hosted e2e canary dispatch inputs (review finding on #1277).
#
# Inputs reach this script ONLY as environment variables (CANARY_SHARD, CANARY_WORKERS),
# never as workflow-expression text spliced into shell source, so a quote, `;`, `$(...)`
# or any other metacharacter in a dispatch value is data, not syntax. The shard label is
# mapped to its Playwright selector through a FIXED table that mirrors the ci.yml
# `terminal-e2e` matrix (tests/test_selfhosted_canary_workflow.py fails if they drift),
# so the canary always runs the hosted shard's exact equivalent. Workers must be an
# integer in 1..16. On success the validated values are appended to $GITHUB_ENV (or
# stdout when unset); on any rejection nothing is written and the exit code is 2.
set -euo pipefail

shard="${CANARY_SHARD:-}"
workers="${CANARY_WORKERS:-}"

case "$shard" in
  desktop-1) projects="--project=desktop --shard=1/5" ;;
  desktop-2) projects="--project=desktop --shard=2/5" ;;
  desktop-3) projects="--project=desktop --shard=3/5" ;;
  desktop-4) projects="--project=desktop --shard=4/5" ;;
  desktop-5) projects="--project=desktop --shard=5/5" ;;
  tablet-1) projects="--project=tablet --shard=1/3" ;;
  tablet-2) projects="--project=tablet --shard=2/3" ;;
  tablet-3) projects="--project=tablet --shard=3/3" ;;
  mobile-1) projects="--project=mobile --shard=1/3" ;;
  mobile-2) projects="--project=mobile --shard=2/3" ;;
  mobile-3) projects="--project=mobile --shard=3/3" ;;
  serial) projects="--project=company-intelligence-desktop --project=company-intelligence-tablet --project=company-intelligence-mobile --project=terminal-chrome-intermediate --project=w2a-workspaces" ;;
  *)
    printf '::error::CANARY_SHARD must be a ci.yml terminal-e2e shard label; rejected %q\n' "$shard" >&2
    exit 2
    ;;
esac

case "$workers" in
  ''|*[!0-9]*)
    printf '::error::CANARY_WORKERS must be an integer 1..16; rejected %q\n' "$workers" >&2
    exit 2
    ;;
esac
if [ "${#workers}" -gt 2 ] || [ "$workers" -lt 1 ] || [ "$workers" -gt 16 ]; then
  printf '::error::CANARY_WORKERS must be an integer 1..16; rejected %q\n' "$workers" >&2
  exit 2
fi

out="${GITHUB_ENV:-/dev/stdout}"
printf 'CANARY_PROJECTS=%s\nCANARY_WORKERS_OK=%s\n' "$projects" "$workers" >> "$out"
