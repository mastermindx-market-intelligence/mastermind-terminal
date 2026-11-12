#!/usr/bin/env bash
# Bind the `terminal-e2e` matrix job to its lane (Mastermind #917, phase 9).
#
# Inputs reach this script ONLY as environment variables, never as workflow-expression
# text spliced into shell source (review finding on #1277):
#   TERMINAL_E2E_LANE          hosted | selfhosted   (the job's resolved lane, from ci.yml)
#   TERMINAL_E2E_LANE_WORKERS  repository variable TERMINAL_E2E_WORKERS; empty = default
#   RUNNER_NAME                set by the runner; names the lane slot (ubuntuH-e2e-N)
#
# hosted     -> exactly today's behaviour: ONE Playwright worker and the config's default
#               ports (3108 for the sharded projects, 31991/31992 for the serial opt-ins).
# selfhosted -> the lane spans several hosts, each serving several runner slots at once.
#               The runner NAME ubuntuH-e2e-N carries the host digit H (0..9) and the
#               slot number N (1..9); host identity never reaches the labels. Every slot
#               owns a port set derived from its slot number N alone: 3200+N for the
#               shard, 32000+10N+1 / +2 for the serial opt-ins. The same N on different
#               hosts reuses the numbers by design: no two hosts share a network
#               namespace. Workers default to 4 (measured 2026-11-05: desktop-1 job
#               8m08s, command 431s; no full-matrix proof) and must be an integer
#               1..16 when the variable is set. A slot name that does not match
#               `ubuntuH-e2e-N`, or an invalid workers value, exits 2: a misnamed slot
#               would collide on ports with its neighbours, and silently defaulting an
#               operator typo hides the misconfiguration. The retired token `ubuntu0`
#               is refused like any other unknown value: the workflow and this script
#               always come from the same commit, so only pre-change revisions (which
#               carry the old script) can still resolve it.
# On success the bound values are appended to $GITHUB_OUTPUT (or stdout when unset);
# on any rejection nothing is written and the exit code is 2.
set -euo pipefail

lane="${TERMINAL_E2E_LANE:-hosted}"
workers_var="${TERMINAL_E2E_LANE_WORKERS:-}"
runner_name="${RUNNER_NAME:-}"

reject() {
  printf '::error::%s\n' "$1" >&2
  exit 2
}

case "$lane" in
  hosted)
    workers=1
    port=3108
    port_investor=31991
    port_shared=31992
    ;;
  selfhosted)
    case "$runner_name" in
      ubuntu[0-9]-e2e-[1-9]) slot="${runner_name##*-}" ;;
      *) reject "selfhosted lane needs a runner slot named ubuntuH-e2e-N (host digit 0..9, N in 1..9); rejected $(printf '%q' "$runner_name")" ;;
    esac
    if [ -z "$workers_var" ]; then
      workers=4
    else
      case "$workers_var" in
        0*|*[!0-9]*) reject "TERMINAL_E2E_WORKERS must be an integer 1..16; rejected $(printf '%q' "$workers_var")" ;;
      esac
      if [ "${#workers_var}" -gt 2 ] || [ "$workers_var" -lt 1 ] || [ "$workers_var" -gt 16 ]; then
        reject "TERMINAL_E2E_WORKERS must be an integer 1..16; rejected $(printf '%q' "$workers_var")"
      fi
      workers="$workers_var"
    fi
    port=$((3200 + slot))
    port_investor=$((32000 + 10 * slot + 1))
    port_shared=$((32000 + 10 * slot + 2))
    ;;
  *)
    reject "TERMINAL_E2E_LANE must be hosted or selfhosted; rejected $(printf '%q' "$lane")"
    ;;
esac

out="${GITHUB_OUTPUT:-/dev/stdout}"
# Playwright browser store. The hosted lane keeps today's literal cache path and key
# (byte-identical). Each slot gets its own store and cache key so concurrent shards on
# one host never restore a tar into a directory another slot's Chromium is running
# from, and so the lane never shares a cache entry with the hosted lane. The key uses
# the FULL runner name: host digit + slot is globally unique across the lane, so slots
# on different hosts can never collide on a cache entry even though they share port
# numbers, and an existing slot's warm entries keep their keys unchanged.
if [ "$lane" = selfhosted ]; then
  browsers_path="$HOME/.cache/ms-playwright-$runner_name"
  cache_suffix="-$runner_name"
  printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$browsers_path" >> "${GITHUB_ENV:-/dev/null}"
else
  browsers_path='~/.cache/ms-playwright'
  cache_suffix=''
fi
printf 'lane=%s\nworkers=%s\nport=%s\nport_investor=%s\nport_shared=%s\nbrowsers_path=%s\ncache_suffix=%s\n' \
  "$lane" "$workers" "$port" "$port_investor" "$port_shared" "$browsers_path" "$cache_suffix" >> "$out"
